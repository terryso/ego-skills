---
name: teambition-ego
description: >
  Read Teambition test plans and test cases through the Ego Lite browser session
  (www.teambition.com/testcase/api/). Login-check first. Read-only Phase 1.
  Use when the user mentions Teambition 测试用例, 用例库, 测试计划, testplan, or case steps.
  Do not use teambition_cli, an Open API token, or the task search API for this module.
metadata:
  version: "0.1.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# teambition-ego

Phase 1 只读 Teambition **测试计划 / 测试用例**。请求走 Ego 里已经登录的浏览器会话：`https://www.teambition.com/testcase/api/`。

Phase 1 reads Teambition **test plans and test cases**. Calls use the logged-in Ego browser session at `https://www.teambition.com/testcase/api/`.

完整技能的方向是 Teambition 管理（项目、任务、测试计划、用例）。本阶段只实现 `testcase` 这一个 domain。`task` 和 `project` 以后挂到同一个 `scripts/tb.mjs` 注册表上，不改路由器。本阶段不写 Teambition，也不把点页面当主要手段。

The later shape is a Teambition manager (projects, tasks, test plans, cases). This phase ships the `testcase` domain only. `task` and `project` will register on the same `scripts/tb.mjs` router later. This phase does not write to Teambition and does not click through the UI.

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。缺失则 soft-fail / 告知用户去装，**不要**硬调浏览器。

Install **Ego Lite** and put `ego-browser` on `PATH`. If either is missing, soft-fail and tell the user. Do not hard-require the browser.

在 Ego 里登录 [teambition.com](https://www.teambition.com/) 之后才能读测试计划。每次读取前把这句话告诉用户。

Sign in to teambition.com inside Ego before reading a test plan. Say that to the user every time.

## 不要用 Open API token

测试计划 / 用例不在任务体系里。`teambition_cli` 和 MCP 的 Open API token（`open.teambition.com`）**读不到**这个模块。本技能只用浏览器会话。

Test plans and cases are not tasks. `teambition_cli` and an MCP Open API token cannot read this module. This skill uses the browser session only.

## 每次读取前：登录闸门（必做）

Agent **在调用 testcase 命令之前**必须跑：

```bash
node scripts/check-login.mjs
# 需要把窗口留给人登录时：
node scripts/check-login.mjs --keep
```

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录 | 把 `login_tip` 告诉用户，继续读取 |
| `2` | 未登录 / 无 ego-browser | 展示 `how_to_login` / `how_to_login_zh`，**停**。请人在 Ego 登录 teambition.com 后再跑 |
| `1` | 其它错误 | 报告 JSON `error`，不要假装已经读到用例 |

详见 `references/login.md`。不要另做 cookie-healthcheck 技能。不要代填密码，不要粘贴 Cookie。

默认 `finish({ keep: [] })`。`--keep` 才把登录页留着并 `handOff()`。

## Phase 1 命令

仓库根目录：

```bash
node skills/teambition-ego/scripts/check-login.mjs
node skills/teambition-ego/scripts/tb.mjs testcase parse-url "<testplan-url>"
node skills/teambition-ego/scripts/tb.mjs testcase plan <projectId> <planId>
node skills/teambition-ego/scripts/tb.mjs testcase groups <projectId> <planId>
node skills/teambition-ego/scripts/tb.mjs testcase cases <projectId> <planId> [--group <groupId>]
node skills/teambition-ego/scripts/tb.mjs testcase get <projectId> <planId> <uniqueId>
node skills/teambition-ego/scripts/tb.mjs testcase cleanup
```

已安装的技能目录里用相对路径：`node scripts/check-login.mjs`、`node scripts/tb.mjs testcase …`。

URL 形如 `https://www.teambition.com/project/{projectId}/testplan/{planId}/group/{groupId}`。`parse-url` 不打开浏览器。其余读取命令在名为 `tb-testcase api` 的任务空间里用 `page.fetch` 发 GET。`cleanup` 只关闭这个本机空间，不改 Teambition 数据。

| 命令 | 作用 |
|------|------|
| `parse-url` | 从测试计划 URL 打出 `projectId`、`planId`、`groupId`（没有分组时第三列为空） |
| `plan` | 计划名称、状态、用例数、创建人 |
| `groups` | 分组 id、用例数、名称 |
| `cases` | 自动翻页列出用例。`--group` 可选。stderr 打出总数 |
| `get` | 按计划内编号看一条用例（前置条件、步骤、预期、实际、截图） |
| `cleanup` | `finish({ keep: [] })` 关掉常驻空间 |

`--json` 打出原始 JSON。没有这个 flag 时，多条用例用 `编号 / 完成标记 / 分组 / 标题`。Agent 展示给用户时：两条及以上用表格；单条用段落。完成标记：`✓` 是 `isDone`，`✗` 是未完成或未通过。

| 退出码 | 含义 |
|--------|------|
| `0` | 成功 |
| `1` | 参数、HTTP、或浏览器执行错误。未登录时 stderr 会要求在 Ego 打开 teambition.com |
| `2` | 本机没有 `ego-browser`（soft-fail）。check-login 未登录也是 `2` |

## 传输

`scripts/lib/session.mjs` 是浏览器 `page.fetch` 门面。Open API 传输只留了 Phase 2 的钩子，调用会失败并说明原因。说明见 `references/transports.md`。字段和坑见 `references/testcase-api.md`、`references/pitfalls.md`。

## 测试

```bash
npm test
```
