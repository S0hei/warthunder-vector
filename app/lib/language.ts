import russian from './translations/ru.json';

export type Language = 'en' | 'ru';
export type LanguagePreference = Language | 'auto';
export type LanguageSource = 'manual' | 'game' | 'steam' | 'system' | 'browser' | 'fallback';
export type LanguageState = { preference: LanguagePreference; language: Language; source: LanguageSource };
export const locales = { en: 'en-US', ru: 'ru-RU' } as const;
export const defaultLanguage: LanguageState = { preference: 'auto', language: 'en', source: 'fallback' };
export function normalizeLanguage(value: unknown): Language | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const name = value.trim().toLowerCase().replaceAll('_', '-');
  if (name === 'english' || /^en(?:-[a-z0-9]{2,8})*$/.test(name)) return 'en';
  if (name === 'russian' || /^ru(?:-[a-z0-9]{2,8})*$/.test(name)) return 'ru';
  return null;
}
export const validPreference = (value: unknown): value is LanguagePreference => value === 'auto' || value === 'en' || value === 'ru';
export function parseLanguageState(value: unknown): LanguageState | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as LanguageState;
  if (!validPreference(s.preference) || (s.language !== 'en' && s.language !== 'ru') ||
    !['manual', 'game', 'steam', 'system', 'browser', 'fallback'].includes(s.source) ||
    (s.preference !== 'auto' && (s.language !== s.preference || s.source !== 'manual')) ||
    (s.preference === 'auto' && s.source === 'manual')) return null;
  return { preference: s.preference, language: s.language, source: s.source };
}
export function browserLanguage(preference: LanguagePreference, languages: readonly string[]): LanguageState {
  if (preference !== 'auto') return { preference, language: preference, source: 'manual' };
  for (const value of languages) { const language = normalizeLanguage(value); if (language) return { preference, language, source: 'browser' }; }
  return { ...defaultLanguage };
}
export function parseAutomaticLanguage(value: unknown): LanguageState | null {
  const state = value && typeof value === 'object' ? parseLanguageState((value as { automatic?: unknown }).automatic) : null;
  return state?.preference === 'auto' ? state : null;
}
export function translate(language: Language, message: string, values: Record<string, string | number> = {}): string {
  const template = language === 'ru' && Object.hasOwn(russian, message) ? (russian as Record<string, string>)[message] : message;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
export function localizedNumber(language: Language, value: number | null, digits = 0) {
  return value === null ? translate(language, 'N/A') : value.toLocaleString(locales[language], { maximumFractionDigits: digits });
}
const russianCounts: Record<string, [string, string, string]> = {
  battle: ['бой', 'боя', 'боёв'], kill: ['уничтожение', 'уничтожения', 'уничтожений'],
  death: ['потеря', 'потери', 'потерь'], spawn: ['возрождение', 'возрождения', 'возрождений'],
  event: ['событие', 'события', 'событий'], second: ['секунда', 'секунды', 'секунд'],
  'saved record': ['запись', 'записи', 'записей'],
};
export function localizedCount(language: Language, value: number | null, singular: string, plural = `${singular}s`) {
  let noun = value === 1 ? singular : plural;
  if (language === 'ru' && russianCounts[singular]) {
    const form = value === null ? 'many' : new Intl.PluralRules('ru').select(value);
    noun = russianCounts[singular][form === 'one' ? 0 : form === 'few' ? 1 : 2];
  }
  return `${localizedNumber(language, value)} ${noun}`;
}
