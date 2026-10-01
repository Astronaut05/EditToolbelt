# A stuck job

1. Admin → Jobs: filter by the user's email or the tool. Open the job.
2. Read the timings: when it was queued and started, the last heartbeat, attempts and the worker.
   - Queued for long: see the queue_wait alert in [alerts.md](alerts.md). A job queued for 15 min expires by itself and gives its credits back.
   - Running with an old heartbeat (over 60 s): its worker died. The reaper requeues it (at most twice, then it fails with WORKER_LOST and refunds). Nothing to do but check the worker.
   - Running with a fresh heartbeat: it's working; the time limit stops it at `Time limit`.
3. To stop it: "Cancel and give the credits back", with a reason. A running job's worker notices within 5 s and deletes its input.
4. To run an ended one again: "Run it again" works only while its input is still in storage (it usually goes when the job ends). It runs on us: no credits, no free job. Otherwise the user uploads again.
5. Never fetch the user's file to look at it. The probe record and the error are what you have.
