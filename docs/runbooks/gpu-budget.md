# The GPU budget alert

`gpu_budget` alerts at 80 % and at 100 % of the day's GPU budget, once a day each (`docs/05` → GPU costs and the daily budget). The day is UTC: it resets at 05:00 Tashkent.

- **80 %** ("GPU spend is $0.82 of today's $1.00 budget"): a warning. GPU jobs still start, as long as the jobs already running couldn't take the spend past the budget even at their time limits (Admin → Dashboard → GPU → "GPU jobs starting" says so).
- **100 %** ("GPU budget reached"): the worker has stopped starting GPU jobs. They wait in the queue; any that wait 15 minutes expire with their credits back, and the person sees "It waited too long in the queue". CPU tools are unaffected.

## When it fires

1. **Is it real use?** Admin → Dashboard → GPU: today's spend, GPU jobs today, and cost by tool. Admin → Jobs, filtered by the GPU tool and today: many jobs from one account, or a few very long ones?
2. **Abuse or a loop** (one account, many jobs; the same file again and again):
   - Admin → Users → the account → disable it (reason: the incident), and revoke its API keys.
   - Cancel its queued jobs in Admin → Jobs (credits go back).
3. **A tool costing more than it should** (cost per job well over what its credits bring in, the Margin column under 2×):
   - Admin → Jobs → a few of its jobs: `gpu_seconds` per job. A cold start on every job (scattered traffic) adds Whisper's 15 to 25 s load each time.
   - Put the tool in maintenance ([disable-a-tool.md](disable-a-tool.md)) while you look, and raise its price with a cost override in Admin → Tools if the numbers say so.
4. **Real, healthy demand:** raise the budget in Admin → Dashboard → GPU (with a reason). The worker starts GPU jobs again on its next claim, within seconds. Modal's own monthly limit ($20) stays behind it; raise that in Modal only with Astro.
5. **Nothing looks wrong but the spend is high:** compare with Modal's dashboard (Usage). Our figure counts every call's idle window, so it should read a little above Modal's; far above or below means the prices in `config/business.ts` (`gpuPricing`) need confirming.

## Stop all GPU work now

- Set the budget to $0 (Admin → Dashboard → GPU): no new GPU job starts; running ones finish.
- Or set each GPU tool's status to `soon` (Admin → Tools): no new GPU jobs at all.
- A running call can be cancelled with its job (Admin → Jobs → Cancel): the worker cancels the call on Modal within a few seconds, and the credits go back.
