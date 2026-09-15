## Vector 0.3.4

- A new gunmetal, silver and red Vector emblem matches the War Thunder-inspired interface across the executable, tray, browser tab and sidebar. Map controls now use consistent angular SVG icons.
- The sidebar includes a direct link to the latest GitHub download.
- The top of the map shows known allied and enemy players still alive, using the local multiplayer roster and combat events rather than AI map markers.
- Added an elapsed battle clock synchronized from matching game events. Missing or stale information is shown as unavailable.
- A popup appears once an update is downloaded and verified, with **Restart Vector** and **Later** buttons in English and Russian.
- Installation now waits for your restart click. If you are in battle, the popup asks you to return to the hangar and try again; Vector does not restart unexpectedly later.
- The existing browser page reconnects after the restart. Installation failures are visible in the interface instead of only in the tray.
- Fixed downloaded updates waiting indefinitely when War Thunder is closed on Windows.
- The updater now allows enough time for Windows to confirm that the local game feed is offline. Active battles, unresponsive feeds and an unavailable game-process check still defer installation.
- Includes the player marker priority improvements from 0.3.3. Battle statistics and saved history are unchanged.

Vector checks for updates at launch and every hour. Installation waits for your **Restart Vector** click and a safe game state; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. Keep **Vector-data** beside it to preserve existing history. Older builds without the updater need this first download once.

If an older build has already downloaded an update but remains on the old version, choose **Exit Vector** in the tray before replacing Vector.exe. Closing the browser does not stop the app.

The Windows executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
