import { compileProject, LIMITS } from './graph.js';
import { isValue } from './types.js';
export class ExecutionError extends Error {
    constructor(message, graph, node, tick, instance) { super(message); this.name = 'ExecutionError'; Object.assign(this, { graph, node, tick, instance }); }
}
const TAU = Math.PI * 2;
const boundedCount = (value, maximum, label) => { if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`${label} must be an integer in 0 … ${maximum}.`); return value; };
function seedFor(seed, key) { let h = seed ^ 2166136261; for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619); return (h >>> 0) || 0x6d2b79f5; }
function random(state) { let x = state.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.rng = x >>> 0; return state.rng / 4294967296; }
function stats(a) {
    if (!a.length)
        return { sum: 0, mean: 0, min: 0, max: 0, length: 0, rms: 0, peak: 0 };
    let sum = 0, square = 0, c = 0, cs = 0, min = Infinity, max = -Infinity;
    for (const v of a) {
        const y = v - c, t = sum + y;
        c = (t - sum) - y;
        sum = t;
        const z = v * v - cs, u = square + z;
        cs = (u - square) - z;
        square = u;
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    return { sum, mean: sum / a.length, min, max, length: a.length, rms: Math.sqrt(square / a.length), peak: Math.max(Math.abs(min), Math.abs(max)) };
}
function transformWave(w, fn) { const samples = new Float64Array(w.samples.length); for (let i = 0; i < samples.length; i++)
    samples[i] = fn(w.samples[i], i); return { samples, dt: w.dt, t0: w.t0 }; }
export function spectrum(wave, window = 'hann') {
    const n = 2 ** Math.floor(Math.log2(wave.samples.length));
    if (n < 2)
        throw new Error('FFT requires at least two samples.');
    const re = new Float64Array(n), im = new Float64Array(n);
    let sumWindow = 0;
    for (let i = 0; i < n; i++) {
        const k = window === 'hann' ? .5 - .5 * Math.cos(TAU * i / n) : 1;
        re[i] = wave.samples[i] * k;
        sumWindow += k;
    }
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1)
            j ^= bit;
        j ^= bit;
        if (i < j)
            [re[i], re[j]] = [re[j], re[i]];
    }
    for (let length = 2; length <= n; length <<= 1) {
        const angle = -TAU / length, c = Math.cos(angle), s = Math.sin(angle);
        for (let i = 0; i < n; i += length) {
            let wr = 1, wi = 0;
            for (let j = 0; j < length / 2; j++) {
                const a = i + j, b = a + length / 2, tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                const next = wr * c - wi * s;
                wi = wr * s + wi * c;
                wr = next;
            }
        }
    }
    const samples = new Float64Array(n / 2 + 1);
    let peak = 1;
    for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.hypot(re[i], im[i]) * (i === 0 || i === n / 2 ? 1 : 2) / sumWindow;
        if (i > 0 && samples[i] > samples[peak])
            peak = i;
    }
    return { spectrum: { samples, t0: 0, dt: 1 / (wave.dt * n) }, peakHz: peak / (wave.dt * n) };
}
/** Reference deterministic VM: Float64 samples, fixed time, transactional state, cooperative instruction yields. */
export class Engine {
    constructor(project) {
        this.ir = compileProject(project);
        this.project = this.ir.project;
        this.index = 0;
        this.states = new Map();
        this.memo = new Map();
        this.values = new Map();
        this.partialValues = new Map();
        this.context = null;
        this.dt = this.project.settings.blockSize / this.project.settings.sampleRate;
    }
    reset() { this.index = 0; this.states.clear(); this.memo.clear(); this.values.clear(); this.partialValues.clear(); this.context = null; }
    snapshot() { return { version: 1, index: this.index, states: structuredClone([...this.states]), values: structuredClone([...this.values]) }; }
    restore(snapshot) {
        if (snapshot.version !== 1 || !Number.isInteger(snapshot.index) || snapshot.index < 0)
            throw new Error('Invalid runtime snapshot.');
        this.index = snapshot.index;
        this.states = new Map(structuredClone(snapshot.states));
        this.values = new Map(structuredClone(snapshot.values));
        this.partialValues = new Map(this.values);
        this.memo.clear();
        this.context = null;
    }
    abort() { this.context = null; this.partialValues = new Map(this.values); }
    state(ctx, key, initial = {}) {
        if (!ctx.touched.has(key)) {
            ctx.states.set(key, ctx.states.has(key) ? structuredClone(ctx.states.get(key)) : { ...initial, rng: seedFor(this.project.settings.seed, key) });
            ctx.touched.add(key);
        }
        return ctx.states.get(key);
    }
    spend(ctx, count = 1) { ctx.fuel -= count; if (ctx.fuel < 0)
        throw new Error(`Execution budget exceeded (${LIMITS.fuel.toLocaleString()} weighted operations / tick). Reduce loop bounds or block size.`); }
    *begin(controls = {}) {
        if (this.context)
            throw new Error('A tick is already in progress.');
        const ctx = { index: this.index, time: this.index * this.dt, controls: structuredClone(controls), states: new Map(this.states), touched: new Set(), values: new Map(), trace: [], fuel: LIMITS.fuel };
        this.context = ctx;
        this.partialValues = ctx.values;
        try {
            yield* this.executeGraph(this.project.root, {}, this.project.root, ctx);
            this.states = ctx.states;
            this.values = ctx.values;
            this.index++;
            return { tick: ctx.index, nextTick: this.index, time: ctx.time, duration: this.dt, values: Object.fromEntries(ctx.values), trace: ctx.trace, operations: LIMITS.fuel - ctx.fuel };
        }
        finally {
            if (this.context === ctx)
                this.context = null;
        }
    }
    tick(controls = {}) { const iterator = this.begin(controls); let next; do {
        next = iterator.next();
    } while (!next.done); return next.value; }
    *executeGraph(graphId, locals, path, ctx) {
        const plan = this.ir.plans.get(graphId), results = new Map(), graphOutputs = {};
        for (const instruction of plan.instructions) {
            const { node, signature, pure } = instruction, instance = `${path}/${node.id}`;
            this.spend(ctx);
            const event = { graph: graphId, node: node.id, instance, tick: ctx.index };
            yield { ...event, kind: 'before' };
            try {
                const inputs = {};
                // Delay reads do not access inputs until the graph's commit phase.
                if (node.type !== 'delay')
                    for (const binding of instruction.bindings) {
                        const value = binding.source ? results.get(binding.source.node)?.[binding.source.port] : binding.fallback;
                        if (value !== null && !isValue(binding.pin.type, value))
                            throw new Error(`Input ${binding.pin.key} expects ${binding.pin.type}.`);
                        if (value === null && binding.fallback !== null)
                            throw new Error(`Input ${binding.pin.key} is required.`);
                        inputs[binding.pin.key] = value;
                    }
                const args = Object.values(inputs), cached = this.memo.get(instance);
                let outputs;
                if (pure && cached && cached.args.length === args.length && args.every((v, i) => Object.is(v, cached.args[i])))
                    outputs = cached.outputs;
                else {
                    if (node.type === 'subvi')
                        outputs = yield* this.executeGraph(node.params.graph, inputs, `${instance}@${node.params.graph}`, ctx);
                    else if (node.type === 'case') {
                        const branch = inputs.selector ? node.params.trueGraph : node.params.falseGraph;
                        const r = yield* this.executeGraph(branch, { value: inputs.value }, `${instance}@${branch}`, ctx);
                        outputs = { value: r.value };
                    }
                    else if (node.type === 'for' || node.type === 'while') {
                        const limit = node.type === 'for' ? boundedCount(inputs.count, LIMITS.iterations, 'Loop count') : boundedCount(node.params.limit, LIMITS.iterations, 'While limit');
                        let value = inputs.seed, count = 0, done = node.type === 'for';
                        const collected = [];
                        for (let index = 0; index < limit; index++) {
                            this.spend(ctx);
                            const r = yield* this.executeGraph(node.params.graph, { value, index }, `${instance}@${node.params.graph}`, ctx);
                            value = r.value;
                            collected.push(value);
                            count++;
                            if (node.type === 'while' && !r.continue) {
                                done = true;
                                break;
                            }
                        }
                        if (!done)
                            throw new Error(`While loop reached its ${limit}-iteration safety limit without terminating.`);
                        outputs = { value, values: Float64Array.from(collected), ...(node.type === 'while' ? { iterations: count } : {}) };
                    }
                    else if (node.type === 'input') {
                        const port = plan.graph.inputs.find(p => p.key === node.params.port);
                        outputs = { value: Object.hasOwn(locals, port.key) ? locals[port.key] : port.default };
                    }
                    else if (node.type === 'output') {
                        graphOutputs[node.params.port] = inputs.value;
                        outputs = {};
                    }
                    else
                        outputs = this.evaluate(node, inputs, instance, ctx);
                    for (const pin of signature.outputs) {
                        const value = outputs[pin.key];
                        if (!isValue(pin.type, value))
                            throw new Error(`Output ${pin.key} is not a finite ${pin.type}.`);
                        const array = value?.samples || (value instanceof Float64Array ? value : null);
                        if (array) {
                            if (array.length > LIMITS.array)
                                throw new Error('Array length limit exceeded.');
                            for (let i = 0; i < array.length; i++)
                                if (!Number.isFinite(array[i]))
                                    throw new Error(`Non-finite array value at sample ${i}.`);
                        }
                    }
                    if (pure)
                        this.memo.set(instance, { args, outputs });
                }
                results.set(node.id, outputs);
                ctx.values.set(`${graphId}/${node.id}`, outputs);
                if (ctx.trace.length < 4096)
                    ctx.trace.push({ ...event, cached: outputs === cached?.outputs });
                yield { ...event, kind: 'after', outputs, cached: outputs === cached?.outputs };
            }
            catch (error) {
                if (error instanceof ExecutionError)
                    throw error;
                throw new ExecutionError(`${node.name}: ${error.message}`, graphId, node.id, ctx.index, instance);
            }
        }
        for (const instruction of plan.delayed) {
            const binding = instruction.bindings[0];
            const value = binding.source ? results.get(binding.source.node)?.[binding.source.port] : binding.fallback;
            if (!isValue('number', value))
                throw new ExecutionError('Feedback commit requires a finite number.', graphId, instruction.id, ctx.index, path);
            this.state(ctx, `${path}/${instruction.id}`).value = value;
        }
        return graphOutputs;
    }
    evaluate(node, i, key, ctx) {
        const p = node.params, dt = this.dt, n = this.project.settings.blockSize, sampleDt = 1 / this.project.settings.sampleRate;
        const state = initial => this.state(ctx, key, initial);
        const spend = amount => this.spend(ctx, amount);
        switch (node.type) {
            case 'control': return { value: key === `${this.project.root}/${node.id}` && Object.hasOwn(ctx.controls, node.id) ? ctx.controls[node.id] : p.value };
            case 'boolean': return { value: key === `${this.project.root}/${node.id}` && Object.hasOwn(ctx.controls, node.id) ? ctx.controls[node.id] : p.value };
            case 'arrayControl': {
                const raw = key === `${this.project.root}/${node.id}` && Object.hasOwn(ctx.controls, node.id) ? ctx.controls[node.id] : p.value;
                const list = raw instanceof Float64Array ? raw : Array.isArray(raw) ? raw : String(raw).trim() ? String(raw).trim().split(/[\s,;]+/).map(Number) : [];
                boundedCount(list.length, LIMITS.array, 'Array size');
                spend(list.length);
                return { value: Float64Array.from(list) };
            }
            case 'constant':
            case 'text': return { value: p.value };
            case 'add': return { value: i.a + i.b };
            case 'subtract': return { value: i.a - i.b };
            case 'multiply': return { value: i.a * i.b };
            case 'divide':
                if (i.b === 0)
                    throw new Error('Division by zero.');
                return { value: i.a / i.b };
            case 'math': {
                const x = i.x * p.scale;
                return { value: (p.operation === 'square' ? x * x : p.operation === 'negate' ? -x : Math[p.operation](x)) + p.offset };
            }
            case 'clamp':
                if (i.min > i.max)
                    throw new Error('Minimum exceeds maximum.');
                return { value: Math.min(i.max, Math.max(i.min, i.x)), inside: i.x >= i.min && i.x <= i.max };
            case 'compare': return { value: ({ '>': () => i.a > i.b, '>=': () => i.a >= i.b, '<': () => i.a < i.b, '<=': () => i.a <= i.b, '==': () => i.a === i.b, '!=': () => i.a !== i.b })[p.operation]() };
            case 'logic': return { value: p.operation === 'and' ? i.a && i.b : p.operation === 'or' ? i.a || i.b : p.operation === 'xor' ? i.a !== i.b : !i.a };
            case 'select': return { value: i.selector ? i.yes : i.no };
            case 'time': return { time: ctx.time, tick: ctx.index, dt };
            case 'random': return { value: p.min + (p.max - p.min) * random(state()) };
            case 'delay': return { value: state({ value: p.initial }).value };
            case 'integrate': {
                const s = state({ value: p.initial });
                s.value = i.reset ? p.initial : s.value + i.x * dt;
                return { value: s.value };
            }
            case 'derivative': {
                const s = state({ previous: i.x });
                const value = (i.x - s.previous) / dt;
                s.previous = i.x;
                return { value };
            }
            case 'signal': {
                spend(n);
                if (i.frequency < 0 || i.frequency > this.project.settings.sampleRate / 2)
                    throw new Error('Frequency exceeds the Nyquist limit or is negative.');
                const s = state({ phase: ((p.phase / 360) % 1 + 1) % 1 }), samples = new Float64Array(n), advance = i.frequency * sampleDt;
                for (let j = 0; j < n; j++) {
                    const v = p.shape === 'sine' ? Math.sin(TAU * s.phase) : p.shape === 'square' ? (s.phase < .5 ? 1 : -1) : p.shape === 'triangle' ? 1 - 4 * Math.abs(s.phase - .5) : p.shape === 'sawtooth' ? 2 * s.phase - 1 : 1;
                    samples[j] = p.offset + i.amplitude * v;
                    s.phase = (s.phase + advance) % 1;
                }
                return { wave: { samples, dt: sampleDt, t0: ctx.time } };
            }
            case 'noise': {
                spend(n);
                const s = state(), samples = new Float64Array(n);
                for (let j = 0; j < n; j++)
                    samples[j] = (random(s) * 2 - 1) * i.amplitude;
                return { wave: { samples, dt: sampleDt, t0: ctx.time } };
            }
            case 'mix': {
                if (i.a.samples.length !== i.b.samples.length || i.a.dt !== i.b.dt || i.a.t0 !== i.b.t0)
                    throw new Error('Waveforms must have equal lengths, sample intervals and start times.');
                spend(i.a.samples.length);
                return { wave: transformWave(i.a, (v, j) => v + i.b.samples[j] * p.mix) };
            }
            case 'gain':
                spend(i.x.samples.length);
                return { wave: transformWave(i.x, v => v * i.gain + p.offset) };
            case 'filter': {
                if (i.cutoff <= 0)
                    throw new Error('Cutoff must be positive.');
                const order = Number(p.order), s = state({ stages: Array(order).fill(0) }), alpha = 1 - Math.exp(-TAU * i.cutoff * i.x.dt);
                spend(i.x.samples.length * order);
                return { wave: transformWave(i.x, value => { for (let k = 0; k < order; k++) {
                        s.stages[k] += alpha * (value - s.stages[k]);
                        value = s.stages[k];
                    } return value; }) };
            }
            case 'rms':
                spend(i.x.samples.length);
                {
                    const s = stats(i.x.samples);
                    return { rms: s.rms, peak: s.peak, mean: s.mean };
                }
            case 'fft':
                spend(Math.ceil(i.x.samples.length * Math.log2(i.x.samples.length)));
                return spectrum(i.x, p.window);
            case 'toArray': return { array: i.x.samples };
            case 'toWave': return { wave: { samples: i.array, dt: i.dt, t0: ctx.time } };
            case 'range': {
                const count = boundedCount(i.count, LIMITS.array, 'Array count');
                spend(count);
                return { array: Float64Array.from({ length: count }, (_, index) => p.start + index * p.step) };
            }
            case 'arrayBuild': return { array: Float64Array.of(i.a, i.b, i.c, i.d) };
            case 'arrayMap':
                spend(i.array.length);
                return { array: i.array.map(x => (p.operation === 'scale' ? x : p.operation === 'square' ? x * x : Math[p.operation](x)) * p.scale + p.offset) };
            case 'arrayIndex': {
                const valid = Number.isInteger(i.index) && i.index >= 0 && i.index < i.array.length;
                return { value: valid ? i.array[i.index] : 0, valid };
            }
            case 'arrayStats':
                spend(i.array.length);
                {
                    const { sum, mean, min, max, length } = stats(i.array);
                    return { sum, mean, min, max, length };
                }
            case 'arrayConcat': {
                boundedCount(i.a.length + i.b.length, LIMITS.array, 'Concatenated length');
                spend(i.a.length + i.b.length);
                const array = new Float64Array(i.a.length + i.b.length);
                array.set(i.a);
                array.set(i.b, i.a.length);
                return { array };
            }
            case 'arraySort':
                spend(Math.ceil(i.array.length * Math.log2(i.array.length + 1)));
                return { array: i.array.slice().sort() };
            case 'instrument': {
                const s = state({ voltage: 0, temperature: p.ambient }), tau = p.resistance * p.capacitance * 1e-6, alpha = -Math.expm1(-i.drive.dt / tau), voltage = new Float64Array(i.drive.samples.length), current = new Float64Array(voltage.length);
                let peak = 0, power = 0;
                spend(voltage.length * 2);
                for (let j = 0; j < voltage.length; j++) {
                    s.voltage += alpha * (i.drive.samples[j] - s.voltage);
                    voltage[j] = s.voltage;
                    current[j] = (i.drive.samples[j] - s.voltage) / p.resistance;
                    peak = Math.max(peak, Math.abs(current[j]));
                    power += current[j] ** 2 * p.resistance;
                }
                s.temperature += (p.ambient + power / (voltage.length || 1) * 20 - s.temperature) * -Math.expm1(-dt / 8);
                const wave = samples => ({ samples, dt: i.drive.dt, t0: i.drive.t0 });
                return { voltage: wave(voltage), current: wave(current), temperature: s.temperature, overload: peak > p.limit };
            }
            case 'pid': {
                const s = state({ integral: 0, previous: i.setpoint - i.process }), error = i.setpoint - i.process, next = s.integral + error * dt;
                const raw = p.kp * error + p.ki * next + p.kd * (error - s.previous) / dt, value = Math.min(p.max, Math.max(p.min, raw));
                if (raw === value || (raw > p.max && error < 0) || (raw < p.min && error > 0))
                    s.integral = next;
                s.previous = error;
                return { value };
            }
            case 'indicator':
            case 'led': return { value: i.value };
            case 'scope': return { wave: i.channel1 };
            case 'format': return { text: p.prefix + i.value.toFixed(Math.trunc(p.digits)) + p.suffix };
            default: throw new Error(`No execution implementation for ${node.type}.`);
        }
    }
}
