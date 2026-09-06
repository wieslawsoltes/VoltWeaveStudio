import { makeNode } from './graph.js';
const node = (id, type, x, y, params = {}, name) => ({ ...makeNode(type, x, y, params, id), ...(name ? { name } : {}) });
const wire = (from, port, to, input, probe = false) => ({ id: `w_${from}_${port}_${to}_${input}`, from: { node: from, port }, to: { node: to, port: input }, probe });
const widget = (id, kind, label, source, x, y, w, h, extra = {}) => ({ id, kind, label, source: typeof source === 'string' ? { node: source, port: 'value' } : source, x, y, w, h, ...extra });
function library() {
    const unary = (id, name, factor) => ({ id, name, inputs: [{ key: 'value', type: 'number' }], outputs: [{ key: 'value', type: 'number' }], nodes: [node('in', 'input', 40, 100, { port: 'value' }), node('factor', 'constant', 40, 300, { value: factor }), node('operation', 'multiply', 340, 100), node('out', 'output', 640, 100, { port: 'value' })], edges: [wire('in', 'value', 'operation', 'a'), wire('factor', 'value', 'operation', 'b'), wire('operation', 'value', 'out', 'value')] });
    return {
        'gain-vi': unary('gain-vi', 'Calibration.vi', 1.025),
        'case-true': unary('case-true', 'True · double.vi', 2),
        'case-false': unary('case-false', 'False · invert.vi', -1),
        'loop-body': { id: 'loop-body', name: 'Accumulate index.vi', inputs: [{ key: 'value', type: 'number' }, { key: 'index', type: 'number' }], outputs: [{ key: 'value', type: 'number' }], nodes: [node('value', 'input', 40, 100, { port: 'value' }), node('index', 'input', 40, 300, { port: 'index' }), node('add', 'add', 330, 150), node('out', 'output', 610, 150, { port: 'value' })], edges: [wire('value', 'value', 'add', 'a'), wire('index', 'value', 'add', 'b'), wire('add', 'value', 'out', 'value')] },
        'while-body': { id: 'while-body', name: 'Converge to zero.vi', inputs: [{ key: 'value', type: 'number' }, { key: 'index', type: 'number' }], outputs: [{ key: 'value', type: 'number' }, { key: 'continue', type: 'boolean' }], nodes: [node('value', 'input', 40, 70, { port: 'value' }), node('half', 'constant', 40, 260, { value: .5 }), node('epsilon', 'constant', 340, 330, { value: .01 }), node('scale', 'multiply', 340, 70), node('compare', 'compare', 620, 240, { operation: '>' }), node('out', 'output', 900, 70, { port: 'value' }), node('continue', 'output', 900, 290, { port: 'continue' })], edges: [wire('value', 'value', 'scale', 'a'), wire('half', 'value', 'scale', 'b'), wire('scale', 'value', 'compare', 'a'), wire('epsilon', 'value', 'compare', 'b'), wire('scale', 'value', 'out', 'value'), wire('compare', 'value', 'continue', 'value')] }
    };
}
function base(name) { return { format: 'voltweave', version: 1, name, root: 'main', settings: { sampleRate: 8192, blockSize: 256, seed: 1337, speed: 1 }, graphs: library(), widgets: [] }; }
export function signalDemo() {
    const p = base('Signal Integrity Bench');
    p.graphs.main = { id: 'main', name: 'Signal Integrity Bench.vi', inputs: [], outputs: [],
        nodes: [
            node('frequency', 'control', 40, 60, { value: 64, min: 1, max: 512, unit: 'Hz' }, 'Frequency'),
            node('amplitude', 'control', 40, 280, { value: 2.5, min: 0, max: 5, unit: 'V' }, 'Amplitude'),
            node('generator', 'signal', 320, 70, { frequency: 64 }, 'Function generator'),
            node('noise', 'noise', 320, 310, { amplitude: .28 }, 'Seeded white noise'),
            node('mixer', 'mix', 600, 110, {}, 'Source + noise'),
            node('cutoff', 'control', 600, 360, { value: 180, min: 20, max: 1000, unit: 'Hz' }, 'Filter cutoff'),
            node('filter', 'filter', 880, 100, { cutoff: 180 }, '2-pole low-pass'),
            node('stats', 'rms', 1160, 20, {}, 'Signal measurements'),
            node('scope', 'scope', 1440, 100, {}, 'Acquisition scope'),
            node('fft', 'fft', 1160, 300, {}, 'Frequency spectrum'),
            node('rc', 'instrument', 880, 540, {}, 'RC network · DAQ 01'),
            node('limit', 'constant', 1160, 600, { value: 3 }, 'Peak limit · 3 V'),
            node('alarm', 'compare', 1440, 450, { operation: '>' }, 'Over-range detector'),
            node('calibrate', 'subvi', 1440, 690, { graph: 'gain-vi' }, 'Calibration.vi'),
            node('clock', 'time', 40, 550, {}, 'Deterministic clock')
        ],
        edges: [wire('frequency', 'value', 'generator', 'frequency'), wire('amplitude', 'value', 'generator', 'amplitude'), wire('generator', 'wave', 'mixer', 'a'), wire('noise', 'wave', 'mixer', 'b'), wire('mixer', 'wave', 'filter', 'x', true), wire('cutoff', 'value', 'filter', 'cutoff'), wire('filter', 'wave', 'stats', 'x'), wire('mixer', 'wave', 'scope', 'channel1'), wire('filter', 'wave', 'scope', 'channel2'), wire('mixer', 'wave', 'fft', 'x'), wire('filter', 'wave', 'rc', 'drive'), wire('stats', 'peak', 'alarm', 'a'), wire('limit', 'value', 'alarm', 'b'), wire('stats', 'rms', 'calibrate', 'value', true)] };
    p.widgets = [
        widget('scope-panel', 'scope', 'Acquisition scope', { node: 'mixer', port: 'wave' }, 24, 24, 688, 324, { source2: { node: 'filter', port: 'wave' }, unit: 'V', range: 4, timebase: .01, channel1: 'Source + noise', channel2: 'Low-pass output' }),
        widget('frequency-knob', 'knob', 'Frequency', 'frequency', 736, 24, 180, 184, { unit: 'Hz', min: 1, max: 512, step: 1 }),
        widget('amplitude-knob', 'knob', 'Amplitude', 'amplitude', 936, 24, 180, 184, { unit: 'V', min: 0, max: 5, step: .05 }),
        widget('cutoff-slider', 'slider', 'Low-pass cutoff', 'cutoff', 736, 228, 380, 120, { unit: 'Hz', min: 20, max: 1000, step: 1 }),
        widget('rms-meter', 'meter', 'RMS voltage', { node: 'calibrate', port: 'value' }, 24, 372, 212, 136, { unit: 'V', digits: 4, subtitle: 'Calibrated · ×1.025' }),
        widget('peak-meter', 'meter', 'Peak amplitude', { node: 'stats', port: 'peak' }, 256, 372, 212, 136, { unit: 'V', digits: 4, subtitle: 'Absolute peak' }),
        widget('frequency-meter', 'meter', 'Dominant frequency', { node: 'fft', port: 'peakHz' }, 488, 372, 224, 136, { unit: 'Hz', digits: 1, subtitle: '256-point FFT · Hann' }),
        widget('temperature-meter', 'meter', 'Instrument temperature', { node: 'rc', port: 'temperature' }, 736, 372, 180, 136, { unit: '°C', digits: 2, subtitle: 'RC network · simulated' }),
        widget('overload-led', 'led', 'Over-range', 'alarm', 936, 372, 180, 136, { subtitle: 'Peak threshold · 3.0 V' }),
        widget('fft-chart', 'chart', 'Amplitude spectrum', { node: 'fft', port: 'spectrum' }, 24, 532, 548, 248, { unit: 'V', range: 3, spectrum: true, channel1: 'Amplitude spectrum' }),
        widget('rc-chart', 'chart', 'Virtual instrument response', { node: 'filter', port: 'wave' }, 596, 532, 520, 248, { source2: { node: 'rc', port: 'voltage' }, unit: 'V', range: 4, timebase: .01, channel1: 'Drive', channel2: 'Capacitor voltage' })
    ];
    return p;
}
export function structuresDemo() {
    const p = base('Structures & Array Laboratory');
    p.graphs.main = { id: 'main', name: 'Structures & Arrays.vi', inputs: [], outputs: [], nodes: [node('count', 'control', 40, 70, { value: 16, min: 0, max: 64 }, 'Iteration count'), node('range', 'range', 320, 70), node('map', 'arrayMap', 610, 70, { operation: 'square', scale: 1 }), node('stats', 'arrayStats', 910, 70), node('loop', 'for', 320, 380, { count: 16 }, 'For · accumulate i'), node('flag', 'boolean', 610, 390, { value: true }, 'Select true case'), node('case', 'case', 910, 430), node('seed', 'constant', 40, 650, { value: 64 }), node('while', 'while', 320, 650, { limit: 32 }, 'While · converge'), node('calibrate', 'subvi', 1210, 440, { graph: 'gain-vi' })], edges: [wire('count', 'value', 'range', 'count'), wire('range', 'array', 'map', 'array'), wire('map', 'array', 'stats', 'array', true), wire('count', 'value', 'loop', 'count'), wire('loop', 'value', 'case', 'value', true), wire('flag', 'value', 'case', 'selector'), wire('case', 'value', 'calibrate', 'value'), wire('seed', 'value', 'while', 'seed')] };
    p.widgets = [widget('count-ui', 'slider', 'Iteration count', 'count', 24, 24, 350, 130, { min: 0, max: 64, step: 1 }), widget('flag-ui', 'toggle', 'Case selector', 'flag', 394, 24, 230, 130), widget('sum-ui', 'meter', 'For-loop accumulation', 'loop', 644, 24, 220, 130, { digits: 0 }), widget('case-ui', 'meter', 'Selected case output', 'case', 884, 24, 230, 130, { digits: 0 }), widget('squared-ui', 'array', 'Squared ramp · DBL[]', { node: 'map', port: 'array' }, 24, 180, 540, 260), widget('loop-values', 'array', 'Auto-indexed loop values', { node: 'loop', port: 'values' }, 588, 180, 526, 260), widget('while-meter', 'meter', 'Converged value', 'while', 24, 468, 280, 150, { digits: 8 }), widget('iterations-meter', 'meter', 'While iterations', { node: 'while', port: 'iterations' }, 328, 468, 260, 150, { digits: 0 }), widget('stats-meter', 'meter', 'Sum of squares', { node: 'stats', port: 'sum' }, 612, 468, 240, 150, { digits: 0 }), widget('cal-meter', 'meter', 'Reusable VI output', 'calibrate', 876, 468, 238, 150, { digits: 3 })];
    return p;
}
export function feedbackDemo() {
    const p = base('Closed-loop Control Bench');
    p.settings.sampleRate = 1000;
    p.settings.blockSize = 20;
    p.graphs.main = { id: 'main', name: 'Feedback Control.vi', inputs: [], outputs: [], nodes: [node('setpoint', 'control', 40, 60, { value: 1, min: -5, max: 5 }, 'Setpoint'), node('previous', 'delay', 40, 330, { initial: 0 }, 'Plant · previous state'), node('pid', 'pid', 340, 70, { kp: .5, ki: .8, kd: .01, min: -10, max: 10 }), node('plant', 'integrate', 650, 70, { initial: 0 }, 'Plant · integral'), node('error', 'subtract', 960, 100, {}, 'Tracking error'), node('clock', 'time', 650, 370)], edges: [wire('setpoint', 'value', 'pid', 'setpoint'), wire('previous', 'value', 'pid', 'process', true), wire('pid', 'value', 'plant', 'x'), wire('plant', 'value', 'previous', 'x'), wire('setpoint', 'value', 'error', 'a'), wire('plant', 'value', 'error', 'b')] };
    p.widgets = [widget('response', 'chart', 'Closed-loop step response', 'plant', 24, 24, 770, 360, { source2: { node: 'setpoint', port: 'value' }, range: 6, timebase: .5, channel1: 'Plant response', channel2: 'Setpoint' }), widget('setpoint-ui', 'knob', 'Setpoint', 'setpoint', 818, 24, 296, 220, { min: -5, max: 5, step: .1 }), widget('error-ui', 'meter', 'Tracking error', 'error', 818, 268, 296, 116, { digits: 5 }), widget('output', 'meter', 'Plant output', 'plant', 24, 410, 348, 144, { digits: 5 }), widget('drive', 'meter', 'PID control effort', 'pid', 396, 410, 348, 144, { digits: 5 }), widget('time', 'meter', 'Simulation time', { node: 'clock', port: 'time' }, 768, 410, 346, 144, { digits: 3, unit: 's' })];
    return p;
}
export function emptyProject() { const p = base('Untitled instrument'); p.graphs.main = { id: 'main', name: 'Untitled.vi', inputs: [], outputs: [], nodes: [], edges: [] }; return p; }
export const DEMOS = { signal: signalDemo, structures: structuresDemo, feedback: feedbackDemo, empty: emptyProject };
