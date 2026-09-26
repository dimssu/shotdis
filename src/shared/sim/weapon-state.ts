import { Keys } from '../physics/movement';
import { defaultAmmo, fireInterval, reloadAmounts, WEAPONS, type AmmoState, type WeaponId } from '../weapons';

/**
 * Weapon state machine shared by client prediction and the authoritative
 * server. All timing is expressed in the player's own simulation clock
 * (`simTime`, seconds), which advances by the dt of each processed input. Both
 * sides therefore reach identical results for identical input streams.
 */
export interface WeaponState {
  slot: number;
  ids: [WeaponId, WeaponId];
  ammo: [AmmoState, AmmoState];
  reloadEndsAt: number;
  equipEndsAt: number;
  nextFireAt: number;
  bloom: number;
  prevKeys: number;
  simTime: number;
}

export interface WeaponStepResult {
  fired: boolean;
  dryFire: boolean;
  reloadStarted: boolean;
  reloadDone: boolean;
  switched: boolean;
}

export function newWeaponState(primary: WeaponId): WeaponState {
  return {
    slot: 0,
    ids: [primary, 'pistol'],
    ammo: [defaultAmmo(WEAPONS[primary]), defaultAmmo(WEAPONS.pistol)],
    reloadEndsAt: 0,
    equipEndsAt: 0,
    nextFireAt: 0,
    bloom: 0,
    prevKeys: 0,
    simTime: 0,
  };
}

export function resetWeaponState(w: WeaponState, primary: WeaponId): void {
  w.slot = 0;
  w.ids = [primary, 'pistol'];
  w.ammo = [defaultAmmo(WEAPONS[primary]), defaultAmmo(WEAPONS.pistol)];
  w.reloadEndsAt = 0;
  w.equipEndsAt = w.simTime + 0.35;
  w.nextFireAt = 0;
  w.bloom = 0;
}

export function copyWeaponState(dst: WeaponState, src: WeaponState): void {
  dst.slot = src.slot;
  dst.ids[0] = src.ids[0];
  dst.ids[1] = src.ids[1];
  dst.ammo[0].mag = src.ammo[0].mag;
  dst.ammo[0].reserve = src.ammo[0].reserve;
  dst.ammo[1].mag = src.ammo[1].mag;
  dst.ammo[1].reserve = src.ammo[1].reserve;
  dst.reloadEndsAt = src.reloadEndsAt;
  dst.equipEndsAt = src.equipEndsAt;
  dst.nextFireAt = src.nextFireAt;
  dst.bloom = src.bloom;
  dst.prevKeys = src.prevKeys;
  dst.simTime = src.simTime;
}

export function currentWeapon(w: WeaponState): WeaponId {
  return w.ids[w.slot];
}

export function isReloading(w: WeaponState): boolean {
  return w.reloadEndsAt > 0;
}

export function isReady(w: WeaponState): boolean {
  return w.simTime >= w.equipEndsAt && w.reloadEndsAt === 0;
}

function startReload(w: WeaponState, out: WeaponStepResult): void {
  const def = WEAPONS[w.ids[w.slot]];
  w.reloadEndsAt = w.simTime + def.reloadTime;
  out.reloadStarted = true;
}

/**
 * Advance the weapon state by one input frame. `canFire` is false while the
 * player is dead or the match is not live.
 */
export function stepWeapon(w: WeaponState, keys: number, dt: number, canFire: boolean, out: WeaponStepResult): void {
  out.fired = false;
  out.dryFire = false;
  out.reloadStarted = false;
  out.reloadDone = false;
  out.switched = false;
  w.simTime += dt;
  const t = w.simTime;
  const edge = keys & ~w.prevKeys;
  w.prevKeys = keys;

  let target = -1;
  if (edge & Keys.SLOT1) target = 0;
  else if (edge & Keys.SLOT2) target = 1;
  else if (edge & Keys.SWAP) target = 1 - w.slot;
  if (canFire && target >= 0 && target !== w.slot) {
    w.slot = target;
    w.equipEndsAt = t + WEAPONS[w.ids[w.slot]].equipTime;
    w.reloadEndsAt = 0;
    w.bloom = 0;
    out.switched = true;
  }

  const def = WEAPONS[w.ids[w.slot]];
  const ammo = w.ammo[w.slot];

  if (w.reloadEndsAt > 0 && t >= w.reloadEndsAt) {
    const r = reloadAmounts(def, ammo);
    ammo.mag = r.mag;
    ammo.reserve = r.reserve;
    w.reloadEndsAt = 0;
    out.reloadDone = true;
  }

  w.bloom = Math.max(0, w.bloom - def.bloom.decay * dt);
  if (!canFire) return;

  const ready = t >= w.equipEndsAt && w.reloadEndsAt === 0;
  if (ready && edge & Keys.RELOAD && ammo.mag < def.magSize && ammo.reserve > 0) {
    startReload(w, out);
    return;
  }

  const wantFire = def.auto ? (keys & Keys.FIRE) !== 0 : (edge & Keys.FIRE) !== 0;
  if (wantFire && ready && t >= w.nextFireAt) {
    if (ammo.mag > 0) {
      ammo.mag -= 1;
      w.nextFireAt = t + fireInterval(def);
      w.bloom = Math.min(def.bloom.max, w.bloom + def.bloom.perShot);
      out.fired = true;
    } else {
      out.dryFire = true;
      w.nextFireAt = t + 0.25;
      if (ammo.reserve > 0) startReload(w, out);
    }
  }
}
