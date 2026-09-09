# Map display names

Session overview and Battle history use the shared `mapName` resolver. Names
come from the English `location/` entries in the game's `missions_locations.csv`,
bundled in `app/lib/map-catalog.json`. The source repository, exact revision and
file are recorded in the catalog and the portable third-party notice.

The archive's `mission` field is the replay header's level ID, not a mission-mode
title. Resolve the exact location ID, ignoring case and optional `levels/`,
`location/` and `.bin` wrappers. Do not infer a game mode or match a similar map.
Winter and ground variants use their own localization entries. For example:

| Stored level | Display name |
| --- | --- |
| `avg_egypt_sinai` | Sinai |
| `air_equatorial_island` | Bourbon Island |
| `air_israel` | Golan Heights |
| `air_kamchatka` | Volcano Valley |
| `air_southeastern_cliffs` | Rocky Pillars |
| `krymsk` | Kuban |
| `stalingrad_w` | Winter Stalingrad |

Unknown/custom IDs get a readable fallback, without an invented catalog match.
Missing data remains `Map unavailable` (or `Battle` for the row heading).
This is display-only: no migrations or changes to saved IDs, merging, results,
rewards or collector behavior. No game memory access, extra API calls, or
runtime network access is involved. Existing saved battles immediately benefit.

To refresh the catalog, run `node scripts/map-catalog.mjs <reviewed-commit-sha>`.
The optional maintainer script reads the pinned public extracted resource and
prints an apply_patch patch; inspect and apply it, update the revision in
`public/aircraft-notices.txt`, then run tests and rebuild the portable app.
Normal builds and tests use the checked-in catalog and do not fetch this source.
The game location labels are preserved, with long dashes changed to hyphens.
