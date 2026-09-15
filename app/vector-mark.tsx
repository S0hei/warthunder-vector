import brand from './lib/vector-brand.json';

// The favicon is also the sidebar emblem, embedded for the single-file build.
export default function VectorMark() {
  return <span className="vector-mark" aria-hidden="true" style={{ backgroundImage: `url("${brand.src}")` }} />;
}
