# Payment webhooks stop arriving

Payments (Paddle) arrive with M5; this page is filled in then. The shape of it:

1. Paddle's dashboard shows failed deliveries (Admin → System will show the last webhook received).
2. Webhooks are idempotent by event id, so replaying from Paddle's dashboard is safe.
3. A paid purchase without its credits: replay the event; don't grant credits by hand unless the replay is impossible, and then with the purchase id in the reason.
