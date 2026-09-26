import { MOVE, PLAYER } from '../config';
import { forwardFlat, rightFlat, v3, type Vec3 } from '../math';
import { type AABB, type CollisionWorld, rampHeightAt } from './world';

export const Keys = {
  FWD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  JUMP: 16,
  SPRINT: 32,
  CROUCH: 64,
  FIRE: 128,
  ADS: 256,
  RELOAD: 512,
  SLOT1: 1024,
  SLOT2: 2048,
  SWAP: 4096,
} as const;

export interface MoveState {
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  crouch: boolean;
  sprint: boolean;
  jumpHeld: boolean;
  /** Set for one step when a jump was initiated. */
  jumped: boolean;
  /** Set for one step when the player landed. Carries the impact speed. */
  landedSpeed: number;
}

export function newMoveState(x = 0, y = 0, z = 0): MoveState {
  return {
    pos: v3(x, y, z),
    vel: v3(),
    onGround: false,
    crouch: false,
    sprint: false,
    jumpHeld: false,
    jumped: false,
    landedSpeed: 0,
  };
}

export function copyMoveState(dst: MoveState, src: MoveState): void {
  dst.pos.x = src.pos.x;
  dst.pos.y = src.pos.y;
  dst.pos.z = src.pos.z;
  dst.vel.x = src.vel.x;
  dst.vel.y = src.vel.y;
  dst.vel.z = src.vel.z;
  dst.onGround = src.onGround;
  dst.crouch = src.crouch;
  dst.sprint = src.sprint;
  dst.jumpHeld = src.jumpHeld;
  dst.jumped = src.jumped;
  dst.landedSpeed = src.landedSpeed;
}

export function playerHeight(crouch: boolean): number {
  return crouch ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
}

export function eyeHeight(crouch: boolean): number {
  return crouch ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT;
}

const EPS = 0.001;
const fwd = v3();
const rgt = v3();
const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

function fillBox(s: MoveState, b: AABB): AABB {
  const hw = PLAYER.HALF_WIDTH;
  b.minX = s.pos.x - hw;
  b.maxX = s.pos.x + hw;
  b.minZ = s.pos.z - hw;
  b.maxZ = s.pos.z + hw;
  b.minY = s.pos.y;
  b.maxY = s.pos.y + playerHeight(s.crouch);
  return b;
}

/**
 * Move along one axis and resolve penetration against the world. Returns true
 * if the move was blocked. For the Y axis, sets `onGround` when landing.
 */
function collideAxis(s: MoveState, world: CollisionWorld, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  const hw = PLAYER.HALF_WIDTH;
  const h = playerHeight(s.crouch);
  if (axis === 0) s.pos.x += delta;
  else if (axis === 1) s.pos.y += delta;
  else s.pos.z += delta;
  let blocked = false;
  fillBox(s, box);
  for (const b of world.boxes) {
    if (!(box.minX < b.maxX && box.maxX > b.minX && box.minY < b.maxY && box.maxY > b.minY && box.minZ < b.maxZ && box.maxZ > b.minZ)) continue;
    blocked = true;
    if (axis === 0) {
      s.pos.x = delta > 0 ? b.minX - hw - EPS : b.maxX + hw + EPS;
    } else if (axis === 1) {
      if (delta > 0) s.pos.y = b.minY - h - EPS;
      else {
        s.pos.y = b.maxY + EPS;
        s.onGround = true;
      }
    } else {
      s.pos.z = delta > 0 ? b.minZ - hw - EPS : b.maxZ + hw + EPS;
    }
    fillBox(s, box);
  }
  // Ramps: treated as a height field within their footprint; sides act as walls.
  for (const r of world.ramps) {
    if (!(box.minX < r.maxX && box.maxX > r.minX && box.minZ < r.maxZ && box.maxZ > r.minZ)) continue;
    if (box.maxY <= r.minY) continue;
    const surf = rampHeightAt(r, s.pos.x, s.pos.z);
    if (axis === 1) {
      if (delta <= 0 && s.pos.y <= surf + EPS && s.pos.y > surf - h) {
        s.pos.y = surf + EPS;
        s.onGround = true;
        blocked = true;
      } else if (delta > 0 && s.pos.y < surf - EPS && s.pos.y + h > r.minY && s.pos.y > surf - h) {
        // Jumping into a ramp from below its surface is treated as a ceiling hit.
        s.pos.y = surf + EPS;
        blocked = true;
      }
    } else {
      if (s.pos.y >= surf - EPS) continue; // on top of or above the surface
      if (s.pos.y + h <= r.minY) continue; // fully below (never happens for grounded ramps)
      if (surf - s.pos.y <= MOVE.STEP_HEIGHT + 0.05) {
        s.pos.y = surf + EPS; // walk up the slope
        s.onGround = true;
      } else {
        blocked = true;
        if (axis === 0) s.pos.x = delta > 0 ? r.minX - hw - EPS : r.maxX + hw + EPS;
        else s.pos.z = delta > 0 ? r.minZ - hw - EPS : r.maxZ + hw + EPS;
      }
    }
    fillBox(s, box);
  }
  return blocked;
}

