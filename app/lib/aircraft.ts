import catalog from './aircraft-catalog.json' with { type: 'json' };

type AircraftEntry = [name: string, countries: string[]];
type CountryEntry = [name: string, flag: string];
const aircraft = new Map<string, AircraftEntry>(Object.entries(catalog.aircraft) as [string, AircraftEntry][]);
const countries = new Map<string, CountryEntry>(Object.entries(catalog.countries) as [string, CountryEntry][]);

export function resolveAircraft(value: string) {
  const id = value.trim().toLowerCase();
  const entry = aircraft.get(id);
  if (!entry) {
    // Do not infer an operator from a model prefix: captured/export aircraft are common.
    // Keep already-readable/localized names intact; make new technical IDs legible.
    const name = value.trim().replace(/_/g, ' ').replace(/\b[a-z][a-z\d-]*\b/g, word =>
      /\d/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
    return { name: name || 'Unknown aircraft', countries: [], known: false };
  }
  return { name: entry[0], countries: entry[1].flatMap(key => {
    const country = countries.get(key);
    return country ? [{ id: key, name: country[0], flag: country[1] }] : [];
  }), known: true };
}
