# Payment webhooks stop arriving

Credits are added only by the providers' own calls to `/api/webhooks/paddle`, `/api/webhooks/click` and `/api/webhooks/payme` (`docs/05` → Payments). When they stop, buyers pay and see "Waiting for … to confirm" on `/credits/return`.

1. **Is the provider on?** Admin → Payments: "Taking money now" must say yes. A path answers 404 while its provider is off (the kill switch, its admin switch, or a missing key), and the provider then counts every delivery as failed.
2. **Can the provider reach us?** While the site is behind Cloudflare Access, each path needs its Bypass application (`turn-on-payments.md` → step 3). Access's logs show blocked requests; a 403 from Access means the bypass is missing or wider paths changed.
3. **What did we answer?** Admin → Payments → Webhook events lists what arrived, when it was processed and any error (payloads are never shown). The web service's log has `payments.webhook` (status) and `payments.webhook_failed` lines for each provider, without payloads.
4. **Replay.** Webhooks are stored once per event id and processed idempotently: an event that failed counts as new on the next delivery, and one that went through is never applied twice. So replaying is always safe:
   - Paddle: Developer tools → Notifications → the destination → the event → Replay.
   - Click and Payme retry by themselves for a while; Payme's cabinet shows the transaction's state.
5. **A paid purchase without its credits** after the replay: check the event's error in Admin → Payments. "no purchase has this transaction" or a price mismatch is kept on purpose: refund the buyer in the provider's dashboard, or, if they should get the credits, grant them in Admin → Users with the purchase id in the reason. Never edit the ledger by hand.
