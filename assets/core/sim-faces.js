// Mouth-kind resolution for the cartoon-face renderers. Priority:
//   1. mouthFlashKind during an active mouthFlashTimer window
//      (event-driven — set by sim.js on fire/damage, decays over
//      ~0.3-0.4 s).
//   2. Pursuit state — while alarmTimer > 0 with a live target.
//   3. Static fallback from the FACE table per cell type.
import { FACE } from './state.js';

export function effectiveMouthKind(c) {
  if (!c) return 'smile';
  if (c.mouthFlashTimer > 0 && c.mouthFlashKind) return c.mouthFlashKind;
  if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') return 'snarl';
  return (FACE[c.type] && FACE[c.type].mouth) || 'smile';
}
