// Publish one local video on member.bilibili.com (runs inside ego-browser).
// Config comes from /tmp/bilibili-video-publish.json written by publish.mjs.
// Exit 0: 投稿成功 (审核中). Exit 1: flow error. Exit 2: login required (handOff).
//
// B 站创作中心是 micro-app (shadow DOM):所有交互都用 shadow-walk 定位元素,
// 拿到坐标后 page.mouse.click。文件选择走 waitForFileChooser。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readConfigSync } from "./lib/config-file.mjs";
import {
  DECLARE_OPTIONS,
  PUBLISH_CONFIG_PATH,
  PUBLISH_OK_RE,
  centerRgba,
  classifyLogin,
  flowErrorBody,
  imageDimsFromBuffer,
  loginRequiredBody,
  declareChoice,
  judgeCoverIdentity,
  lumaGridFromRgba,
  pngFingerprint,
  manuscriptFromText,
  mayClickSubmit,
  partitionChoice,
  syncGate,
  publishSuccessBody,
  RATIO_4_3,
} from "./lib/pure.mjs";

let spaceId;
const fail = (msg, extra = {}) => {
  console.error(JSON.stringify(flowErrorBody(msg, { spaceId, ...extra })));
  process.exit(1);
};

if (typeof taskSpace !== "function") {
  fail("post-video.mjs must run inside ego-browser. Use: node scripts/publish.mjs --yes ...");
}

let cfg = null;
try {
  cfg = readConfigSync(PUBLISH_CONFIG_PATH);
} catch {
  cfg = null;
}
if (!cfg) {
  fail(`配置文件不存在: ${PUBLISH_CONFIG_PATH}。请通过 publish.mjs 调用,不要直接跑 post-video.mjs`);
}

const video = cfg.video || "";
const title = cfg.title || "";
const desc = cfg.desc || "";
const tags = Array.isArray(cfg.tags) ? cfg.tags : [];
const cover43 = cfg.cover43 || "";
const cover169 = cfg.cover169 || "";
const keep = Boolean(cfg.keep);
if (!video || !existsSync(video)) fail(`视频不存在: ${video}`);
if (!title || !String(title).trim()) fail("缺少标题(配置里应有 title)");

// --- shadow-DOM helpers, injected into every page.evaluate ---
const HELPERS = `
function* __walk(root){for(const el of root.querySelectorAll("*")){if(el.shadowRoot)yield* __walk(el.shadowRoot);yield el;}}
function __all(){return Array.from(__walk(document));}
function __own(el){return Array.from(el.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent.trim();}).join("").trim();}
function __visible(el){return !!(el.offsetParent || el.getClientRects().length);}
function __byTextExact(text){var es=__all().filter(function(el){return __own(el)===text && __visible(el);});return es[0]||null;}
function __point(el){var r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}
/* 表单会 reflow:点击前必须滚到可视区,否则坐标可能在视口外(如 y=-180) */
function __pointInView(el){el.scrollIntoView({block:"center"});return __point(el);}
function __textPoint(text){var el=__byTextExact(text);return el?__pointInView(el):null;}
function __hasText(re){var it=__walk(document);for(var s=it.next();!s.done;s=it.next()){var el=s.value;if(__own(el)&&re.test(__own(el))&&__visible(el))return true;}return false;}
function __shadowText(){var out="";var it=__walk(document);for(var s=it.next();!s.done;s=it.next()){var own=__own(s.value);if(own)out+=own+"\\n";if(out.length>4000)break;}return out;}
`;
// ego 的 evaluate 在第二个参数为 undefined 时会做 JSON 序列化校验并报错,
// 所以 arg 为空时干脆不传第二个参数。
const evBody = (body) => new Function("arg", `${HELPERS}\nreturn (${body})(arg);`);
const ev = (body, arg) => (arg === undefined ? page.evaluate(evBody(body)) : page.evaluate(evBody(body), arg));

const task = cfg.spaceId ? await taskSpace(cfg.spaceId) : await taskSpace("publish video to bilibili");
spaceId = task.spaceId;
const page = task.page("p1");
console.error(JSON.stringify({ spaceId, video, title }));

// B 站会弹通知权限打断自动化,先预授权(不支持项会抛错,忽略)。
try {
  await page.cdp("Browser.grantPermissions", { permissions: ["notifications"] });
} catch {
  // 老版本 ego 没有该接口时继续,靠用户手动处理弹窗。
}

await page.goto("https://member.bilibili.com/platform/upload/video/frame", { waitUntil: "domcontentloaded", timeout: 45000 });
try {
  await page.waitForLoadState("networkidle", { timeout: 8000 });
} catch {}
await page.waitForTimeout(2500);

// --- 登录闸门 ---
const probe = await ev(`function(arg){
  return { url: location.href, text: __shadowText() + "\\n" + (document.body.innerText||"") };
}`);
const classified = classifyLogin({ url: probe.url, text: probe.text });
if (!classified.logged_in) {
  console.log(JSON.stringify(loginRequiredBody({ spaceId, url: probe.url })));
  try {
    await task.handOff();
  } catch {}
  process.exit(2);
}

