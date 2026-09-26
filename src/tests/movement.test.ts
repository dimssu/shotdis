import { describe, expect, it } from 'vitest';
import { MOVE, PLAYER } from '@shared/config';
import { box, ramp } from '@shared/maps/builders';
import type { MapDef } from '@shared/maps/types';
import { CollisionWorld } from '@shared/physics/world';
import { Keys, newMoveState, stepPlayer } from '@shared/physics/movement';

const DT = 1 / 60;

function world(...extra: MapDef['solids']): CollisionWorld {
  const map: MapDef = {
    id: 't',
    name: 't',
    tagline: '',
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    sky: { top: 0, bottom: 0, fog: 0, fogNear: 1, fogFar: 2 },
    ambient: { sky: 0, ground: 0, intensity: 1 },
    sun: { dir: [0, 1, 0], color: 0, intensity: 1 },
    solids: [box('floor', -50, -1, -50, 100, 1, 100), ...extra],
    spawns: [],
    nav: [],
    navLinks: [],
    lights: [],
    particles: 'none',
  };
  return CollisionWorld.fromMap(map);
}

function run(w: CollisionWorld, keys: number, steps: number, s = newMoveState(0, 0.5, 0), yaw = 0) {
  for (let i = 0; i < steps; i++) stepPlayer(s, keys, yaw, DT, w);
  return s;
}

describe('player movement', () => {
  it('falls under gravity and lands on the floor', () => {
    const s = run(world(), 0, 120, newMoveState(0, 3, 0));
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeCloseTo(0, 2);
    expect(s.vel.y).toBe(0);
  });

  it('accelerates to walk speed and sprints faster', () => {
    const w = world();
    const walk = run(w, Keys.FWD, 90);
    expect(Math.hypot(walk.vel.x, walk.vel.z)).toBeCloseTo(MOVE.WALK_SPEED, 1);
    expect(walk.pos.z).toBeLessThan(-3); // yaw 0 faces -Z
    const sprint = run(w, Keys.FWD | Keys.SPRINT, 90);
    expect(Math.hypot(sprint.vel.x, sprint.vel.z)).toBeCloseTo(MOVE.SPRINT_SPEED, 1);
    const crouch = run(w, Keys.FWD | Keys.CROUCH, 90);
    expect(Math.hypot(crouch.vel.x, crouch.vel.z)).toBeCloseTo(MOVE.CROUCH_SPEED, 1);
  });

  it('stops quickly when input is released', () => {
    const w = world();
    const s = run(w, Keys.FWD, 60);
    run(w, 0, 30, s);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThan(0.3);
  });

  it('jumps about 1.2 m and requires releasing the key between jumps', () => {
    const w = world();
    const s = run(w, 0, 30);
    let maxY = 0;
    let jumps = 0;
    for (let i = 0; i < 240; i++) {
      const before = s.onGround;
      stepPlayer(s, Keys.JUMP, 0, DT, w);
      if (before && s.jumped) jumps++;
      maxY = Math.max(maxY, s.pos.y);
    }
    expect(maxY).toBeGreaterThan(1.1);
    expect(maxY).toBeLessThan(1.4);
    expect(jumps).toBe(1);
  });

  it('is blocked by walls', () => {
    const w = world(box('concrete', -5, 0, -3, 10, 3, 1));
    const s = run(w, Keys.FWD | Keys.SPRINT, 120);
    // Wall spans z -3..-2; the player stops at its +Z face.
    expect(s.pos.z).toBeCloseTo(-2 + PLAYER.HALF_WIDTH, 2);
  });

  it('steps up small ledges but not tall crates', () => {
    const low = world(box('concrete', -5, 0, -8, 10, 0.5, 5));
    const s1 = run(low, Keys.FWD, 70);
    expect(s1.pos.y).toBeCloseTo(0.5, 2);
    expect(s1.pos.z).toBeLessThan(-3);
    const tall = world(box('crate', -5, 0, -8, 10, 1.1, 5));
    const s2 = run(tall, Keys.FWD, 70);
    expect(s2.pos.y).toBeCloseTo(0, 2);
    expect(s2.pos.z).toBeGreaterThan(-3);
  });

  it('walks up and down a ramp', () => {
    // Ramp occupies z -10..-4 and rises toward -Z from 0 to 2 m; a wall stops the player at the top.
    const w = world(ramp('concrete', -2, 0, -10, 4, 2, 6, 'z', -1), box('concrete', -2, 0, -12, 4, 5, 2));
    const s = run(w, Keys.FWD, 150);
    expect(s.pos.z).toBeLessThan(-9.5);
    expect(s.pos.y).toBeGreaterThan(1.8);
    expect(s.onGround).toBe(true);
    // Turn around and walk back down.
    run(w, Keys.FWD, 200, s, Math.PI);
    expect(s.pos.y).toBeCloseTo(0, 1);
    expect(s.onGround).toBe(true);
  });

  it('cannot stand up under a low ceiling', () => {
    const w = world(box('concrete', -5, 1.5, -5, 10, 1, 10));
    const s = run(w, Keys.CROUCH, 30, newMoveState(0, 0, 0));
    expect(s.crouch).toBe(true);
    run(w, 0, 10, s);
    expect(s.crouch).toBe(true);
    // Move out from under it and stand.
    run(w, Keys.FWD, 200, s);
    expect(s.crouch).toBe(false);
  });

  it('is deterministic for identical inputs', () => {
    const w = world(box('crate', 1, 0, -4, 1.1, 1.1, 1.1));
    const a = run(w, Keys.FWD | Keys.RIGHT | Keys.JUMP, 200);
    const b = run(w, Keys.FWD | Keys.RIGHT | Keys.JUMP, 200);
    expect(a.pos).toEqual(b.pos);
    expect(a.vel).toEqual(b.vel);
  });
});
