# Interface languages

Vector supports English and Russian. The selector is in the side-panel header
and remains accessible in battle and in the session overview. Auto is the default.
Switching language changes labels without remounting the map or activity tracker.
It does not change the game's language or the language of HUD parsing.

## Detection order

The native app uses the first supported English/Russian value from:

1. `language:t` in the detected or user-selected game's `config.blk`.
2. `language` in that Steam library's `appmanifest_236390.acf`.
3. The current user's Steam `Language` registry value.
4. The Windows UI culture.
5. English fallback.

Sources that are missing, inaccessible, unsupported or ambiguous are skipped.
Repeated identical Steam language values are accepted. Regional codes such as
`ru-RU` and `en-GB` normalize to the supported interface language. Auto rechecks
once a minute. A manual preference takes priority and changes immediately.

Configuration reads are read-only, bounded to 1 MiB and reject filesystem links.
Only language values are used. No game configuration is changed; no Steam SDK,
account files, private service, game process memory or input automation is used.
The game folder comes from the existing installation discovery/folder picker.

## Persistence and local API

The native preference is the only field saved in `Vector-data/language.json`:
`{"preference":"auto"}`, `{"preference":"en"}` or `{"preference":"ru"}`.
Updates preserve it. Copy Vector-data when moving your preference and history.
Atomic replacement retains one `.bak` revision. Failed saves leave the previous
choice active and show a short error; game or account data is never written here.

The loopback `/api/language` GET returns only the supported effective preference,
language, source enum and automatic-detection result. PUT accepts one preference
field, a JSON body of at most 128 bytes, the per-launch token and an explicit same
origin. Invalid bodies, duplicate keys, extra fields and other methods are refused.
It cannot change a path or game setting and does not enable archive writes.
Each page load receives the current setting in its native bootstrap.

The development bridge proxies only GET, never the token or native writes.
Its preference is browser-local; Auto can read game detection from an updated
native app even when the tray has a manual preference. Standalone Vector.html
cannot inspect game files or the system: Auto uses browser language preferences,
then English. Browser choices are saved under `vector-language` in localStorage;
storage availability and persistence for file URLs depend on the browser.

## Text and data

Both dictionaries are bundled offline. English interface text is the canonical
key; Russian translations are shared by React and the Windows tray. Numbers and
dates use en-US/ru-RU formatting without changing the local time zone or battle
period boundaries. Russian count labels use one/few/many plural forms.
Missing values remain missing, not zero. Translation never changes battle data,
reward finality, team colors, player names, raw game messages or proper aircraft
and map designations. Country tooltips are translated; flags remain unchanged.
The bundled official-site fonts already include Cyrillic.

Tests cover source priority, config line endings, ambiguity, bounded settings,
restart persistence, HTTP protections, placeholders, plural forms, localization
coverage, native save failures, stale polling responses and browser fallback.
