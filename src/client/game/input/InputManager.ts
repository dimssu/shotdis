import { Keys } from '@shared/physics/movement';

export interface Binding {
  action: string;
  label: string;
  keys: string[];
}

export const BINDINGS: Binding[] = [
  { action: 'forward', label: 'Move forward', keys: ['KeyW', 'ArrowUp'] },
  { action: 'back', label: 'Move back', keys: ['KeyS', 'ArrowDown'] },
  { action: 'left', label: 'Strafe left', keys: ['KeyA', 'ArrowLeft'] },
  { action: 'right', label: 'Strafe right', keys: ['KeyD', 'ArrowRight'] },
  { action: 'jump', label: 'Jump', keys: ['Space'] },
  { action: 'sprint', label: 'Sprint', keys: ['ShiftLeft', 'ShiftRight'] },
  { action: 'crouch', label: 'Crouch', keys: ['ControlLeft', 'ControlRight', 'KeyC'] },
  { action: 'fire', label: 'Fire', keys: ['Mouse0'] },
  { action: 'ads', label: 'Aim down sights', keys: ['Mouse2'] },
  { action: 'reload', label: 'Reload', keys: ['KeyR'] },
  { action: 'slot1', label: 'Primary weapon', keys: ['Digit1'] },
  { action: 'slot2', label: 'Sidearm', keys: ['Digit2'] },
  { action: 'swap', label: 'Swap weapon', keys: ['KeyQ', 'Wheel'] },
  { action: 'scoreboard', label: 'Scoreboard', keys: ['Tab'] },
  { action: 'menu', label: 'Pause menu', keys: ['Escape'] },
];

const KEY_BITS: Record<string, number> = {};
for (const b of BINDINGS) {
  const bit =
    b.action === 'forward' ? Keys.FWD
    : b.action === 'back' ? Keys.BACK
    : b.action === 'left' ? Keys.LEFT
    : b.action === 'right' ? Keys.RIGHT
    : b.action === 'jump' ? Keys.JUMP
    : b.action === 'sprint' ? Keys.SPRINT
    : b.action === 'crouch' ? Keys.CROUCH
    : b.action === 'fire' ? Keys.FIRE
    : b.action === 'ads' ? Keys.ADS
    : b.action === 'reload' ? Keys.RELOAD
    : b.action === 'slot1' ? Keys.SLOT1
    : b.action === 'slot2' ? Keys.SLOT2
    : b.action === 'swap' ? Keys.SWAP
    : 0;
  if (bit) for (const k of b.keys) KEY_BITS[k] = bit;
}

/**
 * Collects keyboard/mouse state and pointer-lock. Mouse deltas accumulate until
 * the game loop consumes them, so nothing is lost between frames.
 */
export class InputManager {
  private held = 0;
  /** Bits that were pressed at least once since the last consume (so a tap shorter than a sim step still fires). */
  private pressedSince = 0;
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  locked = false;
  scoreboardHeld = false;
  onMenu: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onScoreboard: ((open: boolean) => void) | null = null;
  onAnyKey: (() => void) | null = null;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  /** Development aid: behave as if the pointer were locked (used by automated browser tests). */
  forceLock(): void {
    this.forced = true;
    this.locked = true;
    this.onLockChange?.(true);
  }

  private forced = false;

  requestLock(): void {
    if (this.forced) {
      this.locked = true;
      this.onLockChange?.(true);
      return;
    }
    if (document.pointerLockElement === this.el) return;
    try {
      const p = (this.el as HTMLElement & { requestPointerLock(o?: { unadjustedMovement: boolean }): Promise<void> | void }).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          try {
            this.el.requestPointerLock();
          } catch {}
        });
      }
    } catch {
      try {
        this.el.requestPointerLock();
      } catch {}
    }
  }

  releaseLock(): void {
    if (this.forced) {
      this.locked = false;
      this.clear();
      this.onLockChange?.(false);
      return;
    }
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  /** Current key bitmask; includes taps that happened since the last call. */
  consumeKeys(): number {
    const k = this.held | this.pressedSince;
    this.pressedSince = 0;
    return k;
  }

  peekKeys(): number {
    return this.held;
  }

  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  clear(): void {
    this.held = 0;
    this.pressedSince = 0;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.scoreboardHeld = false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      if (!this.locked) return; // menus stay keyboard-navigable
      e.preventDefault();
      if (!this.scoreboardHeld) {
        this.scoreboardHeld = true;
        this.onScoreboard?.(true);
      }
      return;
    }
    if (e.code === 'Escape') {
      // Browsers release pointer lock on Escape themselves; the lock change handler opens the menu.
      return;
    }
    if (!this.locked) return;
    const bit = KEY_BITS[e.code];
    if (bit) {
      e.preventDefault();
      if (!e.repeat) {
        this.held |= bit;
        this.pressedSince |= bit;
      }
    }
    this.onAnyKey?.();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      if (this.scoreboardHeld) {
        e.preventDefault();
        this.scoreboardHeld = false;
        this.onScoreboard?.(false);
      }
      return;
    }
    const bit = KEY_BITS[e.code];
    if (bit) this.held &= ~bit;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    const bit = KEY_BITS[`Mouse${e.button}`];
    if (bit) {
      this.held |= bit;
      this.pressedSince |= bit;
      e.preventDefault();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    const bit = KEY_BITS[`Mouse${e.button}`];
    if (bit) this.held &= ~bit;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) > 2) this.wheel += Math.sign(e.deltaY);
  };

  private onContextMenu = (e: Event): void => {
    if (this.locked) e.preventDefault();
  };

  private onPointerLockChange = (): void => {
    if (this.forced) return;
    const locked = document.pointerLockElement === this.el;
    const was = this.locked;
    this.locked = locked;
    if (!locked) this.clear();
    if (was !== locked) this.onLockChange?.(locked);
  };

  private onBlur = (): void => {
    this.clear();
  };
}
