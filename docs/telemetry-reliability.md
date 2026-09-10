# Telemetry reliability

The live map still reads the same public loopback endpoints. No game memory,
private services, browser extension or screen capture is used.

`app/lib/telemetry.ts` owns the feed types, runtime validation, request timeout
and polling lifecycle. Invalid rows are skipped. Invalid collection envelopes
are rejected without replacing the last good snapshot. Map dimensions and grid
steps are checked before coordinate calculations. Hangar snapshots remain valid
even when their geometry is absent or zero-sized.

`app/use-war-thunder-feed.ts` owns the four map, metadata, mission and chat loops.
Each loop has one pending timer and cancels its active request on cleanup. A
local revision changes when map identity or battle/hangar state changes. Responses
started under an older revision cannot repopulate the new battle's contacts,
objectives or chat cursor. Recent chat IDs are deduplicated within a response too.

Enemy memory uses the last actual observation time. The interface marks contacts
stale after 1.8 seconds without a new snapshot and removes remembered contacts
after 90 seconds, even if polling is unavailable. New map revisions clear manual
selection. These contacts are still approximate position-based tracks, not
authoritative game vehicle IDs or hidden enemy positions.

`app/map-image.tsx` retries a failed background image with delays from 1.5 to 30
seconds. It does not reload a successfully loaded map. A map change unmounts the
old image and cancels any pending retry.

The Windows collector retains reader/signature caches only for the current scan
window (32 logs and 200 replays). Logs already read to their current length do not
allocate another read buffer. Saved battle files and result/reward merging are
unchanged.

## Verification

`scripts/telemetry.test.mjs` covers malformed feed values, timer cancellation,
long-running polling, stale tracks, image retry backoff, account labels and
in-flight responses at map transitions using fixtures and fake timers. It does
not connect to a game or read a player's archive. Native cache pruning is covered
by `pnpm test:windows`. Run the full app tests, type checks, lint, both builds and
portable asset verification before distributing an executable.
