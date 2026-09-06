import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, spectrum } from '../src/runtime.js';
import { compileProject, validateProject, makeNode, connect, History, extractSubVI } from '../src/graph.js';
import { DEMOS } from '../src/demo.js';
import { NODES, ports, isValue } from '../src/types.js';
import { RingBuffer, decimate } from '../src/gpu.js';
const add = (p, id, type, params = {}, graph = 'main') => { const n = makeNode(type, 0, 0, params, id); p.graphs[graph].nodes.push(n); return n; };
const link = (p, a, b, input = 'x', output = 'value', graph = 'main') => connect(p, graph, { node: a, port: output }, { node: b, port: input });
const empty = () => { const p = DEMOS.empty(); p.graphs = { main: p.graphs.main }; return p; };
const v = (frame, node, port = 'value', graph = 'main') => frame.values[`${graph}/${node}`][port];
function compact(frame) { return { tick: frame.tick, time: frame.time, duration: frame.duration, values: frame.values }; }
for (const name of Object.keys(DEMOS))
    test(`example ${name}: compiles and executes 20 ticks`, () => { const engine = new Engine(DEMOS[name]()); for (let i = 0; i < 20; i++)
        assert.equal(engine.tick().tick, i); });
test('all declared operators have stable typed metadata', () => { assert.ok(Object.keys(NODES).length === 47); for (const [key, value] of Object.entries(NODES)) {
    assert.ok(value.title, key);
    assert.ok(Array.isArray(value.inputs));
    assert.ok(Array.isArray(value.outputs));
} });
test('port mismatch rejected at connection time', () => { const p = empty(); add(p, 'a', 'boolean'); add(p, 'b', 'add'); assert.throws(() => link(p, 'a', 'b', 'a'), /Cannot connect boolean to number/); });
test('compiler catches malformed typed edges loaded from disk', () => { const p = empty(); add(p, 'a', 'boolean'); add(p, 'b', 'add'); p.graphs.main.edges.push({ id: 'e', from: { node: 'a', port: 'value' }, to: { node: 'b', port: 'a' } }); assert.throws(() => compileProject(p), /Type mismatch/); });
test('required input diagnostics carry graph and node identity', () => { const p = empty(); add(p, 'scope', 'scope'); assert.throws(() => compileProject(p), e => e.diagnostics.some(d => d.graph === 'main' && d.node === 'scope' && /Required input/.test(d.message))); });
test('one input cannot have multiple drivers', () => { const p = empty(); add(p, 'a', 'constant'); add(p, 'b', 'constant'); add(p, 'sum', 'add'); const e = link(p, 'a', 'sum', 'a'); p.graphs.main.edges.push({ ...structuredClone(e), id: 'other', from: { node: 'b', port: 'value' } }); assert.throws(() => compileProject(p), /more than one driver/); });
test('connecting an input replaces its prior driver', () => { const p = empty(); add(p, 'a', 'constant'); add(p, 'b', 'constant', { value: 5 }); add(p, 'sum', 'add'); link(p, 'a', 'sum', 'a'); link(p, 'b', 'sum', 'a'); assert.equal(p.graphs.main.edges.length, 1); assert.equal(v(new Engine(p).tick(), 'sum'), 5); });
test('combinational cycles are rejected', () => { const p = empty(); add(p, 'a', 'add'); add(p, 'b', 'add'); link(p, 'a', 'b', 'a'); link(p, 'b', 'a', 'a'); assert.throws(() => compileProject(p), /Combinational cycle/); });
test('delay explicitly breaks a dependency cycle', () => { const p = empty(); add(p, 'delay', 'delay', { initial: 7 }); add(p, 'one', 'constant'); add(p, 'sum', 'add'); link(p, 'delay', 'sum', 'a'); link(p, 'one', 'sum', 'b'); link(p, 'sum', 'delay'); const engine = new Engine(p); for (let i = 0; i < 8; i++) {
    const f = engine.tick();
    assert.equal(v(f, 'delay'), 7 + i);
    assert.equal(v(f, 'sum'), 8 + i);
} });
test('clock depends on tick index, not wall time', () => { const p = empty(); p.settings.sampleRate = 100; p.settings.blockSize = 10; add(p, 'clock', 'time'); const engine = new Engine(p); for (let i = 0; i < 12; i++) {
    const f = engine.tick();
    assert.equal(v(f, 'clock', 'time'), i * .1);
    assert.equal(f.duration, .1);
} });
test('same seed and inputs reproduce every Float64 sample', () => { const p = DEMOS.signal(), a = new Engine(p), b = new Engine(p); for (let tick = 0; tick < 30; tick++) {
    const controls = { amplitude: tick > 10 ? 1.75 : 2.5, frequency: tick > 20 ? 128 : 64 };
    assert.deepEqual(compact(a.tick(controls)), compact(b.tick(controls)));
} });
test('different seeds produce independent deterministic noise', () => { const p = DEMOS.signal(), q = structuredClone(p); q.settings.seed++; assert.notDeepEqual(v(new Engine(p).tick(), 'noise', 'wave').samples, v(new Engine(q).tick(), 'noise', 'wave').samples); });
test('recorded-input replay is equivalent to original execution', () => { const project = DEMOS.signal(), engine = new Engine(project), recording = { project, frames: [] }, expected = []; for (let tick = 0; tick < 24; tick++) {
    const controls = { amplitude: 1 + tick / 30, frequency: tick < 12 ? 64 : 96 };
    recording.frames.push({ tick, controls });
    expected.push(compact(engine.tick(controls)));
} const replay = new Engine(recording.project); assert.deepEqual(recording.frames.map(f => compact(replay.tick(f.controls))), expected); });
test('runtime snapshot restores state and random streams exactly', () => { const engine = new Engine(DEMOS.signal()); for (let i = 0; i < 7; i++)
    engine.tick(); const snapshot = engine.snapshot(), expected = Array.from({ length: 8 }, () => compact(engine.tick())); engine.restore(snapshot); assert.deepEqual(Array.from({ length: 8 }, () => compact(engine.tick())), expected); });