/** Horizontal move with automatic step-up over small ledges. */
function moveHorizontal(s: MoveState, world: CollisionWorld, axis: 0 | 2, delta: number, wasOnGround: boolean): void {
  if (delta === 0) return;
  const ox = s.pos.x;
  const oy = s.pos.y;
  const oz = s.pos.z;
  const blocked = collideAxis(s, world, axis, delta);
  if (!blocked || !wasOnGround) return;
  // Save the blocked result, then try again from a stepped-up position.
  const bx = s.pos.x;
  const by = s.pos.y;
  const bz = s.pos.z;
  s.pos.x = ox;
  s.pos.y = oy + MOVE.STEP_HEIGHT;
  s.pos.z = oz;
  fillBox(s, box);
  if (world.overlapsAny(box)) {
    s.pos.x = bx;
    s.pos.y = by;
    s.pos.z = bz;
    return;
  }
  const blocked2 = collideAxis(s, world, axis, delta);
  // Settle back down onto whatever is below.
  const preY = s.pos.y;
  const ground = collideAxis(s, world, 1, -MOVE.STEP_HEIGHT - EPS);
  const progressed = axis === 0 ? Math.abs(s.pos.x - ox) : Math.abs(s.pos.z - oz);
  const progressedBlocked = axis === 0 ? Math.abs(bx - ox) : Math.abs(bz - oz);
  if (blocked2 && progressed <= progressedBlocked + EPS) {
    s.pos.x = bx;
    s.pos.y = by;
    s.pos.z = bz;
    return;
  }
  if (!ground || s.pos.y < oy - EPS) {
    // Nothing to stand on at the stepped position; keep the ground-level result.
    s.pos.x = bx;
    s.pos.y = by;
    s.pos.z = bz;
    return;
  }
  if (s.pos.y > preY) s.pos.y = preY;
}

/**
 * Advance a player by one input. Deterministic given the same inputs, so the
 * client can predict and the server can replay.
 */
