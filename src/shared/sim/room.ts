import { COMBAT, MATCH, MOVE, PLAYER, SCORE, SIM } from '../config';
import { applyDamage } from '../config';
import type { MapDef, NavPoint } from '../maps/types';
import { clamp, dirFromYawPitch, round2, v3, vcross, vnormalize, type Vec3 } from '../math';
import { Keys, eyeHeight, horizontalSpeed, playerHeight, stepPlayer } from '../physics/movement';
import { CollisionWorld, newRayHit, rayAABB, raySphere, type AABB } from '../physics/world';
import type { ClientMsg, GameEvent, InputTuple, MatchInfo, MatchPhase, PlayerInfo, RemoteTuple, ServerMsg } from '../protocol';
import { Rng } from '../util/rng';
import { randomName } from '../util/sanitize';
import { damageAt, PRIMARY_WEAPONS, spreadDegrees, WEAPONS, type WeaponId } from '../weapons';
import { BotBrain, type BotDifficulty, type BotInput, type BotWorldView } from './bot';
import { PLAYER_COLORS, SimPlayer, type HistorySample } from './player';
import type { RoomTransport } from './transport';
import { resetWeaponState, stepWeapon, type WeaponStepResult } from './weapon-state';

export interface RoomOptions {
  id: string;
  maps: MapDef[];
  transport: RoomTransport;
  roomSize?: number;
  botFill?: number;
  seed?: number;
  startMapIndex?: number;
  botDifficulty?: BotDifficulty | 'mixed';
  /** Match length override in seconds (practice mode). */
  matchDuration?: number;
}

const BOT_NAMES = ['Kestrel', 'Moth', 'Jackal', 'Sable', 'Quill', 'Ferro', 'Nyx', 'Pike', 'Dusk', 'Vex', 'Halo', 'Rook'];

/**
 * Authoritative game room. Runs the same movement and weapon code as the client
 * prediction, validates every input, performs hitscan with lag compensation and
 * owns the match state machine. It has no dependency on Node or the DOM so it
 * runs both on the server and inside the browser for offline practice.
 */