// --- 上传视频 ---
const uploadPt = await ev(`function(){
  var area=document.querySelector(".upload-area");
  if(area && __visible(area)) return __pointInView(area);
  var btn=__byTextExact("上传视频");
  if(!btn) return null;
  var el=btn.parentElement||btn;
  return __pointInView(el);
}`);
if (!uploadPt) fail("未找到上传区域(.upload-area),页面结构可能已变化");

const chooserPromise = page.waitForFileChooser({ timeout: 20000 });
await page.mouse.click(uploadPt.x, uploadPt.y, { label: "点击上传视频" });
let chooser;
try {
  chooser = await chooserPromise;
} catch {
  fail("点击上传区后没有弹出文件选择框(可能被权限弹窗打断,重跑并先处理浏览器弹窗)");
}
const picked = await chooser.setFiles(video);
if (picked && picked.dialog) await page.acceptDialog();
console.error("视频已交给浏览器,等待上传完成…");

// 上传完成信号在 shadow DOM 里:出现「上传完成 / 更换视频」。
let uploaded = false;
for (let i = 0; i < 300; i++) {
  await page.waitForTimeout(3000);
  const st = await ev(`function(arg){
    return {
      done: __hasText(/上传完成|更换视频/),
      failed: __hasText(/上传失败|解析失败/),
    };
  }`);
  if (st.failed) fail("视频上传失败(页面上出现「上传失败/解析失败」)");
  if (st.done) { uploaded = true; break; }
}
if (!uploaded) fail("等待视频上传完成超时(15 分钟)");
console.error("上传完成,等待投稿表单…");
await page.waitForTimeout(2000);

// --- 标题 ---
// 不能用原生 setter 写 value:只改显示、不更新 Vue 模型,投稿会发成文件名默认标题。
// 也不能只靠 execCommand:该 input 疑似 v-model.lazy,必须补 blur/change;
// 首选 CDP Input.insertText(真实输入事件),execCommand 作为回退。
const titleFocus = await ev(`function(value){
  var input=__all().find(function(el){return el.tagName==="INPUT" && /稿件标题/.test(el.placeholder||"");});
  if(!input) return {ok:false,error:"未找到标题输入框"};
  input.focus();
  input.setSelectionRange(0, input.value.length);
  return {ok:true,value:input.value};
}`, title);
if (!titleFocus.ok) fail(titleFocus.error || "标题输入框不可聚焦");
let cdpTyped = false;
try {
  await page.cdp("Input.insertText", { text: title });
  cdpTyped = true;
} catch {
  // 老版 ego 没有 cdp 或接口不可用时走 execCommand 回退
}
let titleResult = await ev(`function(value){
  var input=__all().find(function(el){return el.tagName==="INPUT" && /稿件标题/.test(el.placeholder||"");});
  if(!input) return {ok:false,error:"标题输入框消失"};
  if(!${cdpTyped ? "true" : "false"}) {
    input.focus();
    input.setSelectionRange(0, input.value.length);
    document.execCommand("insertText", false, value);
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
  return {ok:true,value:input.value};
}`, title);
if (!titleResult.ok) fail(titleResult.error || "标题写入失败");
if ((titleResult.value || "").trim() !== title.trim()) {
  fail(`标题写入异常: 期望「${title}」实际「${titleResult.value}」`);
}

// --- 标签:先清空表单预填,再加调用方的 ---
// 关闭按钮是 chip 的直接子元素 svg.close。行会重排,坐标点击会点错元素,
// 一律在 evaluate 里对 svg.close 派发合成 MouseEvent(Vue 不校验 isTrusted)。
for (let round = 0; round < 3; round++) {
  const removed = await ev(`function(){
    var removed=[];
    for(const el of __all()){
      if(String(el.className).indexOf("label-item-v2-container")<0 || !__visible(el)) continue;
      var icon=el.querySelector("svg.close");
      if(!icon) continue;
      icon.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
      removed.push(1);
    }
    return removed;
  }`);
  if (!removed.length) break;
  await page.waitForTimeout(800);
}
const remainingTags = await ev(`function(){
  return __all().filter(function(el){return String(el.className).indexOf("label-item-v2-content")>=0 && __visible(el);})
    .map(function(el){return __own(el);});
}`);
if (remainingTags.length > 0) {
  console.error(JSON.stringify({ note: "预填标签未能全部移除,保留现状", remaining: remainingTags }));
}

