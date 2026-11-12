# Go public

The site's code is public by default (`docs/decisions/2026-11-12-go-public.md`). What still keeps strangers out is Cloudflare Access, which answers before Railway. This page is the steps only Astro can do, in order. Step 1 is the one that opens the site.

## Before

- The pull request with the Go public change is merged, and Railway has deployed it. Actions → **Ops checks** → Run workflow, checks `site`: while Access still covers the domain it says the site is private. That is expected.

## 1. Open the site (Cloudflare, 2 minutes)

Zero Trust → Access → Applications → the EditToolbelt application → Edit.

- Change its addresses from the whole domain to the admin only: `edittoolbelt.com/admin` and `www.edittoolbelt.com/admin` (domain, then `admin` in the path field).
- Keep the policy that allows your email. The Service Auth policy can go: CI no longer needs a token.
- Save. **Do not delete the application:** editing it keeps its audience tag, which Railway's `CF_ACCESS_AUD` names. A new application has a new tag, and `/admin` then answers 403 until the variable is changed.
- The second application, the one that opens `/.well-known/acme-challenge/`, is no longer needed. Delete it.

The site is public from the moment you save.

## 2. Check it (GitHub, 1 minute)

Actions → **Ops checks** → Run workflow, checks `site,access,worker`. Expect:

- `site: public (the pages answer anyone): version …, ready, security headers, www redirects; /admin is behind Cloudflare Access, then its own sign-in`
- `access: public site; behind Access: /admin`
- `worker: worker alive: …`

If `site` says the home page answered 404 from Railway's edge, the custom domains are not on the web service: Railway → `web` → Settings → Networking → Custom domain, port 8080, for the domain and `www`. If it says 525 or 526, set Cloudflare's SSL mode to Full instead of Full (strict).

From here **Smoke** runs after every deploy and **Watch** every 30 minutes with no secrets at all.

## 3. Soon after

Each of these is independent.

- **A contact address.** `/contact` says an address is on its way until this is set. Cloudflare → Email → Email Routing: route an address at the domain (for example `hello@`) to your inbox. Then Railway → Shared Variables → `CONTACT_EMAIL` = that address, and Actions → **Railway** → Run workflow → approve.
- **Sign-in email reaches inboxes.** The `dns` check says the domain has no SPF and no DMARC record, so sign-in links may land in spam. Add the SPF record your email provider gives you, and a DMARC record: TXT `_dmarc`, `v=DMARC1; p=quarantine; rua=mailto:<your address>`.
- **Lock the origin.** Without it a request can skip Cloudflare by going straight to Railway's edge, and then choose the client address the rate limits count.
  1. Make a secret: `openssl rand -base64 48`.
  2. Cloudflare → Rules → Transform Rules → Modify Request Header → Create: all incoming requests, Set static, header `x-origin-auth`, value the secret. Deploy it **first**: the site ignores the header until step 3.
  3. Railway → Shared Variables → `ORIGIN_AUTH_SECRET` = the secret. Then Actions → **Railway** → Run workflow → approve (the web service starts reading it).
  4. Ops checks → `site` still passes. If every page answers 403, the two values differ: remove the Railway variable, apply, and start again.
- **A rate-limiting rule.** Cloudflare → Security → WAF → Rate limiting rules (one is free): requests to `/sign-in` and `/api/`, 100 in 10 seconds per IP, block for 10 seconds. The site has its own limits; this keeps a flood off Railway.
- **Railway waits for CI.** Railway → `web` and `worker` → Settings → Source → Wait for CI. Today Railway deploys a commit as it lands on `main`. Only merged pull requests land there, and they have passed CI, so this is a second lock, not a missing first one.
- **Search engines.** Google Search Console and Bing Webmaster Tools: verify the domain (DNS record) and submit `/sitemap.xml`.
- **Tidy up.** GitHub → Settings → Secrets → Actions: `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` can be deleted. They name a service token that no longer exists.

## Do not

- Do not set the `CLOUDFLARE_API_TOKEN` secret. It wakes the old Cloudflare Pages deploy job in `ci.yml`, which would put the static export (no accounts, no API) on the domain in place of Railway.
- Do not turn payments on from here: `turn-on-payments.md`, after the legal pages have their final text.

## Take it private again

Set `SITE_ACCESS: 'private'` in the web service's `env` in `.railway/railway.ts` (a pull request), then Actions → Railway → Run workflow → approve, and give the Access application the whole domain again (remove `/admin` from its addresses). CI then needs a live Access service token in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`, in a Service Auth policy on the application.
