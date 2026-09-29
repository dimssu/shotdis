import { create } from 'zustand';
import type { MatchInfo, PlayerInfo } from '@shared/protocol';
import { normalizeRoomCode } from '@shared/util/roomCode';
import type { WeaponId } from '@shared/weapons';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export type Screen = 'menu' | 'play' | 'connecting' | 'loading' | 'game';
export type GameMode = 'online' | 'practice';

export interface KillFeedEntry {
  id: number;
  killer: string;
  killerColor: number;
  victim: string;
  victimColor: number;
  weapon: WeaponId | 'fall' | 'void';
  headshot: boolean;
  mine: boolean;
  died: boolean;
  at: number;
}

export interface DamageIndicator {
  id: number;
  angle: number;
  at: number;
}

export interface HitMarker {
  id: number;
  headshot: boolean;
  kill: boolean;
  blocked: boolean;
  at: number;
}

export interface DamageNumber {
  id: number;
  x: number;
  y: number;
  value: number;
  headshot: boolean;
  at: number;
}

export interface Banner {
  id: number;
  text: string;
  sub?: string;
  kind: 'kill' | 'streak' | 'info';
  at: number;
}

export interface DeathInfo {
  killer: string;
  killerColor: number;
  weapon: WeaponId | 'fall' | 'void';
  headshot: boolean;
  respawnAt: number;
}

export interface MatchResults {
  rows: PlayerInfo[];
  me: PlayerInfo | null;
  accuracy: number;
  bestStreak: number;
  nextAt: number;
}

export interface HudState {
  hp: number;
  armor: number;
  mag: number;
  reserve: number;
  weapon: WeaponId;
  slot: number;
  weapons: [WeaponId, WeaponId];
  reloading: boolean;
  reloadProgress: number;
  spread: number;
  ads: boolean;
  scoped: boolean;
  alive: boolean;
  phase: MatchInfo['phase'];
  phaseEndsAt: number;
  serverOffset: number;
  score: number;
  kills: number;
  deaths: number;
  streak: number;
  rank: number;
  ping: number;
  fps: number;
  mapName: string;
  mapId: string;
  lowHealth: boolean;
}

/** The private room the player is in (null for public matches and practice). */
export interface RoomState {
  code: string;
  host: number;
}

interface State {
  screen: Screen;
  mode: GameMode;
  settings: Settings;
  firstLaunch: boolean;
  overlay: 'none' | 'settings' | 'controls' | 'credits';
  pointerLocked: boolean;
  paused: boolean;
  scoreboardOpen: boolean;
  connectStatus: string;
  connectError: string | null;
  reconnecting: boolean;
  loadingProgress: number;
  loadingLabel: string;
  hud: HudState;
  killFeed: KillFeedEntry[];
  damageIndicators: DamageIndicator[];
  hitMarkers: HitMarker[];
  banners: Banner[];
  damageNumbers: DamageNumber[];
  damageFlashAt: number;
  death: DeathInfo | null;
  scoreboard: PlayerInfo[];
  myId: number;
  results: MatchResults | null;
  countdown: number | null;
  serverInfo: { ok: boolean; players: number; rooms: number } | null;
  toast: string | null;
  room: RoomState | null;
  /** Room code from an invite link (?room=CODE), until used or dismissed. */
  inviteCode: string | null;

  setScreen(s: Screen): void;
  setMode(m: GameMode): void;
  updateSettings(patch: Partial<Settings>): void;
  updateCrosshair(patch: Partial<Settings['crosshair']>): void;
  setOverlay(o: State['overlay']): void;
  setHud(patch: Partial<HudState>): void;
  pushKill(e: Omit<KillFeedEntry, 'id' | 'at'>): void;
  pushDamage(angle: number): void;
  pushHitMarker(headshot: boolean, kill: boolean, blocked?: boolean): void;
  pushBanner(text: string, kind: Banner['kind'], sub?: string): void;
  pushDamageNumber(x: number, y: number, value: number, headshot: boolean): void;
  flashDamage(): void;
  prune(now: number): void;
  setDeath(d: DeathInfo | null): void;
  setScoreboard(rows: PlayerInfo[]): void;
  setResults(r: MatchResults | null): void;
  setCountdown(n: number | null): void;
  setToast(t: string | null): void;
  clearInvite(): void;
  reset(): void;
}

function readInviteCode(): string | null {
  try {
    return normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '') || null;
  } catch {
    return null;
  }
}

let nextId = 1;

