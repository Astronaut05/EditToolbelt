# 2026-10-02 · A worker cleans up what a stop, a stall or a kill left

**Decision:** four small fixes from the final worker review's nits, so inputs and scratch files go as soon as nothing needs them, and no sooner:
- **A cancel during a stop:** `jobqueue.requeue` says whether it handed the job back. A job the person cancelled while the worker was stopping isn't handed back, so its input is deleted at once instead of at the upload's expiry.
- **A stalled worker:** before deleting a job's inputs, the runner asks the database whether the job is back in the queue or running on another worker (`jobqueue.runs_elsewhere`). If so, the inputs stay for that attempt; this covers both a clean hand-back and a job the reaper took from a worker that stalled for over 60 s. When the database can't answer, the inputs are deleted, as before: privacy first, and the retry fails with its credits back.
- **The 2-hour alert** (`storage_old_objects`) leaves out the inputs of queued and running jobs: a CPU tool may run 2 hours after up to 15 minutes in the queue, so a live input can pass the mark.
- **Scratch folders:** jobs and probes now make their folders under one root, `<temp dir>/etb-work` (mode 700). A starting worker locks the root (`flock`) and empties it, so a killed worker's folders (a user's input, maybe an output) don't outlive it. A second worker on the same host finds the lock held and leaves the folders alone. `--task` runs don't touch it.

**Why:** each closes a gap in rule 4 (or in a retry) without new moving parts. The ownership check is one indexed read per job. The lock costs nothing and makes clearing safe on a shared host; Railway runs one worker per container, and compose gives the worker its own `/tmp`. Where the database says the job is still this worker's (its `succeed` or `fail` didn't land), the inputs still go, as before.

**Reverse:** in `runner.py`, delete inputs unless `requeue` returned True (the old flag); drop `_not_in_use` in `retention.py`; make job folders with `tempfile.mkdtemp` again and drop `workdir.py` and its call in `main.py`.
