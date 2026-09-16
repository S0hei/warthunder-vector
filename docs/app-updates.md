# Automatic app updates

Vector.exe checks the latest stable release of S0hei/warthunder-vector at launch
and every hour while the tray app runs. It is not an OS scheduled task. The tray
shows the installed version and update status, with a manual Check for app
updates action. History collection can be paused independently. Vector.html and
the development server do not install app updates.

Checks use the public GitHub Releases API over HTTPS without authentication.
Downloads are limited to the exact repository's Vector.exe release asset and
GitHub's HTTPS asset hosts. Stable numeric versions only: no downgrades, drafts
or prereleases. Metadata is bounded to 1 MiB and executables to 64 MiB, with
network timeouts. The GitHub-provided SHA-256 digest, length, assembly version
and Vector product metadata must all agree. This trusts the repository and
GitHub HTTPS; it is not Authenticode signing or protection against compromise
of the release publisher. No SSH key or GitHub token is embedded in the app.

The complete, verified download is staged in Vector-data/updates. The interface
shows an English/Russian popup with **Restart Vector** and **Later**. Dismissing
it leaves a small update button; it never authorizes an automatic restart.
Installation requires an explicit click, then an out-of-battle map response or
a refused local feed with no running aces game process. Windows has up to five
seconds to report a refused connection. Timeouts, invalid responses and active
battle maps reject the restart request with a visible message. The user must
click again after returning to the hangar; the app does not silently restart later.
No process memory is read. The replacement is checked again immediately before
installation. App folders containing filesystem links are refused.

A temporary copy of the current executable acts as the updater. It verifies
the requesting process identity/start time and original file hash, handshakes
with it, and waits for graceful exit. It cannot kill the requesting app. Only
the executable in that same app directory can be replaced; data, game files
and unrelated files are untouched. File.Replace preserves previous.exe in the
staging directory. The new app must acknowledge successful server/collector/tray
initialization within 20 seconds. If startup fails, only that updater-launched
replacement child may be terminated, the old executable is restored, and that
release digest is suppressed until a manual retry or a different release.

From 0.3.6, helper, replacement and rollback processes use `CreateProcessW` with
handle inheritance disabled and no console window. The startup handshakes open
their named events explicitly. This prevents the .NET Framework launch path from
passing the loopback listening socket to the helper, which kept port 8112 occupied
after the parent exited. Exclusive socket binding is retained: no address reuse,
new port, firewall change or termination of an unrelated port owner is needed.
See [Microsoft's handle inheritance documentation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw).
The Windows regression fixture starts a real loopback server in the parent and
requires its replacement to bind the same port and serve HTTP before acknowledging
startup while the helper is alive. It uses temporary files, an ephemeral port and
a separate mutex, never the user's collector, game, browser or running Vector.

The existing browser tab checks the local app instance and update state every
three seconds and reloads after a restart, refreshing its per-launch access token.
Older native versions retain the 15-second instance check. It does not
poll GitHub. Like a normal app restart, the temporary Activity table and
session start time reset; saved battle history stays intact. Previous.exe and
failed.exe are retained for recovery. No administrator elevation is attempted;
if the executable is locked, its folder is not writable, or atomic replacement
is unsupported, the existing version is kept. The tray and popup report failure.
A rollback marker for a newer version is shown after the old app restarts. If
the browser cannot reconnect within 90 seconds, it asks the user to reopen Vector
instead of displaying an endless progress state.

The read-only GET /api/updates and bodyless POST /api/updates/restart require the
per-launch token. Restart additionally requires the exact local Origin; GET,
cross-origin requests and arbitrary request bodies cannot start an installer.
POST queues a single handoff and returns before the native app exits. Duplicate
requests from multiple tabs are rejected. No executable paths or release URLs
are accepted from the browser or exposed in the update status.

The interface is included from 0.3.4; the inherited-socket fix is in 0.3.6.
An older updater cannot reliably install this fix because its own helper retains
the bug. Exit Vector from its tray, close startup error dialogs, and replace the
main Vector.exe manually once, preserving Vector-data. Do not launch executables
from the staging folders. A popup does not bypass checksum verification or rollback.

## Publishing

Update package.json and native/Version.cs together, update release notes, commit
to the repository, then push a matching vMAJOR.MINOR.PATCH tag. The Windows
release workflow installs the locked dependencies, runs type/lint/frontend and
native checks, builds the self-contained artifacts, and verifies embedding.
It uploads Vector.exe, Vector.html and SHA256SUMS into a draft release, compares
GitHub's uploaded digests and lengths, then publishes it as latest. A published
release is never overwritten. Push a new version/tag for fixes.

The workflow uses GitHub's short-lived GITHUB_TOKEN with contents-write access
only for release publishing. GitHub actions are pinned to commit SHAs. No
developer private key, captured telemetry, battle archive, environment file or
machine-specific investigation note belongs in source control.
