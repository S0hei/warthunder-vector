# Automatic battle history

Implemented 2026-09-08 following the local-file investigation. No game-memory access, input automation, screenshots, private service calls, external upload, new package or installer is required.

## Collection and scope

`native/GameFiles.cs` is compiled into Vector.exe. Steam's uninstall entry and library index provide installation discovery, with a tray folder-picker fallback. Only `.game_logs/<timestamp>__<pid>.clog` and `Replays/*.wrpl` are read. Reparse-point files are skipped. The game files are never written or locked exclusively.

The five-second background scan is serialized and independent of the UI thread. It examines the newest 200 replay files and 32 client logs modified within seven days. Replay fingerprints skip unchanged files and a quiet interval avoids partly written trailers. Log byte offsets and UTF-8 decoder state survive polls; reads are bounded per file. Truncation resets the reader, failed persistence causes replay from the source, and raw log lines are never saved. Only allowlisted diagnostic record families are considered, with bounded line length and strict field matching. A stopped/paused collector performs no new scan.

The replay reader accepts the investigated header version 101387 and standalone uncompressed BLK metadata only. Header/trailer offsets, counts, string bounds, author row and complete trailer consumption are validated. It does not decode gameplay packets or import other players' metadata. Unsupported versions fail closed until explicitly reviewed.

## Record semantics

The durable key is `(accountId, battleId)`, not map generation, filename or import date. Replay start time takes precedence over the log's join timestamp. Log and replay fields merge into one row. Repeated snapshots/restarts do not add battles; contradictory outcomes become a visible conflict and are excluded from confirmed totals.

Outcome and reward finality are independent. `outcome` is `win`, `loss` or `unknown`; `rewardsFinal` requires an explicit terminal log status adjoining the SessionStats ending. A final replay does not promote provisional WP/EXP. A provisional rescan cannot downgrade confirmed data. No late economic report is synthesized from account-balance changes, activity events or missing telemetry.

`kills`, ground/naval kills, separate AI counters, deaths, assists and score retain replay semantics. Missing scoreboards do not become zero-kill battles in K/D. WP and EXP are displayed as Battle earnings and Experience; they are not verified net profit or vehicle research points. Aggregate coverage explicitly reports how many resolved matches have finalized log rewards. All unknown outcomes and provisional rewards remain outside those totals.

## Storage and serving

Allowlisted JSON records are flushed and atomically replaced under `Vector-data/battles`, keeping one previous version. Existing unreadable records are preserved and flagged. The archive loads/serves up to 5,000 recent records. A selected installation path is kept in `Vector-data/game-folder.txt`; no account credentials or decoded log dumps are persisted. Backup/move the entire Vector-data folder to retain history.

`GET /api/battles` and `/api/activity-teams` require a per-launch token, strict Host/Origin validation, loopback binding, size limits and conditional requests. There is no HTTP write/file route. The development-only `/api/vector/battles` and `/api/vector/activity-teams` proxies accept local Host, same-origin GET requests only, obtain native authorization on the server side and forward no browser-selected destination or headers. They fail closed if the native app is absent or outdated.

Results now contains only automatic history. The copied-report UI, parser, importer, clipboard APIs and `/api/reports` route have been removed. Existing files under `Vector-data/reports` are preserved but never read. The singleton mutex retains its historical name solely to avoid launching two versions simultaneously. Periods use local play date or play time since Vector started. Accounts are selected separately.

## Spawns and combat colors

Own-unit assignment is established from `MPlayer::onStateChanged()` with `l=1` and the logged account ID. Matching `UnitRespawn` events with a nonnegative spawn base, or following an explicit `IN_RESPAWN -> IN_FLIGHT` transition, count as statistical spawns. An unbased (`spawnBase:-1`) reset of an already observed own unit without a new-life transition is an airfield restoration, not another spawn. Thus Air RB repairs do not reduce kills per spawn; genuine additional lives are not globally capped at one. Timestamp/unit keys deduplicate events and survive reconnects and rescans. Landings, repair-start/burn messages, enemy units and former own units do not count.

The archive retains its original `spawnEvents` and adds allowlisted `spawnTypes` evidence (`spawn` or `repair`). Old events remain unclassified until available logs are reread; a partial or missing classification yields an unavailable count, not the old inflated total or a guessed value. Within the existing 32-log limit, older logs may be read past the normal seven-day window when their time range overlaps unclassified saved events. Replays and legacy rescans cannot erase known classifications. Normal archive updates retain `.previous` backups. No game files are modified. Replay-only battles have no inferred spawn count. The two ratios use independent coverage: total kills / total deaths, and total kills / statistical spawns, only across battles providing both inputs. AI remains separate.

Activity displays an event feed and a participant table. The native collector holds at most 128 allowlisted combat annotations in memory. Roster team IDs establish each side relative to the local player's team; HUD color roles are learned from those roster-confirmed identities, never hardcoded palette numbers or presumed attacker/victim opposition. The frontend only annotates exact normalized HUD messages within 15 seconds of their observation and within the current observation window. Unknown or conflicting sides stay neutral. No roster, HUD annotation, full log or authentication value is saved as part of this feed. Actor and target vehicle labels are colored separately, including friendly fire.

## Validation

Native synthetic fixtures cover replay metadata parsing, unsupported/truncated/residual data, single-byte incremental log reads, sensitive-line exclusion, departure/final transitions, unrelated later mission statuses, log/replay merging, duplicate/restart behavior, account isolation, independent reward finality, conflicts, corrupt archive preservation and protected API access. Frontend tests cover validation, date order, account keys, unresolved-result exclusion, AI separation, missing scoreboards, reward coverage, independent reward finality and dev-proxy origin/host checks.

`scripts/test-game-files.ps1` is an optional local integration check. It reads the selected game's files into a separate temporary archive and verifies record uniqueness and persistence. It is not run by the public release workflow. Regular tests use synthetic fixtures and do not require an installed game or access to saved user history.

HUD log flush latency can delay live annotations. No claim is made that early-departure final results are recoverable, that WP equals net SL, or that EXP equals vehicle RP.

A third-party file format's technical readability is not a certification of Gaijin permission.
