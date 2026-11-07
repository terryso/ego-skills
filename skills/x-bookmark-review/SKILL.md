---
name: x-bookmark-review
description: >
  Turn an x-bookmark-export archive into at most three sourced suggestions and
  an unbookmark plan. Analysis is structured input, not a keyword score.
  Cleanup is preview-only until the owner opts in and the command passes --yes.
  Grok Bot X connector delete_users_bookmark is the only removal route, and this
  skill does not call it. Ego Lite is unverified and is not invoked.
metadata:
  version: "0.1.0"
  runtime: grok-x-connector
  ego_browser: unsupported
  verification: unverified-ego-backend
  requires:
    bins:
      - node
  x_access:
    adapter: grok-connector
    tools:
      - delete_users_bookmark
---

# x-bookmark-review

在已有归档上接收结构化分析、生成最多 3 条建议，并默认只做清理预览。

Read an archive from `x-bookmark-export`, accept a structured analysis file, and plan cleanup. The default command does not unbookmark anything.

**状态：** 可移植核心和单元测试。Ego 后端未验证。这里的连接器步骤不是已经证明可用的 Ego 技能。现有只读分析例程不会被本技能自动切换。

**Status:** portable core and unit tests. The Ego backend is unverified. Connector steps are not a live-proven Ego skill. An existing read-only analysis routine is left untouched.

两个技能要装在相邻目录。只有 review、没有 export 时，退出码 `2`。

## 分析

分析文件的 schema 是 `x-bookmark-analysis/1`。核心不给帖子打分。它只接受 `actionable`、`unhelpful`、`keep`、`uncertain`，并核对 `archive_sha256` 和来源链接。来源必须是归档里的帖子 URL 或正文里的 https 链接。

`delivered`、`delete`、`command` 这类字段会被拒绝。帖子正文不能授权删除。

建议最多 3 条，带来源链接。重复标题加同一链接会跳过。没有新的有用项时保持沉默，不改 `notified`。书签表示兴趣，不是认同。

## 清理

分析和变更分开。`plan` 和没有 `--yes` 的 `apply` 都不发出连接器调用。`apply` 无 `--yes` 时退出码 `3`。

真正准备取消书签还要同时满足：

- 所有者已经用 onboarding 或 `consent-set` 打开对应开关。默认两个开关都是 false。
- `apply --yes`。
- 计划签名匹配，账号一致，没有过期，id 在允许列表里。
- 可执行建议要有交付回执。回执是本机 HMAC，不是分析文件里的布尔值。过期或篡改的回执不能用。
- 明显无帮助的项还要有 `discard_unhelpful`、归档原文和理由。`incomplete` 或 `uncertain` 不能删。
- 单次上限默认 10，最大 25。没有 `--all`。

本地先记下「已派出」再返回 `delete_users_bookmark` 参数。脚本自己不调用它。调用失败或本地确认没写上时，先 `reconcile`，对账之后才允许有限重试。已经成功的 id 不会再派出。

取消书签不删除原帖。重新加入书签不一定恢复顺序或文件夹。本地 `posts/*.json` 不会被删掉。

## 命令

```bash
node skills/x-bookmark-review/scripts/check-deps.mjs
node skills/x-bookmark-review/scripts/review.mjs onboard --answers /tmp/x-bookmark-answers.json
node skills/x-bookmark-review/scripts/review.mjs accept-analysis \
  --account 1000000000000000001 --archive /tmp/x-bookmark-archive --analysis /tmp/x-bookmark-analysis.json
node skills/x-bookmark-review/scripts/review.mjs recommend \
  --account 1000000000000000001 --archive /tmp/x-bookmark-archive
node skills/x-bookmark-review/scripts/review.mjs plan \
  --account 1000000000000000001 --archive /tmp/x-bookmark-archive
node skills/x-bookmark-review/scripts/review.mjs apply \
  --account 1000000000000000001 --archive /tmp/x-bookmark-archive --plan <planId>
```

引导问题一次只问一个。见 `references/onboarding.md`。清理细节见 `references/cleanup.md`。

## 成功标准

成功是本地状态和预览计划。退出码 `0` 且 `issue: true` 只表示允许宿主去调用连接器，不表示书签已经移除，也不表示 Ego 已验证。本仓库没有做现场清理。
