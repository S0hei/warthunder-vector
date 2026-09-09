# Aircraft identity and reward labels

Session overview and Battle history share `AircraftNames`. Display names come
from English game localization (`_0`, with `_shop` fallback), preserving exact
marks/variants and capitalization. Game-font nation glyphs are replaced by SVG
flags. Names and flags are bundled in the browser build and single-file EXE;
there are no runtime requests to GitHub or the wiki.

The catalog prefers explicit `operatorCountry` values (including lists), then
a single explicit country tag. It does not guess from aircraft design origin,
ID suffixes, team color, or a similar model name. Unknown IDs get a readable
fallback without a flag. For example the Belgian Spitfire has Belgium's flag,
not Britain (manufacturer) or France (research tree).

`scripts/aircraft-catalog.mjs` is an optional maintainer tool, not part of the
game collector or ordinary build. It fetches only the pinned public extracted
localization, unit tags and flag assets and prints a patch for review/application.
To refresh, run it with a reviewed 40-character source commit SHA. Review any new
country labels in `scripts/aircraft-countries.json`, inspect/apply the printed
patch, update `public/aircraft-notices.txt`, and rerun tests and portable build.
Missing or placeholder-only names are not assigned invented display names.
At this revision, 1,565 aircraft/helicopters have display identities and 56 flags
are embedded. Metadata is the game's classification, not independent historical
research; its historical national symbols are retained.

Sources and third-party notice: `public/aircraft-notices.txt`. The notice is also
embedded as an HTML comment in the portable artifact (and thus in the EXE).

Reward presentation uses **Battle earnings** and **Experience**, with separate
columns in the overview and separate fields in battle details. Hover text retains
the WP/EXP source distinction. This is a naming change only: amounts, aggregation,
unknown values, partial coverage, and provisional/final safeguards are unchanged.
WP is not labeled as net Silver Lions, and EXP is not labeled as vehicle RP;
neither stronger interpretation was established by the inspected game logs.
