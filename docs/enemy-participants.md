# Compact enemy participants

Activity's Participants view is an enemy-focused, three-column table:
nickname, latest observed aircraft, and last reported damage received. It uses
the per-name observation directory, not the per-actor/vehicle score rows. Allies,
the local player and unknown-team participants are excluded. Enemies identified
only as targets are included when the existing roster annotation confirms their
name. The Events view still includes both sides and all existing combat events.

The existing picker searches only enemies while this table is open. Its large
selected-aircraft card is suppressed because the same aircraft is in the table.
Selecting an ally in Events cannot silently carry an empty enemy-only selection
into Participants. Clearing or searching works without changing battle data.

Damage is a timestamped report: Critical, Severe, Shot down, Destroyed or Crashed.
It is **not** damage dealt, a hit-point percentage, current flightworthiness, or
proof the aircraft remains destroyed. No report is shown as Unknown, not healthy.
Only target events and the participant's own crash update received damage;
outgoing attacks do not damage the attacker. A different observed aircraft clears
the previous report. Same-type respawns and airfield repairs cannot be inferred
from this HUD source, so the label remains Last damage rather than Current damage.

Reports are retained with each bounded flight participant even after the recent
event feed rolls over. Mission time and record ID order updates, including late
annotations; earlier-aircraft reports cannot contaminate a newly observed type.
Map changes and reconnects clear the directory through the existing tracker
baseline. The last flight stays explicitly labeled in the hangar. No new data
source, archive migration, net request, game input or memory access is added.
