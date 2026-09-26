import { describe, expect, it } from 'vitest';
import { applyDamage } from '@shared/config';
import { Keys } from '@shared/physics/movement';
import { newWeaponState, stepWeapon, type WeaponStepResult } from '@shared/sim/weapon-state';
import { damageAt, falloffMultiplier, fireInterval, reloadAmounts, spreadDegrees, WEAPONS } from '@shared/weapons';

const out: WeaponStepResult = { fired: false, dryFire: false, reloadStarted: false, reloadDone: false, switched: false };
const DT = 1 / 60;

describe('weapon math', () => {
  it('fire interval derives from rpm', () => {
    expect(fireInterval(WEAPONS.rifle)).toBeCloseTo(60 / 640, 6);
  });

  it('damage falls off with distance and never below the minimum', () => {
    const r = WEAPONS.rifle;
    expect(falloffMultiplier(r, 0)).toBe(1);
    expect(falloffMultiplier(r, r.falloff.start)).toBe(1);
    expect(falloffMultiplier(r, (r.falloff.start + r.falloff.end) / 2)).toBeCloseTo((1 + r.falloff.min) / 2, 6);
    expect(falloffMultiplier(r, 1000)).toBe(r.falloff.min);
  });

  it('headshots multiply damage', () => {
    expect(damageAt(WEAPONS.pistol, 5, true)).toBeCloseTo(WEAPONS.pistol.damage * WEAPONS.pistol.headshotMult);
    expect(damageAt(WEAPONS.sniper, 100, true)).toBeGreaterThanOrEqual(150);
  });

  it('spread grows when moving and airborne, shrinks when crouched or aiming', () => {
    const base = spreadDegrees(WEAPONS.rifle, { ads: false, moveFrac: 0, airborne: false, crouch: false, bloom: 0 });
    const moving = spreadDegrees(WEAPONS.rifle, { ads: false, moveFrac: 1, airborne: false, crouch: false, bloom: 0 });
    const air = spreadDegrees(WEAPONS.rifle, { ads: false, moveFrac: 1, airborne: true, crouch: false, bloom: 0 });
    const ads = spreadDegrees(WEAPONS.rifle, { ads: true, moveFrac: 0, airborne: false, crouch: false, bloom: 0 });
    const crouch = spreadDegrees(WEAPONS.rifle, { ads: false, moveFrac: 0, airborne: false, crouch: true, bloom: 0 });
    expect(moving).toBeGreaterThan(base);
    expect(air).toBeGreaterThan(moving);
    expect(ads).toBeLessThan(base);
    expect(crouch).toBeLessThan(base);
  });

  it('reload moves ammo from reserve, capped by reserve', () => {
    expect(reloadAmounts(WEAPONS.pistol, { mag: 2, reserve: 60 })).toEqual({ mag: 12, reserve: 50 });
    expect(reloadAmounts(WEAPONS.pistol, { mag: 2, reserve: 4 })).toEqual({ mag: 6, reserve: 0 });
  });

  it('armor absorbs part of the damage first', () => {
    const r = applyDamage(100, 50, 22);
    expect(r.absorbed).toBeCloseTo(13.2);
    expect(r.armor).toBeCloseTo(36.8);
    expect(r.hp).toBeCloseTo(91.2);
    const r2 = applyDamage(100, 0, 22);
    expect(r2.hp).toBe(78);
    const r3 = applyDamage(10, 100, 90);
    expect(r3.hp).toBe(0);
  });
});

describe('weapon state machine', () => {
  it('respects fire rate and consumes ammo', () => {
    const w = newWeaponState('rifle');
    w.equipEndsAt = 0;
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      stepWeapon(w, Keys.FIRE, DT, true, out);
      if (out.fired) fired++;
    }
    // 1 second at 640 rpm ≈ 10.7 shots (first shot immediate)
    expect(fired).toBeGreaterThanOrEqual(10);
    expect(fired).toBeLessThanOrEqual(11);
    expect(w.ammo[0].mag).toBe(WEAPONS.rifle.magSize - fired);
  });

  it('semi-automatic weapons fire once per click', () => {
    const w = newWeaponState('shotgun');
    w.slot = 1; // pistol
    let fired = 0;
    for (let i = 0; i < 30; i++) {
      stepWeapon(w, Keys.FIRE, DT, true, out);
      if (out.fired) fired++;
    }
    expect(fired).toBe(1);
    stepWeapon(w, 0, DT, true, out);
    for (let i = 0; i < 30; i++) {
      stepWeapon(w, Keys.FIRE, DT, true, out);
      if (out.fired) fired++;
    }
    expect(fired).toBe(2);
  });

  it('reloads after the reload time and refuses to fire meanwhile', () => {
    const w = newWeaponState('pistol');
    w.slot = 1;
    w.ammo[1].mag = 3;
    stepWeapon(w, Keys.RELOAD, DT, true, out);
    expect(out.reloadStarted).toBe(true);
    let steps = 1;
    let doneAt = -1;
    while (steps < 400) {
      stepWeapon(w, Keys.FIRE, DT, true, out);
      steps++;
      expect(out.fired).toBe(false);
      if (out.reloadDone) {
        doneAt = steps;
        break;
      }
    }
    expect(doneAt).toBeGreaterThan(0);
    expect(doneAt * DT).toBeCloseTo(WEAPONS.pistol.reloadTime, 1);
    expect(w.ammo[1].mag).toBe(WEAPONS.pistol.magSize);
    expect(w.ammo[1].reserve).toBe(WEAPONS.pistol.reserve - 9);
  });

  it('auto-reloads on an empty magazine and switches weapons with an equip delay', () => {
    const w = newWeaponState('smg');
    w.ammo[0].mag = 0;
    stepWeapon(w, Keys.FIRE, DT, true, out);
    expect(out.dryFire).toBe(true);
    expect(out.reloadStarted).toBe(true);
    stepWeapon(w, Keys.SLOT2, DT, true, out);
    expect(out.switched).toBe(true);
    expect(w.slot).toBe(1);
    expect(w.reloadEndsAt).toBe(0);
    stepWeapon(w, Keys.FIRE, DT, true, out);
    expect(out.fired).toBe(false); // still equipping
    for (let i = 0; i < 30; i++) stepWeapon(w, 0, DT, true, out);
    stepWeapon(w, Keys.FIRE, DT, true, out);
    expect(out.fired).toBe(true);
  });

  it('does nothing when the player cannot act', () => {
    const w = newWeaponState('rifle');
    stepWeapon(w, Keys.FIRE | Keys.RELOAD | Keys.SLOT2, DT, false, out);
    expect(out.fired).toBe(false);
    expect(out.switched).toBe(false);
    expect(w.ammo[0].mag).toBe(WEAPONS.rifle.magSize);
  });
});
