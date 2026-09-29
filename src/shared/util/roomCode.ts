/** Room codes avoid look-alike characters (no I, O, 0, 1) so they are easy to read out loud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** Uppercase, strip spaces and dashes, and validate. Returns '' when the code is not well formed. */
export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 32) return '';
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== ROOM_CODE_LENGTH) return '';
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return '';
  return s;
}

/** `randomInt(max)` must return an integer in [0, max). */
export function generateRoomCode(randomInt: (max: number) => number): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return out;
}