for (const tag of tags) {
  const added = await ev(`function(tag){
    var input=__all().find(function(el){return el.tagName==="INPUT" && /创建标签/.test(el.placeholder||"");});
    if(!input) return {ok:false,error:"未找到标签输入框"};
    var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
    setter.call(input,tag);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,which:13,bubbles:true}));
    return {ok:true};
  }`, tag);
  if (!added.ok) fail(added.error || "标签写入失败");
  await page.waitForTimeout(600);
}
if (tags.length) {
  const chipTexts = await ev(`function(){
    return __all().filter(function(el){return String(el.className).indexOf("label-item-v2-content")>=0 && __visible(el);})
      .map(function(el){return __own(el);});
  }`);
  const missing = tags.filter((t) => !chipTexts.includes(t));
  if (missing.length) fail(`标签未确认添加(回车创建失败?): ${missing.join(", ")}`);

  // B 站会在表单挂载后异步插入推荐标签(每轮都可能不同),
  // 所以「读 chips → 删多余 → 复核」循环几轮,等它插入完并清干净。
  // 删除动作用 evaluate 内派发合成 MouseEvent 点 svg.close:推荐行频繁重排,
  // 坐标点击会在点击瞬间落到别的元素上(实测会误触)。
  let extras = [];
  for (let round = 0; round < 6; round++) {
    await page.waitForTimeout(1500);
    const chipsNow = await ev(`function(arg){
      return __all().filter(function(el){return String(el.className).indexOf("label-item-v2-content")>=0 && __visible(el);})
        .map(function(el){return __own(el);});
    }`);
    extras = chipsNow.filter((t) => !tags.includes(t));
    if (!extras.length) { extras = []; break; }
    const removed = await ev(`function(arg){
      var removed=[];
      for(const el of __all()){
        if(String(el.className).indexOf("label-item-v2-container")<0 || !__visible(el)) continue;
        var p=el.querySelector("p");
        if(!p || arg.extras.indexOf(__own(p))<0) continue;
        var icon=el.querySelector("svg.close");
        if(!icon) continue;
        icon.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
        removed.push(__own(p));
      }
      return removed;
    }`, { extras });
    if (!removed.length && extras.length) {
      // svg.close 派发无效时的兜底:聚焦输入框派发 Backspace 删最后一个 chip
      await ev(`function(){
        var input=__all().find(function(el){return el.tagName==="INPUT" && /创建标签/.test(el.placeholder||"");});
        if(!input) return {ok:false};
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown",{key:"Backspace",keyCode:8,which:8,bubbles:true}));
        return {ok:true};
      }`);
    }
    await page.waitForTimeout(800);
  }
  if (extras.length) {
    fail(`表单里残留非本次标签(自动插入的推荐清不掉): ${extras.join(", ")}。请在创作中心手动清理后重试。`);
  }
}

// --- 简介 (Quill 编辑器) ---
if (desc) {
  const descResult = await ev(`function(value){
    var editors=__all().filter(function(el){return String(el.className).indexOf("ql-editor")>=0 && __visible(el);});
    var editor=editors.find(function(el){return el.getBoundingClientRect().height>60;})||editors[0];
    if(!editor) return {ok:false,error:"未找到简介编辑器"};
    editor.focus();
    document.execCommand("selectAll",false,null);
    document.execCommand("insertText",false,value);
    editor.blur();
    return {ok:true,text:(editor.innerText||"").trim()};
  }`, desc);
  if (!descResult.ok) fail(descResult.error);
  // Quill 把单个换行渲染成段落(\n\n),回读归一化换行再比较。
  const normText = (s) => String(s || "").replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (normText(descResult.text) !== normText(desc)) {
    fail(`简介写入异常: 期望「${desc}」实际「${descResult.text}」`);
  }
}

