# Algorithms

Engineering notes for non-obvious algorithms in the codebase. Each
section starts with the user-visible problem, then the concrete
algorithm, then complexity / trade-offs.

---

## Edge-anchored navigation arrows: clustering

### Problem

When `S.navMode === 'anchored'`, every off-screen cell is shown as a
small arrow projected onto the screen rectangle at its **exit point**
(the spot where a ray from the screen centre through the cell crosses
the screen edge). The arrow slides along the edge as the cell moves
through the world.

With a small simulation that works fine. But the sim can hold
hundreds of cells, and many of them tend to bunch up behind the same
edge (e.g. a wave of pathogens flooding from the right). Drawing one
arrow per cell quickly turns the edge into a solid bar of overlapping
glyphs.

We need to **merge crowded arrows into clusters**, with a count badge
showing how many cells are inside the cluster — but cheaply, every
frame-loop tick, and stably enough that the cluster boundaries don't
flicker on small camera moves.

### Algorithm: 1D greedy threshold clustering on the perimeter

The screen rectangle perimeter is a 1D loop. We collapse the 2D
clustering problem to 1D by parameterising it.

#### 1. Parameterise the perimeter

For a viewport `W × H`, define an arc-length parameter
`s ∈ [0, 2(W + H))` running **clockwise from the top-left corner**:

```
edge       parameter range          (x, y) on edge
─────────────────────────────────────────────────────
top        [0,        W)            (s, 0)
right      [W,        W+H)          (W, s − W)
bottom     [W+H,      2W+H)         (W − (s − W − H), H)
left       [2W+H,     2W+2H)        (0, H − (s − 2W − H))
```

`perimeterParam(edge, x, y, W, H)` maps an edge intersection to `s`;
`perimeterPoint(s, W, H)` is its inverse. At each corner the two
incident edges agree on `s`, so the parameter is continuous.

#### 2. Project + bucket each cell

For every off-screen cell:

1. Cast a ray from the screen centre `(W/2, H/2)` through the cell's
   projected screen position `(s.x, s.y)`.
2. Solve for the smallest positive `t` such that the ray hits one of
   the four edges of `[0, W] × [0, H]`. That edge is the
   **exit edge**; the hit point is the cell's perimeter anchor.
3. Convert `(edge, x, y)` to a 1D `s` via `perimeterParam`.
4. Tag with `cat = good | bad` (from `CELL_TYPES[type].category`).

This is **O(n)** per tick for `n` off-screen cells, with a few
divisions per cell.

#### 3. Sort by `s`

`Array.sort` — **O(n log n)**. The constant is small in practice
because Tim-sort exploits the temporal coherence between frames (the
input order changes slowly).

#### 4. Greedy linear-scan cluster

Walk the sorted list left to right. Open a new cluster whenever the
gap from the previous item exceeds `CLUSTER_GAP_PX` (≈ 60 px); any
item inside that radius joins the current cluster.

```text
clusters = []
for item in items sorted by s:
    if clusters and item.s − clusters[-1].lastS < CLUSTER_GAP_PX:
        clusters[-1].extend(item)          # join
    else:
        clusters.append(new Cluster(item)) # open
```

Each cluster carries:

| field    | meaning                                              |
|----------|------------------------------------------------------|
| `count`  | number of cells merged                               |
| `good`   | good-category cells                                  |
| `bad`    | bad-category (pathogen) cells                        |
| `sumS`   | running sum of `s` (for mean position computation)   |
| `lastS`  | `s` of the most-recently-joined item                 |

This is **single-linkage agglomerative clustering with a fixed cutoff
distance** — but because the input is 1D and sorted, the dendrogram
collapses to a single left-to-right sweep. **O(n)** after the sort.

#### 5. Wrap-around merge

The perimeter is a loop, but `sort()` + greedy-scan treats it as an
open interval. If the first and last clusters straddle `s = 0` (the
top-left corner), the "short way" gap from `last.mean` round to
`first.mean` may itself be below `CLUSTER_GAP_PX`. After the main
pass we check for that and merge them, treating one mean as
negative-side:

```text
wrapGap = (perim − last.mean) + first.mean
if wrapGap < CLUSTER_GAP_PX:
    merged.sumS = first.sumS + (last.sumS − perim * last.count)
```

The negative-side trick keeps the cluster's mean continuous across
the seam.

#### 6. Render

For each cluster:

* Position = `perimeterPoint(sumS / count, W, H)` (the cluster's mean
  perimeter parameter, mapped back to a screen pixel + edge tag).
* Inset by 8 px from the edge so the arrow doesn't graze the chrome.
* Rotate to point outward (0° / 90° / 180° / −90° for top / right /
  bottom / left).
* Hue lerps red↔green by `good / total` (matches the floating-mode
  mapping).
