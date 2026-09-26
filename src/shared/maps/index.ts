import { NEON_DISTRICT } from './neon-district';
import type { MapDef } from './types';
import { WAREHOUSE } from './warehouse';

export const MAPS: MapDef[] = [WAREHOUSE, NEON_DISTRICT];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export { WAREHOUSE, NEON_DISTRICT };
