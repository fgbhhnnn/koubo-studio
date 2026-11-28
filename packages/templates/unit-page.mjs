/**
 * OpenFilm scene page for one bound classic-performance unit.
 * The page exposes window.film.frame(t) on the clip's output clock; mapSource
 * warps that onto the authored choreography clock (speech-aligned at assign
 * time). Talk audio stays on the film timeline, never in this page.
 */
import { PACK_PLAIN_TEXT_RUNTIME } from './bind-unit.mjs';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(value) {
  return JSON.stringify(value);
}

/**
 * @param {{
 *   clip: object,
 *   talkRel?: string,
 *   seqMedia?: Record<string, string>,
 *   boundScript: string,
 *   faceTrack?: object | null,
 * }} opts
 */
export function renderUnitPage(opts) {
  const clip = opts.clip;
  const duration = Number(clip.duration);
  const at = Number(clip.at) || 0;
  const sourceEnd = Number(clip.sourceEnd);
  const talkRel = opts.talkRel || '';
  const seqMedia = opts.seqMedia || {};
  const boundScript = opts.boundScript;
  const clock = clip.clock || { segments: [] };
  const faceTrack = opts.faceTrack || null;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<title>${escapeHtml(clip.id || 'unit')}</title>
<link rel="stylesheet" href="classic-runtime/style.css">
</head>
<body>
<div id="world"></div>
<div id="fx"></div>
<script src="classic-runtime/config.js"></script>
<script>
window.CONFIG = Object.assign(window.CONFIG || {}, {
  hideOfficialBadge: true,
  showOfficialBadge: false,
  brand: '',
  account: '',
  repoUrl: '',
  end: ${JSON.stringify(sourceEnd)},
  talkFrames: 0,
  filmTalkSrc: ${escapeJs(talkRel)},
  filmTalkOffset: ${JSON.stringify(at)},
  seqMedia: ${escapeJs(seqMedia)},
  kouboFace: ${escapeJs(faceTrack)}
});
</script>
<script src="classic-runtime/lib.js"></script>
<script src="classic-runtime/motion.js"></script>
<script>
${PACK_PLAIN_TEXT_RUNTIME}
</script>
<script>
${boundScript}
</script>
<script src="classic-runtime/main.js"></script>
<script>
const CLOCK = ${escapeJs(clock)};
function mapSource(t) {
  const segs = CLOCK.segments || [];
  if (!segs.length) return (CLOCK.sourceStart || 0) + Math.max(0, t);
  for (const seg of segs) {
    if (t <= seg.out1 + 1e-9) {
      if (seg.hold || seg.out1 - seg.out0 < 1e-9) return seg.src0;
      const u = (t - seg.out0) / (seg.out1 - seg.out0);
      return seg.src0 + u * (seg.src1 - seg.src0);
    }
  }
  const last = segs[segs.length - 1];
  return last.hold ? last.src0 : last.src1;
}
function syncTalk(filmT) {
  const src = window.CONFIG && window.CONFIG.filmTalkSrc;
  if (!src) return;
  document.querySelectorAll('.cam').forEach((cam) => {
    const box = cam.classList.contains('cam') ? cam : (cam.querySelector('.cam') || cam.firstElementChild || cam);
    let v = box.querySelector('video.talk-live');
    if (!v) {
      v = document.createElement('video');
      v.className = 'talk-live';
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      /* none until this page is actually framed: a film of many unit pages must
         not open a talk decoder in every iframe as the first frame is drawn */
      v.preload = 'none';
      v.src = src;
      box.appendChild(v);
      const img = box.querySelector('img');
      if (img) img.style.opacity = '0';
    }
    if (Number.isFinite(filmT)) {
      const next = Math.max(0, filmT);
      if (Math.abs((v.currentTime || 0) - next) > 0.08) {
        try { v.currentTime = next; } catch { /* seek before metadata */ }
      }
    }
  });
}
function whenReady() {
  const render = window.renderAt;
  const wait = window.imgWait;
  window.film = {
    duration: ${JSON.stringify(duration)},
    width: 1920,
    height: 1080,
    frame(t) {
      const filmT = (window.CONFIG.filmTalkOffset || 0) + t;
      window.CONFIG.filmTime = filmT;
      const srcT = mapSource(t);
      if (typeof render === 'function') render(srcT);
      syncTalk(filmT);
      if (typeof wait === 'function') return wait();
    }
  };
}
if (window.READY && typeof window.READY.then === 'function') {
  window.READY.then(whenReady);
} else {
  whenReady();
}
</script>
</body>
</html>
`;
}
