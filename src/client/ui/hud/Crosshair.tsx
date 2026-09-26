import { useStore } from '@client/app/store';

/** Customizable crosshair; the gap widens with the predicted spread when "dynamic" is on. */
export function Crosshair({ spread, hit, preview }: { spread: number; hit?: boolean; preview?: boolean }) {
  const ch = useStore((s) => s.settings.crosshair);
  const gap = ch.gap + (ch.dynamic ? spread * 9 : 0);
  const size = ch.size;
  const t = ch.thickness;
  const style = { '--ch-color': ch.color, '--ch-opacity': ch.opacity } as React.CSSProperties;
  return (
    <div className={`crosshair ${hit ? 'hit' : ''}`} style={preview ? { ...style, position: 'relative', left: 0, top: 0 } : style} aria-hidden="true">
      {ch.dot && <i className="dot" style={{ width: t + 1, height: t + 1 }} />}
      <i style={{ left: -t / 2, top: -gap - size, width: t, height: size }} />
      <i style={{ left: -t / 2, top: gap, width: t, height: size }} />
      <i style={{ top: -t / 2, left: -gap - size, width: size, height: t }} />
      <i style={{ top: -t / 2, left: gap, width: size, height: t }} />
    </div>
  );
}
