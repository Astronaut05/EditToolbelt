# Disable a tool fast

Any tool can be stopped from the admin without a deploy; the site picks it up within 30 s.

1. Admin → Tools → the tool.
2. Pick one, with a reason:
   - **Maintenance message** ("Back in an hour"): the page stays up with the message; use it while you fix something.
   - **Status `disabled`**: the page answers 404 and the tool leaves the hubs and the sitemap.
   - **Server path off** (hybrid tools): the browser path keeps working; uploads and server jobs for it are refused.
3. Jobs already queued for it still run. To stop them too: Admin → Jobs, filter by the tool and `queued`, and cancel each (credits go back).
4. Put it back the same way; "default" returns the registry's status.
