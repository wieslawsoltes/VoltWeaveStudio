# VoltWeave Studio

**A working, local-first graphical programming workbench for virtual instrumentation.**

VoltWeave pairs a LabVIEW-inspired front panel with an executable typed block diagram. The controls, measurements, plots, probes, and debugger operate on the same live program. This is an independent implementation with original branding and assets, not a binary-compatible replacement for NI LabVIEW.

The application uses plain HTML, CSS, and JavaScript. There is no UI framework, package installation, CDN dependency, telemetry, or build step. WebGPU renders diagram wires and instrument traces when available. A clearly identified Canvas2D backend keeps the application usable without it. Numerical execution runs in a dedicated Worker using Float64 values; GPU availability does not affect simulation results.

## Start

Install Node.js 20 or newer, extract the archive, and run from its directory:

```sh
cd voltweave-studio
npm start
```

Open **http://localhost:8080**. The Signal Integrity Bench starts acquiring automatically. Stop the server with Ctrl+C.

To choose another port:

```sh
# macOS / Linux
PORT=4173 npm start

# Windows PowerShell
$env:PORT=4173; npm start
```

A generic static server also works:

```sh
python3 -m http.server 8080
```

Serve the modular application over localhost or HTTPS, rather than opening `index.html` through `file://`. Module Workers and WebGPU are subject to browser origin/security requirements. The app displays the selected renderer instead of pretending that fallback rendering is GPU-accelerated.

### Single-file edition

`VoltWeave-Standalone.html` contains the entire app, CSS, native data-URL ES modules, and a bundled classic Worker. It has no network dependencies and uses the same compiler/runtime. Serving it over localhost or HTTPS is recommended; file-opening policies vary by browser. This supplementary edition is useful for portability, not a replacement for the readable modular source.

Regenerate it after source changes with Python 3:

```sh
python3 tools/standalone.py
```

On Windows, `python` can be used instead of `python3`.

## First five minutes

The initial front panel contains a dual-channel acquisition scope, two knobs, a cutoff slider, calibrated RMS/peak/frequency meters, an over-range LED, an amplitude spectrum, and an RC response chart. Change **Amplitude** or **Frequency** and watch the actual generated waveform change. **Fit workspace** fits the complete panel; clicking it again returns to width-fit.

Open **Block Diagram** or press **Ctrl+E**. The displayed graph is the program driving the panel. Click an output terminal and then a compatible input, or drag between them. Changing a connection recompiles the document and pauses the instrument. Press **F5** to run the modified program. Click a block for editable parameters and unwired input defaults in Properties.

Double-click a wire to add a live probe. Toggle a block’s breakpoint dot, then run. **F6** executes one operator, including operators inside nested diagrams. **F10** completes a tick, unless another breakpoint is encountered. The highlighted block and live Properties values show the actual paused execution state.

Unlock **Layout mode** to move widget headers and resize their lower-right handles. Select a widget to change its typed source binding, units, precision, or geometry. Layout changes do not restart the VM. **Ctrl+Z** and **Ctrl+Shift+Z** undo and redo document edits; undoing or redoing reloads the VM at tick zero.

Use **File → Structures & Array Laboratory** to operate real For/While/Case bodies and arrays. Double-click a structure to open its nested diagram. **File → Closed-loop Control Bench** demonstrates a PID controller, integrator, and explicit delayed feedback.

## What is implemented

