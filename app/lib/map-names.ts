import catalog from './map-catalog.json' with { type: 'json' };

const maps = new Map<string, string>(Object.entries(catalog.maps));

// Display only: preserve the original level ID in battle storage and merge keys.
export function mapName(value: string | null | undefined, fallback = 'Map unavailable'): string {
  const id = (value ?? '').trim().replaceAll('\\', '/').replace(/^(?:levels|location)\//i, '').replace(/\.bin$/i, '');
  const known = maps.get(id.toLowerCase());
  if (known) return known;

  // Unknown/custom locations stay readable, without borrowing a different map's name.
  const readable = id.replace(/^(?:air|avg|avn|arcade)_/i, '').replace(/_/g, ' ')
    .replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  return readable.replace(/(^|[\s/])\p{Ll}/gu, initial => initial.toUpperCase()) || fallback;
}
