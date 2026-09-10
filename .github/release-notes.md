## Vector 0.3.2

- Airfield repairs no longer count as additional spawns or reduce kills per spawn. Genuine new spawns still count separately.
- Existing repair-inclusive statistics are corrected automatically from available game logs. Unverifiable counts remain unavailable instead of being guessed. Saved history is preserved.
- Russian statistics now use **Фраги**, **Смерти**, **Спавны**, **Фраги / Смерти** and **Фраги / Спавны**, including the correct plural forms.
- Shot-down enemies are crossed out in the Activity participants table while their aircraft, team color and damage report stay readable.
- Failed map backgrounds retry automatically. Invalid telemetry and delayed responses from a previous battle no longer disrupt the current map.
- Last-known enemy positions expire correctly when the feed goes offline. Polling and local file-reader caches are bounded, and account selectors keep the newest known nickname.
- Local-only statistics remain lightweight, without profile-browser or screen-reader integrations.

Vector checks for updates at launch and every hour. Installation waits until it is safe to leave the current battle view; saved history stays in **Vector-data**.

Download **Vector.exe** to a writable folder and run it. No installation or administrator rights required. Keep **Vector-data** beside it to preserve existing history. Older builds without the updater need this first download once.

The Windows executable is unsigned. Vector is an unofficial read-only companion and does not access game memory. It contacts GitHub for app updates but does not upload battle data. Vector.html is an optional standalone map without file-based history or automatic app updates.
