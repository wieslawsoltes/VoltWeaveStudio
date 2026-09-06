# VoltWeave Studio — engine and editor architecture

## 1. Module boundaries

| Module | Responsibility |
|---|---|
| `types.js` | Value-type definitions, the 47-operator registry, parameter metadata, dynamic port signatures, value/default validation and formatting. |
| `graph.js` | Document validation, typed compilation, dependency/call-graph analysis, document history, connection edits, SubVI extraction. |
| `runtime.js` | Host-independent deterministic Float64 virtual machine, transactional state, structure execution, numerical operators and FFT. |
| `worker.js` | Browser-worker protocol, cooperative execution scheduling, pause/step/breakpoints, bounded frame transport, recording/replay. |
| `gpu.js` | Shared WebGPU host/pipeline, per-canvas streaming surfaces, Canvas2D fallback, ring buffer and decimation. |
| `diagram.js` | Graph viewport, native HTML nodes, typed wires, wire hit geometry, probes, selection, gestures, graph navigation. |
| `panel.js` | Front-panel layout/controls, typed value bindings, scope acquisition history, trigger/cursors, CSV export. |
| `app.js` | Command routing, history boundaries, worker orchestration, frame coalescing, project IO, inspectors, menus and debugger. |
| `demo.js` | Programmatically constructed executable examples and initial SubVI library. |
| `util.js` | Small DOM/SVG, icon, download, debounce and numeric helpers. |

The core (`types`, `graph`, `runtime`) has no DOM dependency. The UI is native browser code, not a canvas imitation of buttons and text fields. The numerical VM and render backend are deliberately independent.

## 2. Document model and value types

A project has `format: "voltweave"`, `version: 1`, `name`, `root`, `settings`, a `graphs` dictionary and a `widgets` array. Settings contain sample rate, samples per tick, seed, and wall-clock playback speed. Graphs contain typed input/output interface declarations, positioned nodes, and explicit edges. A widget binds to `{node, port, graph?}`; omitted graph means the project root. Bindings do not create execution dependencies.

A node stores its stable identifier, operator kind, display name, position, parameters, and optional breakpoint. A wire connects one named output terminal to one named input terminal. Fan-out is allowed. An input has one driver; connecting another source through the editor replaces that driver as one undoable edit. A malformed imported graph with multiple drivers is rejected by compilation.

The five runtime types are:

| Type | Representation |
|---|---|
| `number` | Finite JavaScript Number; IEEE-754 double precision. |
| `boolean` | Actual Boolean, with no implicit numeric/string coercion. |
| `array` | `Float64Array` with finite elements. |
| `waveform` | `{samples: Float64Array, t0: finite number, dt: positive finite number}`. |
| `string` | JavaScript Unicode string. |

Types must match exactly. Array/waveform conversion uses explicit operators. This is not NI’s entire datatype system: integers, fixed point, complex numbers, clusters, references, errors-as-data, multidimensional arrays and user typedefs are not implemented.

The FFT reuses the sampled-series waveform container: for its `spectrum` output, `t0=0` and `dt` is frequency-bin spacing in Hz, not seconds. Spectrum widgets explicitly interpret that domain. A richer unit/domain type would be a sensible schema extension; it is not silently assumed by the current type checker.

Parameter metadata validates built-in ranges and enumeration choices. Unwired input values resolve from per-node defaults before port defaults. A required input without either a wire or a default produces a compile diagnostic. Imported identifiers reject prototype-sensitive names; type membership is checked with own-property tests.

## 3. Compilation and typed IR

Compilation clones and validates the document before constructing execution plans, so editor mutations cannot alter a running plan in place. Each graph is compiled independently. Its plan contains a node map, port signatures, normalized input bindings, stable topological instruction order, instruction purity flags, and delayed state-commit instructions.

The compiler validates edge endpoints, exact terminal types, input-driver uniqueness and required inputs. Every declared graph output must have exactly one matching output terminal. It checks callable graph existence and the interface contracts of For, While, Case and ordinary SubVI calls. A separate call-graph traversal rejects recursion, including references hidden in Case branches.

