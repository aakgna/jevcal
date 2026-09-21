// Seeded PRNG (mulberry32) so a 1000+-case dataset per domain is reproducible
// across runs — useful for resumability and for anyone re-checking these results.

export function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng, min, max, decimals = 2) {
  const v = rng() * (max - min) + min;
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

export function choice(rng, options) {
  return options[Math.floor(rng() * options.length)];
}

export function bool(rng, pTrue = 0.5) {
  return rng() < pTrue;
}
