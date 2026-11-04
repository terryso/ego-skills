# 避坑（Teambition 测试用例，Phase 1）

读取走 `page.fetch`，不把点页面当主要手段。下面这些是脚本已经按接口语义处理过的，Agent 不要另写一套请求。

1. **用例不在任务接口里。** `teambition_cli`、MCP token、任务 TQL 都拿不到 testplan 用例。只请求 `https://www.teambition.com/testcase/api/`。
2. **只认浏览器会话。** Open API token 在本阶段不可用。`session.mjs` 里的 open 传输会直接失败。不要让用户粘贴 Cookie。
3. **先 login-check。** 退出码 `2` 必须停。缺 `ego-browser` 也是 soft-fail，不要硬调浏览器。
4. **401 表示要在 Ego 里登录 teambition.com。** 不要改去调 open.teambition.com。
5. **JSON 不严格。** 响应偶发含未转义控制字符。解析会先严格解析，失败后再去掉控制字符重试。
6. **排序不稳定。** 同一查询两次顺序可能不同。不要依赖顺序。
7. **`totalSize` 恒为 0。** 以翻页耗尽为准，不要用这个字段当总数。stderr 的「共 N 条」是拉回来的条数。
8. **`pageToken` 是偏移量。** `0`、`100`、`200`… 按 pageSize 递增，不是 opaque token。最后一页 `nextPageToken` 为空。单次命令最多 30 页。
9. **TQL 只拼两个已验证字段。** `(_testplanId = {planId})`，可选 `AND groupId = {groupId}`。`uniqueId` 不能当 TQL 过滤。`get` 在浏览器侧逐页扫描，找到即停。
10. **`needTestCaseResult=true` 才带每步执行结果。** 本阶段列表和详情都打开它，以便步骤里有实际结果和截图。
11. **分组响应的键不固定。** 可能是数组，或 `result`，或 `groups`。空的 `result` 会再看 `groups`。
12. **常驻空间名字是 `tb-testcase api`。** `plan` / `groups` / `cases` / `get` 不调用 `finish`，以便下次复用。看完如果要收尾，跑 `cleanup`，它执行 `finish({ keep: [] })`。
13. **check-login 用另一个空间。** `teambition-login-check` 默认 `finish({ keep: [] })`。`--keep` 才 `handOff()`。它不会关掉用例空间。
14. **没有写接口。** 不要创建、编辑、回写执行结果，也不要发 POST。`cleanup` 只关本机浏览器空间。
15. **ego 内嵌 Node 不继承 shell 环境变量。** 参数写在临时 entry 的 JSON 里，再交给 `ego-browser nodejs`。不要指望 `VAR=x ego-browser` 能读到 `VAR`。
16. **路径用技能相对路径。** 文档和示例不写个人机器上的产品目录。调用方自己提供测试计划 URL 或 id。
