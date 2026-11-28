/**
 * Interpolate a Koubo / 阿杜 face track on the output (film) clock.
 * Sample times are seconds; optional `f` arrays are 60fps frame indices.
 */

export function interpolateFace(track, timeSec, fallback = { cx: 0.5, cy: 0.42, h: 0.28 }) {
  if (!track || !Array.isArray(track.cx) || !track.cx.length) return { ...fallback, source: 'fallback' };
  const n = track.cx.length;
  const times = Array.isArray(track.t) && track.t.length === n
    ? track.t
    : Array.isArray(track.f) && track.f.length === n
      ? track.f.map((f) => (Number(f) - 1) / (track.fps || 60))
      : null;
  if (!times) return { ...fallback, source: 'fallback' };
  const t = Math.max(0, Number(timeSec) || 0);
  if (t <= times[0]) return sample(track, 0, fallback);
  if (t >= times[n - 1]) return sample(track, n - 1, fallback);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = times[lo];
  const b = times[hi];
  const x = b > a ? (t - a) / (b - a) : 0;
  const lerp = (p, q) => p + (q - p) * x;
  const value = {
    cx: lerp(track.cx[lo], track.cx[hi]),
    cy: lerp(track.cy[lo], track.cy[hi]),
    h: lerp(track.h[lo], track.h[hi]),
    source: 'track',
  };
  return Number.isFinite(value.cx) && Number.isFinite(value.cy) && value.h > 0 ? value : { ...fallback, source: 'fallback' };
}

function sample(track, i, fallback) {
  const value = { cx: track.cx[i], cy: track.cy[i], h: track.h[i], source: 'track' };
  return Number.isFinite(value.cx) && Number.isFinite(value.cy) && value.h > 0 ? value : { ...fallback, source: 'fallback' };
}

export function faceJs(track) {
  return `window.CONFIG = Object.assign(window.CONFIG || {}, { kouboFace: ${JSON.stringify(track)} });\n`;
}