Kahn scheduling starts with zero-indegree nodes in document order and follows successor lists in wire order. All executable nodes participate, including disconnected nodes; there is no dead-code elimination. A disconnected faulty operator can therefore still fault the instrument.

For an ordinary edge, its destination’s indegree depends on its source. An edge entering a `delay` node is different: it is a **commit-phase dependency**, not a read-phase scheduling dependency. The delay can publish its previously committed output before its current input is available. This breaks feedback cycles explicitly. Remaining cycles are diagnosed instead of choosing an arbitrary iteration count or reading stale untyped values.

Document order provides deterministic tie-breaking for independent nodes, not left-to-right screen position. Moving a block does not change the schedule. This is a deterministic sequential dataflow VM, not a parallel independent-node scheduler.

## 4. Fixed simulation clock

The root tick duration is:

```text
dt = blockSize / sampleRate
tickTime(k) = k * dt
sampleTime(k, i) = tickTime(k) + i / sampleRate
```

Playback speed changes the worker’s waiting time between ticks, not simulation time or sample values. Slow UI painting causes backpressure rather than skipped simulation ticks. A delayed browser cannot promise wall-clock synchronization, but it does not distort the numerical timestep to catch up.

`Engine.tick(controls)` runs one complete root tick synchronously for headless use. `Engine.begin(controls)` is a generator that yields `{kind:'before'}` and `{kind:'after'}` around actual operators, recursively including operators inside structure bodies. The worker drains that generator in bounded scheduling slices.

Controls are cloned at the start of the root tick. Changes arriving mid-tick take effect on the next tick. Root controls cannot overwrite identically named controls inside a nested graph; pass dynamic values into a SubVI through its explicit input terminals.

## 5. Transactional and instance-scoped state

Each tick starts with a shallow copy of the committed state map. The first write to a node’s state in that tick clones that node’s state record. Subsequent accesses use the transaction-local record. The committed map remains unchanged until the entire root graph returns successfully.

Successful completion publishes the transaction’s values and state and increments the tick index. Cancellation, generator return or an execution error prevents this commit. The worker explicitly aborts the iterator/context on stop or document replacement. Published values contain newly created immutable-in-practice sample arrays; operators must not mutate their inputs.

State identity includes the complete invocation path, for example:

```text
main/controllerCall@controller-vi/integral
```

Two calls to the same graph have different state and random streams. Repeated loop iterations at one call site use the same instance path, so that body’s state persists across its iterations and later ticks. A Case branch’s state persists when that branch is not selected; it is not evaluated or advanced while inactive.

The seeded xorshift32 stream is local to each stateful random node and derives its initial seed from the project seed and instance identity. There is no global PRNG whose consumption can be reordered by unrelated branches. Renaming stable IDs or extracting stateful/random nodes into a new call path intentionally changes their state identity; such edits reset the engine.

### Feedback semantics

A delay publishes the old scalar state when its instruction executes. Once its graph invocation finishes, it reads the newly computed input and writes the next state into the transaction. Those graph-local writes become globally visible only when the root tick commits. In a repeatedly invoked loop body, the next body invocation can observe the state written by the preceding invocation in that same transaction. This is distinct from forcing every nested delay to advance only once per root tick.

## 6. Structures and SubVIs

A normal SubVI maps its incoming typed terminals to the callee’s graph inputs and maps declared output-terminal values back to the caller. Input/output terminal nodes are ordinary executable interface operators. A SubVI can expose up to 32 inputs and 32 outputs.

For has numeric `count` and `seed`. Its body takes `{value:number, index:number}` and returns `{value:number}`. It runs `count` iterations, feeds each result into the next iteration, and returns the final value and an auto-indexed array of iteration results. Zero iterations return the seed and an empty array. Negative, fractional and oversized counts fail.

While has a numeric seed and a configured positive safety limit. Its body takes the same inputs and returns `{value:number, continue:boolean}`. It runs at least once, repeats while `continue` is true and returns its terminal value, collected values and actual iteration count. Exhausting the limit without a false continuation is an error, not a silently accepted partial answer.

