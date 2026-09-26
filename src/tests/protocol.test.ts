import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '@shared/protocol';
import { PROTOCOL_VERSION } from '@shared/config';
import { sanitizeName } from '@shared/util/sanitize';

describe('client message validation', () => {
  it('accepts a valid join', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 'Ace', weapon: 'rifle', v: PROTOCOL_VERSION }))).toEqual({
      t: 'join',
      name: 'Ace',
      weapon: 'rifle',
      v: PROTOCOL_VERSION,
    });
  });

  it('rejects garbage, wrong types and out-of-range values', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 5, weapon: 'rifle', v: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 'x', weapon: 'bazooka', v: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 5, 0, 0, 0, 0]] }))).toBeNull(); // dt too big
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 0.016, -1, 0, 0, 0]] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 0.016, 0, 0, 9, 0]] }))).toBeNull(); // pitch out of range
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1.5, 0.016, 0, 0, 0, 0]] }))).toBeNull(); // non-integer seq
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 0.016, 0, 0, 0]] }))).toBeNull(); // missing render time
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 0.016, 0, 0, 0, -5]] }))).toBeNull(); // negative render time
    expect(parseClientMessage(JSON.stringify({ t: 'in', f: new Array(50).fill([1, 0.016, 0, 0, 0, 0]) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 'x', weapon: 'pistol', v: 1 }))).toBeNull(); // sidearm is not a primary
    expect(parseClientMessage('x'.repeat(10000))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'ping', c: 'now' }))).toBeNull();
  });

  it('accepts a valid input batch', () => {
    const m = parseClientMessage(JSON.stringify({ t: 'in', f: [[1, 1 / 60, 3, 0.5, -0.2, 1234.5]] }));
    expect(m?.t).toBe('in');
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 'Ace', weapon: 'rifle', v: PROTOCOL_VERSION, token: 'abc' }))?.t).toBe('join');
  });
});

describe('nickname sanitizer', () => {
  it('strips html and control characters', () => {
    expect(sanitizeName('<script>alert(1)</script>')).not.toMatch(/[<>()/]/);
    expect(sanitizeName('<b>Ace</b>')).toBe('bAceb');
    expect(sanitizeName('Bob\u0000\u0007')).toBe('Bob');
    expect(sanitizeName('  Ace   Rider ')).toBe('Ace Rider');
  });
  it('enforces length and rejects empties', () => {
    expect(sanitizeName('a'.repeat(40)).length).toBe(14);
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('!!!')).toBe('');
    expect(sanitizeName(42)).toBe('');
  });
});
