# Results periods

Results defaults to Today and also offers Yesterday, Day before yesterday,
This week (Monday through today), Custom period, This session and All saved
battles. Custom dates include both the start and end day. The first custom
selection starts with the currently selected calendar period; subsequent visits
retain the entered dates for as long as Results stays mounted.

The period selector uses Vector's condensed typography, calendar icon, angular
surfaces and red focus accent. Supporting browsers also render a themed options
menu with a selected-item indicator. It remains a native select, preserving
keyboard navigation and an accessible label; older browsers retain the native
options popup. No dropdown library or additional JavaScript state is needed.

Calendar ranges use the computer's local dates and the battle's `playedAt`,
not archive arrival time or later result updates. Date arithmetic uses calendar
days, not fixed 24-hour intervals, so daylight-saving changes and local midnight
are handled correctly. The existing 30-second clock refresh advances presets
after midnight. Session boundaries and the hangar session overview are unchanged.

The same filtered collection drives the rows, battle count, win rate, ratios,
reward totals and pagination. Account boundaries, unresolved outcomes and
provisional reward exclusions remain unchanged. Changing dates, period or
account resets pagination. Empty, invalid, reversed and future custom ranges
do not silently fall back to all battles; validation is shown alongside the
date fields. No archive writes, data migration or additional network source.
