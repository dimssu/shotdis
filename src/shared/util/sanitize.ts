import { NET } from '../config';

const ALLOWED = /[^A-Za-z0-9 _\-.]/g;

/**
 * Sanitize a player nickname. Strips anything that isn't a letter, digit, space,
 * underscore, dash or dot, collapses whitespace and enforces the length limit.
 * Returns an empty string if nothing usable remains.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC').replace(ALLOWED, '').replace(/\s+/g, ' ').trim();
  if (s.length > NET.MAX_NAME_LENGTH) s = s.slice(0, NET.MAX_NAME_LENGTH).trim();
  if (s.length < NET.MIN_NAME_LENGTH) return '';
  return s;
}

export function isValidName(raw: unknown): boolean {
  return sanitizeName(raw).length >= NET.MIN_NAME_LENGTH;
}

const ADJ = ['Swift', 'Grim', 'Neon', 'Static', 'Rogue', 'Vapor', 'Iron', 'Ghost', 'Volt', 'Ash'];
const NOUN = ['Fox', 'Wolf', 'Hawk', 'Viper', 'Raven', 'Lynx', 'Drone', 'Shade', 'Bolt', 'Rat'];

export function randomName(rand = Math.random): string {
  return `${ADJ[Math.floor(rand() * ADJ.length)]}${NOUN[Math.floor(rand() * NOUN.length)]}${Math.floor(rand() * 90 + 10)}`;
}
