# 2026-10-02 · Server tools take video up to 240 frames a second

**Decision:** the jobs API refuses a video above 240 fps for every server tool before anything is charged (`MAX_SERVER_FPS` in `apps/web/src/server/job-rules.ts`), asking for it at its playback rate. The GPU tools also cap the frames they decode (#84).
**Why:** server tools are priced by the minute, which assumes an ordinary frame rate, and the decode cap limits seconds, not frames. The review found a truthful 3 s file at 10,000 fps, priced at the 2-credit minimum, that Compress Video decoded and encoded frame by frame: 30,000 frames, the work of 17 minutes at 30 fps. Phones record slow motion at up to 240 fps, so nothing honest is turned away; faster footage is normally exported at its playback rate.
**Reverse:** raise `MAX_SERVER_FPS`, or price CPU video tools per frame as `frameCount` does for the GPU ones.