// --- 封面(4:3 与 16:9 分开上传) ---
let coverApplied = { "4x3": false, "16x9": false };
if (cover43 && cover169) {
  const addPt = await ev(`function(){
    return __textPoint("添加封面");
  }`);
  if (!addPt) fail("未找到「添加封面」入口");
  await page.mouse.click(addPt.x, addPt.y, { label: "打开封面制作" });
  await page.waitForTimeout(3000);

  const dlgOpen = await ev(`function(){
    return __all().some(function(el){return String(el.className).indexOf("cover-editor-head")>=0 && __visible(el);});
  }`);
  if (!dlgOpen) fail("「封面制作」弹窗没有出现");
  await page.waitForTimeout(1000);

  // 同步开关是 .sync-checkbox-wrapper 里的可见 checkbox，不是文字，也没有 bcc-checkbox。
  // 弹窗初始化会在点击之后把勾选写回去。读 input.checked，连续两次为关才算关掉。
  const readSync = () => ev(`function(){
    var wrappers=__all().filter(function(el){
      return String(el.className||"").split(" ").indexOf("sync-checkbox-wrapper")>=0;
    });
    var visible=null;
    for(const el of wrappers){
      var r=el.getBoundingClientRect();
      if(r.width>20 && r.height>8) visible=el;
    }
    if(!visible) return {found:false};
    var input=null;
    for(const el of visible.querySelectorAll("input")){
      if(el.type!=="checkbox") continue;
      var box=el.getBoundingClientRect();
      if(box.width<8 || box.height<8) continue;
      input=el;
      break;
    }
    if(!input) return {found:true, checked:null};
    var box=input.getBoundingClientRect();
    return {found:true, checked:input.checked===true, x:box.x+box.width/2, y:box.y+box.height/2};
  }`);
  const ensureSyncOff = async (why) => {
    const readings = [];
    let clicks = 0;
    for (let i = 0; i < 8; i += 1) {
      const state = await readSync();
      if (state.found && state.checked !== null) readings.push(state.checked);
      const plan = syncGate({ readings, clicks });
      if (plan === "ready") return;
      if (plan === "fail") {
        fail(`双比例同步仍开着(${why})，已停止，避免上传覆盖另一张封面`);
      }
      if (plan === "click") {
        if (!state.x) fail(`双比例同步勾选看得见但点不到(${why})`);
        await page.mouse.click(state.x, state.y, { label: "关闭双比例同步改动" });
        clicks += 1;
      }
      await page.waitForTimeout(300);
    }
    fail(`双比例同步状态没有稳定关掉(${why})，已停止`);
  };
  await ensureSyncOff("打开封面弹窗后");

  const sampleNode = `
    var w=node.naturalWidth||node.width||0;
    var h=node.naturalHeight||node.height||0;
    if(w>=20 && h>=20){
        var grid=null;
        try {
          var canvas=document.createElement("canvas");
          canvas.width=8; canvas.height=8;
          var ctx=canvas.getContext("2d");
          ctx.drawImage(node,0,0,8,8);
          var data=ctx.getImageData(0,0,8,8).data;
          grid=[];
          for(var i=0;i<data.length;i+=4){
            grid.push(Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]));
          }
        } catch(error) { grid=null; }
        if(grid) out.push({w:w,h:h,grid:grid});
    }
  `;
  // 右侧「首页推荐 / 个人空间」只切换手机预览。上传落点是中间两块编辑画布，
  // 父级 class 为 active 的那块才是当前目标。panel 下任意 canvas 会把 4:3 画布误当成 16:9。
  const readEditorSamples = (kind) => ev(`function(arg){
    var out=[];
    var marker=arg.kind==="4x3"?"editor_4_3":"editor_16_9";
    var root=__all().find(function(el){return String(el.className||"").split(" ").indexOf(marker)>=0;});
    if(!root) return out;
    var nodes=Array.from(root.querySelectorAll("canvas")).filter(function(node){
      return String(node.className||"").indexOf("lower-canvas")>=0;
    });
    if(!nodes.length) nodes=Array.from(root.querySelectorAll("canvas,img"));
    for(const node of nodes){ ${sampleNode} }
    return out;
  }`, { kind });
  const selectEditor = async (kind) => {
    const marker = kind === "4x3" ? "editor_4_3" : "editor_16_9";
    for (let i = 0; i < 4; i += 1) {
      const state = await ev(`function(arg){
        function info(name){
          var el=__all().find(function(node){return String(node.className||"").split(" ").indexOf(name)>=0;});
          if(!el) return null;
          var parent=el.parentElement;
          var r=el.getBoundingClientRect();
          return {
            active: !!(parent && String(parent.className||"").split(" ").indexOf("active")>=0),
            x: r.x+r.width/2,
            y: r.y+r.height/2
          };
        }
        return {mine: info(arg.marker)};
      }`, { marker });
      if (state.mine && state.mine.active) return;
      if (!state.mine || !state.mine.x) fail(`封面编辑区没有${kind}画布`);
      await page.mouse.click(state.mine.x, state.mine.y, { label: `选中${kind}画布` });
      await page.waitForTimeout(300);
    }
    fail(`${kind}画布没有成为当前上传目标，已停止，避免文件进到另一个槽`);
  };

  const uploadCover = async (file, kind, source, other) => {
    await selectEditor(kind);
    await ensureSyncOff(`上传${kind}前`);

    const upPt = await ev(`function(){
      return __textPoint("上传封面");
    }`);
    if (!upPt) fail("封面弹窗里找不到「上传封面」");
    const cp = page.waitForFileChooser({ timeout: 15000 });
    await page.mouse.click(upPt.x, upPt.y, { label: `上传${kind}封面` });
    const chooser2 = await cp;
    await chooser2.setFiles(file);
    // 等对应槽位的缩略图出现且比例正确(naturalWidth/Height 来自上传图)。
    const slotSel = kind === "4x3" ? "editor_4_3" : "editor_16_9";
    let last = { status: "unread" };
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(500);
      const samples = await readEditorSamples(kind);
      last = judgeCoverIdentity({
        samples,
        target: RATIO_4_3,
        source,
        other,
        slot: slotSel,
        requireRatio: false,
      });
      if (last.status === "ok") return last.evidence;
    }
    fail(`${kind} 封面在 7.5 秒内对不上原图(${last.status}): ${JSON.stringify(last)}`);
  };

  const fingerprintFile = (file) => {
    const buf = readFileSync(file);
    const png = pngFingerprint(buf);
    if (png) return png;
    const dims = imageDimsFromBuffer(buf);
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-vframes", "1", "pipe:1"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!dims || decoded.status !== 0 || !decoded.stdout || decoded.stdout.length < dims.width * dims.height * 4) return null;
    const rgba = decoded.stdout.subarray(0, dims.width * dims.height * 4);
    const center = centerRgba(rgba, dims.width, dims.height);
    return {
      full: lumaGridFromRgba(rgba, dims.width, dims.height),
      center: lumaGridFromRgba(center.rgba, center.width, center.height),
    };
  };
  const source43 = fingerprintFile(cover43);
  const source169 = fingerprintFile(cover169);
  if (!source43 || !source169) fail("无法计算封面指纹，不能确认槽位里是哪张图");

  const cover43Evidence = await uploadCover(cover43, "4x3", source43, source169);
  if (!cover43Evidence) fail("4:3 封面上传后未确认,放弃投稿");
  const cover169Evidence = await uploadCover(cover169, "16x9", source169, source43);
  if (!cover169Evidence) fail("16:9 封面上传后未确认,放弃投稿");
  // 16:9 文件若进了 4:3 画布，或同步把 4:3 换成了 16:9，这里看的是 4:3 画布本身。
  // 不拿另一块较小的残留图充数。
  let still43 = { status: "unread" };
  for (let i = 0; i < 4; i += 1) {
    const samples = await readEditorSamples("4x3");
    still43 = judgeCoverIdentity({
      samples,
      target: RATIO_4_3,
      source: source43,
      other: source169,
      slot: "editor_4_3",
      requireRatio: false,
    });
    if (still43.status !== "unread") break;
    await page.waitForTimeout(400);
  }
  if (still43.status !== "ok") {
    const syncNow = await readSync();
    const why = still43.status === "mismatch"
      ? "上传 16:9 后 4:3 槽位比例变了"
      : `上传 16:9 后未能确认 4:3 槽仍是原图(${still43.status})`;
    fail(`${why}: ${JSON.stringify({ ...still43, syncChecked: syncNow.checked })}`);
  }
  try { await page.screenshot({ path: "/tmp/bilibili-cover-slots.png" }); } catch {}
  coverApplied = { "4x3": still43.evidence, "16x9": cover169Evidence };

  // 完成可能需要多轮:点「完成」后若弹「检测到个人空间封面(16:9)未修改」,
  // 必须选「不同步,手动编辑」保住分开上传的 16:9(绝不点「确认同步」),
  // 然后编辑器会切到 16:9 手动编辑视图,再点一次「完成」才真正关闭。
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(2000);
    const dlgState = await ev(`function(){
      var vis=function(el){return !!(el.getClientRects().length);};
      var editor=__all().some(function(el){return String(el.className).indexOf("cover-editor-head")>=0 && vis(el);});
      var modal=__all().some(function(el){return String(el.className).indexOf("videoup-confirm-modal")>=0 && vis(el);});
      return {editor:editor, modal:modal};
    }`);
    if (!dlgState.editor && !dlgState.modal) break;
    if (dlgState.modal) {
      const keepPt = await ev(`function(){
        var vis=function(el){return !!(el.getClientRects().length);};
        function inModal(el){var p=el;for(var i=0;i<8&&p;i++){if(String(p.className||"").indexOf("videoup-confirm-modal")>=0)return true;p=p.parentElement;}return false;}
        var span=__all().find(function(el){
          return vis(el) && __own(el) && /不同步/.test(__own(el)) && inModal(el);
        });
        if(!span) return null;
        var r=span.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      }`);
      if (!keepPt) fail("封面确认弹窗里找不到「不同步,手动编辑」");
      await page.mouse.click(keepPt.x, keepPt.y, { label: "选择不同步,手动编辑" });
      await page.waitForTimeout(1500);
      continue;
    }
    const donePt = await ev(`function(){
      var btn=__all().find(function(el){return __own(el)==="完成" && String(el.className).indexOf("submit")>=0;});
      if(!btn) return null;
      return __pointInView(btn);
    }`);
    if (!donePt) fail("封面弹窗里找不到「完成」按钮");
    await page.mouse.click(donePt.x, donePt.y, { label: "确认封面" });
  }

  const dlgClosed = await ev(`function(){
    return !__all().some(function(el){return String(el.className).indexOf("cover-editor-head")>=0 && __visible(el);});
  }`);
  if (!dlgClosed) fail("点「完成」后封面弹窗没有关闭");
  const formCover = await ev(`function(){
    var el=__all().find(function(el){return String(el.className).indexOf("cover-img")>=0 && el.getBoundingClientRect().width>50;});
    if(!el) return {ok:false,error:"表单上没有 .cover-img 预览"};
    var bg=getComputedStyle(el).backgroundImage||"";
    return {ok: bg.indexOf("url(")>=0, bg: bg.slice(0,120)};
  }`);
  if (!formCover.ok) fail("封面未落到投稿表单(.cover-img 背景为空)");
}