Case takes a Boolean selector and a numeric value. Each branch is a graph mapping `{value:number}` to `{value:number}`. Only the chosen branch runs. Both branch programs must compile, but an inactive branch does not execute runtime effects or faults.

Extraction preserves selected internal edges and creates typed input/output terminals for boundary edges. Repeated external sources share a generated input terminal. Observed selected outputs become caller output ports, including root-front-panel bindings. Live root controls and interface terminal nodes are deliberately excluded from UI extraction. Pure processing selections have tested value-preserving extraction; stateful identity changes follow the reset semantics above.

## 7. Worker protocol, cancellation and backpressure

Every host command is associated with a document `revision`. A load replaces the Engine, clears pending execution and establishes a new revision. Stale commands are ignored. The worker also uses an internal cancellation generation and clears scheduled timers on cancellation.

Commands are `load`, `run`, `pause`, `stop`, `tick`, `node`, `controls`, `breakpoints`, `ack`, `recordStart`, `recordStop`, `replay`, `snapshot` and `dispose`. Responses include `compiled`, `status`, `frame`, `break`, `debug`, `error`, `reset`, `recording` and `snapshot`.

The worker uses approximately 5 ms slices while draining a tick. It yields through timers between slices so controls and cancellation can be received. A slice boundary occurs between operator yields; a single operator is not preempted mid-arithmetic. The instruction/array/loop resource limits bound that work, but this is cooperative cancellation, not an OS-level hard deadline.

There are **two frame credits**. Publishing a completed tick consumes one. The UI returns an ACK after consuming the frame in its animation-frame callback. When both credits are occupied, the worker does not advance another tick. The UI cannot accumulate an unbounded queue of completed sample blocks.

Transferable ownership is explicit. Before posting a frame, the worker structured-clones it, collects unique ArrayBuffers from the clone, and transfers those buffers. Engine state, memoized arrays and published runtime values are never detached. This is deliberately an extra copy for correctness and ownership simplicity, not a zero-copy shared-memory implementation.

The UI coalesces frame handling onto `requestAnimationFrame`. Reset discards frames received before reset but not yet painted. Before displaying a paused partial transaction, it drains already completed frames in order. Replay ownership is driven by ordered status messages, never by delayed frame painting. These details prevent stale frames from resurrecting a stopped instrument or re-locking controls after replay has completed.

## 8. Debugging behavior

Breakpoints match graph/node identity and stop on the `before` yield. No output for that node has been computed yet. Continuing consumes the next generator position rather than repeatedly stopping on the same already-consumed `before` event. The same breakpoint can trigger on subsequent loop iterations or ticks.

Node step resumes until the next actual `after` event. It naturally enters a nested graph rather than treating a SubVI as one opaque operation. Tick step finishes the root tick unless a breakpoint interrupts it. Pause preserves a partially evaluated transaction; Stop cancels and resets it.

Partial debug values are not committed engine state. The normal frame is published only after successful root completion. A runtime fault includes graph, node, tick and invocation identity where available. Weighted fuel exhaustion can arise outside a specific operator’s local evaluation wrapper.

## 9. Recording, replay and persistence

Recording resets to tick zero, stores the compiled project and appends the controls captured for each completed tick. Each record includes its tick number. The seed and fixed clock live in the recorded project; replay executes the graph again rather than showing captured output frames.

Replay validates the recording envelope and contiguous tick indices, creates a fresh Engine, supplies each logged control set, and ignores live control changes for execution. Completion pauses the worker and releases replay input ownership. Tests compare the actual transferred waveform arrays against those produced during recording.

Recordings are bounded to 20,000 ticks, but that is a tick-count bound rather than a strict byte-budgeted recorder. Large control arrays make recordings large; this implementation is not a disk-streaming acquisition service. Project import is limited to 20 MB and recording import to 40 MB in the UI. Keep exports below those limits for round trips.

