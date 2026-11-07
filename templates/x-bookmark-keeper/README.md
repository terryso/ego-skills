# x-bookmark-keeper template

Generic source for a later public bot. This directory is not a created bot, not a share link, and not an installed schedule.

The parent installs `x-bookmark-export` and `x-bookmark-review`, then authors the host onboarding skill after validation. Do not publish this template to SkillHub or ClawHub from this branch.

## What a future owner must be asked

Use `skills/x-bookmark-review/references/onboarding.md`. One question at a time. Start from empty answers. Do not copy another person's name, goals, consent, archive path, or private links.

## Runtime route

The supported read tool is Grok Bot's X connector `get_users_bookmarks`. The supported unbookmark tool is `delete_users_bookmark`, and only after the local plan says `issue: true`.

This version is not an Ego backend. `check-deps` reports `not_implemented` and `not_accepted`. Run [getting-started.md](./getting-started.md). A printed recipe is not a connector call.

## What not to ship from here

- No crontab, systemd unit, or file watcher on the computer.
- No `api.x.com` client, cookie import, or browser login.
- No live cleanup and no real bookmark fixture.
- No claim that `npm test` accepted the workflow on Pro or Mini.