// --- 创作声明 ---
// bcc-select 预填时 input.value 已是组件当前值。点输入框中心不会展开列表,
// 未展开时选项高度为 0,按可见文本去找会误报「没有选项」。
// 只有回读不一致才点下拉右侧箭头,并等选项高度大于 0。
const declareText = DECLARE_OPTIONS[cfg.declare] || DECLARE_OPTIONS.none;
const readDeclare = () => ev(`function(){
  var input=__all().find(function(el){
    if(el.tagName!=="INPUT" || !/创作声明/.test(el.placeholder||"")) return false;
    var r=el.getBoundingClientRect();
    return r.width>20 && r.height>10;
  });
  return input ? String(input.value||"").trim() : "";
}`);
let declareFinal = "";
const applyDeclare = async () => {
declareFinal = await readDeclare();
if (!declareFinal && declareFinal !== "") fail("未找到创作声明下拉");
let declareDecision = declareChoice({ requested: declareText, current: declareFinal, options: [] });
if (declareDecision.action !== "keep") {
  const opener = await ev(`function(){
    var input=__all().find(function(el){return el.tagName==="INPUT" && /创作声明/.test(el.placeholder||"");});
    if(!input) return null;
    var wrap=input.closest(".bcc-select") || input;
    wrap.scrollIntoView({block:"center"});
    var r=wrap.getBoundingClientRect();
    return {x:r.x+r.width-18, y:r.y+r.height/2};
  }`);
  if (!opener) fail("未找到创作声明下拉");
  await page.mouse.click(opener.x, opener.y, { label: "打开创作声明下拉" });
  let optionNames = [];
  for (let i = 0; i < 8 && !optionNames.length; i += 1) {
    await page.waitForTimeout(300);
    optionNames = await ev(`function(){
      var names=[];
      for (const el of __all()) {
        var own=(__own(el)||"").trim();
        if(!own) continue;
        var r=el.getBoundingClientRect();
        if(r.width>0 && r.height>0) names.push(own);
      }
      return names;
    }`);
    optionNames = optionNames.filter((name) => Object.values(DECLARE_OPTIONS).includes(name));
  }
  declareDecision = declareChoice({ requested: declareText, current: declareFinal, options: optionNames });
  if (declareDecision.action !== "select") {
    fail(`创作声明下拉里没有「${declareText}」,当前值是「${declareFinal || "空"}」`);
  }
  const optPt = await ev(`function(arg){
    var opt=__all().find(function(el){
      if((__own(el)||"").trim()!==arg.text) return false;
      var r=el.getBoundingClientRect();
      return r.width>0 && r.height>0;
    });
    if(!opt) return null;
    opt.scrollIntoView({block:"center"});
    var r=opt.getBoundingClientRect();
    var x=r.x+Math.min(r.width/2, 36);
    var y=r.y+Math.min(r.height/2, 10);
    var top=document.elementFromPoint(x, y);
    var hit=top;
    while(hit && hit!==opt) hit=hit.parentElement || (hit.getRootNode && hit.getRootNode().host) || null;
    if(hit!==opt) return null;
    return {x:x, y:y};
  }`, { text: declareText });
  if (!optPt) fail(`创作声明「${declareText}」可见但点不到,当前值是「${declareFinal || "空"}」`);
  await page.mouse.click(optPt.x, optPt.y, { label: "选择创作声明" });
  await page.waitForTimeout(600);
  declareFinal = await readDeclare();
}
if (declareFinal !== declareText) {
  fail(`创作声明回读不是「${declareText}」(实际「${declareFinal || "空"}」)`);
}
if (declareDecision.action === "select") {
  if (page.keyboard && typeof page.keyboard.press === "function") {
    try { await page.keyboard.press("Escape"); } catch {}
  }
  const away = await ev(`function(){
    var el=__byTextExact("基本设置");
    return el ? __pointInView(el) : null;
  }`);
  if (away) await page.mouse.click(away.x, away.y, { label: "收起创作声明" });
  await page.waitForTimeout(300);
  declareFinal = await readDeclare();
  if (declareFinal !== declareText) {
    fail(`收起创作声明后回读不是「${declareText}」(实际「${declareFinal || "空"}」)`);
  }
}
};

