'use client';
import { useEffect, useState } from 'react';

export default function MapImage({ source, alt }: { source: string; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => { setAttempt(value => value + 1); setFailed(false); }, Math.min(30000, 1500 * 2 ** Math.min(attempt, 5)));
    return () => clearTimeout(timer);
  }, [attempt, failed]);
  const src = attempt ? `${source}${source.includes('?') ? '&' : '?'}retry=${attempt}` : source;
  // The image comes directly from the local game, including in the single-file app.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="map-image" src={src} alt={alt} draggable="false" onError={() => setFailed(true)} onLoad={() => setFailed(false)} />;
}
