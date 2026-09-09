'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { browserLanguage, defaultLanguage, locales, localizedCount, localizedNumber, parseAutomaticLanguage, parseLanguageState, translate, validPreference } from './lib/language';
import type { LanguagePreference, LanguageState } from './lib/language';
import { vectorEndpoint } from './lib/vector-bridge';

const storageKey = 'vector-language';
type LanguageContextValue = LanguageState & { saving: boolean; error: boolean; setPreference: (value: LanguagePreference) => void };
const LanguageContext = createContext<LanguageContextValue>({ ...defaultLanguage, saving: false, error: false, setPreference: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LanguageState>(defaultLanguage), [saving, setSaving] = useState(false), [error, setError] = useState(false);
  const stateRef = useRef(state), revision = useRef(0), mounted = useRef(false), savePending = useRef(false);
  const detected = useRef<LanguageState | null>(null);
  const requests = useRef(new Set<AbortController>());
  const update = useCallback((next: LanguageState) => { stateRef.current = next; setState(next); }, []);
  useEffect(() => {
    mounted.current = true;
    revision.current++;
    let stopped = false;
    const activeRequests = requests.current;
    let stored: LanguagePreference = 'auto';
    try { const value = localStorage.getItem(storageKey); if (validPreference(value)) stored = value; } catch { }
    const boot = parseLanguageState(window.__VECTOR__?.language);
    // Server rendering cannot read native bootstrap or browser preferences. Apply
    // those external settings once after hydration, without remounting the app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    update(boot ?? browserLanguage(stored, navigator.languages));
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const endpoint = vectorEndpoint('language'), atRevision = revision.current;
      const controller = new AbortController(); requests.current.add(controller);
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        if (endpoint) {
          const response = await fetch(endpoint.url, { headers: endpoint.headers, cache: 'no-store', credentials: 'omit', signal: controller.signal });
          const payload = response.ok ? await response.json() : null;
          const next = parseLanguageState(payload);
          const automatic = parseAutomaticLanguage(payload);
          if (automatic?.preference === 'auto' && !stopped) detected.current = automatic;
          if (next && !stopped && revision.current === atRevision && !savePending.current) {
            // Preview preferences are local; production shares the tray setting.
            if (window.__VECTOR__) update(next);
            else if (stateRef.current.preference === 'auto' && detected.current) update(detected.current);
          }
        }
      } catch { /* Missing native detection keeps the saved choice/browser fallback. */ }
      finally { clearTimeout(timeout); activeRequests.delete(controller); if (!stopped) timer = setTimeout(poll, 60000); }
    };
    void poll();
    const onStorage = (event: StorageEvent) => {
      if (!window.__VECTOR__ && event.key === storageKey) {
        revision.current++;
        const preference = validPreference(event.newValue) ? event.newValue : 'auto';
        update(preference === 'auto' && detected.current ? detected.current : browserLanguage(preference, navigator.languages));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); for (const controller of activeRequests) controller.abort(); window.removeEventListener('storage', onStorage); };
  }, [update]);
  useEffect(() => {
    document.documentElement.lang = state.language;
    document.title = translate(state.language, 'Vector | War Thunder companion');
  }, [state.language]);
  const setPreference = useCallback(async (preference: LanguagePreference) => {
    if (!validPreference(preference) || savePending.current) return;
    const atRevision = ++revision.current;
    setError(false);
    const endpoint = window.__VECTOR__ ? vectorEndpoint('language') : null;
    if (!endpoint) {
      update(preference === 'auto' && detected.current ? detected.current : browserLanguage(preference, navigator.languages));
      try { localStorage.setItem(storageKey, preference); } catch { setError(true); }
      return;
    }
    savePending.current = true; setSaving(true);
    const controller = new AbortController(); requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint.url, { method: 'PUT', headers: { ...endpoint.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference }), credentials: 'omit', signal: controller.signal });
      const payload = response.ok ? await response.json() : null;
      const next = parseLanguageState(payload), automatic = parseAutomaticLanguage(payload);
      if (!next || next.preference !== preference) throw new Error('Language not saved');
      if (mounted.current && revision.current === atRevision) { update(next); if (automatic?.preference === 'auto') detected.current = automatic; }
    } catch { if (mounted.current && revision.current === atRevision) setError(true); }
    finally { clearTimeout(timeout); requests.current.delete(controller); savePending.current = false; if (mounted.current) setSaving(false); }
  }, [update]);
  const value = useMemo(() => ({ ...state, saving, error, setPreference }), [state, saving, error, setPreference]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const state = useContext(LanguageContext);
  const t = useCallback((message: string, values?: Record<string, string | number>) => translate(state.language, message, values), [state.language]);
  return { ...state, t, locale: locales[state.language], notAvailable: t('N/A'),
    number: (value: number | null, digits = 0) => localizedNumber(state.language, value, digits),
    countLabel: (value: number | null, singular: string, plural?: string) => localizedCount(state.language, value, singular, plural) };
}

export function LanguageSelector() {
  const { preference, language, source, saving, error, setPreference, t } = useTranslation();
  const sources = { manual: 'Language', game: 'War Thunder', steam: 'Steam', system: 'Windows', browser: 'Browser', fallback: 'English fallback' };
  return <div className="language-control">
    <select aria-label={t('Language')} title={preference === 'auto' ? t('Automatic language: {source}', { source: t(sources[source]) }) : t('Language')}
      value={preference} disabled={saving} onChange={event => setPreference(event.target.value as LanguagePreference)}>
      <option value="auto">{t('Auto')} · {language.toUpperCase()}</option><option value="en">English</option><option value="ru">Русский</option>
    </select>
    {error && <span role="status" className="language-error">{t('Could not save language')}</span>}
  </div>;
}
