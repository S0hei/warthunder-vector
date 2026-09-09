# In-game UI icons

Vector bundles 13 original War Thunder UI assets: the Silver Lions coin plus
experience, victory, combat, spawn, participant and statistics symbols. Assets
come from the same pinned public extraction as the offline map/aircraft names.
Exact filenames, source revision and original SHA-256 hashes are stored in
`app/lib/game-icons.json`. The third-party notice lists every selected file and
is embedded in both portable outputs.

`GameIcon` is decorative (`aria-hidden`); `GameLabel` always keeps visible text.
The Silver Lions coin retains its original PNG shading. The original monochrome
SVG artwork is used as a CSS mask, with restrained theme colors and no tile
backgrounds. Artwork is not redrawn and SVG IDs/styles never enter the page DOM.
All sizes follow text scaling in `em`, with slightly larger summary icons and
compact table/navigation icons. The Activity event count has its own badge class
so it cannot apply a border to icon spans.

Earnings and Experience use the shared reward label in summaries, table headings
and battle details. Existing WP/EXP source caveats, unavailable values, reward
finality and calculations remain unchanged. The coin does not turn partial
earnings into confirmed net Silver Lions. The experience symbol does not change
EXP into vehicle RP or convertible RP.

The optional maintainer command `node scripts/game-icons.mjs <reviewed-sha>`
prints an apply_patch patch. It validates bounded PNG/SVG input, removes SVG
editor metadata and rejects active/external SVG content. Review/apply the patch,
update notices, run tests and rebuild the portable app. Normal builds never
download these assets; the app needs no network connection for icons.
