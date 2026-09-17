## Vector 0.3.9

- Added support for War Thunder replay format 101404 while retaining format 101387 support and strict result validation.
- Fixed unsupported or incomplete replays incorrectly causing the persistent "Some files unavailable" warning. These now have a separate, neutral notice; genuine file-access and save failures remain visible.
- Replays without a multiplayer battle ID no longer cause errors or enter session statistics.
- Stable unsupported files are cached instead of being reparsed every five seconds. Changed or completed files are retried automatically, as are failed archive saves.
- Verified the collector against actual game files using an isolated test archive. Existing history, reward safeguards and the compact table layout are preserved.

Includes the updater fix from 0.3.6. If you are still on 0.3.5 or earlier and automatic updates fail with a port 8112 error, install this release manually once: choose **Exit Vector** in the tray, close any startup error dialog, replace your existing **Vector.exe** with this download, then launch it. Keep **Vector-data** in place. Closing only the browser does not stop Vector. Do not run copies inside the updates folder.

Vector checks for updates at launch and every hour. Installation waits for your **Restart Vector** click and a safe game state; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. The executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