// --- 分区 ---
// The remembered chip lives in .video-human-type .select-item-cont-inserted.
// Opening .select-controller reveals .human-type-list; choosing a missing name
// must stop before 立即投稿 instead of keeping the old chip.
const readPartition = () => ev(`function(){
  var root=__all().find(function(el){return String(el.className||"").split(" ").indexOf("video-human-type")>=0;});
  if(!root) return {ok:false,error:"未找到分区区域"};
  var chip=null;
  for(const el of __walk(root)){
    if(String(el.className).indexOf("select-item-cont-inserted")>=0){chip=(__own(el)||"").trim();break;}
  }
  return {ok:true,chip:chip};
}`);
let typeState = await readPartition();
if (!typeState.ok) fail(typeState.error);
const requestedType = String(cfg.type || "").trim();
if (requestedType && typeState.chip !== requestedType) {
  const opener = await ev(`function(){
    var root=__all().find(function(el){return String(el.className||"").split(" ").indexOf("video-human-type")>=0;});
    var ctrl=root && root.querySelector(".select-controller");
    if(!ctrl) return null;
    return __pointInView(ctrl);
  }`);
  if (!opener) fail(`分区「${requestedType}」无法打开人选列表,已停止,没有沿用「${typeState.chip || "空"}」`);
  await page.mouse.click(opener.x, opener.y, { label: "打开分区列表" });
  const readOptionNames = () => ev(`function(){
    var names=[];
    for(const el of __all()){
      if(String(el.className).indexOf("item-cont-main")<0 || !__visible(el)) continue;
      var name=(__own(el)||"").trim();
      if(name && names.indexOf(name)<0) names.push(name);
    }
    return names;
  }`);
  let optionNames = [];
  let reopened = false;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(300);
    optionNames = await readOptionNames();
    if (optionNames.includes(requestedType)) break;
    if (!reopened && i === 3 && optionNames.length === 0) {
      reopened = true;
      const again = await ev(`function(){
        var root=__all().find(function(el){return String(el.className||"").split(" ").indexOf("video-human-type")>=0;});
        var ctrl=root && root.querySelector(".select-controller");
        return ctrl ? __pointInView(ctrl) : null;
      }`);
      if (again) await page.mouse.click(again.x, again.y, { label: "再次打开分区列表" });
    }
  }
  const choice = partitionChoice({ requested: requestedType, current: typeState.chip, options: optionNames });
  if (choice.action !== "select") {
    fail(`分区「${requestedType}」不在人选列表里,已停止,没有沿用「${typeState.chip || "空"}」。看到:${optionNames.join("、") || "空"}`);
  }
  const optionPt = await ev(`function(arg){
    var item=__all().find(function(el){
      return el.getAttribute && el.getAttribute("title")===arg.name && String(el.className).indexOf("drop-list-v2-item")>=0 && __visible(el);
    });
    if(!item) return null;
    return __pointInView(item);
  }`, { name: requestedType });
  if (!optionPt) fail(`分区「${requestedType}」可见但点不到,已停止,没有沿用「${typeState.chip || "空"}」`);
  await page.mouse.click(optionPt.x, optionPt.y, { label: `选择分区${requestedType}` });
  await page.waitForTimeout(800);
  typeState = await readPartition();
  if (!typeState.ok || typeState.chip !== requestedType) {
    fail(`分区回读不是「${requestedType}」(实际「${typeState.chip || ""}」),已停止投稿`);
  }
}
const kept = partitionChoice({ requested: requestedType, current: typeState.chip, options: requestedType ? [requestedType] : [] });
if (kept.action === "fail") {
  fail("分区为空:B 站投稿必须选分区。请传 --type,或先在创作中心留下一个分区。");
}
const partitionListOpen = () => ev(`function(){
  return __all().some(function(el){
    if(String(el.className||"").indexOf("human-type-list")<0) return false;
    var r=el.getBoundingClientRect();
    return r.height>20 && r.width>20;
  });
}`);
for (let i = 0; i < 3 && await partitionListOpen(); i += 1) {
  const closer = await ev(`function(){
    var el=__byTextExact("标题") || __byTextExact("基本设置");
    return el ? __pointInView(el) : null;
  }`);
  if (closer) await page.mouse.click(closer.x, closer.y, { label: "收起分区列表" });
  await page.waitForTimeout(400);
}
typeState = await readPartition();
if (requestedType && typeState.chip !== requestedType) {
  fail(`收起分区列表后回读不是「${requestedType}」(实际「${typeState.chip || "空"}」)`);
}
if (await partitionListOpen()) {
  fail("分区列表没有收起,已停止,避免点击落到声明上");
}
// 分区点击会盖住仍开着的声明列表,并把声明打回默认值。分区定下来后再改声明。
await applyDeclare();
declareFinal = await readDeclare();
typeState = await readPartition();
if (declareFinal !== declareText) {
  fail(`停投前创作声明回读不是「${declareText}」(实际「${declareFinal || "空"}」)`);
}
if (requestedType && typeState.chip !== requestedType) {
  fail(`停投前分区回读不是「${requestedType}」(实际「${typeState.chip || "空"}」)`);
}

