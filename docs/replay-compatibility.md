# Replay compatibility and collector health

The metadata reader accepts replay versions 101387 and 101404. The latter was
checked against local game-generated files using the same header offsets,
standalone-BLK trailer parser, field allowlist and battle validation. It does not
assume arbitrary future versions are compatible. Replays without a multiplayer
battle ID are ignored rather than assigned an invented identity.

Unsupported or incomplete replay data is not a file-permission error. Parsing
failures are counted separately as `skippedReplays` (bounded by the 200-file scan
window), while the collector continues reading supported replays and game logs.
Results and the session overview display a neutral notice only when that count
is nonzero. Older native responses without the count remain supported.

The replay cache stores length, last-write time and whether parsing was skipped.
Unchanged unsupported files are not reparsed every five seconds; changed files
are retried, and files leaving the scan window are removed from the cache. Failed
reads and archive writes are never cached as successful imports. They still set
`read-error` and are retried, including when the source replay has not changed.

Format exceptions are caught only around the replay parser, never around archive
saves. Saved history is not deleted, and neither parser support nor a successful
read promotes departure-time rewards or unknown outcomes to confirmed results.
