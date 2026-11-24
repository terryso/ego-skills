# ToS / ethics notes (zhihu-article)

- Personal use of the Zhihu account already signed in to Ego Lite. The article help used for draft and image limits is [专栏与文章使用常见问题](https://www.zhihu.com/column/p/20681428).
- The skill prepares one article draft. It does not publish, schedule, answer, comment, or post a 想法.
- Do not create accounts, sell a dataset, bypass a captcha or challenge, harvest credentials, or type a password.
- The script does not call private Zhihu APIs, `page.fetch` against internal endpoints, or cookie export. It uses the visible editor through `ego-browser`.
- The script does not print cookie values and does not commit session files.
- Examples use `/absolute/path/to/article.md`. No home-directory paths and no real account names.
- `--save-draft` is not permission to click 发布 or 邀请预览.
- A draft can exist after autosave even when this command later fails. Do not run it again while the receipt says `uploaded` or `unverified`.
