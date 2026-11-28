/**
 * Remap authored unit SFX cues from the source choreography clock onto the
 * film output clock. Cues that fall outside a played segment are dropped.
 */

export function parseUnitCues(source) {
  const text = String(source ?? '');
  const match = text.match(/cues\(\[\s*([\s\S]*?)\s*\]\)\s*;/);
  if (!match) return [];
  const events = [];
  const row = /\[\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*['"]([a-zA-Z0-9_-]+)['"]\s*(?:,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)))?(?:,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)))?/g;
  let m;
  const body = match[1];
  while ((m = row.exec(body))) {
    events.push({
      t: Number(m[1]),
      type: m[2],
      g: m[3] != null ? Number(m[3]) : 1,
      p: m[4] != null ? Number(m[4]) : 0,
    });
  }
  return events;
}

export function outputTimeAt(clock, srcT, clipAt = 0) {
  const segs = clock?.segments || [];
  for (const seg of segs) {
    if (seg.hold) continue;
    if (srcT >= seg.src0 - 1e-9 && srcT <= seg.src1 + 1e-9) {
      const span = Math.max(seg.src1 - seg.src0, 1e-9);
      const u = (srcT - seg.src0) / span;
      return Number(clipAt) + seg.out0 + u * (seg.out1 - seg.out0);
    }
  }
  const src0 = clock?.sourceStart ?? clock?.srcStart ?? 0;
  const src1 = clock?.sourceEnd ?? clock?.srcEnd;
  if (src1 != null && srcT >= src0 - 1e-9 && srcT <= src1 + 1e-9) {
    const span = Math.max(src1 - src0, 1e-9);
    const out0 = clock.outStart ?? 0;
    const out1 = clock.outEnd ?? out0 + span;
    const u = (srcT - src0) / span;
    return Number(clipAt) + out0 + u * (out1 - out0);
  }
  return null;
}

export function remapClipCues(clip, sourceCues) {
  const events = [];
  for (const cue of sourceCues || []) {
    const t = outputTimeAt(clip.clock, cue.t, clip.at);
    if (t == null) continue;
    events.push({ ...cue, t: Number(t.toFixed(4)), sourceT: cue.t, clipId: clip.id, unitId: clip.unitId });
  }
  return events;
}
