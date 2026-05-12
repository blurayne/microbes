// Visual-test rig for cell renderer ports.
//
// The harness drives docs/cell-zoo.html (one iframe per
// cell × theme × renderer combo) and pixel-diffs each frame
// against a baseline committed to tests/visual/baselines/.
//
// Tolerances differ per renderer: WebGPU on Linux CI uses
// SwiftShader (Vulkan over llvmpipe) which drifts a few pixels
// frame to frame; WebGL2 + canvas2d are mostly deterministic.

import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PW_PORT ? Number(process.env.PW_PORT) : 8753;

export default defineConfig({
  testDir: './tests/visual',
  // Each cell-iframe gets a couple of seconds to boot, init the
  // renderer, settle into pose. CI is sometimes slow; default 30 s
  // per test is fine but each `expect` poll is short.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Parallel across spec files; per-file serial inside (the harness
  // navigates the same page).
  fullyParallel: false,
  // Treat missing baselines as "create new snapshot" the first
  // time, fail-on-diff after that. This lets per-cell PRs grow the
  // baseline set incrementally without a separate bootstrap PR.
  // Override with `playwright test --update-snapshots` to refresh.
  updateSnapshots: 'missing',
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Bigger viewport so each iframe in cell-zoo.html has room.
    viewport: { width: 1280, height: 800 },
    // Trace on failure so the diff images come back in artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Boots a Python http.server (already in `npm run serve`) so the
  // ES modules + relative iframe srcs (`../index.html?...`) resolve.
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
