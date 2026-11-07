# Onboarding

Ask one question, wait for the answer, then ask the next. Do not copy goals, cadence, or consent from another owner, another bot, or a bookmark.

1. `x_connection` — Has this owner connected the authenticated X connector in the host? The skill will not open a browser or call `api.x.com`.
2. `goals` — What should the bot look for? The answer is stored as text. It is not a delete instruction.
3. `cadence` — `daily`, `few_days`, or `weekly`. This chooses a future server-side routine. It does not install cron or a watchdog on the machine.
4. `cleanup_mode` — `preview` (default) or `auto`.
5. Only after `auto`: `auto_processed`, then `auto_unhelpful`. Each accepts a real boolean. The string `"true"` does not opt in.

`preview` stores both consent flags false. `review.mjs onboard` without `--apply` only prints the next question. `--apply` writes `owner.json` and consent for the account in the answers file. The account id must match `--account`.

The parent authors the host onboarding skill later, after validation. This file is the generic script. It is not that host skill, and it is not a created bot.

Server routines, if the parent adds them later, belong in the bot host. Do not add crontab, systemd timers, or a folder watcher on the box.
