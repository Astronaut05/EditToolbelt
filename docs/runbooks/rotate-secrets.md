# Rotate secrets

Secrets live in the git-ignored `.env` (locally) and in the host's secret store (production); never in the repo. After changing one, restart what reads it: `docker compose up -d --force-recreate web worker`.

| Secret | Read by | What rotating it does |
|---|---|---|
| `BETTER_AUTH_SECRET` | web | Signs everyone out and ends admin two-factor sessions. Accounts and data are untouched. |
| `GOOGLE_CLIENT_SECRET` | web | Rotate in Google Cloud Console first, then here. Google sign-in fails in between. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | web, worker | Create the new key in storage, switch both services, then delete the old key. Download links already handed out stop working (they last 10 min anyway). |
| `DATABASE_URL` password | web, worker, migrate | `alter user etb password '…'`, then update the URL everywhere at once. |
| `SMTP_URL` | web, worker | Sign-in emails and alert emails fail until both use the new one. |
| `TELEGRAM_BOT_TOKEN` | worker | Revoke in @BotFather, set the new one. Alerts fall back to email in between. |

After a leak, rotate first and investigate second. Check Admin → Audit log for admin actions you don't recognise, and treat a leaked database or storage key as a possible breach ([data-breach.md](data-breach.md)).
