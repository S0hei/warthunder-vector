'use client';

import { useId, useState } from 'react';
import { useTranslation } from './language-provider';
import type { useAppUpdates } from './use-app-updates';
import ControlIcon from './control-icon';

export default function AppUpdateNotice({ update, requesting, requestError, reconnectFailed, restart }: ReturnType<typeof useAppUpdates>) {
  const { t } = useTranslation();
  const titleId = useId(), descriptionId = useId();
  const [dismissed, setDismissed] = useState('');
  if (!update || update.state === 'idle') return null;
  const key = `${update.version}:${update.state}:${update.error}:${requestError}:${reconnectFailed}`;
  const failed = update.state === 'failed' || reconnectFailed;
  const restarting = (requesting || update.state === 'restarting') && !reconnectFailed;
  if (dismissed === key && !restarting) return (
    <button type="button" className="app-update-chip" onClick={() => setDismissed('')} aria-label={t('Show app update')}>
      <ControlIcon name="restart" />{t(failed ? 'App update failed' : 'Update ready')}
    </button>
  );
  const description = reconnectFailed ? 'Vector did not reconnect. Open Vector again.'
    : update.error === 'battle-active' ? 'Return to the hangar or close War Thunder, then try again.'
    : update.state === 'failed' ? (update.error === 'rolled-back' ? 'The new version could not start. Your current version was kept.' : 'The update could not be installed. Check for updates from the tray to retry.')
    : requestError ? 'Could not confirm the restart. If Vector is still running, try again.'
    : restarting ? 'This page will reconnect automatically.' : 'Restart to install the update.';
  return (
    <section className="app-update-notice" role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="app-update-heading"><ControlIcon name="restart" /><h2 id={titleId}>
        {t(restarting ? 'Restarting Vector' : failed ? 'App update failed' : 'Vector {version} is ready', { version: update.version ?? '' })}
      </h2></div>
      <p id={descriptionId} role="status">{t(description)}</p>
      <div className="app-update-actions">
        {!restarting && <button type="button" onClick={() => setDismissed(key)}>{t(failed ? 'Close' : 'Later')}</button>}
        {!failed && <button type="button" className="app-update-restart" disabled={restarting} onClick={() => void restart()}>
          {t(restarting ? 'Restarting Vector' : 'Restart Vector')}
        </button>}
      </div>
    </section>
  );
}
