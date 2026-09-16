## Vector 0.3.6

**If an older version fails during automatic updates, install this release manually once:** choose **Exit Vector** in the tray, close any startup error dialog, replace your existing **Vector.exe** with this download, then launch it. Keep **Vector-data** in place. Closing only the browser does not stop Vector. Do not run the copies inside the updates folder.

- Fixed updates failing with "Only one usage of each socket address..." on port 8112, then rolling back to the old version.
- The updater helper was inheriting the app's listening socket and keeping the port occupied after the main app exited. Helper, replacement and rollback processes now launch without inherited handles.
- Added an end-to-end Windows regression test that serves HTTP, exits the original process, then starts the replacement on the exact same port while the helper is still alive.
- The port remains exclusive. Checksum verification, explicit restart approval, battle-state checks and rollback protections are unchanged.
- Includes the 4K layout improvements from 0.3.5. Battle statistics and saved history are unchanged.

The faulty updater is part of the older executable, so downloading 0.3.6 through that updater cannot reliably repair it. The one-time manual replacement installs the corrected updater for future releases.

Vector checks for updates at launch and every hour. Installation waits for your **Restart Vector** click and a safe game state; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. Keep **Vector-data** beside it to preserve existing history. Older builds without the updater need this first download once.

If an older build has already downloaded an update but remains on the old version, choose **Exit Vector** in the tray before replacing Vector.exe. Closing the browser does not stop the app.

The Windows executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