const initialHud: HudState = {
  hp: 100,
  armor: 50,
  mag: 30,
  reserve: 120,
  weapon: 'rifle',
  slot: 0,
  weapons: ['rifle', 'pistol'],
  reloading: false,
  reloadProgress: 0,
  spread: 0,
  ads: false,
  scoped: false,
  alive: false,
  phase: 'waiting',
  phaseEndsAt: 0,
  serverOffset: 0,
  score: 0,
  kills: 0,
  deaths: 0,
  streak: 0,
  rank: 0,
  ping: 0,
  fps: 0,
  mapName: '',
  mapId: '',
  lowHealth: false,
};

const loaded = loadSettings();

export const useStore = create<State>((set, get) => ({
  screen: 'menu',
  mode: 'online',
  settings: loaded,
  firstLaunch: loaded.name.length === 0,
  overlay: 'none',
  pointerLocked: false,
  paused: false,
  scoreboardOpen: false,
  connectStatus: '',
  connectError: null,
  reconnecting: false,
  loadingProgress: 0,
  loadingLabel: '',
  hud: { ...initialHud },
  killFeed: [],
  damageIndicators: [],
  hitMarkers: [],
  banners: [],
  damageNumbers: [],
  damageFlashAt: 0,
  death: null,
  scoreboard: [],
  myId: -1,
  results: null,
  countdown: null,
  serverInfo: null,
  toast: null,
  room: null,
  inviteCode: readInviteCode(),

  setScreen: (screen) => set({ screen }),
  setMode: (mode) => set({ mode }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings, firstLaunch: settings.name.length === 0 });
  },
  updateCrosshair: (patch) => {
    const settings = { ...get().settings, crosshair: { ...get().settings.crosshair, ...patch } };
    saveSettings(settings);
    set({ settings });
  },
  setOverlay: (overlay) => set({ overlay }),
  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  pushKill: (e) => set((s) => ({ killFeed: [...s.killFeed.slice(-5), { ...e, id: nextId++, at: performance.now() }] })),
  pushDamage: (angle) => set((s) => ({ damageIndicators: [...s.damageIndicators.slice(-7), { id: nextId++, angle, at: performance.now() }] })),
  pushHitMarker: (headshot, kill, blocked = false) =>
    set((s) => ({ hitMarkers: [...s.hitMarkers.slice(-3), { id: nextId++, headshot, kill, blocked, at: performance.now() }] })),
  pushBanner: (text, kind, sub) => set((s) => ({ banners: [...s.banners.slice(-2), { id: nextId++, text, sub, kind, at: performance.now() }] })),
  pushDamageNumber: (x, y, value, headshot) =>
    set((s) => ({ damageNumbers: [...s.damageNumbers.slice(-11), { id: nextId++, x, y, value, headshot, at: performance.now() }] })),
  flashDamage: () => set({ damageFlashAt: performance.now() }),
  prune: (now) =>
    set((s) => {
      const killFeed = s.killFeed.filter((k) => now - k.at < 6000);
      const damageIndicators = s.damageIndicators.filter((d) => now - d.at < 900);
      const hitMarkers = s.hitMarkers.filter((h) => now - h.at < 300);
      const banners = s.banners.filter((b) => now - b.at < 1600);
      const damageNumbers = s.damageNumbers.filter((d) => now - d.at < 800);
      if (
        killFeed.length === s.killFeed.length &&
        damageIndicators.length === s.damageIndicators.length &&
        hitMarkers.length === s.hitMarkers.length &&
        banners.length === s.banners.length &&
        damageNumbers.length === s.damageNumbers.length
      )
        return {};
      return { killFeed, damageIndicators, hitMarkers, banners, damageNumbers };
    }),
  setDeath: (death) => set({ death }),
  setScoreboard: (scoreboard) => set({ scoreboard }),
  setResults: (results) => set({ results }),
  setCountdown: (countdown) => set({ countdown }),
  setToast: (toast) => set({ toast }),
  clearInvite: () => {
    try {
      const url = new URL(location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
    } catch {}
    set({ inviteCode: null });
  },
  reset: () =>
    set({
      hud: { ...initialHud },
      killFeed: [],
      damageIndicators: [],
      hitMarkers: [],
      banners: [],
      damageNumbers: [],
      damageFlashAt: 0,
      death: null,
      scoreboard: [],
      results: null,
      countdown: null,
      paused: false,
      scoreboardOpen: false,
      pointerLocked: false,
      connectError: null,
      reconnecting: false,
      room: null,
    }),
}));

export const defaultSettings = DEFAULT_SETTINGS;