test('aborted tick cannot commit state', () => { const p = empty(); add(p, 'one', 'constant'); add(p, 'integral', 'integrate'); link(p, 'one', 'integral'); const engine = new Engine(p), iterator = engine.begin(); let e; do {
    e = iterator.next();
} while (!(e.value?.node === 'integral' && e.value?.kind === 'after')); assert.equal(engine.states.size, 0); iterator.return(); engine.abort(); assert.equal(engine.index, 0); assert.equal(v(engine.tick(), 'integral'), engine.dt); });
test('runtime error rolls back all preceding stateful nodes', () => { const p = empty(); add(p, 'integral', 'integrate', { x: 1 }); add(p, 'bad', 'divide', { a: 1, b: 0 }); const engine = new Engine(p); assert.throws(() => engine.tick(), /Division by zero/); assert.equal(engine.index, 0); assert.equal(engine.states.size, 0); assert.equal(engine.context, null); });
test('pure scalar operators memoize unchanged inputs', () => { const p = empty(); add(p, 'a', 'constant', { value: 4 }); add(p, 'sum', 'add', { b: 3 }); link(p, 'a', 'sum', 'a'); const engine = new Engine(p); assert.equal(v(engine.tick(), 'sum'), 7); assert.ok(engine.tick().trace.find(t => t.node === 'sum').cached); });
test('For loop has deterministic iteration inputs and auto-indexing', () => { const engine = new Engine(DEMOS.structures()), f = engine.tick({ count: 5 }); assert.equal(v(f, 'loop'), 10); assert.deepEqual(v(f, 'loop', 'values'), Float64Array.of(0, 1, 3, 6, 10)); });
test('For loop supports zero iterations and returns the seed', () => { const p = DEMOS.structures(); p.graphs.main.nodes.find(n => n.id === 'loop').params.seed = 17; const f = new Engine(p).tick({ count: 0 }); assert.equal(v(f, 'loop'), 17); assert.equal(v(f, 'loop', 'values').length, 0); });
test('For rejects fractional iteration counts', () => { const p = DEMOS.structures(); assert.throws(() => new Engine(p).tick({ count: 2.5 }), /integer/); });
test('While returns terminal value and iteration count', () => { const f = new Engine(DEMOS.structures()).tick(); assert.equal(v(f, 'while'), .0078125); assert.equal(v(f, 'while', 'iterations'), 13); });
test('While enforces a termination limit', () => { const p = DEMOS.structures(); p.graphs.main.nodes.find(n => n.id === 'while').params.limit = 2; assert.throws(() => new Engine(p).tick(), /safety limit/); });
test('Case structure is lazy, not a select on eagerly evaluated branches', () => { const p = DEMOS.structures(); add(p, 'bad', 'divide', { a: 1, b: 0 }, 'case-true'); const engine = new Engine(p); assert.equal(v(engine.tick({ flag: false, count: 5 }), 'case'), -10); assert.throws(() => engine.tick({ flag: true }), /Division by zero/); });
test('recursive subprogram references fail compilation', () => { const p = DEMOS.empty(); add(p, 'recursive', 'subvi', { graph: 'gain-vi' }, 'gain-vi'); assert.throws(() => compileProject(p), /Recursive|not wired/); });
test('loop body interface must have the structure contract', () => { const p = DEMOS.structures(); p.graphs.main.nodes.find(n => n.id === 'loop').params.graph = 'gain-vi'; assert.throws(() => compileProject(p), /Loop bodies require/); });
test('reused subprograms have call-site-isolated state', () => {
    const p = empty();
    p.graphs.body = { id: 'body', name: 'body', inputs: [{ key: 'value', type: 'number' }], outputs: [{ key: 'value', type: 'number' }], nodes: [], edges: [] };
    add(p, 'in', 'input', { port: 'value' }, 'body');
    add(p, 'integral', 'integrate', {}, 'body');
    add(p, 'out', 'output', { port: 'value' }, 'body');
    link(p, 'in', 'integral', 'x', 'value', 'body');
    link(p, 'integral', 'out', 'value', 'value', 'body');
    add(p, 'a', 'subvi', { graph: 'body', value: 1 });
    add(p, 'b', 'subvi', { graph: 'body', value: 3 });
    const e = new Engine(p);
    for (let i = 1; i <= 4; i++) {
        const f = e.tick();
        assert.equal(v(f, 'a'), e.dt * i);
        assert.equal(v(f, 'b'), e.dt * i * 3);
    }
});
test('subprogram extraction preserves values, boundaries, and indicator bindings', () => { const p = DEMOS.signal(), original = new Engine(p).tick(); const call = extractSubVI(p, 'main', ['filter', 'stats'], 'Analysis.vi'); const f = new Engine(p).tick(); assert.equal(v(f, 'calibrate'), v(original, 'calibrate')); assert.equal(p.widgets.find(w => w.id === 'peak-meter').source.node, call.id); assert.ok(p.graphs[call.params.graph].inputs.some(p => p.type === 'waveform')); });
test('FFT reports bin-centered frequency and amplitude', () => { const sampleRate = 8192, samples = Float64Array.from({ length: 1024 }, (_, i) => 2.5 * Math.sin(2 * Math.PI * 128 * i / sampleRate)); for (const window of ['hann', 'rectangular']) {
    const result = spectrum({ samples, dt: 1 / sampleRate, t0: 0 }, window);
    assert.equal(result.peakHz, 128);
    assert.ok(Math.abs(result.spectrum.samples[16] - 2.5) < 1e-12);
} });
test('FFT gracefully rejects a one-sample block', () => assert.throws(() => spectrum({ samples: Float64Array.of(1), dt: 1, t0: 0 }), /two samples/));
test('signal generator validates Nyquist frequency', () => { const p = DEMOS.signal(); assert.throws(() => new Engine(p).tick({ frequency: 5000 }), /Nyquist/); });
test('array operations do not mutate their upstream buffers', () => { const p = empty(); add(p, 'array', 'arrayControl', { value: '3, -2, 1' }); add(p, 'sort', 'arraySort'); add(p, 'map', 'arrayMap', { operation: 'square', scale: 1 }); link(p, 'array', 'sort', 'array'); link(p, 'array', 'map', 'array'); const f = new Engine(p).tick(); assert.deepEqual(v(f, 'array'), Float64Array.of(3, -2, 1)); assert.deepEqual(v(f, 'sort', 'array'), Float64Array.of(-2, 1, 3)); assert.deepEqual(v(f, 'map', 'array'), Float64Array.of(9, 4, 1)); });
test('invalid array elements produce node-local runtime diagnostics', () => { const p = empty(); add(p, 'array', 'arrayControl', { value: '1, abc, 2' }); assert.throws(() => new Engine(p).tick(), e => e.node === 'array' && /Non-finite/.test(e.message)); });
test('array-to-waveform conversion does not cache a stale timestamp', () => { const p = empty(); add(p, 'range', 'range', { count: 2 }); add(p, 'wave', 'toWave'); link(p, 'range', 'wave', 'array', 'array'); const e = new Engine(p); e.tick(); assert.equal(v(e.tick(), 'wave', 'wave').t0, e.dt); });
test('array count resource limits are enforced', () => { const p = empty(); add(p, 'range', 'range'); assert.throws(() => { p.graphs.main.nodes[0].params.count = 65537; new Engine(p); }, /within/); });
test('weighted execution budget bounds nested work', () => { const p = DEMOS.structures(); p.settings.blockSize = 8192; p.graphs.main.nodes.find(n => n.id === 'loop').params.count = 10000; add(p, 'extraWave', 'signal', {}, 'loop-body'); assert.throws(() => new Engine(p).tick({ count: 10000 }), /budget exceeded/); });
test('project format and coordinate validation reject malformed data', () => { const p = empty(); assert.throws(() => validateProject({}), /supported/); add(p, 'x', 'constant'); p.graphs.main.nodes[0].x = NaN; assert.throws(() => validateProject(p), /coordinates/); });
test('duplicate node identifiers are rejected', () => { const p = empty(); add(p, 'same', 'constant'); add(p, 'same', 'constant'); assert.throws(() => compileProject(p), /Duplicate/); });
test('unknown operators cannot reach execution', () => { const p = empty(); p.graphs.main.nodes.push({ id: 'x', type: 'eval', x: 0, y: 0, params: {} }); assert.throws(() => new Engine(p), /Unknown operator/); });
test('project persistence round-trip preserves executable semantics', () => { const p = DEMOS.feedback(), roundTrip = JSON.parse(JSON.stringify(p)), a = new Engine(p), b = new Engine(roundTrip); for (let i = 0; i < 100; i++)
    assert.deepEqual(compact(a.tick()), compact(b.tick())); });
