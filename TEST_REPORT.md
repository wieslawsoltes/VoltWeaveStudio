# Verification report

Release: **VoltWeave Studio 1.0.0**  
Verification date: **2026-09-06**

## Automated core and Worker tests

`npm test` completed with **58 passed, 0 failed, 0 skipped**. The suite runs with Node’s built-in test runner and has no package dependencies. The final release copy was also syntax-checked with `npm run check` across 15 JavaScript modules.

The suite covers all example projects, typed terminal validation, required inputs, single-driver enforcement, explicit feedback versus combinational cycles, fixed simulation time, per-instance seeded noise, exact recorded-input replay, snapshot restoration, atomic state rollback, pure-node caching, For/While/Case behavior, nested call-state isolation, recursion rejection, SubVI extraction, FFT amplitude/frequency, finite values, array immutability, timestamp-sensitive conversions, resource limits, JSON project round trips, undo/redo, ring-buffer behavior and spike-preserving decimation.

Eight tests specifically launch the **unchanged ES-module browser worker through Node worker_threads** using a small host adapter. They verify two-credit backpressure, buffer transfer without detaching VM arrays, pause/stop/reset, before-node breakpoints, nested generator stepping, partial-transaction cancellation, recorded controls with exact output replay, stale revision rejection and malformed recording rejection.

Prototype-sensitive identifier rejection, own-property type validation and nested-control namespace isolation have dedicated regression tests.

## Browser integration

`tests/browser_smoke.py --standalone` completed with **16 passing workflow checks** and **zero uncaught browser page exceptions**.

The tests operate real browser controls and mouse/keyboard gestures to check startup/acquisition, waveform amplitude changes, pause and single tick, graph dragging with undo/redo, compatible/incompatible wiring, breakpoints and node step, palette insertion/deletion, front-panel dragging/resizing/undo, arrays and executable loop/case bodies, nested diagram navigation, recording/replay, project file import round trip, PID feedback/reset, split view and help.

Screenshots in `verification/` were captured from that running application. Waveforms, readouts, arrays and probe values are runtime outputs, not pre-rendered fixtures.

## Verification boundaries

The container’s Chromium installation blocks ordinary URL navigation through its administrative policy. That policy was left in place. Browser integration was tested by supplying the generated standalone document directly through Playwright `set_content()`.

That synthetic document has an opaque, non-secure origin. Consequently, its `navigator.gpu` was unavailable, native localStorage access was denied, and an ES-module Blob Worker could not be launched there. The standalone distribution uses a bundled **real classic Worker**, which successfully executed the same VM during every browser workflow. The normal modular source retains its ES-module Worker.

Therefore:

- **Verified:** deterministic compiler/runtime behavior; actual Node worker transport; actual classic browser Worker execution; Canvas2D rendering; the listed browser editing/debug/replay workflows; project JSON export/import semantics; static server MIME responses.
- **Implemented but not browser-verified here:** secure-origin WebGPU canvas rendering, device-loss recovery, the served ES-module Worker launch, and native localStorage persistence across page reloads.
- **Not benchmarked/certified:** physical GPU performance, large-project scale, sustained multi-hour acquisition, memory pressure at maximum limits, cross-engine bitwise equivalence, mobile/touch ergonomics, accessibility conformance, hard-real-time behavior, or real hardware instrumentation.

The WebGPU implementation is present in `src/gpu.js`: actual device/pipeline/resource creation, WGSL vertex/fragment stages, persistent streaming buffers, render-pass encoding, and queue submission. Its existence is not being substituted for a claim that its GPU path was exercised. The status bar reports the backend actually selected.

The localStorage warning in the saved browser results is expected for the synthetic test origin. It is not an uncaught application exception. Explicit project import/export was exercised independently of browser storage.

## Reproduction

```sh
npm test
npm run check
python3 tools/standalone.py
python3 tests/browser_smoke.py --standalone --chromium /path/to/chromium
```

On a normal development machine, also run the served modular browser path:

```sh
# Terminal 1
npm start

# Terminal 2
python3 tests/browser_smoke.py --url http://localhost:8080 --chromium /path/to/chromium
```

Use a browser/platform exposing WebGPU and inspect the status bar, browser console, scopes and diagram view to validate the GPU backend. No result for that unperformed verification is claimed in this release.
