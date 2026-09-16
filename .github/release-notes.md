## Vector 0.3.8

- Made Results, Participants, target tracks and recent session battles more compact, so more rows fit on screen.
- Reduced row padding and metadata gaps while keeping existing text sizes and automatic 4K scaling.
- Placed table header icons beside their labels. Battle results and timestamps share a line when space permits, and AI counts sit alongside player kills.
- Tightened Activity event spacing and empty states. Long names and translated labels can still wrap; expanded details, team colors and reported-loss markings are preserved.
- No changes to statistics, saved history or update behavior. Includes the styled period dropdown from 0.3.7.

Includes the updater fix from 0.3.6. If you are still on 0.3.5 or earlier and automatic updates fail with a port 8112 error, install this release manually once: choose **Exit Vector** in the tray, close any startup error dialog, replace your existing **Vector.exe** with this download, then launch it. Keep **Vector-data** in place. Closing only the browser does not stop Vector. Do not run copies inside the updates folder.

Vector checks for updates at launch and every hour. Installation waits for your **Restart Vector** click and a safe game state; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. The executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
