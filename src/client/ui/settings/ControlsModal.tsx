import { BINDINGS } from '@client/game/input/InputManager';
import { Button } from '../common/Controls';

const KEY_LABEL: Record<string, string> = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyR: 'R', KeyQ: 'Q', KeyC: 'C',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl',
  Mouse0: 'LMB', Mouse2: 'RMB', Wheel: 'Wheel', Digit1: '1', Digit2: '2', Tab: 'Tab', Escape: 'Esc',
};

export function ControlsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal narrow" role="dialog" aria-label="Controls">
        <div className="modal-head">
          <h2>Controls</h2>
          <Button className="ghost small" onClick={onClose} autoFocus>
            Close ✕
          </Button>
        </div>
        <table className="keys-table">
          <tbody>
            {BINDINGS.map((b) => (
              <tr key={b.action}>
                <td>{b.label}</td>
                <td>
                  {b.keys.map((k) => (
                    <kbd key={k}>{KEY_LABEL[k] ?? k}</kbd>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Sprint only works while moving forward. Aiming down sights slows you and tightens spread; the sniper scope only works while aiming.</p>
      </div>
    </div>
  );
}
