# Drain workers

A worker stops cleanly on SIGTERM: it stops claiming, stops its running tool, and hands the job back to the queue for another worker (or itself, later). Nothing is lost and nothing is charged twice.

1. `docker compose stop worker` (sends SIGTERM, waits 10 s, then kills). A killed worker's job is requeued by the reaper after 60 s instead; also fine.
2. To stop new work but let running jobs finish: switch the affected tools' server path off or put them in maintenance ([disable-a-tool.md](disable-a-tool.md)), wait until Admin → Dashboard shows nothing running, then stop the worker.
3. Bring it back: `docker compose up -d worker`. It claims waiting jobs at once (it also listens for new ones).
4. Jobs waiting more than 15 min while workers are down expire and give credits back; tell users to run them again if the outage was long.