* Saturation lerps 50 % → 100 % over `total ∈ [1, 32]`.
* Size lerps 18 × 14 → 44 × 32 px over the same range.
* If `count > 1`, show a numeric badge above the tip.

### Complexity

| pass                 | per tick                |
|----------------------|-------------------------|
| project + bucket     | **O(n)** (n = off-screen cells) |
| sort by `s`          | **O(n log n)**          |
| greedy linear scan   | **O(n)**                |
| render (k clusters)  | **O(k)**                |

Total **O(n log n)** with small constants — comfortable at the
4 Hz update rate already used for the nav-arrows tick.

### Why this and not …

* **K-means / DBSCAN in 2D.** Overkill. Cells are constrained to a
  closed 1D loop after projection — we'd be discarding free
  structure. K-means also needs a fixed `k` (we don't know it in
  advance) or repeated runs; DBSCAN's neighbour queries cost
  more than a sorted sweep.
* **Fixed-bin bucketing** (divide the perimeter into K equal bins,
  count cells per bin). Cheaper and **O(n)**, but the cluster
  positions snap to bin centres → an arrow visibly jumps in
  CLUSTER_GAP_PX-sized steps when a cell crosses a bin boundary.
  The greedy-threshold variant tracks the actual cluster centroid
  smoothly.
* **Quadtree / grid index for 2D neighbour queries.** Useful when
  the clustering is in 2D screen space, but post-projection the
  problem is 1D and a sort dominates anyway.
* **Force-based de-congestion** (place arrows at their exact
  projected positions, then iteratively push overlapping arrows
  apart). Visually smooth but stateful, non-deterministic, and
  costs more per frame. Hard to communicate the cell count to the
  user without a badge anyway — and the badge undoes most of the
  visual benefit of nudging the icons.

### Hysteresis / temporal stability — Schmitt-trigger pass

The greedy threshold pass on its own is **memoryless**: each tick
re-computes clusters from scratch. A cell sitting right at the
`CLUSTER_GAP_PX` boundary can flip between "joining the cluster" and
"being its own cluster" as it drifts a few pixels per tick. The
result on screen is a one-cell cluster appearing and vanishing at
4 Hz next to its neighbour.

To suppress that we run a **Schmitt-trigger pass** after the greedy
clustering and the wrap-around merge:

1. Carry over `prevAnchoredCentroids` — the mean `s` of every
   cluster produced last tick.
2. For each new cluster compute its mean `s` and find the nearest
   previous centroid within `CLUSTER_GAP_PX`. Record that as the
   "ancestor index" (or −1 for no ancestor).
3. Walk adjacent cluster pairs `(clusters[i-1], clusters[i])` from
   right to left. If both share the same ancestor *and* their gap
   is below the wider `SPLIT_GAP_PX = 1.5 × CLUSTER_GAP_PX`, re-merge
   them. Use right-to-left order so `splice()` doesn't invalidate
   the indices we still need to visit.
4. Persist the post-merge centroids as the next tick's
   `prevAnchoredCentroids`.

The two thresholds form the classic Schmitt-trigger pair: the
**merge threshold** decides when two items belong together this
tick (greedy pass, `CLUSTER_GAP_PX`), and the **split threshold**
decides when an *existing* pair has separated enough to actually
break (`SPLIT_GAP_PX`). Between them is a stable band where the
cluster's previous decision carries forward, which is exactly the
behaviour we want for cells dithering across the threshold.

Edge cases handled:

* **First tick / mode toggle.** `prevAnchoredCentroids` is `null`
  before any cluster has been produced, and `_hideAnchored` resets
  it to `null` when the user switches off anchored mode. The first
  tick after either event falls back to the greedy result with no
  hysteresis applied.
* **Cluster count drops or grows.** Centroids that no longer have a
  nearby new cluster simply don't influence anything — they age out
  in a single tick. New clusters with no ancestor (-1) are not
  candidates for hysteresis-merge, so they enter the system at full
  greedy resolution.

State carried across ticks is one `number[]` of cluster centroids —
typically ≤ a dozen entries.

### Tuning knobs (in `assets/ui/nav-arrows.js`)

| constant            | value | effect                                       |
|---------------------|-------|----------------------------------------------|
| `CLUSTER_GAP_PX`    | 60    | bigger → fewer, larger clusters              |
| `SPLIT_GAP_PX`      | 90    | bigger → wider hysteresis band (slower splits) |
| `EDGE_INSET_PX`     | 8     | distance from the actual screen edge         |
| `ANCHORED_POOL_MIN` | 4     | initial DOM-element pool size (grows on demand) |

The size & colour mappings reuse the same `[1 → 32]` ramps as the
floating mode so both modes feel consistent to the player.
