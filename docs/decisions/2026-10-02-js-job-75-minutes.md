# 2026-10-02 · CI's JS job gets 75 minutes

**Decision:** the JS job's `timeout-minutes` goes from 45 to 75 (`.github/workflows/ci.yml`).

**Why:** with every tool built, a normal run takes about 44 minutes: Lighthouse about 10, the static e2e in four browsers about 21, the server build's e2e about 9 (main's run 37033313146: 43.7 minutes). #90's run was cut off at 45 in the server build's tests, with nothing failing. The slow apt mirror the old comment allowed for adds up to 28 minutes on its own. Splitting the server build's tests into a job of their own would be faster, but that job wouldn't be among the required checks, which only Astro sets, so its failures wouldn't block a merge.

**Reverse:** set it back to 45, or split the job and add the new one to the required checks.