// --- 立即投稿 ---
// The only click. stop-before-submit and a missing --yes both refuse it.
const submitGate = mayClickSubmit({ yes: cfg.yes === true, stopBeforeSubmit: cfg.stopBeforeSubmit === true });
if (!submitGate.allow) {
  const dir = "/tmp";
  let shot = "";
  try {
    shot = await page.screenshot({ path: `${dir}/bilibili-video-stop.png` });
  } catch {}
  console.log(JSON.stringify({
    ok: true,
    submitted: false,
    stopped_before_submit: true,
    reason: submitGate.reason,
    title,
    type: typeState.chip,
    declare: declareFinal,
    tags,
    covers: coverApplied,
    cover_slots: "/tmp/bilibili-cover-slots.png",
    screenshot: shot || `${dir}/bilibili-video-stop.png`,
  }));
  if (!keep) {
    try { await task.finish({ keep: [] }); } catch {}
  }
  process.exit(0);
}
const submitPt = await ev(`function(){
  var btn=__all().find(function(el){return __own(el)==="立即投稿" && String(el.className).indexOf("submit-add")>=0;});
  if(!btn) return null;
  btn.scrollIntoView({block:"center"});
  return __point(btn);
}`);
if (!submitPt) fail("未找到「立即投稿」按钮");
const submitUrlBefore = await page.url();
await page.waitForTimeout(500);
const receipt = await page.mouse.click(submitPt.x, submitPt.y, { label: "点击立即投稿" });
if (receipt && receipt.dialog) await page.acceptDialog();
await page.waitForTimeout(3000);

