/**
 * Central gameplay configuration. Everything that tunes "feel" lives here so it is
 * easy to balance. Both client and server import this file.
 */
export const PROTOCOL_VERSION = 3;

export const SIM = {
  /** Fixed simulation rate (Hz) used by client prediction and server replay. */
  HZ: 60,
  DT: 1 / 60,
  /** Largest per-input timestep the server will accept (seconds). */
  MAX_INPUT_DT: 1 / 30,
  MIN_INPUT_DT: 1 / 250,
  /** Snapshots per second sent by the server. */
  SNAPSHOT_HZ: 20,
  /** How far behind "now" remote players are rendered (ms). */
  INTERP_DELAY_MS: 100,
  /** Maximum extrapolation when snapshots are late (ms). */
  MAX_EXTRAPOLATE_MS: 120,
  /** Inputs per batch message sent from the client. */
  INPUT_BATCH: 3,
  /** Lag compensation window (ms). */
  LAGCOMP_MAX_MS: 250,
  HISTORY_MS: 1000,
  /** Anti-speedhack: a client may not simulate more than this factor of real time. */
  INPUT_TIME_BUDGET_FACTOR: 1.08,
  INPUT_TIME_BUDGET_MAX: 0.25,
} as const;

export const PLAYER = {
  HALF_WIDTH: 0.34,
  HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.25,
  EYE_HEIGHT: 1.62,
  CROUCH_EYE_HEIGHT: 1.06,
  HEAD_RADIUS: 0.2,
} as const;

export const MOVE = {
  WALK_SPEED: 5.4,
  SPRINT_SPEED: 7.4,
  CROUCH_SPEED: 2.8,
  ADS_SPEED_MULT: 0.72,
  /** Ground acceleration as a multiple of the wish speed, per second. */
  GROUND_ACCEL: 12,
  GROUND_FRICTION: 9.5,
  AIR_ACCEL: 16,
  AIR_SPEED_CAP: 1.0,
  JUMP_VELOCITY: 7.2,
  GRAVITY: 21,
  MAX_FALL_SPEED: 45,
  STEP_HEIGHT: 0.55,
  /** Velocity slope leniency for "on ground" after landing. */
  KILL_Y: -25,
} as const;

export const COMBAT = {
  MAX_HP: 100,
  SPAWN_ARMOR: 50,
  MAX_ARMOR: 100,
  /** Fraction of incoming damage armor absorbs while it lasts. */
  ARMOR_ABSORB: 0.6,
  RESPAWN_DELAY: 3,
  SPAWN_PROTECTION: 1.25,
  FALL_DAMAGE_MIN_SPEED: 16,
  FALL_DAMAGE_PER_SPEED: 4,
  /** Minimum distance between a spawn point and the nearest enemy (m). */
  SPAWN_MIN_ENEMY_DIST: 8,
} as const;

export const MATCH = {
  DURATION_S: 300,
  COUNTDOWN_S: 4,
  RESULTS_S: 12,
  WAITING_S: 1.5,
  MIN_PLAYERS: 1,
  ROOM_SIZE: 8,
  BOT_FILL: 4,
} as const;

export const SCORE = {
  KILL: 100,
  HEADSHOT_BONUS: 25,
  STREAK_BONUS: 15,
  STREAK_MILESTONES: [3, 5, 7, 10] as readonly number[],
} as const;

export const NET = {
  MAX_NAME_LENGTH: 14,
  MIN_NAME_LENGTH: 1,
  PING_INTERVAL_MS: 2000,
  /** Max inbound messages per second before the server disconnects a client. */
  MAX_MSG_PER_SEC: 120,
  MAX_INPUTS_PER_MSG: 12,
  MAX_MESSAGE_BYTES: 4096,
  SCOREBOARD_HZ: 2,
} as const;

/** Apply damage against armor first. Returns the new hp/armor and the amount absorbed. */
export function applyDamage(
  hp: number,
  armor: number,
  dmg: number,
): { hp: number; armor: number; absorbed: number; dealt: number } {
  const absorbed = Math.min(armor, dmg * COMBAT.ARMOR_ABSORB);
  const dealt = dmg - absorbed;
  return {
    hp: Math.max(0, hp - dealt),
    armor: Math.max(0, armor - absorbed),
    absorbed,
    dealt,
  };
}
