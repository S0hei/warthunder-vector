## Vector 0.3.7

- Restyled the Results period dropdown to match Vector: condensed typography, a calendar icon, an angular dark surface and a custom arrow.
- Added a matching dark options menu in supporting browsers, with a red selected-item indicator and a clear keyboard focus outline.
- Preserved native keyboard navigation, all date presets and custom ranges. No new dependencies or changes to battle statistics or saved history.
- Checked the dropdown at 4K and smaller desktop sizes, including keyboard selection and custom dates.

Includes the updater fix from 0.3.6. If you are still on 0.3.5 or earlier and automatic updates fail with a port 8112 error, install this release manually once: choose **Exit Vector** in the tray, close any startup error dialog, replace your existing **Vector.exe** with this download, then launch it. Keep **Vector-data** in place. Closing only the browser does not stop Vector. Do not run copies inside the updates folder.

Vector checks for updates at launch and every hour. Installation waits for your **Restart Vector** click and a safe game state; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. The executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
