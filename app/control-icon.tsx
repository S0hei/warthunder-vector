const paths = {
  contrast: 'M7 3H17L21 7V17L17 21H7L3 17V7Z',
  fullscreen: 'M9 3H3V9M15 3H21V9M21 15V21H15M9 21H3V15',
  zoomIn: 'M5 12H19M12 5V19',
  zoomOut: 'M5 12H19',
  fitAircraft: 'M7 3H3V7M17 3H21V7M21 17V21H17M7 21H3V17',
  fitBattle: 'M4 18L8 6M16 18L20 6M2 17L6 19M6 5L10 7M14 17L18 19M18 5L22 7M10 12H14',
  center: 'M9 4H4V9M15 4H20V9M20 15V20H15M9 20H4V15M12 1V6M12 18V23M1 12H6M18 12H23',
  close: 'M6 6L18 18M18 6L6 18',
  external: 'M13 3H21V11M21 3L10 14M8 5H3V21H19V16',
  restart: 'M20 3V9H14M20 9A8 8 0 1 0 20 15',
} as const;

export type ControlIconName = keyof typeof paths;

export default function ControlIcon({ name }: { name: ControlIconName }) {
  return <svg className="control-icon" data-control-icon={name} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
    {name === 'contrast' && <path d="M12 3H7L3 7V17L7 21H12Z" fill="currentColor" stroke="none" />}
    {name === 'fitAircraft' && <path d="M12 6L14 11L18 14V16L13 14V17L15 18V19L12 18L9 19V18L11 17V14L6 16V14L10 11Z" fill="currentColor" stroke="none" />}
    {name === 'center' && <path d="M12 9L15 12L12 15L9 12Z" fill="currentColor" stroke="none" />}
  </svg>;
}
