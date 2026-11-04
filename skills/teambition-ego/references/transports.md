# 传输：浏览器会话和 Open API token

Phase 1 只实现浏览器传输。Open API 传输是钩子，调用会失败。

| | 浏览器会话（Phase 1） | Open API token（未实现） |
|--|----------------------|-------------------------|
| 谁在用 | `testcase` 的 plan / groups / cases / get | 预留给以后的 task / project。**不要**拿来读测试用例 |
| 地址 | `https://www.teambition.com/testcase/api/` | `open.teambition.com`（本技能不调用） |
| 凭据 | Ego 里 teambition.com 的登录会话。`page.fetch` 自动带上 | `teambition_cli` / MCP token。测试计划模块不认 |
| 代码 | `scripts/lib/session.mjs` 的 `createTransport("browser")` | `createTransport("open")` 抛 `TRANSPORT_NOT_IMPLEMENTED` |
| 写操作 | 没有。只有 GET，加上本机关闭空间的 `cleanup` | 没有 |

`scripts/tb.mjs` 的 domain 注册表目前只有 `testcase`。`task` 和 `project` 写在 `FUTURE_DOMAINS` 里，命令会拒绝执行。以后要加域，只注册新的 `run`，不要重写路由器。

登录检查不走这两套 API。它打开 https://www.teambition.com/ ，看登录墙、应用正文和 Cookie **名字**。不打印 Cookie 值。
