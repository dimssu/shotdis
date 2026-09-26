import { Rng } from '../src/shared/util/rng';
import { PRIMARY_WEAPONS } from '../src/shared/weapons';
for (const seed of [1, 42, 123456789, (Math.random() * 1e9) >>> 0]) {
  const r = new Rng(seed);
  const picks = Array.from({ length: 8 }, () => r.pick(PRIMARY_WEAPONS));
  console.log(seed, picks.join(','), Array.from({ length: 5 }, () => r.next().toFixed(3)).join(' '));
}
