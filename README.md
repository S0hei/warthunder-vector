# Vector

Vector is a modern, read-only tactical map and battle-history companion for War Thunder. Your battle data stays on your PC. The Windows app uses GitHub only to check for and download app updates.

## Start it

1. [Download Vector.exe](https://github.com/S0hei/warthunder-vector/releases/latest/download/Vector.exe) to a writable folder, then start War Thunder.
2. Double-click **Vector.exe**. No installation or Node.js is needed.
3. Put the opened Vector tab on your second monitor and press `F` for full screen.

Vector reconnects automatically if the match changes or the telemetry feed briefly drops.

Outside battle, the map area becomes a **Session overview**: confirmed win rate, both kill ratios, battle earnings, experience, separate AI counts and the six latest battles since Vector started. It shares the selected account and a single collector connection with Results. **Battle history** opens the full Results panel. The live map returns automatically when the game's map-validity flag becomes true, including respawn and spectator views. Brief telemetry interruptions retain the map; after 15 seconds without either map-info or object updates, the overview replaces it. Session totals never include older backfilled battles or another account's records.

## Automatic updates

Vector.exe checks for a new stable release at launch and every hour while it runs. It downloads verified updates in the background, then restarts outside battle. The existing browser tab refreshes automatically. The tray menu shows the installed version and update status and includes **Check for app updates**.

Updates replace only the executable, preserving **Vector-data** and your saved battle history. A failed startup triggers rollback to the previous executable. A normal update restart clears temporary Activity observations and begins a new session window. Network failures leave the current version usable and retry later. See [update behavior and safeguards](docs/app-updates.md).

Older builds without this updater need one manual replacement with the latest Vector.exe. Close Vector using its tray menu first. The app is unsigned, so Windows may show a reputation warning. Vector is an unofficial companion, not a Gaijin product or a claim of Gaijin approval.

## Display scaling

Text, controls, spacing and panels scale automatically with the browser's usable width and height, including 1440p and 4K screens. Smaller labels now have a readable baseline instead of the previous 6–9px sizes. The map retains its own fit/zoom controls and precise pointer coordinates.

Scaling updates when resizing the window, moving between differently scaled monitors or entering full screen. It uses CSS viewport dimensions, so Windows display scaling is not applied twice. Browser zoom and larger default fonts remain available. Narrow/short windows keep scrolling tables and wrapping controls rather than forcing a minimum-height layout off screen. Both Vector.exe and Vector.html include this behavior.

## Portable single-file build

Run `pnpm build:portable` on Windows to create **Vector.exe** and **Vector.html** in the project root. Copy **Vector.exe** to a writable folder on another Windows PC and double-click it. It contains the complete interface, opens `http://127.0.0.1:8112/` in your default browser, and collects battle history from game-written logs and replays automatically. No Node.js, pnpm, installation, administrator access or separate HTML file is needed on that PC. It uses Windows' .NET Framework 4 runtime (normally present on Windows 10/11). This locally built executable is unsigned.

The tray icon offers Open, Pause/Resume collection, Choose War Thunder folder, app update status/checks, and Exit. Steam installations are detected automatically; use the folder picker if discovery fails. Closing the browser does not stop collection or hourly update checks; use **Exit Vector** in the tray to stop it. Launching the executable again reopens the existing app. The map still reads the game directly from `127.0.0.1:8111`.

Vector's lime **V** icon is embedded in the Windows executable and tray, with 16–256px sizes for different display scales. The same icon appears in browser tabs, including the standalone HTML file. No separate icon file is needed when moving the app. The editable source is `public/favicon.svg`; `public/vector.ico` is the generated Windows asset, rebuilt with `node scripts/build-icon.mjs` when Sharp is available (or pass an absolute Sharp module path).

Automatic history is saved beside the executable in **Vector-data/battles**. Copy **Vector-data** as well to move your history to another PC. Updating/replacing Vector.exe leaves that folder intact. Each changed record keeps one previous revision as a backup. Automatic history separates account IDs. Legacy copied-report files are left untouched, but are no longer read or used.

**Vector.html** remains a single-file, map-only alternative that can be opened directly in a browser. Saved results and source-confirmed Activity team colors require **Vector.exe**; a standalone HTML page cannot read game files.

`build-src` contains compiler input and is not meant to be opened in a browser. Only the generated root-level `Vector.html` is the portable app.

## Controls

- Vector initially fits the view around active air contacts. Press `0` or the ⤢ button to resume aircraft-based auto-fit.
- Press `B` or the **B** map button for **battle-area auto-fit**: it frames all reported friendly/enemy runway endpoints and the area between them, with 10% padding on each side (at least 2.5% of the map per axis). It adapts to airfield changes, new maps and window resizing, independently of aircraft positions and layer visibility. If no valid runway geometry is available, it shows the whole map until airfields arrive.
- Drag to pan, use the mouse wheel or `+` / `−` to zoom. Manual map movement pauses auto-fit.
- Press `C` or double-click to center your aircraft.
- Press `1` through `5` to toggle air contacts, ground units, objectives, airfields, and spawn points. Airfields are visible by default; spawn points are hidden until enabled.
- Press `M` to toggle last-known enemy positions. Lost contacts remain on the map and in the enemy track table for 90 seconds.
- Click any marker to see its distance and track.
- The vehicle selected in War Thunder receives a thin, muted split-ring highlight automatically when the live map feed supplies its target flag. This is separate from clicking a marker in Vector and respects your visible layers; it does not move the map.
- Click an enemy table row to jump to that contact's current or last-known position.
- Click a recent team ping on the map or contact board to focus its grid square.
- Open **Activity** beside **Contacts** for the live event feed and participant table. It keeps updating while you use the map or Contacts tab.
- Open **Results** for automatic battle history and both kill ratios.

## Automatic battle history

Start Vector.exe and play normally; no Copy button or report-screen interaction is required for the file-based fields. The collector checks game-written files every five seconds, imports saved replay metadata and reads new log bytes incrementally. It backfills up to 200 available replays and the newest 32 client logs modified within seven days. Saved history survives source-file rotation and restarts; the interface exposes the newest 5,000 saved records. The Windows reader is included in the single executable.

Results shows confirmed win rate, separate **kills / deaths** and **kills / spawns**, and a match list with kills, deaths and spawns. Expand a battle for its individual ratios, battle earnings, experience, AI counters, assists, score, map, aircraft, duration and match ID. Choose today, yesterday, the day before yesterday, the current week, a custom date range, this session or all saved battles. Periods use **play time**, not import time; weeks start on Monday and custom ranges include both selected dates. If multiple accounts are present, choose the account; their totals are not pooled.

An absent replay result stays unknown, not a loss. Departure-time rewards are marked provisional in battle details and excluded from reward totals. Confirmation of a replay outcome alone does not finalize a log's provisional rewards: reward finality is tracked separately. Battle earnings and experience come from the game's WP/EXP values, not verified net Silver Lions or vehicle-research RP. Resolved-match reward coverage is shown explicitly. The inspected files do not supply late-final reports after leaving early, and this implementation does not invent them.

Only numeric battle fields and required match/account/vehicle labels are saved. Full decoded logs, other players' profiles, authentication material, crash dumps and arbitrary game files are not exported or persisted. Files are opened read-only with sharing; Vector does not inject code, read game memory, modify game configuration, control game input, capture the screen or call private game services. This documents technical behavior, not blanket Gaijin approval. Replay metadata support is explicitly version-gated (header 101387); unsupported or unreadable files produce a concise error instead of guessed records. See `docs/automatic-battle-history.md` for implementation details and tests.

## Kill ratios

Kills are the replay's air + ground + naval kill counters; explicit AI counters stay separate. K/D divides total kills by deaths. K/spawn divides total kills by logged spawns, including the unit respawn emitted after airfield restoration. It does not count landings, repair starts or burning as spawns. Only the local player's currently assigned unit counts. Source-event timestamps deduplicate rescans and merge reconnects. Each ratio uses only battles with both required counters; coverage is shown beside it. Missing spawn evidence stays unavailable, never deaths + 1.

Clipboard polling, report import, copied-report parsing and the copied-results interface have been removed. Vector never opens the clipboard. Existing legacy report files are preserved but unused.

## Combat activity

Activity opens on the latest 60 events, with separate attacker and target blocks, a readable action label and sortie time. **Participants** is a compact table of known enemies, their latest observed aircraft and last received damage. Damage describes reported combat events, not a live health percentage; an aircraft change clears the prior aircraft's damage. A flight-player selector and search make it quick to find a nickname or aircraft. Allies are blue, enemies red, and your own identity lime; names and vehicles share their confirmed side. Unknown sides remain neutral. The read-only log collector validates HUD color roles against explicit roster team IDs, then annotates only matching live HUD messages within 15 seconds. It does not assume that an attacker's target is an enemy. These annotations are temporary and are not saved to disk.

The table starts from new events after Vector connects. It skips the initial HUD buffer because it can include earlier sorties. Leaving for the hangar freezes the last table; the next map or a feed reconnection begins a fresh observation window. Refreshing or closing the page clears this temporary activity. Keep Vector open to collect it; nothing needs to be entered manually.

The activity parser recognizes validated Russian wording and equivalent English destruction, shoot-down, damage and crash phrases. Unrecognized messages, awards, fires, and disconnects do not become kills or deaths. This is an observed-activity table, not a full roster, final scoreboard, or human/bot classifier for the map. Test flights can also produce activity. Final results are kept separately in Results and never merged with these observation counts.

## How it works

The page reads `map_obj.json`, `map_info.json`, `map.img`, `mission.json`, coordinate-bearing messages from `gamechat`, and the `hudmsg` combat feed directly from War Thunder at `localhost:8111`. It uses the map feed's headings, runway geometry, active/blinking state, grid definition, mission status, and recent team pings. Combat activity polls separately about once per second, checking map identity before and after each HUD read to avoid mixing transitions. The feed is read-only and accessible only while the game exposes it.

Vector intentionally ignores `state` and cockpit values from `indicators`. Combat messages stay on the separate Activity tab instead of adding noise to the map.

Aircraft markers use the map feed's explicit role: **fighter** = pointed marker, **assault** = one tail bar, **bomber** = two tail bars. These markings work for both friendly and enemy contacts, retain their heading, and also appear in last-known positions and the enemy track table. Blue/red allegiance colors and green squad/player highlighting remain unchanged. A compact role legend is on the Contacts tab.

Unrecognized/missing roles use an outlined marker. The game's `Player` icon does not specify your own aircraft's role, so Vector does not guess it. War Thunder's map feed still does not provide a reliable human/bot flag for aircraft; aircraft role does not imply player identity. Ground contacts remain in their separate layer.

Game-target highlighting uses an explicit `icon_bg` matching `<icon>Target`, observed live as `FighterTarget`, `WheeledTarget`, and `AirdefenceTarget`. Ordinary blinking contacts are not treated as selected. The highlight updates with the live objects, disappears when the target flag is absent or the feed is offline, and never appears on last-known memory markers. It preserves aircraft role/direction and allegiance colors without adding a filled marker background. If the game does not expose a selected object, Vector cannot mark it; this does not infer radar or missile locks.

Bombing bases use small circle outlines; defence bases use rounded-square outlines. Each has a small center dot, with muted red for enemy and blue for friendly bases, taken from the feed's color rather than inferred from objective type. Missing/neutral colors stay gray. Runways use the same palette and transparent outlines, retaining their exact length and orientation. Base letters and gold diamonds are removed; hover labels, click selection, and separate airfield/spawn filters remain available.

If Vector says **Feed offline**, verify that `http://localhost:8111` opens while you are in a battle. Some menus and replays do not expose complete telemetry.

## Checks

For development, use Node.js 24 and pnpm 11.19.0, then run `pnpm install --frozen-lockfile`. `pnpm test` runs combat-parser, aggregate, archive-decoding, activity and update regression tests. `pnpm exec tsc --noEmit` checks types. `pnpm build` checks the development service build; `pnpm build:portable` builds the standalone HTML and embeds it in the Windows executable. `pnpm test:windows` runs isolated native persistence, HTTP-security and updater handoff/rollback checks without accessing the clipboard or user archive. The Windows compiler is taken from the installed .NET Framework. `node scripts/verify-release.mjs` verifies bundled assets and creates release checksums.

`pnpm dev` remains available for UI development. With Vector.exe running, a restricted same-origin development proxy supplies automatic battle history and temporary Activity team annotations at localhost:3000. It does not expose the native service token to browser code or allow browser-selected targets/paths. Standalone Vector.html cannot read game files and directs the user to Vector.exe for automatic history. The packaged executable is the normal runtime.
