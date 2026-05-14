---
name: Mobile-Debüt
description: Use when debugging the live site from a mobile or tablet browser where you can't open devtools. Documents the in-app log mirror (Settings → Debug), its consecutive-dedupe behaviour, and what each Debug-section button is for (Clear, Copy log, Copy build SHA, Screenshot, Copy / Save / Apply settings). Covers the workflow for capturing a reproducible bug report from a touch device.
---

# Mobile-Debüt — debugging the live site from a phone or tablet

Desktop browsers have devtools. Touch devices typically don't. The Settings → Debug section is engineered as a self-contained replacement for the most common devtools tasks you'd reach for during a bug hunt on the live site:

- read recent `console.log / .warn / .error` output;
- copy that output (with a build stamp) to share in a report;
- export the current `S.*` settings blob so the bug is reproducible elsewhere;
- import a settings blob to land in someone else's exact state;
- grab a screenshot for the same purpose.

This skill documents how those pieces work + the workflow for capturing a clean bug report from a touch device.

## 1. The Debug section, top to bottom

Open **Settings → Debug** (the gear icon, then expand the Debug `<details>` block).

### Toggles (top)

The three toggles at the top of the Debug section are HUD pills:

| Toggle | What it does |
|---|---|
| **Show FPS + renderer** | Top-left pill showing live FPS and the active renderer (`webgpu`, `webgl2`, `canvas2d`). 4 Hz update. |
| **Show build info** | Top-left pill showing the deployed `branch · sha · #run · codename · date`. Click it to copy the full SHA. Long branch names wrap to a second row. |
| **Show cell total** | Appends `· N cells` to the FPS pill — handy when sanity-checking population caps or split storms. |

These run on every renderer + every device — they're not part of the dev-only debug log.

### The in-app log mirror (mobile/tablet only)

`#debugLogView` is a `<pre>` element that mirrors every `console.log / info / warn / error / debug / trace` call into an in-page scrolling pane. It's **hidden by CSS on devices with a fine pointer + hover** (`@media (pointer: coarse) and (hover: none)` is the only place it shows up) — on desktop, devtools is the right tool. On phones and tablets, the in-app mirror is the only console you have.

**Consecutive-dedupe** is critical here. The buffer is capped at 200 entries; high-frequency repeats (e.g. WebGPU validation errors firing once per frame at ~60 Hz) would evict every other message in ~3 seconds without dedupe. So:

```js
const last = _debugLog[_debugLog.length - 1];
if (last && last.level === level && last.msg === msg) {
  last.count = (last.count || 1) + 1;
  last.t = Date.now();
} else {
  _debugLog.push({ t: Date.now(), level, msg, count: 1 });
  if (_debugLog.length > _DEBUG_LOG_MAX) _debugLog.shift();
}
```

Render shows ` (×N)` when `count > 1`. **One-shot init messages then survive arbitrary spam** — exactly what we need to capture a `[webgpu sceneFx-async]` rejection from a phone.

### Mobile-only log buttons (under the log)

These two only appear on touch devices (same `@media` rule as the log pane itself):

| Button | What it does |
|---|---|
| **Clear** | Empties `_debugLog`. Use before a reproduction run so the captured paste is just the relevant errors. |
| **Copy log** | Copies all log entries + a build stamp header to the clipboard. First line of the paste is always `build: main · <sha> · #<run> · <codename> · <date>` (so the reproducer knows which deploy the user was on). Each entry is `[hh:mm:ss.mmm] LEVEL message (×N)`. |

### Universal utility buttons (`.debug-actions`)

These show on every device:

| Button | What it does |
|---|---|
| **Copy build SHA** | Writes the full commit SHA to clipboard. Same effect as clicking the build pill, but reachable without enabling the pill. |
| **Screenshot** | Snapshots the canvas (PNG + JSON sidecar). The JSON sidecar carries the build stamp + active S.* keys + sim state. Filename is `microbes-<sha>-<timestamp>.png`. Useful for visual bug reports — paste the PNG and the JSON tells the receiver everything else. |
| **Copy settings** | `JSON.stringify(S, null, 2)` → clipboard. Reads from the live `S` (which `loadSettings()` already merged with `DEFAULTS`), so every known key is present even if the user never touched a slider. |
| **Save settings** | Same payload, downloaded as `microbes-settings-<short-sha>-<timestamp>.json`. Useful when the user can't paste into the receiving app but can attach a file. |
| **Apply settings** | Opens a paste dialog. Pasted JSON is parsed, filtered against `Object.keys(DEFAULTS)` (unknown keys are dropped with a `console.warn`), written to localStorage, then the page reloads to pick up the new state. The filter prevents an older export's renamed keys (`showObjectCount` → `showCellTotal`) or a stray field from corrupting `S`. |

## 2. Capturing a clean bug report from a phone

Workflow that produces the highest-fidelity reproducer:

