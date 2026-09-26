import { Button } from '../common/Controls';

export function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal narrow credits" role="dialog" aria-label="Credits">
        <div className="modal-head">
          <h2>Credits</h2>
          <Button className="ghost small" onClick={onClose} autoFocus>
            Close ✕
          </Button>
        </div>
        <p>
          <strong>SHOTDIS</strong> is an original browser arena shooter. Every arena, weapon, model, sound and piece of music is generated procedurally in code, so nothing is downloaded and nothing is borrowed.
        </p>
        <p>Rendering by three.js. Interface by React. Multiplayer over WebSockets with an authoritative server that runs the very same simulation code used for offline practice.</p>
        <p>Inspired by the pace of classic browser arena shooters. Built to load in seconds and play at 60 FPS on ordinary laptops.</p>
      </div>
    </div>
  );
}
