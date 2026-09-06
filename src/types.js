/** Immutable port metadata shared by the compiler, editor and worker. No DOM dependencies. */
export const TYPES = Object.freeze({
    number: { label: 'DBL', color: '#dc7a16', description: 'IEEE 754 double precision' },
    boolean: { label: 'BOOL', color: '#23824e', description: 'Boolean' },
    array: { label: 'DBL[]', color: '#2869bc', description: 'Immutable Float64Array' },
    waveform: { label: 'WAVE', color: '#9b4ac5', description: '{samples: Float64Array, t0: seconds, dt: seconds/sample}' },
    string: { label: 'STR', color: '#cf528d', description: 'Unicode string' }
});
const p = (key, type = 'number', value, label = key) => ({ key, type, label, ...(value !== undefined ? { default: value } : {}) });
const num = (label, value, min = -1e9, max = 1e9, step = 'any') => ({ kind: 'number', label, default: value, min, max, step });
const choice = (label, value, options) => ({ kind: 'select', label, default: value, options });
const str = (label, value) => ({ kind: 'text', label, default: value });
const def = (category, title, glyph, inputs, outputs, parameters = {}, extra = {}) => ({ category, title, glyph, inputs, outputs, parameters, ...extra });
export const NODES = {
    control: def('Controls', 'Numeric control', '123', [], [p('value')], { value: num('Value', 1), min: num('Minimum', 0), max: num('Maximum', 10), unit: str('Unit', '') }),
    boolean: def('Controls', 'Boolean control', 'T/F', [], [p('value', 'boolean')], { value: { kind: 'boolean', label: 'Value', default: false } }),
    arrayControl: def('Controls', 'Array control', '[ ]', [], [p('value', 'array')], { value: str('Values (comma separated)', '1, 2, 3, 4') }),
    constant: def('Numeric', 'Numeric constant', '#', [], [p('value')], { value: num('Value', 1) }, { pure: true }),
    text: def('Controls', 'String constant', 'abc', [], [p('value', 'string')], { value: str('Text', 'VoltWeave') }, { pure: true }),
    add: def('Numeric', 'Add', '+', [p('a', 'number', 0), p('b', 'number', 0)], [p('value')], {}, { pure: true }),
    subtract: def('Numeric', 'Subtract', '−', [p('a', 'number', 0), p('b', 'number', 0)], [p('value')], {}, { pure: true }),
    multiply: def('Numeric', 'Multiply', '×', [p('a', 'number', 1), p('b', 'number', 1)], [p('value')], {}, { pure: true }),
    divide: def('Numeric', 'Divide', '÷', [p('a', 'number', 1), p('b', 'number', 1)], [p('value')], {}, { pure: true }),
    math: def('Numeric', 'Math function', 'ƒ', [p('x', 'number', 0)], [p('value')], { operation: choice('Operation', 'sin', ['sin', 'cos', 'tan', 'abs', 'sqrt', 'exp', 'log', 'floor', 'ceil', 'round', 'square', 'negate']), scale: num('Input scale', 1), offset: num('Output offset', 0) }, { pure: true }),
    clamp: def('Numeric', 'In range / coerce', '↔', [p('x', 'number', 0), p('min', 'number', 0), p('max', 'number', 1)], [p('value'), p('inside', 'boolean')], {}, { pure: true }),
    compare: def('Boolean', 'Compare', '≥', [p('a', 'number', 0), p('b', 'number', 0)], [p('value', 'boolean')], { operation: choice('Comparison', '>', ['>', '>=', '<', '<=', '==', '!=']) }, { pure: true }),
    logic: def('Boolean', 'Boolean logic', '&', [p('a', 'boolean', false), p('b', 'boolean', false)], [p('value', 'boolean')], { operation: choice('Operation', 'and', ['and', 'or', 'xor', 'not']) }, { pure: true }),
    select: def('Boolean', 'Select', '?', [p('selector', 'boolean', false), p('yes', 'number', 1), p('no', 'number', 0)], [p('value')], {}, { pure: true }),
    time: def('Timing', 'Simulation clock', '◷', [], [p('time'), p('tick'), p('dt')]),
    random: def('Timing', 'Seeded random', '⚄', [], [p('value')], { min: num('Minimum', 0), max: num('Maximum', 1) }),
    delay: def('Timing', 'Feedback / z⁻¹', 'z⁻¹', [p('x', 'number', 0)], [p('value')], { initial: num('Initial value', 0) }),
    integrate: def('Timing', 'Integrator', '∫', [p('x', 'number', 0), p('reset', 'boolean', false)], [p('value')], { initial: num('Initial value', 0) }),
    derivative: def('Timing', 'Derivative', 'd/dt', [p('x', 'number', 0)], [p('value')]),
    signal: def('Signal processing', 'Signal generator', '∿', [p('frequency', 'number', 40), p('amplitude', 'number', 2.5)], [p('wave', 'waveform')], { shape: choice('Waveform', 'sine', ['sine', 'square', 'triangle', 'sawtooth', 'dc']), frequency: num('Frequency (Hz)', 40, 0, 1e6), amplitude: num('Amplitude (V)', 2.5), offset: num('DC offset', 0), phase: num('Initial phase (°)', 0, -360, 360) }),
    noise: def('Signal processing', 'White noise', '≋', [p('amplitude', 'number', .12)], [p('wave', 'waveform')], { amplitude: num('Amplitude', .12, 0, 100) }),
    mix: def('Signal processing', 'Mix waveforms', 'Σ', [p('a', 'waveform'), p('b', 'waveform')], [p('wave', 'waveform')], { mix: num('B gain', 1) }, { pure: true }),
    gain: def('Signal processing', 'Waveform gain', '×k', [p('x', 'waveform'), p('gain', 'number', 1)], [p('wave', 'waveform')], { gain: num('Gain', 1), offset: num('Offset', 0) }, { pure: true }),
    filter: def('Signal processing', 'Low-pass filter', '⌁', [p('x', 'waveform'), p('cutoff', 'number', 90)], [p('wave', 'waveform')], { cutoff: num('Cutoff (Hz)', 90, .001, 1e6), order: choice('Order', '2', ['1', '2', '4']) }),
    rms: def('Signal processing', 'Waveform statistics', 'RMS', [p('x', 'waveform')], [p('rms'), p('peak'), p('mean')], {}, { pure: true }),
    fft: def('Signal processing', 'FFT spectrum', 'FFT', [p('x', 'waveform')], [p('spectrum', 'waveform'), p('peakHz')], { window: choice('Window', 'hann', ['hann', 'rectangular']) }, { pure: true }),
    toArray: def('Arrays', 'Waveform → array', '→[ ]', [p('x', 'waveform')], [p('array', 'array')], {}, { pure: true }),
    toWave: def('Arrays', 'Array → waveform', '[ ]→', [p('array', 'array'), p('dt', 'number', .001)], [p('wave', 'waveform')], {}, { pure: false }),
    range: def('Arrays', 'Ramp array', '0..n', [p('count', 'number', 16)], [p('array', 'array')], { start: num('Start', 0), step: num('Step', 1), count: num('Count', 16, 0, 65536, 1) }, { pure: true }),
    arrayBuild: def('Arrays', 'Build array', '[+]', [p('a', 'number', 0), p('b', 'number', 1), p('c', 'number', 2), p('d', 'number', 3)], [p('array', 'array')], {}, { pure: true }),
    arrayMap: def('Arrays', 'Map array', '[ƒ]', [p('array', 'array')], [p('array', 'array')], { operation: choice('Operation', 'scale', ['scale', 'sin', 'cos', 'abs', 'square', 'sqrt']), scale: num('Scale', 2), offset: num('Offset', 0) }, { pure: true }),
    arrayIndex: def('Arrays', 'Index array', '[i]', [p('array', 'array'), p('index', 'number', 0)], [p('value'), p('valid', 'boolean')], {}, { pure: true }),
    arrayStats: def('Arrays', 'Array statistics', 'μ', [p('array', 'array')], [p('sum'), p('mean'), p('min'), p('max'), p('length')], {}, { pure: true }),
    arrayConcat: def('Arrays', 'Concatenate arrays', '[⋈]', [p('a', 'array'), p('b', 'array')], [p('array', 'array')], {}, { pure: true }),
    arraySort: def('Arrays', 'Sort array', '[↑]', [p('array', 'array')], [p('array', 'array')], {}, { pure: true }),
    for: def('Structures', 'For loop', 'N↻', [p('count', 'number', 8), p('seed', 'number', 0)], [p('value'), p('values', 'array')], { graph: { kind: 'graph', label: 'Body VI', default: 'loop-body' }, count: num('Iteration count', 8, 0, 10000, 1) }),
    while: def('Structures', 'While loop', '↻?', [p('seed', 'number', 0)], [p('value'), p('values', 'array'), p('iterations')], { graph: { kind: 'graph', label: 'Body VI', default: 'while-body' }, limit: num('Maximum iterations', 128, 1, 10000, 1) }),
    case: def('Structures', 'Case structure', 'T │ F', [p('selector', 'boolean', false), p('value', 'number', 0)], [p('value')], { trueGraph: { kind: 'graph', label: 'True case', default: 'case-true' }, falseGraph: { kind: 'graph', label: 'False case', default: 'case-false' } }),
    subvi: def('Structures', 'SubVI', 'VI', [], [], { graph: { kind: 'graph', label: 'Subprogram', default: 'gain-vi' } }),
    input: def('Terminals', 'Input terminal', '→', [], [], { port: str('Interface input', 'value') }),
    output: def('Terminals', 'Output terminal', '←', [], [], { port: str('Interface output', 'value') }),
    instrument: def('Instruments', 'Virtual RC instrument', 'RC', [p('drive', 'waveform')], [p('voltage', 'waveform'), p('current', 'waveform'), p('temperature'), p('overload', 'boolean')], { resistance: num('Resistance (Ω)', 1000, .01, 1e9), capacitance: num('Capacitance (µF)', 1, .00001, 1e6), ambient: num('Ambient (°C)', 23), limit: num('Current limit (A)', .02, 0, 1e6) }),
    pid: def('Instruments', 'PID controller', 'PID', [p('setpoint', 'number', 1), p('process', 'number', 0)], [p('value')], { kp: num('Kp', 1), ki: num('Ki', .1), kd: num('Kd', 0), min: num('Output minimum', -10), max: num('Output maximum', 10) }),
    indicator: def('Indicators', 'Numeric indicator', 'DBL', [p('value', 'number', 0)], [p('value')], {}, { pure: true }),
    led: def('Indicators', 'Boolean indicator', '●', [p('value', 'boolean', false)], [p('value', 'boolean')], {}, { pure: true }),
    scope: def('Indicators', 'Oscilloscope', '⌁', [p('channel1', 'waveform'), p('channel2', 'waveform', null)], [p('wave', 'waveform')], {}, { pure: true }),
    format: def('Indicators', 'Format number', 'a↔1', [p('value', 'number', 0)], [p('text', 'string')], { digits: num('Decimal places', 3, 0, 12, 1), prefix: str('Prefix', ''), suffix: str('Suffix', '') }, { pure: true })
};
export function defaults(type) {
    const d = NODES[type];
    if (!d)
        throw new Error(`Unknown node type: ${type}`);
    return Object.fromEntries(Object.entries(d.parameters).map(([k, v]) => [k, v.default]));
}
export function ports(node, graph, project) {
    const d = NODES[node.type];
    if (!d)
        return { inputs: [], outputs: [] };
    if (node.type === 'subvi') {
        const child = project.graphs[node.params.graph];
        return { inputs: (child?.inputs || []).map(x => ({ ...x, key: x.key, label: x.label || x.key })), outputs: (child?.outputs || []).map(x => ({ ...x, label: x.label || x.key })) };
    }
    if (node.type === 'input') {
        const pin = graph.inputs?.find(x => x.key === node.params.port);
        return { inputs: [], outputs: pin ? [{ ...pin, key: 'value', label: pin.key }] : [] };
    }
    if (node.type === 'output') {
        const pin = graph.outputs?.find(x => x.key === node.params.port);
        return { inputs: pin ? [{ ...pin, key: 'value', label: pin.key }] : [], outputs: [] };
    }
    return { inputs: d.inputs, outputs: d.outputs };
}
export function inputDefault(node, pin) {
    if (Object.hasOwn(node.params, pin.key))
        return node.params[pin.key];
    if (Object.hasOwn(pin, 'default'))
        return pin.default;
    return undefined;
}
export function isValue(type, value) {
    if (type === 'number')
        return typeof value === 'number' && Number.isFinite(value);
    if (type === 'boolean')
        return typeof value === 'boolean';
    if (type === 'string')
        return typeof value === 'string';
    if (type === 'array')
        return value instanceof Float64Array;
    if (type === 'waveform')
        return value && value.samples instanceof Float64Array && Number.isFinite(value.t0) && Number.isFinite(value.dt) && value.dt > 0;
    return false;
}
export function formatValue(value, digits = 4) {
    if (value === undefined)
        return '—';
    if (value === null)
        return 'none';
    if (typeof value === 'boolean')
        return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number')
        return Number.isInteger(value) ? String(value) : Number(value.toPrecision(digits)).toString();
    if (value instanceof Float64Array || Array.isArray(value))
        return `[${Array.from(value.subarray ? value.subarray(0, 6) : value.slice(0, 6)).map(x => formatValue(x)).join(', ')}${value.length > 6 ? ', …' : ''}] (${value.length})`;
    if (value.samples)
        return `${value.samples.length} samples · Δ ${formatValue(value.dt)} s`;
    return String(value).slice(0, 140);
}
