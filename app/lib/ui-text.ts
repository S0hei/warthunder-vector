import type { FileBattle } from './file-battles';

export const notAvailable = 'N/A';
export const formatNumber = (value: number | null, digits = 0) => value === null
  ? notAvailable : value.toLocaleString(undefined, { maximumFractionDigits: digits });

export const countLabel = (value: number | null, singular: string, plural = `${singular}s`) =>
  `${formatNumber(value)} ${value === 1 ? singular : plural}`;

export function battleOutcomeText(battle: Pick<FileBattle, 'outcome' | 'conflict'>) {
  if (battle.conflict) return 'Results disagree';
  return battle.outcome === 'win' ? 'Victory' : battle.outcome === 'loss' ? 'Defeat' : 'No result';
}