test('history is bounded and redo is invalidated by a new edit', () => { const h = new History(2); h.push({ x: 1 }); h.push({ x: 2 }); h.push({ x: 3 }); assert.equal(h.undoStack.length, 2); assert.deepEqual(h.undo({ x: 4 }), { x: 3 }); assert.deepEqual(h.redo({ x: 3 }), { x: 4 }); h.undo({ x: 4 }); h.push({ x: 9 }); assert.equal(h.redoStack.length, 0); });
test('ring buffer wraps and retains chronological sample order', () => { const r = new RingBuffer(4); r.append([1, 2, 3], .5, 0); r.append([4, 5, 6], .5, 1.5); assert.deepEqual(r.tail(), Float64Array.of(3, 4, 5, 6)); assert.equal(r.t0, 1); assert.deepEqual(r.tail(2), Float64Array.of(5, 6)); });
test('ring resets when the sampling interval changes', () => { const r = new RingBuffer(8); r.append([1, 2], 1, 0); r.append([3, 4], .5, 3); assert.deepEqual(r.tail(), Float64Array.of(3, 4)); });
test('min-max decimation retains narrow positive and negative spikes', () => { const a = new Float64Array(10000); a[1337] = 100; a[1399] = -100; const points = decimate(a, 300); assert.ok(points.some(([i, v]) => i === 1337 && v === 100)); assert.ok(points.some(([i, v]) => i === 1399 && v === -100)); assert.ok(points.length <= 600); });
test('Float64 is required for typed arrays and waveform values', () => { assert.ok(isValue('array', Float64Array.of(1))); assert.equal(isValue('array', Float32Array.of(1)), false); assert.equal(isValue('number', Infinity), false); assert.ok(isValue('waveform', { samples: Float64Array.of(1), t0: 0, dt: .1 })); });

test('interface type validation rejects inherited object properties', () => {
    const p = empty();
    p.graphs.main.inputs = [{ key: 'bad', type: 'constructor' }];
    assert.throws(() => validateProject(p), /interface port/);
});
test('prototype-sensitive identifiers cannot be imported as graph records', () => {
    const p = empty();
    add(p, '__proto__', 'constant');
    assert.throws(() => validateProject(p), /invalid node ID/);
});
test('root input controls cannot override identically named controls inside a subprogram', () => {
    const p = empty();
    p.graphs.body = { id: 'body', name: 'body', inputs: [], outputs: [{ key: 'value', type: 'number' }], nodes: [], edges: [] };
    add(p, 'amplitude', 'control', { value: 9 }, 'body');
    add(p, 'out', 'output', { port: 'value' }, 'body');
    link(p, 'amplitude', 'out', 'value', 'value', 'body');
    add(p, 'amplitude', 'control', { value: 3 });
    add(p, 'call', 'subvi', { graph: 'body' });
    const frame = new Engine(p).tick({ amplitude: 5 });
    assert.equal(v(frame, 'amplitude'), 5);
    assert.equal(v(frame, 'call'), 9);
});
