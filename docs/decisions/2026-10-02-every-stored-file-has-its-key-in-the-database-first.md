# 2026-10-02 · Every stored file has its key in the database before it exists

**Decision:** the sweeper finds every file through a key the database already holds; it doesn't delete files it can't name. Two gaps the final worker review found (B2) are closed that way:
- **A CPU job's output:** the runner puts the new random key on the job (`jobqueue.record_output`, guarded by worker and status), then uploads (`runner.py` → `_store`). If the worker dies, or `succeed()` fails, after the upload, the key is still on the job: the next attempt deletes it first (`_drop_stale_output`), or the sweeper does 60 minutes after the job ends. GPU keys already worked this way (`start_gpu_call`). If the job is no longer the worker's, nothing is uploaded.
- **An upload storage completed but the web never recorded** (the web died, or its `headObject` or database write failed, between `CompleteMultipartUpload` and its `UPDATE`): the sweeper's stale-upload loop now deletes the object after aborting the multipart upload. The row still has `multipart_id` set, so no job can use it; deleting a missing object is a no-op.

The `storage_old_objects` alert (anything older than 2 hours) stays as the signal that some other path leaves files behind.

**Why:** rule 4 says the sweeper is the guarantee. With both gaps the only cleanup was R2's 1-day lifecycle rule (up to ~48 hours). Recording the key first is the smallest change that makes the 1-hour rule hold in both windows, and it reuses the pattern GPU keys already follow. The other option the review named, deleting any listed object older than 2 hours that no row references, was not taken: it adds a second, broader deleter whose reference check has to stay in step with every place that writes a key, and one missed reference deletes a live file (a long job's input, an output being delivered). It would also only act at 2 hours, not 1.

One narrow case is left to the alert and the lifecycle rule: a worker that stalls for over 60 s mid-upload, whose job is reaped and picked up by another worker (which deletes the old key at once), and which then finishes that upload and dies before deleting it.

**Reverse:** drop `record_output` and let `Storage.upload` make its own key again; drop the `storage.delete` after `abort_upload` in `retention.py`. Both gaps come back.
