# State and consent contract (zhihu-article)

`--save-draft` is a remote mutation. It authorizes one article draft. It does not authorize public publishing.

`--publish` and `--yes` are parse errors. They are not aliases of `--save-draft`. Every summary sets `publishPermitted: false` and `publishSupported: false`, including a successful draft. Public publishing is not implemented. There is no code path that clicks 发布.

## Consent

| Input | `consent` | Browser | Exit |
|-------|-----------|---------|------|
| `preview` | `none` | no | `0` when the local plan is valid |
| `save-draft` without `--save-draft` | `none` | no | `3` |
| `save-draft --save-draft` | `save-draft` | yes, after login | `0` only when `state` is `draft-saved` |

Invalid Markdown, a malformed image, or a refused flag never starts the browser.

## Mutation

| `mutation` | When |
|------------|------|
| `none` | No editor write was observed |
| `autosave` | An id or the 已保存 badge appeared, but the draft was not verified. Also used when an explicit draft button was visible and was not successfully clicked |
| `autosave-verified` | No explicit draft button was visible. Autosave produced one id, the badge was visible, and reopen matched |
| `explicit-save` | The explicit draft button was clicked once. Success still requires the same reopen checks |

`autosave-verified` is a verified draft. It is not a publish.

## State

| `state` | `verified` | `retryable` | Exit |
|---------|------------|-------------|------|
| `not-started` | false | true only when nothing was opened or the editor was still blank | `0` preview, `3` unconfirmed save, `2` login, `1` or `4` for a blank-editor refusal |
| `failed` | false | true only for a local failure before an accepted edit | `1` |
| `uploaded` | false | false | `4` |
| `unverified` | false | false | `4`, or `2` when the session expired after content was entered |
| `draft-saved` | true | false | `0` |

A previous receipt in `uploaded` or `unverified` for the same content hash blocks another save with exit `4` and does not open the editor. A previous verified `draft-saved` receipt returns that id and does not write again.

## Receipt

The receipt is JSON keyed by the content hash. It stores the title, account name, state, draft id, clean edit URL, image count, cover status (`not-requested`, `applied`, or `unverified`), and a short observed excerpt. It does not store cookies, tokens, or local file paths.

`draftUrl` is `https://zhuanlan.zhihu.com/p/<id>/edit` only when `<id>` is a decimal string that was observed. The script does not invent an id from a button click.
