# Live battle header

The map header shows known allied/enemy players alive and elapsed battle time.
The sidebar footer links to the fixed GitHub latest-release page, including in
the hangar. The link opens a new tab and does not restart or replace the app.

The live-map API's inspected mission/map responses contain no scoreboard totals
or continuous mission timer. Counts therefore use the existing read-only local
game-log collector, not anonymous map markers or a count of Activity rows.
Positive-account multiplayer roster entries establish known players and teams;
zero/negative accounts and explicitly labelled AI entries are excluded. Own-player
team determines allied/enemy orientation. IN_FLIGHT marks an active life; logged
shoot-downs, destruction, crashes and leaving the game remove it. Critical/severe
damage does not. A real respawn restores the player; duplicate death messages and
unchanged IN_FLIGHT snapshots cannot subtract twice or resurrect a dead plane.

These are **known** live players from observed records, not a promise of a complete
server scoreboard. Missing teams display unavailable, not zero. Unsupported states,
missing records and changes in the game's logging format can limit coverage.
Only aggregate counts, session identity and timing leave the reader; the roster
and account IDs are not exported or saved by this feature.

Elapsed time is anchored by matching a HUD message's game-time value to the same
message's log timestamp, then advancing locally while the live feed is available.
It never uses Vector's opening time or a guessed match length. Until a matching
event exists, time is unavailable. This is not a remaining-time countdown; paused
practice flights can drift until another event resynchronizes the clock.

The existing Activity polling loop carries the summary; no new game endpoint or
extra telemetry polling loop is added. Successful reads of the active log refresh
it even if an unrelated replay is unreadable. A paused/unavailable collector makes
the summary stale after 15 seconds. Map transitions, hangar entry, HUD resets and
disconnects clear it. The previous native session cannot fill a new map's header.
Everything stays local, with no game memory access, injection or screen reading.