1. **Reproduce the bug fresh.** Reload the page so the build stamp matches the run that hit the bug (cache may mask deploys; do a hard reload — usually "Reload" from the address-bar menu, NOT just pull-to-refresh).
2. **Settings → Debug → Clear** the log to start clean.
3. **Trigger the bug** — flip the toggle, draw the cells, whatever reproduces.
4. Wait a few seconds for any deferred validation / async pipeline rejection to land in the log.
5. **Settings → Debug → Copy log** — paste the clipboard contents into the bug report (works in any chat app, ticketing system, email).
6. **Settings → Debug → Copy settings** OR **Save settings** — also paste / attach. Now the receiver has both the runtime state AND the configuration that produced the bug.
7. Optional: **Screenshot** for visual bugs (renders the canvas + saves a JSON sidecar with the same metadata).

### Sample paste from a successful capture

```
build: main · 374df17 · #361 · cerise-lipid · 05-14 10:59
[09:00:36.187] INFO  [microbes] WebGPURenderer ready
[09:00:36.320] WARN  [webgpu sceneFx-shader] error at 80:21: 'textureSample' must only be called from uniform control flow
[09:00:36.320] WARN  [webgpu sceneFx-async] validation rejection: [Invalid ShaderModule "sceneFx"] is invalid due to a previous error.
[09:00:36.320] WARN  [webgpu-diag] validation error: [Invalid RenderPipeline "sceneFx"] is invalid due to a previous error. (×523)
[09:00:36.321] LOG   [webgpu-diag] px=rgba(0,0,0,0) chain=sceneFx kind=lava base=#0d0300 opacity=1 microscopeBlur=0 makeItReal=1 cs=1
```

The one-shot lines (shader error, async rejection, init readback) survive the spam thanks to dedupe — the `(×523)` collapses 523 frames of identical validation errors into one line.

## 3. Workflow for the receiver

When someone pastes a Copy-log block at you:

1. **First line** is the build stamp. Note the commit SHA — if it's older than `origin/main`, that bug may already be fixed; reproduce locally on that SHA before patching blind.
2. **Look for one-shot WARN lines** — they're usually the root cause. Repeated errors (`(×N)`) are typically derivative.
3. **Copy settings JSON** (if attached) → save to `/tmp/microbes-bug.json`. To reproduce in your own browser: open Settings → Debug → **Apply settings**, paste, reload. Now you're in the user's exact state.
4. **Screenshot JSON sidecar** carries the same shape; if you only have a screenshot, the sidecar tells you everything you need to write a test case.

## 4. Adding new debug functionality

When extending Settings → Debug:

- **In-app log:** any `console.*` call you add is already captured + deduped. Don't add a parallel logger.
- **New utility buttons** live in `.debug-actions` (always visible) and inherit the pill button style — `flex: 0 0 auto; padding: 6px 12px; background: #00000044; border: 1px solid var(--line); border-radius: 6px;`. The hover style picks up `var(--accent)`.
- **New log-only buttons** (clear, copy, etc.) live in `.debug-log-actions` (mobile-only via the `(pointer: coarse) and (hover: none)` media query).
- **Toasts** for confirmation feedback: `showToast(T('toast_…') || 'fallback')`. Use the same `toast_…` key in `i18n` for en + de minimum, others fall through to en.
- **New paste/import dialogs** follow the `applySettingsDialog` pattern: `.dialog.hidden` + `.dialog-backdrop` + `.dialog-panel`, registered in `allDialogs` for backdrop-click + escape support.

## 5. Reference PRs from this project

- **PR #240** — first cache-buster on `assets/build.js` (later superseded by inline injection in PR #242).
- **PR #242** — inline build stamp directly into `index.html` so the build pill always reflects the deployed sha.
- **PR #247** — initial `Dump settings` button.
- **PR #248** — split Dump into Copy / Save / Apply with a paste dialog.
- **PR #251** — `@media (pointer: coarse) and (hover: none)` gate on the log + log-only buttons.
- **PR #252** — Copy log prepends the build stamp as line 1.
- **PR #254** — Copy / Save read from live `S` (every DEFAULTS key included) + Apply filters against `Object.keys(DEFAULTS)`.
- **PR #256** — consecutive-dedupe in the log buffer (`(×N)` counter).
- **PR #257** — `webgpu-debugger` skill (reference for what the captured log lines mean and how to act on them).

## 6. Related skills

- `.claude/skills/webgl-debugger/SKILL.md` — when the bug is in WebGL2 specifically (feedback loops, sampler null-binding).
- `.claude/skills/webgpu-debugger/SKILL.md` — when the bug is in WebGPU specifically (pipeline validation, WGSL uniform-control-flow, async pipeline creation).

Use those when you're triaging a captured bug report and the in-app log surfaces a renderer-specific error. This skill is the **capture** workflow; those are the **act** workflows.
