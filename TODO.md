# TODO — open design questions

A scratchpad for design questions that aren't yet a numbered plan
file. Each item should either get closed (decision recorded), or
graduate to `.claude/plan/NN-*.md` once it's big enough to need a
proper plan.

---

## What should happen when `S.maxCells` is reached?

**Today (PR #136):** `spawnAtWorld` and `beginSplit` quietly evict
the **oldest** cell (front of the `cells` array) so the user's
action always succeeds. Auto-split (timer-driven, gated on
`S.randomSplit`) **defers** at the cap instead of churning. Default
cap is **511** (bumped down from 1024 in the same PR that added
the user-facing slider in Settings → Population).

The current behaviour is the safe default — never refuse a user
action — but "eat the oldest cell" has rough edges that we should
think about before committing to it forever.

### Options on the table

1. **Recycle oldest cell (current).**
   - ✅ User action never silently fails.
   - ✅ Cheap, no UI cost, no decision-fatigue.
   - ❌ Random destruction of presumably-loved entities. Especially
     painful with hero (good) cells, which have `Infinity` HP and
     would otherwise live forever.
   - ❌ Doesn't surface the cap at all — user wonders where their
     old cells went.

2. **Refuse spawn with a brief on-screen toast** (`"Max cells
   reached — kill or split some first"`).
   - ✅ User understands why nothing happened.
   - ❌ Action explicitly fails; user has to manage the population.
   - 👉 Could mix with (1): toast on every recycle so the user
     learns about the cap without being blocked.

3. **Evict the weakest first** (lowest HP fraction among pathogens;
   protect heroes).
   - ✅ Hero cells are durable, so the player's "team" isn't
     accidentally evicted.
   - ❌ Computing the weakest each spawn is O(n) — fine at 511 but
     scales poorly.
   - ❌ Still feels arbitrary to the user; hard to predict.

4. **Combat-driven population control** (auto-trigger a small
   damage burst across pathogens once the cap is hit).
   - ✅ Reads as "the immune system fights back" — narratively
     coherent.
   - ❌ Couples sim physics to capacity management; very magic.

5. **Hard cap with sim freeze** (pause auto-split, block spawn,
   keep existing cells alive).
   - ✅ Predictable, no destruction.
   - ❌ Game stops being responsive to "+" button without manual
     cleanup.

### Edges worth thinking about

- **Hero protection.** Heroes have `defaultHp == Infinity`. They
  shouldn't be recycled before pathogens. Currently we recycle
  whatever is at `cells[0]` regardless of category. Consider a
  two-pass eviction: pathogens first, heroes only if no pathogens.
- **Selection.** Recycled cell might be selected. We already
  `selectedCells.delete(c)` in `_recycleOldest`, but the
  composition HUD might briefly show a phantom counter.
- **Splitting-state cells.** Should we refuse to recycle a cell
  that's currently in `state === 'SPLITTING'`? Mid-split
  eviction breaks the metaball pair.
- **Auto-split deferral feels like a stall.** A pathogen that
  wants to split but can't accumulates `splitTimer` and might
  burst-split the instant the cap drops below. Smooth that out.
- **Visual feedback.** Should there be a subtle "evicted" puff at
  the location of the cell being removed? Currently silent.

### When to revisit

After we see how often users hit the cap with the new 511 default.
If the slider sits at 511 untouched in the wild and recycle-oldest
isn't reported as visually confusing, leave it. If the recycling
behaviour comes back as a complaint, pick from the options above.