| Area | Working implementation |
|---|---|
| Diagram editor | Typed terminal wiring and fan-out, one-driver input replacement, node dragging, multi-selection, rubber-band selection, pan/zoom/fit, contextual actions, clipboard operations, function search and insertion, auto-arrange, deletion. |
| Typed programs | Five value types, validation, stable dependency scheduling, required-input and missing-terminal diagnostics, combinational-cycle rejection, typed SubVI interfaces, explicit delayed feedback. |
| Numeric and array operations | Arithmetic, scalar math, comparison and logic, clamp/select, array construction/indexing/mapping/sorting/concatenation/statistics, scalar formatting, array/waveform conversion. |
| Structures | For with carried value and auto-indexed results; bounded While with Boolean continuation; lazy Case; reusable SubVIs; extraction of selected processing blocks into a typed callable graph. |
| Front panel | Twelve widget kinds: knobs, sliders, numeric controls, Boolean switches, array editors, numeric meters, analog gauges, LEDs, waveform charts, oscilloscopes, arrays, text indicators. |
| Signals/instruments | Phase-continuous waveform generation, deterministic white noise, waveform mixing/gain, cascaded low-pass filtering, RMS/peak/mean, amplitude FFT, simulated RC circuit with current/temperature/overload, PID, integration and differentiation. |
| Scopes/charts | Two channels, bounded history, spike-preserving min/max display decimation, hold, auto vertical range, configurable timebase, rising-edge auto trigger, two cursors, visible-sample CSV export. |
| Debugging | Before-node breakpoints, nested node stepping, tick stepping, execution highlighting, wire probes, operator trace, compilation/runtime diagnostics with graph/node context. |
| Execution | Dedicated Worker, fixed simulation clock, per-instance PRNG and state, transactional tick commits, pure-node memoization, cooperative cancellation, two-credit frame transport, document revision isolation. |
| Replay | Capture from tick zero, project/seed/input recording, JSON recording export/import, deterministic replay, live-input exclusion during replay, up to 20,000 recorded ticks. |
| Persistence | Versioned `.vwx` JSON projects, localStorage autosave when permitted, explicit import/export, 80-entry undo/redo, typed IR export, runtime snapshot export. |

The function library contains **47 operators**. See [OPERATORS.md](OPERATORS.md) for exact inputs, outputs, parameters, and purity flags.

## Examples

| Project | What to try |
|---|---|
| `examples/signal.vwx` | Oscillator → noise mixer → filter → scope/analysis/RC instrument. Change frequency, amplitude, cutoff, or the calibration SubVI. |
| `examples/structures.vwx` | Set iteration count to 5: For returns `10` and `[0, 1, 3, 6, 10]`. True Case doubles it; False Case negates it. While halves 64 until its value is at most 0.01. |
| `examples/feedback.vwx` | Step the setpoint while the PID controls an integrated plant. The feedback node exposes the previously committed value. |

The File menu loads the same examples without importing a file. A blank project is also available and includes editable example SubVI bodies.

## Keyboard reference

| Shortcut | Action |
|---|---|
| F5 / Shift+F5 | Run / cancel and reset |
| F6 | Step into one actual operator |
| F10 or Ctrl+R | Run one tick |
| Ctrl+E | Switch front panel / block diagram |
| Tab | Function/control insertion palette |
| F | Fit current workspace |
| Space+drag or middle-drag | Pan diagram |
| Mouse wheel | Zoom diagram at pointer |
| P / B | Toggle selected wire probe / selected block breakpoint |
| Ctrl+G | Extract selected processing blocks into a SubVI |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste / duplicate |
| Ctrl+S / Ctrl+O / Ctrl+N | Export / open / new project |
| Delete / Escape | Delete selection / cancel gesture or close dialog |
| F1 | Embedded workflow guide |

Command is accepted in place of Control on macOS. Text-input shortcuts retain their usual editing behavior.

## Core engine API

The compiler and VM have no DOM, Worker, GPU, or Node-specific dependency. They can run in a headless test or be embedded in another host:

