export type BaseKind = 'bombing' | 'defending';
export type BaseTeam = 'friendly' | 'enemy' | 'neutral';

export function baseKind(object: { type?: unknown }): BaseKind | null {
  if (object.type === 'bombing_point') return 'bombing';
  if (object.type === 'defending_point') return 'defending';
  return null;
}

// Read the supplied red/blue color family. Do not turn missing colors or
// neutral/yellow objectives into friendly bases, or infer team from base type.
export function baseTeam(object: { color?: unknown }): BaseTeam {
  if (typeof object.color !== 'string') return 'neutral';
  let color = object.color.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(color)) color = [...color].map((part) => part + part).join('');
  if (!/^[\da-f]{6}$/i.test(color)) return 'neutral';
  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);
  if (red >= 96 && red > green * 1.25 && red > blue * 1.25) return 'enemy';
  if (blue >= 96 && blue > red * 1.25 && blue > green * 1.05) return 'friendly';
  return 'neutral';
}