export function stepPlayer(s: MoveState, keys: number, yaw: number, dt: number, world: CollisionWorld, speedMult = 1): void {
  s.jumped = false;
  s.landedSpeed = 0;
  const wasOnGround = s.onGround;

  // Crouch / uncrouch (only stand up when there is headroom).
  const wantCrouch = (keys & Keys.CROUCH) !== 0;
  if (wantCrouch !== s.crouch) {
    if (wantCrouch) s.crouch = true;
    else {
      s.crouch = false;
      fillBox(s, box);
      if (world.overlapsAny(box)) s.crouch = true;
    }
  }

  const ads = (keys & Keys.ADS) !== 0;
  const fwdIn = (keys & Keys.FWD ? 1 : 0) - (keys & Keys.BACK ? 1 : 0);
  const rightIn = (keys & Keys.RIGHT ? 1 : 0) - (keys & Keys.LEFT ? 1 : 0);
  s.sprint = (keys & Keys.SPRINT) !== 0 && fwdIn > 0 && !s.crouch && !ads;

  forwardFlat(yaw, fwd);
  rightFlat(yaw, rgt);
  let wx = fwd.x * fwdIn + rgt.x * rightIn;
  let wz = fwd.z * fwdIn + rgt.z * rightIn;
  const wl = Math.hypot(wx, wz);
  let wishSpeed = 0;
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
    wishSpeed = s.crouch ? MOVE.CROUCH_SPEED : s.sprint ? MOVE.SPRINT_SPEED : MOVE.WALK_SPEED;
    if (ads) wishSpeed *= MOVE.ADS_SPEED_MULT;
    wishSpeed *= speedMult;
  }

  if (s.onGround) {
    // Friction
    const speed = Math.hypot(s.vel.x, s.vel.z);
    if (speed > 0) {
      const drop = speed * MOVE.GROUND_FRICTION * dt;
      const ns = Math.max(0, speed - drop) / speed;
      s.vel.x *= ns;
      s.vel.z *= ns;
    }
    // Accelerate toward the wish direction
    if (wishSpeed > 0) {
      const cur = s.vel.x * wx + s.vel.z * wz;
      const add = Math.min(wishSpeed - cur, MOVE.GROUND_ACCEL * wishSpeed * dt);
      if (add > 0) {
        s.vel.x += wx * add;
        s.vel.z += wz * add;
      }
    }
  } else if (wishSpeed > 0) {
    // Air control: accelerate but never above the wish speed in that direction.
    const cur = s.vel.x * wx + s.vel.z * wz;
    const cap = wishSpeed * MOVE.AIR_SPEED_CAP;
    const add = Math.min(cap - cur, MOVE.AIR_ACCEL * dt);
    if (add > 0) {
      s.vel.x += wx * add;
      s.vel.z += wz * add;
    }
  }

  // Hard cap on horizontal speed: no input pattern (strafe-jumping, high-rate inputs) may exceed sprint.
  {
    const maxSpeed = MOVE.SPRINT_SPEED * Math.max(speedMult, 1) * 1.02;
    const hs = Math.hypot(s.vel.x, s.vel.z);
    if (hs > maxSpeed) {
      const k = maxSpeed / hs;
      s.vel.x *= k;
      s.vel.z *= k;
    }
  }

  // Jump
  const jumpKey = (keys & Keys.JUMP) !== 0;
  if (jumpKey && !s.jumpHeld && s.onGround) {
    s.vel.y = MOVE.JUMP_VELOCITY;
    s.onGround = false;
    s.jumped = true;
  }
  s.jumpHeld = jumpKey;

  // Gravity
  s.vel.y -= MOVE.GRAVITY * dt;
  if (s.vel.y < -MOVE.MAX_FALL_SPEED) s.vel.y = -MOVE.MAX_FALL_SPEED;

  // Horizontal movement with step-up
  const groundedBefore = s.onGround;
  moveHorizontal(s, world, 0, s.vel.x * dt, groundedBefore);
  moveHorizontal(s, world, 2, s.vel.z * dt, groundedBefore);

  // Vertical movement
  const fallSpeed = -s.vel.y;
  s.onGround = false;
  if (groundedBefore && !s.jumped && s.vel.y <= 0) {
    // Stick to the ground when walking down stairs and slopes.
    const y0 = s.pos.y;
    const hit = collideAxis(s, world, 1, -MOVE.STEP_HEIGHT);
    if (!hit) s.pos.y = y0;
  }
  if (!s.onGround) {
    const dy = s.vel.y * dt;
    const hit = collideAxis(s, world, 1, dy);
    if (hit) {
      if (s.vel.y > 0 && !s.onGround) s.vel.y = 0; // ceiling
    }
  }
  if (s.onGround) {
    if (!wasOnGround && fallSpeed > 0) s.landedSpeed = fallSpeed;
    if (s.vel.y < 0) s.vel.y = 0;
  }

  // Keep inside the arena bounds (soft walls in case a map has gaps).
  const b = world.bounds;
  const hw = PLAYER.HALF_WIDTH;
  if (s.pos.x < b.minX + hw) s.pos.x = b.minX + hw;
  if (s.pos.x > b.maxX - hw) s.pos.x = b.maxX - hw;
  if (s.pos.z < b.minZ + hw) s.pos.z = b.minZ + hw;
  if (s.pos.z > b.maxZ - hw) s.pos.z = b.maxZ - hw;
}

export function horizontalSpeed(s: MoveState): number {
  return Math.hypot(s.vel.x, s.vel.z);
}
