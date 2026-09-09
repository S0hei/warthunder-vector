# Activity participant picker

Activity has a searchable picker above its event feed and participant table.
Opening it lists observed names with aircraft and team colors. Typing searches
names, source vehicle labels and the bundled readable aircraft names. Selecting
a name shows its latest observed aircraft and filters events where that exact
name is either the actor or target. Participants uses a compact enemy-only table
with nickname, aircraft and last reported damage received; its picker searches
enemies and suppresses the duplicate aircraft card. See `enemy-participants.md`
for the table's data limits. Clear removes the selection and filter. Arrow keys, Enter,
Escape, pointer selection and an explicit browse button are supported.

## Data limits

This is an observed-participant directory, not a complete live roster or a human
versus AI classifier. The inspected game logs provide other participants' roster
and unit assignments, but `UnitRespawn` aircraft IDs in normal matches were only
available for the local player. No live aircraft field for every pilot was
established. The picker therefore says **Last observed aircraft**, with the
observation time, rather than claiming an unseen respawn or continuously current
aircraft. Existing game-localized HUD labels are retained; technical aircraft
IDs use the same offline names and flags as battle history.

An actor with a parsed name/aircraft is eligible, except explicit AI-tagged
names. A target is eligible only when its exact name has already been observed
or a time-matched native annotation confirms that name in the current battle's
roster. Parentheses and team colors alone never create a named participant.
The native annotation adds only `targetInRoster`, not a new roster export.
The native name splitter handles nested aircraft variants and nickname
parentheses. Existing message/time checks still reject historical backfills.

The latest sighting is chosen by mission time, then HUD record ID, not fetch
completion order or table order. Observations survive the 60-event display
window, are bounded to 256 exact names, and remain in memory only. Clan tags and
distinct names are not merged by fuzzy matching. A new flight or reconnect
clears the directory, selection and search. In the hangar, retained observations
are labeled as the last flight. Combat counts and durable battle results are
unchanged. No additional data source, game input, memory access or external
request is used.

Validation includes tracker chronology, target identity, pruning/reset,
immutable prior snapshots, localized search, exact-name filtering, rendered
copy/colors, keyboard/pointer handlers, responsive sizing and native roster
identity fixtures. These checks do not involve controlling the game or browser.
