import { resolveAircraft } from './lib/aircraft';

export default function AircraftNames({ vehicles }: { vehicles: string[] }) {
  return <span className="aircraft-list">{[...new Set(vehicles)].map(id => {
    const aircraft = resolveAircraft(id);
    return <span className="aircraft-identity" key={id}>
      {aircraft.countries.length > 0 && <span className="aircraft-flags">{aircraft.countries.map(country =>
        // Bundled data URI: no image optimizer or external server is used by the portable app.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={country.id} className="aircraft-flag" src={country.flag} alt={country.name} title={country.name} width={24} height={16} />
      )}</span>}
      <span className="aircraft-title">{aircraft.name}</span>
    </span>;
  })}</span>;
}
