import { useStore } from '@client/app/store';
import { Button } from '../common/Controls';

export function LoadingScreen() {
  const progress = useStore((s) => s.loadingProgress);
  const label = useStore((s) => s.loadingLabel);
  const map = useStore((s) => s.hud.mapName);
  return (
    <div className="center-screen" role="status" aria-live="polite">
      <h1>Loading arena</h1>
      <div className="sub">{map || label || 'Preparing'}</div>
      <div className="progress">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="sub" style={{ opacity: 0.7 }}>
        {label}
      </div>
    </div>
  );
}

export function ConnectingScreen({ onCancel, onOffline }: { onCancel: () => void; onOffline: () => void }) {
  const status = useStore((s) => s.connectStatus);
  const error = useStore((s) => s.connectError);
  return (
    <div className="center-screen" role="status" aria-live="polite">
      {error ? (
        <>
          <h1>Connection failed</h1>
          <div className="sub" style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button className="primary" onClick={onOffline}>
              Play offline instead
            </Button>
            <Button onClick={onCancel}>Back</Button>
          </div>
        </>
      ) : (
        <>
          <div className="spinner" />
          <h1>Connecting</h1>
          <div className="sub">{status}</div>
          <Button className="ghost small" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