// 提交后可能出现确认/清单弹窗(如「稿件确认」类):有「确认/提交」按钮就点掉,
// 其余弹窗原样截图留证,绝不盲目点「取消」以外的按钮。
const submitDialog = await ev(`function(){
  var vis=function(el){return !!(el.getClientRects().length);};
  var dlgs=__all().filter(function(el){return vis(el) && /bcc-dialog|confirm-modal|modal/i.test(String(el.className)) && el.getBoundingClientRect().width>200 && el.getBoundingClientRect().width<900;});
  var out=[];
  for(const d of dlgs){
    var texts=[];
    for(const el of __walk(d)){
      if(__own(el) && __own(el).length<30) texts.push(__own(el));
      if(texts.length>12) break;
    }
    out.push({cls:String(d.className).slice(0,60),texts:texts});
  }
  return out;
}`);
if (submitDialog.length) {
  console.error(JSON.stringify({ note: "提交后出现弹窗", dialogs: submitDialog }));
  const confirmPt = await ev(`function(){
    var vis=function(el){return !!(el.getClientRects().length);};
    var span=__all().find(function(el){
      if(!vis(el)) return false;
      var t=__own(el);
      return (t==="确认"||t==="确认投稿"||t==="提交") && String(t).length<=6;
    });
    if(!span) return null;
    var r=span.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  }`);
  if (confirmPt) {
    await page.mouse.click(confirmPt.x, confirmPt.y, { label: "点击提交确认" });
    await page.waitForTimeout(2000);
  }
  try {
    await page.screenshot({ path: "/tmp/bilibili-video-submit-step.png" });
  } catch {}
}

// --- 成功判定 ---
// 立即投稿后页面可能整页跳转(重定向到稿件管理/成功页),SPA 上下文会重建,
// 探测要容忍白屏骨架期,并以「URL 离开投稿页 + 文本命中」双重观察。
let published = false;
let finalText = "";
let finalUrl = submitUrlBefore;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(3000);
  let st;
  try {
    st = await ev(`function(arg){
      return { url: location.href, text: __shadowText() + "\\n" + (document.body.innerText||"") };
    }`);
  } catch {
    // 导航瞬间 evaluate 可能抛错,跳过本轮
    continue;
  }
  finalText = st.text;
  finalUrl = st.url;
  if (PUBLISH_OK_RE.test(st.text)) { published = true; break; }
  // URL 已离开投稿页且页面稳定渲染(不再是骨架)也继续等文本命中;
  // 只在超时后统一失败并带 URL/截图报错。
}
if (!published) {
  let shot = "/tmp/bilibili-video-publish-fail.png";
  try {
    shot = await page.screenshot({ path: shot });
  } catch {}
  fail(`点击立即投稿后未确认到成功状态。截图: ${shot}`, {
    finalText: finalText.slice(0, 400),
    finalUrl,
  });
}

let found = manuscriptFromText(`${finalText}\n${finalUrl}`);
if (found.identity !== "bvid") {
  try {
    await page.goto("https://member.bilibili.com/platform/upload-manager/article", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const href = await ev(`function(arg){
      var link=__all().find(function(el){
        return el.tagName==="A" && (el.innerText||"").indexOf(arg.title)>=0 && /BV[0-9A-Za-z]{10}/.test(el.href||"");
      });
      return link ? link.href : "";
    }`, { title });
    const again = manuscriptFromText(href);
    if (again.identity === "bvid") found = again;
  } catch {
    // The submit already happened. A missing id is reported as unconfirmed.
  }
}
console.log(JSON.stringify(publishSuccessBody({
  title,
  type: typeState.chip,
  declare: declareFinal,
  tags,
  coverApplied,
  bvid: found.bvid,
  url: found.url,
  identity: found.identity,
})));
if (!keep) await task.finish({ keep: [] });
