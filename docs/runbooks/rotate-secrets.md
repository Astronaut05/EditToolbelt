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
| `WELCOME_GRANT_SECRET` | web | Don't, unless it leaked: every email could claim the welcome grant once more. Unset, it's derived from `BETTER_AUTH_SECRET`, so set this one before rotating that. |
| `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` | web | Make the new one in Paddle, switch the Railway variable, then revoke the old one. |
| `PADDLE_WEBHOOK_SECRET` | web | Rotate in Paddle's notification destination; Paddle signs with both for a while, and either one passes. |
| `CLICK_SECRET_KEY` | web | Change it in Click's cabinet and the Railway variable together; Click's calls fail in between and Click retries them. |
| `PAYME_KEY` | web | Change it in Payme's cabinet and the Railway variable together; Payme's calls fail in between and Payme retries them. |

After a leak, rotate first and investigate second. Check Admin → Audit log for admin actions you don't recognise, and treat a leaked database or storage key as a possible breach ([data-breach.md](data-breach.md)).
