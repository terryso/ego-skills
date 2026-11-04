# Teambition testplan API（浏览器会话）

Phase 1 只读。前缀 `https://www.teambition.com`。下面的路径由 `page.fetch` 在已登录的 teambition.com 页面里请求，自动带上浏览器会话。

本文件不记录个人目录、具体项目或业务线路径。调用方从测试计划 URL 取出 id。

## 端点

### 计划信息

```text
GET /testcase/api/v1/projects/{projectId}/testplans/{planId}
```

展示时读取 `result.name`、`result.statusName` 或 `result.status`、`result.testcaseCount`（数字或 `{ total }`）、`result.creator.name`。

### 用例分组

```text
GET /testcase/api/v1/projects/{projectId}/testplans/{planId}/groups
```

响应可能是数组，或对象上的 `result` / `groups`。空 `result` 时再看 `groups`。每个分组：`_id`、`name`、`resourceCount`（组内用例数）、`creator.name`、`pos`。

### 用例查询（v3，TQL + 分页）

```text
GET /testcase/api/v3/project/{projectId}/testcase/query
    ?tql=<urlencoded>&pageSize=100&needTestCaseResult=true&pageToken=<offset>
```

- `tql`：本技能只发送 `_testplanId = {planId}`，以及可选的 `AND groupId = {groupId}`。`uniqueId` 不能用于 TQL（返回 0 条）。单条查询在拉回的页里用 `uniqueId` 过滤。
- `pageToken`：偏移量（0、100、200…按 pageSize 递增），不是 opaque token。最后一页 `nextPageToken` 为空。
- `needTestCaseResult=true` 才返回每步执行结果（actual / resultStatus / 截图）。
- 响应：`{"result": [...], "nextPageToken": "100", "totalSize": 0}`。`totalSize` 不可信，以翻页耗尽为准。最多 30 页。

## 用例对象字段

| 字段 | 说明 |
|------|------|
| `title` | 用例标题 |
| `uniqueId` | 用例编号（计划内展示的编号） |
| `precondition` | 前置条件 |
| `steps[]` | `desc` 操作、`expected` 预期、`actual` 实际、`resultStatus`（passed/failed）、`actualPayload.urls` 执行截图。`actualPayload.urls` 为空时才看 `expectPayload.urls` |
| `isDone` | 执行完成 |
| `priority` | 0 紧急，1 高，2 中，3 低 |
| `executor.name` | 执行人 |
| `commongroup.name` | 所属分组名 |
| `caseType` | 例如 function |
| `_flowstatusId` | 用例状态。名称要另查 taskflows，本阶段不查 |
| `testplanName` | 所属计划名 |

## 鉴权

这个模块只认 teambition.com 的登录会话。`teambition_cli` 和 MCP 使用的 Open API token（open.teambition.com）不适用。

本技能不导出 Cookie，也不接受用户粘贴的会话。401 时让人在 Ego Lite 打开 https://www.teambition.com/ 登录，然后重跑 `check-login`。

## 和任务数据的区别

任务搜索命中的是任务卡片。测试计划里的用例是另一套数据。不要用任务接口回答「这条用例的步骤是什么」。