export class GameRoom implements BotWorldView {
  readonly id: string;
  readonly players = new Map<number, SimPlayer>();
  private brains = new Map<number, BotBrain>();
  map!: MapDef;
  world!: CollisionWorld;
  nav: NavPoint[] = [];
  navAdj: number[][] = [];
  phase: MatchPhase = 'waiting';
  phaseEndsAt = 0;
  round = 0;
  now = 0;
  mapIndex: number;
  private maps: MapDef[];
  private transport: RoomTransport;
  private roomSize: number;
  private botFill: number;
  private botDifficulty: BotDifficulty | 'mixed';
  private matchDuration: number;
  private rng: Rng;
  private nextId = 1;
  private snapAccum = 0;
  private scoreAccum = 0;
  private broadcastQueue: GameEvent[] = [];
  private privateQueue = new Map<number, GameEvent[]>();
  private lastResults: PlayerInfo[] = [];
  private botInput: BotInput = { keys: 0, yaw: 0, pitch: 0 };
  private stepOut: WeaponStepResult = { fired: false, dryFire: false, reloadStarted: false, reloadDone: false, switched: false };
  private adsHeld = new Map<number, boolean>();
  private lastSpawnIndex = -1;
  private idleSince = 0;
  private rayHit = newRayHit();
  private sample: HistorySample = { t: 0, x: 0, y: 0, z: 0, crouch: false, alive: false };

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.maps = opts.maps;
    this.transport = opts.transport;
    this.roomSize = opts.roomSize ?? MATCH.ROOM_SIZE;
    this.botFill = opts.botFill ?? MATCH.BOT_FILL;
    this.botDifficulty = opts.botDifficulty ?? 'mixed';
    this.matchDuration = opts.matchDuration ?? MATCH.DURATION_S;
    this.rng = new Rng(opts.seed ?? 12345);
    this.mapIndex = opts.startMapIndex ?? 0;
    this.loadMap(this.mapIndex);
  }

  get live(): boolean {
    return this.phase === 'live';
  }

  /* ------------------------------------------------------------------ */
  /* Map                                                                 */
  /* ------------------------------------------------------------------ */

  private loadMap(index: number): void {
    this.mapIndex = ((index % this.maps.length) + this.maps.length) % this.maps.length;
    this.map = this.maps[this.mapIndex];
    this.world = CollisionWorld.fromMap(this.map);
    this.nav = this.map.nav;
    this.navAdj = this.nav.map(() => []);
    for (const [a, b] of this.map.navLinks) {
      if (this.navAdj[a] && this.navAdj[b]) {
        this.navAdj[a].push(b);
        this.navAdj[b].push(a);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Players                                                             */
  /* ------------------------------------------------------------------ */

  *alivePlayers(): Iterable<SimPlayer> {
    for (const p of this.players.values()) if (p.alive) yield p;
  }

  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  botCount(): number {
    return this.players.size - this.humanCount();
  }

  hasRoomForHuman(): boolean {
    return this.humanCount() < this.roomSize;
  }

  matchInfo(): MatchInfo {
    return { phase: this.phase, phaseEndsAt: Math.round(this.phaseEndsAt), map: this.map.id, round: this.round };
  }

  private pickColor(): number {
    const used = new Map<number, number>();
    for (const p of this.players.values()) used.set(p.color, (used.get(p.color) ?? 0) + 1);
    let best = PLAYER_COLORS[0];
    let bestCount = Infinity;
    for (const c of PLAYER_COLORS) {
      const n = used.get(c) ?? 0;
      if (n < bestCount) {
        bestCount = n;
        best = c;
      }
    }
    return best;
  }

  addHuman(name: string, weapon: WeaponId): SimPlayer {
    if (WEAPONS[weapon].slot !== 'primary') weapon = 'rifle';
    // Replace a bot if the room is full of bots.
    if (this.players.size >= this.roomSize) {
      for (const p of this.players.values()) {
        if (p.bot) {
          this.removePlayer(p.id);
          break;
        }
      }
    }
    const id = this.nextId++;
    const p = new SimPlayer(id, name, false, this.pickColor(), weapon);
    p.joinedAt = this.now;
    p.lastInputWall = this.now;
    this.players.set(id, p);
    this.adsHeld.set(id, false);
    if (this.phase === 'waiting') {
      this.setPhase('countdown');
    }
    if (this.phase === 'countdown' || this.phase === 'live') this.spawn(p);
    this.broadcast({ e: 'join', p: p.info() }, id);
    this.ensureBots();
    return p;
  }

  /**
   * Send the welcome message to a player. Called by the host once the player's
   * connection is registered with the transport (so the message can be routed).
   */
  welcome(id: number, token = ''): void {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    this.transport.send(id, {
      t: 'welcome',
      id,
      st: round2(this.now),
      match: this.matchInfo(),
      players: [...this.players.values()].map((q) => q.info()),
      you: p.youTuple(this.now, false),
      room: this.id,
      token,
    });
    this.transport.send(id, { t: 'scores', p: this.sortedInfo() });
  }

  /**
   * A player reconnected on a new socket: forget the old input stream so the
   * client can restart its sequence numbers, and keep everything else (score,
   * position, loadout) as it was.
   */
  rejoin(id: number): boolean {
    const p = this.players.get(id);
    if (!p || p.bot) return false;
    p.lastSeq = -1;
    p.inputQueue.length = 0;
    p.timeBudget = 0.1;
    p.lastInputWall = this.now;
    p.connected = true;
    return true;
  }

  /** Mark a player as disconnected (the socket dropped); they are removed by the host when it gives up on them. */
  markDisconnected(id: number): void {
    const p = this.players.get(id);
    if (p) p.connected = false;
  }

  addBot(difficulty?: BotDifficulty): SimPlayer {
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map((p) => p.name));
    let name = this.rng.pick(BOT_NAMES);
    let tries = 0;
    while (used.has(name) && tries++ < 20) name = this.rng.pick(BOT_NAMES);
    if (used.has(name)) name = randomName(() => this.rng.next());
    const weapon = this.rng.pick(PRIMARY_WEAPONS);
    const p = new SimPlayer(id, name, true, this.pickColor(), weapon);
    p.joinedAt = this.now;
    this.players.set(id, p);
    const diff: BotDifficulty =
      difficulty ?? (this.botDifficulty === 'mixed' ? this.rng.pick(['easy', 'normal', 'normal', 'hard'] as const) : this.botDifficulty);
    this.brains.set(id, new BotBrain(p, diff, new Rng(this.rng.int(1, 1e9))));
    this.adsHeld.set(id, false);
    if (this.phase === 'countdown' || this.phase === 'live') this.spawn(p);
    this.broadcast({ e: 'join', p: p.info() });
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.brains.delete(id);
    this.privateQueue.delete(id);
    this.adsHeld.delete(id);
    this.broadcast({ e: 'leave', id });
    if (!p.bot) {
      this.ensureBots();
      if (this.humanCount() === 0) this.idleSince = this.now;
    }
  }

  private ensureBots(): void {
    const humans = this.humanCount();
    const desired = clamp(this.botFill - Math.max(0, humans - 1), 0, Math.max(0, this.roomSize - humans));
    let bots = this.botCount();
    while (bots < desired) {
      this.addBot();
      bots++;
    }
    while (bots > desired) {
      for (const p of this.players.values()) {
        if (p.bot) {
          this.removePlayer(p.id);
          break;
        }
      }
      bots--;
    }
  }

  /** Milliseconds this room has been without humans, or 0. */
  idleMs(): number {
    return this.humanCount() === 0 ? this.now - this.idleSince : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  handleMessage(id: number, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    switch (msg.t) {
      case 'in': {
        for (const f of msg.f) {
          if (f[0] <= p.lastSeq) continue;
          if (p.inputQueue.length >= 64) p.inputQueue.shift();
          p.inputQueue.push(f);
        }
        break;
      }
      case 'ping': {
        p.ping = Math.round(msg.rtt);
        this.transport.send(id, { t: 'pong', c: msg.c, st: round2(this.now) });
        break;
      }
      case 'loadout': {
        if (WEAPONS[msg.weapon].slot === 'primary') p.pendingPrimary = msg.weapon;
        break;
      }
      case 'join':
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Simulation                                                          */
  /* ------------------------------------------------------------------ */

  /** Advance the room to server time `now` (ms). Call at ~60 Hz. */
  update(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.now) / 1000));
    this.now = now;
    this.updatePhase();
    // Phase/map changes must reach clients before the snapshot that follows them.
    this.flushEvents();

    for (const p of this.players.values()) {
      if (p.bot) this.updateBot(p, dt);
      else this.processInputs(p);
      if (!p.alive && p.respawnAt > 0 && now >= p.respawnAt && (this.phase === 'live' || this.phase === 'countdown')) {
        this.spawn(p);
      }
    }

    this.snapAccum += dt;
    if (this.snapAccum >= 1 / SIM.SNAPSHOT_HZ) {
      this.snapAccum -= 1 / SIM.SNAPSHOT_HZ;
      if (this.snapAccum > 0.1) this.snapAccum = 0;
      this.sendSnapshots();
    }
    this.scoreAccum += dt;
    if (this.scoreAccum >= 0.5) {
      this.scoreAccum = 0;
      this.sendScores();
    }
    this.flushEvents();
  }

  private updatePhase(): void {
    if (this.phase === 'waiting') return;
    if (this.now < this.phaseEndsAt) return;
    switch (this.phase) {
      case 'countdown':
        this.setPhase('live');
        break;
      case 'live':
        this.setPhase('ended');
        break;
      case 'ended':
        this.loadMap(this.mapIndex + 1);
        for (const b of this.brains.values()) b.reset();
        if (this.humanCount() > 0) this.setPhase('countdown');
        else this.setPhase('waiting');
        break;
    }
  }

  private setPhase(phase: MatchPhase): void {
    this.phase = phase;
    let results: PlayerInfo[] | undefined;
    switch (phase) {
      case 'waiting':
        this.phaseEndsAt = 0;
        break;
      case 'countdown':
        this.round++;
        this.phaseEndsAt = this.now + MATCH.COUNTDOWN_S * 1000;
        for (const p of this.players.values()) {
          p.resetStats();
          this.spawn(p);
        }
        break;
      case 'live':
        this.phaseEndsAt = this.now + this.matchDuration * 1000;
        break;
      case 'ended':
        this.phaseEndsAt = this.now + MATCH.RESULTS_S * 1000;
        results = this.sortedInfo();
        this.lastResults = results;
        break;
    }
    this.broadcast({ e: 'match', m: this.matchInfo(), results });
  }

  private sortedInfo(): PlayerInfo[] {
    return [...this.players.values()]
      .map((p) => p.info())
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }

  private processInputs(p: SimPlayer): void {
    const now = this.now;
    // Replenish the time budget from wall-clock time (anti speed-hack).
    p.timeBudget = Math.min(SIM.INPUT_TIME_BUDGET_MAX, p.timeBudget + ((now - p.lastInputWall) / 1000) * SIM.INPUT_TIME_BUDGET_FACTOR);
    p.lastInputWall = now;
    const q = p.inputQueue;
    if (q.length === 0) return;
    for (const f of q) {
      const [seq, dt] = f;
      if (seq <= p.lastSeq) continue;
      p.lastSeq = seq;
      if (p.timeBudget < dt) continue; // client is running ahead of real time: drop
      p.timeBudget -= dt;
      this.applyInput(p, f);
    }
    q.length = 0;
  }

  private updateBot(p: SimPlayer, dt: number): void {
    const brain = this.brains.get(p.id);
    if (!brain) return;
    // Bots simulate at the fixed sim rate regardless of how often the host ticks.
    p.botAccum += dt;
    let steps = 0;
    while (p.botAccum >= SIM.DT && steps < 4) {
      p.botAccum -= SIM.DT;
      brain.think(this, SIM.DT, this.botInput);
      this.applyInput(p, [p.lastSeq + 1, SIM.DT, this.botInput.keys, this.botInput.yaw, this.botInput.pitch, this.now]);
      p.lastSeq++;
      steps++;
    }
    if (p.botAccum > SIM.DT * 4) p.botAccum = 0;
  }

  private applyInput(p: SimPlayer, f: InputTuple): void {
    const [, dt, rawKeys, yaw, pitch, rt] = f;
    p.yaw = yaw;
    p.pitch = pitch;
    p.renderTime = rt;
    const canAct = p.alive && this.phase === 'live';
    const keys = canAct ? rawKeys : 0;
    this.adsHeld.set(p.id, (keys & Keys.ADS) !== 0);
    const def = WEAPONS[p.currentWeapon];
    const bloomBefore = p.weapon.bloom;
    if (p.alive) {
      stepPlayer(p.move, keys, yaw, dt, this.world, def.moveSpeedMult);
      if (p.move.landedSpeed > COMBAT.FALL_DAMAGE_MIN_SPEED && this.phase === 'live') {
        const dmg = (p.move.landedSpeed - COMBAT.FALL_DAMAGE_MIN_SPEED) * COMBAT.FALL_DAMAGE_PER_SPEED;
        this.damage(p, p, dmg, false, 'fall');
      }
      if (p.move.pos.y < MOVE.KILL_Y && p.alive) this.kill(p, null, 'void', false);
    }
    stepWeapon(p.weapon, keys, dt, canAct, this.stepOut);
    if (!p.alive) return;
    const r = this.stepOut;
    if (r.switched) this.broadcast({ e: 'switch', id: p.id, w: p.currentWeapon }, p.id);
    if (r.reloadStarted) this.broadcast({ e: 'reload', id: p.id }, p.id);
    if (r.fired) this.fire(p, yaw, pitch, (keys & Keys.ADS) !== 0, bloomBefore);
  }

  /* ------------------------------------------------------------------ */
  /* Combat                                                              */
  /* ------------------------------------------------------------------ */

  private fire(p: SimPlayer, yaw: number, pitch: number, ads: boolean, bloomBefore: number): void {
    const def = WEAPONS[p.currentWeapon];
    const now = this.now;
    p.protectedUntil = 0; // shooting forfeits spawn protection
    const spreadDeg = spreadDegrees(def, {
      ads,
      moveFrac: horizontalSpeed(p.move) / MOVE.WALK_SPEED,
      airborne: !p.move.onGround,
      crouch: p.move.crouch,
      bloom: bloomBefore,
    });
    const spreadRad = spreadDeg * (Math.PI / 180);
    const ox = p.move.pos.x;
    const oy = p.move.pos.y + eyeHeight(p.move.crouch);
    const oz = p.move.pos.z;
    const dir = dirFromYawPitch(yaw, pitch, tmpDir);
    const right = vcross(tmpRight, dir, UP);
    vnormalize(right);
    const up = vcross(tmpUp, right, dir);

    // Rewind every other player to the time the shooter was rendering.
    const rt = clamp(p.renderTime, now - SIM.LAGCOMP_MAX_MS, now);
    const targets: { q: SimPlayer; head: Vec3; body: AABB }[] = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      let x = q.move.pos.x;
      let y = q.move.pos.y;
      let z = q.move.pos.z;
      let crouch = q.move.crouch;
      if (!p.bot && q.sampleHistory(rt, this.sample) && this.sample.alive) {
        x = this.sample.x;
        y = this.sample.y;
        z = this.sample.z;
        crouch = this.sample.crouch;
      }
      const h = playerHeight(crouch);
      const hw = PLAYER.HALF_WIDTH;
      targets.push({
        q,
        head: v3(x, y + h - PLAYER.HEAD_RADIUS - 0.02, z),
        body: { minX: x - hw, maxX: x + hw, minY: y, maxY: y + h - PLAYER.HEAD_RADIUS * 2 + 0.05, minZ: z - hw, maxZ: z + hw },
      });
    }

    const ends: [number, number, number][] = [];
    const hitMap = new Map<number, { dmg: number; hs: boolean; dist: number }>();
    for (let i = 0; i < def.pellets; i++) {
      let dx = dir.x;
      let dy = dir.y;
      let dz = dir.z;
      if (spreadRad > 0) {
        const r = spreadRad * Math.sqrt(this.rng.next());
        const th = this.rng.next() * Math.PI * 2;
        const cx = Math.cos(th) * r;
        const cy = Math.sin(th) * r;
        dx += right.x * cx + up.x * cy;
        dy += right.y * cx + up.y * cy;
        dz += right.z * cx + up.z * cy;
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
      }
      this.world.raycast(ox, oy, oz, dx, dy, dz, def.range, this.rayHit);
      let bestT = this.rayHit.hit ? this.rayHit.dist : def.range;
      let victim: SimPlayer | null = null;
      let hs = false;
      for (const t of targets) {
        const th = raySphere(ox, oy, oz, dx, dy, dz, t.head.x, t.head.y, t.head.z, PLAYER.HEAD_RADIUS);
        if (th > 0 && th < bestT) {
          bestT = th;
          victim = t.q;
          hs = true;
        }
        const tb = rayAABB(ox, oy, oz, dx, dy, dz, t.body);
        if (tb > 0 && tb < bestT) {
          bestT = tb;
          victim = t.q;
          hs = false;
        }
      }
      ends.push([round2(ox + dx * bestT), round2(oy + dy * bestT), round2(oz + dz * bestT)]);
      if (victim) {
        const dmg = damageAt(def, bestT, hs);
        const acc = hitMap.get(victim.id);
        if (acc) {
          acc.dmg += dmg;
          acc.hs = acc.hs || hs;
        } else hitMap.set(victim.id, { dmg, hs, dist: bestT });
      }
    }

    p.shots++;
    let landed = false;
    for (const [vid, h] of hitMap) {
      const victim = this.players.get(vid);
      if (!victim) continue;
      const outcome = this.damage(victim, p, h.dmg, h.hs, def.id);
      if (outcome === 'blocked') {
        // Spawn protection absorbed it: tell the shooter with zero damage so the UI can show a shield.
        this.sendTo(p.id, { e: 'hit', v: vid, d: 0, hs: h.hs, k: false });
        continue;
      }
      if (outcome === 'ignored') continue;
      landed = true;
      if (h.hs) p.headshots++;
      this.sendTo(p.id, { e: 'hit', v: vid, d: Math.round(h.dmg), hs: h.hs, k: outcome === 'killed' });
    }
    if (landed) p.hits++;
    this.broadcast({ e: 'shot', id: p.id, w: def.id, o: [round2(ox), round2(oy), round2(oz)], ends: ends.slice(0, 12), hit: landed ? 1 : 0 }, p.id);
  }

  /** Apply damage. */
  private damage(victim: SimPlayer, attacker: SimPlayer, dmg: number, hs: boolean, weapon: WeaponId | 'fall'): 'ignored' | 'blocked' | 'applied' | 'killed' {
    if (!victim.alive || this.phase !== 'live') return 'ignored';
    if (victim.protectedUntil > this.now && attacker !== victim) return 'blocked';
    const r = applyDamage(victim.hp, victim.armor, dmg);
    victim.hp = r.hp;
    victim.armor = r.armor;
    if (attacker !== victim) attacker.damageDealt += r.dealt;
    if (!victim.bot) {
      this.sendTo(victim.id, {
        e: 'dmg',
        a: attacker.id,
        d: Math.round(dmg),
        hp: Math.round(victim.hp),
        ar: Math.round(victim.armor),
        ax: round2(attacker.move.pos.x),
        ay: round2(attacker.move.pos.y),
        az: round2(attacker.move.pos.z),
      });
    }
    if (victim.hp <= 0) {
      this.kill(victim, attacker === victim ? null : attacker, weapon, hs);
      return 'killed';
    }
    return 'applied';
  }

  private kill(victim: SimPlayer, killer: SimPlayer | null, weapon: WeaponId | 'fall' | 'void', hs: boolean): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.now + COMBAT.RESPAWN_DELAY * 1000;
    victim.move.vel.x = 0;
    victim.move.vel.z = 0;
    let streak = 0;
    let milestone = 0;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.streak++;
      streak = killer.streak;
      if (killer.streak > killer.bestStreak) killer.bestStreak = killer.streak;
      killer.score += SCORE.KILL + (hs ? SCORE.HEADSHOT_BONUS : 0);
      if (SCORE.STREAK_MILESTONES.includes(killer.streak)) {
        milestone = killer.streak;
        killer.score += SCORE.STREAK_BONUS * killer.streak;
      }
    } else {
      victim.score = Math.max(0, victim.score - 25);
    }
    this.broadcast({ e: 'kill', k: killer ? killer.id : -1, v: victim.id, w: weapon, hs, streak, milestone });
  }

  /* ------------------------------------------------------------------ */
  /* Spawning                                                            */
  /* ------------------------------------------------------------------ */

  private pickSpawn(p: SimPlayer): number {
    const spawns = this.map.spawns;
    const scored = spawns.map((s, i) => {
      let minD = Infinity;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const dx = q.move.pos.x - s.x;
        const dz = q.move.pos.z - s.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < minD) minD = d;
      }
      // Slight randomness so players cannot predict spawns; penalize the last used point.
      let score = Math.min(minD, 40) + this.rng.range(0, 6);
      if (i === this.lastSpawnIndex) score -= 8;
      return { i, score, minD };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).filter((s) => s.minD >= COMBAT.SPAWN_MIN_ENEMY_DIST || s === scored[0]);
    const pick = top[Math.floor(this.rng.next() * top.length)] ?? scored[0];
    this.lastSpawnIndex = pick.i;
    return pick.i;
  }

  private spawn(p: SimPlayer): void {
    const s = this.map.spawns[this.pickSpawn(p)];
    p.move.pos.x = s.x;
    p.move.pos.y = s.y + 0.05;
    p.move.pos.z = s.z;
    p.move.vel.x = 0;
    p.move.vel.y = 0;
    p.move.vel.z = 0;
    p.move.onGround = false;
    p.move.crouch = false;
    p.move.sprint = false;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.hp = COMBAT.MAX_HP;
    p.armor = COMBAT.SPAWN_ARMOR;
    p.alive = true;
    p.respawnAt = 0;
    p.protectedUntil = this.now + COMBAT.SPAWN_PROTECTION * 1000;
    resetWeaponState(p.weapon, p.pendingPrimary);
    const brain = this.brains.get(p.id);
    if (brain) brain.reset();
    this.broadcast({ e: 'spawn', id: p.id, x: round2(s.x), y: round2(s.y), z: round2(s.z), yaw: round2(s.yaw) });
  }

  /* ------------------------------------------------------------------ */
  /* Output                                                              */
  /* ------------------------------------------------------------------ */

  private sendSnapshots(): void {
    const now = this.now;
    const remotes: RemoteTuple[] = [];
    for (const p of this.players.values()) {
      p.pushHistory(now);
      remotes.push(p.remoteTuple(now, this.adsHeld.get(p.id) ?? false));
    }
    for (const p of this.players.values()) {
      if (p.bot || !p.connected) continue;
      const others = remotes.filter((r) => r[0] !== p.id);
      const msg: ServerMsg = { t: 'snap', st: round2(now), ack: p.lastSeq, you: p.youTuple(now, this.adsHeld.get(p.id) ?? false), p: others };
      this.transport.send(p.id, msg);
    }
  }

  private sendScores(): void {
    const rows = this.sortedInfo();
    for (const p of this.players.values()) if (!p.bot) this.transport.send(p.id, { t: 'scores', p: rows });
  }

  private broadcast(ev: GameEvent, _origin?: number): void {
    this.broadcastQueue.push(ev);
  }

  private sendTo(id: number, ev: GameEvent): void {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    let q = this.privateQueue.get(id);
    if (!q) {
      q = [];
      this.privateQueue.set(id, q);
    }
    q.push(ev);
  }

  private flushEvents(): void {
    if (this.broadcastQueue.length === 0 && this.privateQueue.size === 0) return;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const priv = this.privateQueue.get(p.id);
      const list = priv ? this.broadcastQueue.concat(priv) : this.broadcastQueue;
      if (list.length > 0) this.transport.send(p.id, { t: 'ev', e: list });
    }
    this.broadcastQueue = [];
    this.privateQueue.clear();
  }

  /** Results of the last finished match (for late joiners). */
  results(): PlayerInfo[] {
    return this.lastResults;
  }

  playerInfos(): PlayerInfo[] {
    return this.sortedInfo();
  }
}

const UP = v3(0, 1, 0);
const tmpDir = v3();
const tmpRight = v3();
const tmpUp = v3();
