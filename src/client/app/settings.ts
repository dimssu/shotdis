import type { WeaponId } from '@shared/weapons';

export type Quality = 'low' | 'medium' | 'high';

export interface CrosshairSettings {
  size: number;
  thickness: number;
  gap: number;
  opacity: number;
  color: string;
  dynamic: boolean;
  dot: boolean;
}

export interface Settings {
  name: string;
  sensitivity: number;
  fov: number;
  crosshair: CrosshairSettings;
  quality: Quality;
  shadows: boolean;
  effects: boolean;
  resolutionScale: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  damageNumbers: boolean;
  showFps: boolean;
  /** Minimap: player-centred and rotating, whole arena, or hidden. */
  minimap: 'rotate' | 'fixed' | 'off';
  uiScale: number;
  weapon: WeaponId;
  practiceBots: number;
  practiceDifficulty: 'easy' | 'normal' | 'hard' | 'mixed';
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 3,
  fov: 95,
  crosshair: { size: 8, thickness: 2, gap: 4, opacity: 0.9, color: '#4df2c9', dynamic: true, dot: false },
  quality: 'high',
  shadows: true,
  effects: true,
  resolutionScale: 1,
  masterVolume: 0.8,
  musicVolume: 0.35,
  sfxVolume: 0.9,
  muted: false,
  reducedMotion: false,
  damageNumbers: true,
  showFps: false,
  minimap: 'rotate',
  uiScale: 1,
  weapon: 'rifle',
  practiceBots: 4,
  practiceDifficulty: 'mixed',
};

const KEY = 'shotdis.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, crosshair: { ...DEFAULT_SETTINGS.crosshair } };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(parsed.crosshair ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, crosshair: { ...DEFAULT_SETTINGS.crosshair } };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode); settings stay in memory */
  }
}

/** Auto-detect a sensible quality tier for the device. */
export function detectQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 2 || mem <= 2) return 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}
