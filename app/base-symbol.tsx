import type { BaseKind } from './lib/base-markers';

export default function BaseSymbol({ kind }: { kind: BaseKind }) {
  return <svg className="base-symbol" data-base-kind={kind} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    {kind === 'bombing'
      ? <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
      : <rect x="3" y="3" width="14" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1" />}
    <circle cx="10" cy="10" r="1.65" fill="currentColor" />
  </svg>;
}
