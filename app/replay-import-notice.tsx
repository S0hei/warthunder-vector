import { useTranslation } from './language-provider';

export default function ReplayImportNotice({ count = 0 }: { count?: number }) {
  const { t, number } = useTranslation();
  return count > 0 ? <p className="results-message" role="status">{t('Replay results unavailable: {count}. Unsupported or incomplete files were skipped.', { count: number(count) })}</p> : null;
}