`.vwx` and `.vwr` are readable JSON formats. The UI’s native controls produce JSON-safe scalar, Boolean and array-text input values. Custom integrations should provide arrays as JSON arrays rather than relying on JSON serialization of typed arrays. Runtime snapshots preserve typed arrays in the headless API; the UI’s snapshot export tags them for inspection and does not expose a snapshot import command.

The 80-entry history stores project snapshots, not GPU buffers, output arrays, current selection, or VM history. It is count-bounded rather than byte-budgeted. Undo/redo recompiles the restored project and resets simulation state. Autosave is debounced localStorage persistence and can fail due to browser policy or quota; explicit project export remains available.

## 10. Rendering path

A shared WebGPU adapter, device, shader module and render pipeline serve all graph/scope canvases. Each canvas owns its configured presentation target, a persistent viewport uniform and a growable persistent instance buffer.

Each line segment is one 36-byte instance containing start/end positions, width and RGBA. A six-vertex instanced triangle pair expands the segment to a capsule bounding rectangle. The WGSL fragment stage evaluates a capsule signed distance and blends an antialiased edge. Bezier wires are tessellated into line segments; grid points use tiny capsule segments. The renderer performs actual WebGPU resource creation, streaming buffer writes, render-pass encoding and queue submission.

Trace history uses fixed-capacity 32,768-sample ring buffers. Display decimation keeps each bucket’s minimum and maximum in temporal order, preserving narrow spikes rather than averaging them away. Cursor/export operations work from the displayed undecimated sample window. Source data is not modified by display decimation.

HTML provides node text, ports, controls and menus. SVG provides invisible wire hit areas and some instrument chrome. These are intentional interactive layers, not replacements for the WebGPU trace/wire renderer. The renderer falls back visibly to Canvas2D when a device is unavailable and recreates canvas targets if a GPU device is lost. Physical-GPU rendering and device-loss recovery have not been verified in the delivery environment.

No throughput claims are attached to this design. Dirty redraw requests are coalesced, but parts of SVG hit geometry and trace geometry are still rebuilt on redraw. Very large diagrams, many scopes, GPU memory pressure, and browser background-tab behavior need dedicated profiling before production deployment.

## 11. Resource envelope

| Limit | Value |
|---|---:|
| Nodes across the entire project | 4,096 |
| Wires across the entire project | 16,384 |
| Graphs | 128 |
| Front-panel widgets | 512 |
| Input/output ports per graph direction | 32 |
| Samples per root tick | 1–8,192 |
| Elements per array/waveform result | 65,536 |
| Loop iterations | 10,000, also subject to fuel |
| Weighted operations per root tick | 250,000 |
| Scope history per channel | 32,768 samples |
| In-flight completed frames | 2 |
| Recorded ticks | 20,000 |
| Undo entries | 80 |

Fuel includes operator overhead, array element work and FFT work estimates. It is an application guard, not a calibrated CPU-cycle or wall-time budget. Stored outputs and trace records are not lazy virtual arrays.

## 12. Extending the system

Add the operator’s typed ports, parameter schema, category, glyph and purity flag to `NODES` in `types.js`. Add its actual implementation to `Engine.evaluate` in `runtime.js`, or a generator-aware structure case in `executeGraph`. Validate numerical domains, never mutate upstream arrays, charge array/loop work through `spend`, and use `state(ctx, instanceKey, initialState)` for stateful behavior. Declare an operator pure only when its result depends entirely on its input values and immutable compiled parameters—not clock, random state or previous ticks.

Then add headless tests for correct results, invalid domains, resource limits, rollback and replay. The existing palette and inspector consume registry metadata automatically. More complex dynamic signatures belong in `ports()` with matching compiler validation. Update `OPERATORS.md`, regenerate the standalone edition, and run both core and browser workflows.

A real hardware backend should remain outside the deterministic numerical core. Timestamp and normalize external samples, define explicit queue overflow/backpressure policies, record the normalized input stream, and feed it through typed input terminals. Do not turn a hardware driver callback into an implicit wall-clock dependency inside a nominally deterministic operator.
