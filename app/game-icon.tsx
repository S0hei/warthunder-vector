import type { ReactNode } from 'react';
import catalog from './lib/game-icons.json';

export type GameIconName = keyof typeof catalog.icons;

export function GameIcon({ name }: { name: GameIconName }) {
  const asset = catalog.icons[name];
  return <span className={`game-icon game-icon-${asset.mode}`} data-game-icon={name} aria-hidden="true"
    style={asset.mode === 'image' ? { backgroundImage: `url("${asset.src}")` }
      : { maskImage: `url("${asset.src}")`, WebkitMaskImage: `url("${asset.src}")` }} />;
}

export function GameLabel({ icon, children, title }: { icon: GameIconName; children: ReactNode; title?: string }) {
  return <span className="game-label" title={title}><GameIcon name={icon} /><span className="game-label-text">{children}</span></span>;
}
