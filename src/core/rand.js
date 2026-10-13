// Deterministic helpers so a project can be rebuilt identically (e.g. in Blender).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D value noise + fBm.
export function makeNoise2(seed) {
  const rnd = mulberry32(seed);
  const P = 256;
  const v = new Float32Array(P * P);
  for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
  const at = (x, y) => v[((y & (P - 1)) * P) + (x & (P - 1))];
  const s = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = s(x - xi), yf = s(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  noise.fbm = (x, y, oct = 4) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  };
  return noise;
}
