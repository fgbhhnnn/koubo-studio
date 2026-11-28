/**
 * Pack-clock reveal times for classic-performance typography slots.
 *
 * Derived from the MIT unit scripts (hash-checked) — not a redistributed
 * MotionGit pack. Times are the source-choreography instants when that
 * slot's text is first shown (and optionally hidden).
 */
export const SLOT_REVEALS = {
  'claim-into-container': {
    sourceBlockSha256: '6dda3cacea9d11239f594807c4c7abdb8c5a202f22a21918062f0bc26b2da577',
    slots: [
      { id: 'text-01', src: 0, hide: 3.3, group: 'opening' },
      { id: 'text-02', src: 0, hide: 3.3, group: 'opening' },
      { id: 'text-03', src: 2.033, hide: 3.3 },
      { id: 'text-04', src: 3.56, hide: 8.3 },
      { id: 'text-05', src: 4.52, hide: 10.88, kind: 'label' },
      { id: 'text-06', src: 4.52, hide: 10.88 },
      { id: 'text-07', src: 4.52, hide: 10.88 },
      { id: 'text-08', src: 9.566, hide: 10.88, kind: 'label' },
      { id: 'text-09', src: 5.93, hide: 9.65 },
      { id: 'text-10', src: 6.28, hide: 9.685 },
      { id: 'text-11', src: 6.63, hide: 9.72 },
      { id: 'text-12', src: 8.566, hide: 10.85 },
      { id: 'text-13', src: 10.13, hide: 10.85 },
      { id: 'text-14', src: 11.15, kind: 'label' },
      { id: 'text-15', src: 11.22 },
      { id: 'text-16', src: 13.133 },
      { id: 'text-17', src: 14.2 },
    ],
  },
  'decompose-and-consolidate': {
    sourceBlockSha256: '3e002508e96c802c7c7a25f96fb088f1f4db3e84767ac62846118ef58928874f',
    slots: [
      { id: 'text-01', src: 84.3, kind: 'label' },
      { id: 'text-02', src: 84.43, hide: 89.8 },
      { id: 'text-03', src: 86.533, hide: 89.8 },
      { id: 'text-04', src: 87.933, hide: 89.8 },
      { id: 'text-05', src: 89.966, hide: 94.55 },
      { id: 'text-06', src: 94.7 },
      { id: 'text-07', src: 90.1, hide: 95.0 },
      { id: 'text-08', src: 90.1, hide: 95.0 },
      { id: 'text-09', src: 90.45, hide: 95.5, derived: true },
      { id: 'text-10', src: 90.8, hide: 96.0, derived: true },
      { id: 'text-14', src: 96.2, hide: 100.0 },
      { id: 'text-15', src: 96.7, hide: 100.0, derived: true },
      { id: 'text-16', src: 97.2, hide: 100.0, derived: true },
      { id: 'text-11', src: 98.5 },
      { id: 'text-12', src: 98.5 },
      { id: 'text-13', src: 98.5 },
      { id: 'text-17', src: 99.4 },
    ],
  },
  'evidence-focus': {
    sourceBlockSha256: '2e0ac04a41d46a55354af09c183d515ceaa7e59657b773bdeaedb72efb6f2678',
    slots: [
      { id: 'text-01', src: 68.64, hide: 74.7 },
      { id: 'text-03', src: 69.2, hide: 74.966 },
      { id: 'text-07', src: 71.166, hide: 78.133 },
      { id: 'text-08', src: 72.9, hide: 79.35 },
      { id: 'text-02', src: 74.966 },
      { id: 'text-09', src: 74.966, hide: 80.166 },
      { id: 'text-11', src: 74.966 },
      { id: 'text-04', src: 78.133 },
      { id: 'text-05', src: 79.35 },
      { id: 'text-06', src: 80.166 },
      { id: 'text-10', src: 82.266 },
    ],
  },
};

export function slotRevealsFor(scene) {
  const entry = SLOT_REVEALS[scene?.id];
  if (!entry) return [];
  return entry.slots;
}

/**
 * Confirm reviewed reveal metadata still matches the authored unit block.
 * Throws when the source hash or a source-time literal is gone.
 */
export function assertSlotReveals(scene, sourceBlock) {
  const entry = SLOT_REVEALS[scene?.id];
  if (!entry) throw new Error(`${scene?.id}: no reviewed typography reveals`);
  if (scene.sourceBlockSha256 && entry.sourceBlockSha256 !== scene.sourceBlockSha256) {
    throw new Error(`${scene.id}: slot reveal table is stale (manifest hash changed)`);
  }
  const text = String(sourceBlock ?? '');
  for (const slot of entry.slots) {
    if (slot.derived || Number(slot.src) === 0) continue;
    const src = Number(slot.src);
    const forms = uniqueTimeForms(src);
    const found = forms.some((f) => text.includes(f));
    if (!found) {
      throw new Error(`${scene.id}.${slot.id}: pack time ${src} is not in the source block`);
    }
  }
}

function uniqueTimeForms(n) {
  const forms = new Set();
  const raw = String(n);
  forms.add(raw);
  if (Number.isInteger(n)) {
    forms.add(String(n));
    forms.add(`${n}.`);
    forms.add(`${n}.0`);
  } else {
    forms.add(n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
    forms.add(n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    forms.add(String(n));
  }
  return [...forms].filter(Boolean);
}