```js
import { signalDemo } from './src/demo.js';
import { compileProject } from './src/graph.js';
import { Engine } from './src/runtime.js';

const project = signalDemo();
const ir = compileProject(project); // Throws CompileError with diagnostics.
console.log(ir.nodeCount, ir.plans.get(project.root).instructions.map(i => i.id));

const engine = new Engine(project);
for (let tick = 0; tick < 32; tick++) {
    const frame = engine.tick({ frequency: 128, amplitude: 2 });
    const waveform = frame.values['main/filter'].wave;
    const calibratedRms = frame.values['main/calibrate'].value;
    console.log(frame.tick, frame.time, waveform.samples.length, calibratedRms);
}

const snapshot = engine.snapshot();
const expected = engine.tick();
engine.restore(snapshot);
const reproduced = engine.tick();
// Same project, state, inputs, and JS engine => identical sample values.
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing execution semantics or adding operators. Treat a compiled Engine’s project as immutable; create a new Engine when the program changes.

## Verify

```sh
npm test
npm run check
```

No packages need to be installed for either command. The supplied core/Worker suite contains **58 passing tests**, including execution semantics, wire/type validation, loop behavior, exact replay, transactional cancellation, buffer ownership, breakpoints, and backpressure.

Optional end-to-end testing requires Python Playwright and a Chromium browser. The test itself is not an application dependency:

```sh
# Serve the app with npm start in a separate terminal first.
python3 tests/browser_smoke.py --url http://localhost:8080 --chromium /path/to/chromium

# Synthetic-document mode for isolated, navigation-restricted environments:
python3 tests/browser_smoke.py --standalone --chromium /path/to/chromium
```

The delivered build passed **16 browser workflow checks** with no uncaught page exceptions. Those checks ran the standalone edition with a real classic Worker and Canvas2D fallback. The secure-origin WebGPU canvas path and the served ES-module Worker path were not browser-tested in this environment; the unchanged module Worker was separately exercised through Node worker_threads. See [TEST_REPORT.md](TEST_REPORT.md) for precise verification boundaries.

## Important boundaries

This release provides the executable workbench described above, not the complete commercial LabVIEW ecosystem. It does **not** read native binary `.vi` files, run NI-generated code, load native drivers, connect physical DAQ/VISA/GPIB hardware, support arbitrary user JavaScript/WGSL operators, or reproduce every NI datatype, toolkit, and structure. Nested structures are edited as separate body diagrams rather than inline resizable LabVIEW frames. No NI assets or proprietary runtime are included.

Numeric simulation is worker-based CPU Float64, not GPU compute. WebGPU is the rendering backend. No physical-GPU performance benchmark or large-project scalability benchmark is claimed. The UI also uses HTML/SVG for accessible controls, text, node hit targets, and some instrument chrome.

A browser Worker is not a hard-real-time or safety-certified execution target. The simulated RC/PID instruments are illustrative deterministic models, not validated electronics/measurement products. Waveform generators are not band-limited; discontinuous waveforms can alias. The FFT reports amplitude rather than power or spectral density.

Replay is exact within the same JavaScript engine and identical inputs. Cross-engine transcendental functions are not promised bit-identical. Pure-node caching currently benefits unchanged scalars and retained immutable references; newly allocated equal-content arrays are not content-hashed. State is reset on program recompilation, with no live state migration between edited graph versions. History records the document, not historical VM state. Runtime snapshots are exportable for inspection, while restoration is currently exposed only through the headless Engine API.

Projects are saved in this origin’s localStorage when available. Export `.vwx` files for portable backups. Browser privacy settings, storage quotas, and file-origin policies may prevent autosave; the UI reports that condition. Recordings are in-memory until explicitly exported. Opening another example preserves the prior document in undo history but does not preserve its live simulation state.

## References and license

The architecture is original. The familiar dataflow workflow follows the public idea that a node executes after its required inputs are available. Background references are the [NI dataflow documentation](https://www.ni.com/docs/en-US/bundle/labview/page/block-diagram-data-flow.html) and the [W3C WebGPU specification](https://www.w3.org/TR/webgpu/).

MIT license; see [LICENSE](LICENSE). NI and LabVIEW are names of their respective owners. VoltWeave Studio is not affiliated with or endorsed by NI.
