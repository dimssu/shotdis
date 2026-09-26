import { useStore } from '@client/app/store';
import { Button } from '../common/Controls';

export function PauseMenu({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <div className="overlay">
      <div className="modal narrow pause-menu">
        <div className="modal-head">
          <h2>Paused</h2>
          <span className="hint">The match keeps running</span>
        </div>
        <Button className="primary" onClick={onResume} autoFocus>
          Resume
        </Button>
        <Button onClick={() => setOverlay('settings')}>Settings</Button>
        <Button onClick={() => setOverlay('controls')}>Controls</Button>
        <Button className="danger" onClick={onLeave}>
          Leave match
        </Button>
      </div>
    </div>
  );
}
