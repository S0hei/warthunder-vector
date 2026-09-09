# Official-site visual theme

Vector adapts the official War Thunder website's visual language without
loading its stylesheets, scripts, advertising, tracking or artwork at runtime.
This is still an unofficial local companion, not a Gaijin product.

Reference inspected 2026-09-09:
- https://warthunder.com/en
- https://warthunder.com/assets/index.css?v=f1e1da9e
- https://warthunder.com/css/fonts.css

The reference uses navy #13191b / #263238 / #31424a / #546e7a, light text #cfd8dc,
red #e53935 accents, predominantly square panels, uppercase Roboto Condensed
navigation, and Roboto for reading text. Vector applies that hierarchy to the
map controls, navigation, session overview, Results, Activity, player picker and
enemy table. Small white text uses darker #d32f2f button fills, and secondary
text is lightened to preserve contrast. Fonts and control sizes retain the
existing viewport-based 4K scale, native keyboard controls and scroll behavior.

Red brand accents are separate from data semantics. Friendly, enemy, squad,
self, aircraft-role, base, target-reticle, damage and outcome colors are not
reclassified. Marker shape, size, transparency, anchor coordinates and map
movement are unchanged. No data collection, results logic or filter behavior
changes. Aircraft and player names keep their original casing.

Four unchanged Roboto 2.137 (2017) fonts are bundled from the exact official-site
URLs in `scripts/warthunder-fonts.mjs`. The fonts' name tables identify Google
copyright and the Apache 2.0 license. The script pins SHA-256 checksums, refuses
changed assets, and is maintenance-only (`node scripts/warthunder-fonts.mjs
--download`). Local CSS references work in development and both builds; Vite
inlines the font bytes in the portable HTML. `public/font-notices.txt` is also
embedded in that HTML, then in the executable. No Google Fonts or War Thunder
connection is needed to display the theme.

The existing Vector desktop icon and game icon assets remain unchanged. No
official logo, promotional hero, extra tips, UI sections, or remote background
has been added. Verification uses static CSS/font checks, font integrity and
license checks, contrast calculations, existing component/interaction tests,
both builds and the isolated native server tests. Browser QA was not requested.
