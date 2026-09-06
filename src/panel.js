import { Surface, RingBuffer, decimate } from './gpu.js';
import { formatValue } from './types.js';
import { $, el, svg, clamp, snap, download } from './util.js';
export const WIDGETS = {
    knob: { name: 'Rotary knob', glyph: '◉', category: 'Controls', type: 'number', w: 180, h: 184 },
    slider: { name: 'Horizontal slider', glyph: '⊶', category: 'Controls', type: 'number', w: 340, h: 125 },
    numeric: { name: 'Numeric input', glyph: '123', category: 'Controls', type: 'number', w: 220, h: 130 },
    toggle: { name: 'Boolean switch', glyph: '⊷', category: 'Controls', type: 'boolean', w: 210, h: 130 },
    arrayControl: { name: 'Array editor', glyph: '[ ]', category: 'Controls', type: 'array', w: 360, h: 220 },
    meter: { name: 'Digital meter', glyph: 'DBL', category: 'Indicators', type: 'number', w: 230, h: 136 },
    gauge: { name: 'Analog gauge', glyph: '◴', category: 'Indicators', type: 'number', w: 240, h: 170 },
    led: { name: 'Boolean LED', glyph: '●', category: 'Indicators', type: 'boolean', w: 180, h: 136 },
    chart: { name: 'Waveform chart', glyph: '⌁', category: 'Displays', type: 'waveform', w: 520, h: 260 },
    scope: { name: 'Oscilloscope', glyph: '∿', category: 'Displays', type: 'waveform', w: 650, h: 320 },
    array: { name: 'Array indicator', glyph: '[#]', category: 'Indicators', type: 'array', w: 400, h: 250 },
    text: { name: 'String indicator', glyph: 'abc', category: 'Indicators', type: 'string', w: 320, h: 150 }
};
export class ScopePlot {
    constructor(panel, widget, container) {
        this.panel = panel;
        this.app = panel.app;
        this.widget = widget;
        this.container = container;
        this.rings = [new RingBuffer(), new RingBuffer()];
        this.latest = [null, null];
        this.frozen = false;
        this.triggered = true;
        this.autoRange = false;
        this.cursorEnabled = false;
        this.cursorPositions = [.3, .7];
        this.display = [[], []];
        this.lastTick = -1;
        const shell = el('div', { class: 'plot-shell' });
        const channels = el('div', { class: 'scope-channel' }, el('span', {}, el('i'), el('span', { text: widget.channel1 || 'Channel 1' })));
        if (widget.source2)
            channels.append(el('span', { class: 'ch2' }, el('i'), el('span', { text: widget.channel2 || 'Channel 2' })));
        this.modeLabel = el('span', { class: 'scope-mode' }, el('i'), el('span', { text: widget.spectrum ? 'FFT · HANN' : 'AUTO' }));
        shell.append(el('div', { class: 'scope-top' }, channels, this.modeLabel));
        this.area = el('div', { class: 'plot-area' });
        const canvas = el('canvas', { 'aria-label': widget.label });
        this.labels = el('div', { class: 'plot-labels' }, el('span', { class: 'y-max', text: '+4.0' }), el('span', { class: 'y-zero', text: '0.0' }), el('span', { class: 'y-min', text: '−4.0' }), el('span', { class: 'x-max', text: '100 ms' }), el('span', { class: 'trigger-label', text: 'T → 0.00 V' }));
        this.cursorReadout = el('span', { class: 'cursor-readout', hidden: true });
        this.area.append(canvas, this.labels, this.cursorReadout);
        shell.append(this.area);
        container.append(shell);
        this.surface = new Surface(canvas, () => this.draw());
        this.readouts = el('div', { class: 'scope-readouts' });
        const controls = el('div', { class: 'scope-actions' });
        const hold = el('button', { text: 'HOLD', title: 'Freeze this display (acquisition continues)', onclick: () => { this.frozen = !this.frozen; hold.classList.toggle('active', this.frozen); this.draw(); } });
        const auto = el('button', { text: 'AUTO', title: 'Automatic vertical range', onclick: () => { this.autoRange = !this.autoRange; auto.classList.toggle('active', this.autoRange); this.draw(); } });
        const cursor = el('button', { text: 'CURS', title: 'Toggle measurement cursors; click the plot to position the nearest cursor', onclick: () => { this.cursorEnabled = !this.cursorEnabled; cursor.classList.toggle('active', this.cursorEnabled); this.cursorReadout.hidden = !this.cursorEnabled; this.draw(); } });
        controls.append(hold, auto, cursor);
        if (!widget.spectrum) {
            const timebase = el('select', { title: 'Timebase (seconds per division)', 'aria-label': `${widget.label} timebase` });
            for (const t of [.001, .002, .005, .01, .02, .05, .1, .2, .5, 1])
                timebase.append(el('option', { value: t, text: t < 1 ? `${t * 1000} ms` : '1 s', selected: t === (widget.timebase || .01) }));
            timebase.onchange = () => { this.app.beginChange('Change scope timebase'); widget.timebase = Number(timebase.value); this.app.finishChange({ runtime: false, render: false }); this.draw(); };
            controls.append(timebase);
            const trig = el('button', { text: 'TRIG', class: 'active', title: 'Rising-edge trigger at the configured level', onclick: () => { this.triggered = !this.triggered; trig.classList.toggle('active', this.triggered); this.draw(); } });
            controls.append(trig);
        }
        controls.append(el('button', { text: 'CSV', title: 'Export visible channel samples', onclick: () => this.exportCSV() }));
        container.append(el('div', { class: 'scope-bottom' }, this.readouts, controls));
        this.observer = new ResizeObserver(() => this.draw());
        this.observer.observe(this.area);
        this.area.addEventListener('pointerdown', e => {
            if (!this.cursorEnabled)
                return;
            const r = this.area.getBoundingClientRect(), fraction = clamp((e.clientX - r.left) / r.width, 0, 1), index = Math.abs(fraction - this.cursorPositions[0]) < Math.abs(fraction - this.cursorPositions[1]) ? 0 : 1;
            this.cursorPositions[index] = fraction;
            this.draw();
        });
    }
    reset() { this.rings.forEach(r => r.clear()); this.latest = [null, null]; this.lastTick = -1; this.frozenDisplay = null; this.draw(); }
    ingest(frame) {
        if (frame.tick === this.lastTick)
            return;
        this.lastTick = frame.tick;
        const sources = [this.widget.source, this.widget.source2];
        sources.forEach((source, i) => {
            const value = this.app.value(source);
            this.latest[i] = value;
            if (value?.samples && !this.widget.spectrum)
                this.rings[i].append(value.samples, value.dt, value.t0);
            else if (typeof value === 'number')
                this.rings[i].append([value], frame.duration, frame.time);
            else if (value instanceof Float64Array)
                this.rings[i].append(value, 1, 0);
        });
        if (!this.frozen)
            this.draw();
    }
    visible() {
        if (this.frozen && this.frozenDisplay)
            return this.frozenDisplay;
        const w = this.widget;
        let display, dt, duration, triggered = false;
        if (w.spectrum) {
            const first = this.latest[0];
            dt = first?.dt || 1;
            const count = Math.min(first?.samples.length || 0, Math.floor((w.maxFrequency || 1024) / dt) + 1);
            display = this.latest.map(x => x?.samples?.slice(0, count) || new Float64Array());
            duration = Math.max(1, count - 1) * dt;
        }
        else {
            dt = this.rings[0].dt;
            const count = Math.max(2, Math.ceil((w.timebase || .01) * 10 / dt));
            const raw = this.rings.map(r => r.tail(count * 2)), length = raw[0].length;
            let start = Math.max(0, length - count);
            if (this.triggered && length >= count) {
                const pre = Math.floor(count * .1), level = Number(w.triggerLevel || 0), max = length - count + pre;
                for (let i = max; i > pre; i--)
                    if (raw[0][i - 1] < level && raw[0][i] >= level) {
                        start = i - pre;
                        triggered = true;
                        break;
                    }
            }
            display = raw.map(x => x.slice(start, start + count));
            duration = (Math.max(2, display[0].length) - 1) * dt;
        }
        const result = { display, dt, duration, triggered };
        this.frozenDisplay = result;
        return result;
    }
    draw() {
        const width = this.area.clientWidth, height = this.area.clientHeight;
        if (!width || !height)
            return;
        this.surface.resize(width, height);
        const mesh = this.surface.mesh;
        mesh.reset();
        const { display, dt, duration, triggered } = this.visible();
        this.display = display;
        this.displayDt = dt;
        const w = this.widget;
        let range = w.range || 4;
        if (this.autoRange) {
            let max = .001;
            for (const a of display)
                for (const x of a)
                    max = Math.max(max, Math.abs(x));
            range = max * 1.15;
        }
        const left = 32, right = width - 12, top = 13, bottom = height - 22, plotW = Math.max(1, right - left), plotH = Math.max(1, bottom - top), center = w.spectrum ? bottom : (top + bottom) / 2;
        const y = value => w.spectrum ? bottom - clamp(value / range, 0, 1) * plotH : center - clamp(value / range, -1, 1) * plotH * .5;
        for (let i = 0; i <= 10; i++) {
            const x = left + i * plotW / 10;
            mesh.line(x, top, x, bottom, i === 0 ? .8 : .5, '#31454c', i % 5 === 0 ? .8 : .45);
        }
        for (let i = 0; i <= 8; i++) {
            const yy = top + i * plotH / 8;
            mesh.line(left, yy, right, yy, i === 4 ? 1 : .5, '#31454c', i === 4 ? .9 : .4);
        }
        mesh.line(left, center, right, center, .8, '#50615e', .5);
        for (let i = 1; i < 50; i++) {
            const x = left + i / 50 * plotW;
            mesh.line(x, center - 2, x, center + 2, .6, '#657b72', .4);
        }
        const colors = ['#b6d595', '#e3b977'];
        display.forEach((samples, index) => {
            if (!samples.length)
                return;
            const data = decimate(samples, Math.floor(plotW));
            const points = data.map(([i, v]) => [left + i / Math.max(1, samples.length - 1) * plotW, y(v)]);
            if (w.spectrum)
                for (const [x, yy] of points)
                    mesh.line(x, bottom, x, yy, Math.min(3, plotW / Math.max(1, points.length) * .35), colors[index], .48);
            mesh.polyline(points, index === 0 ? 1.35 : 1.65, colors[index]);
        });
        if (this.cursorEnabled) {
            const [a, b] = this.cursorPositions, data = display[0], va = data[Math.round(a * (data.length - 1))] || 0, vb = data[Math.round(b * (data.length - 1))] || 0;
            for (const t of [a, b]) {
                const x = left + t * plotW;
                for (let yy = top; yy < bottom; yy += 7)
                    mesh.line(x, yy, x, Math.min(bottom, yy + 3), .8, '#d9e8be', .85);
            }
            this.cursorReadout.textContent = w.spectrum ? `Δf ${formatValue(Math.abs(b - a) * duration)} Hz  ΔV ${formatValue(vb - va)} ${w.unit || ''}` : `Δt ${formatValue(Math.abs(b - a) * duration * 1000)} ms  ΔV ${formatValue(vb - va)} ${w.unit || ''}`;
        }
        this.labels.querySelector('.y-max').textContent = `${formatValue(range, 3)}`;
        this.labels.querySelector('.y-min').textContent = w.spectrum ? '0' : `−${formatValue(range, 3)}`;
        this.labels.querySelector('.y-zero').hidden = !!w.spectrum;
        this.labels.querySelector('.x-max').textContent = w.spectrum ? `${formatValue(duration)} Hz` : `${formatValue(duration * 1000)} ms`;
        this.labels.querySelector('.trigger-label').textContent = w.spectrum ? `${formatValue(dt)} Hz / bin` : `T → ${formatValue(w.triggerLevel || 0)} ${w.unit || 'V'}`;
        this.modeLabel.lastChild.textContent = this.frozen ? 'HOLD' : w.spectrum ? 'FFT' : this.triggered ? triggered ? 'AUTO · TRIG' : 'AUTO · WAIT' : 'FREE RUN';
        this.readouts.replaceChildren(el('span', {}, 'H ', el('b', { text: w.spectrum ? `${formatValue(dt)} Hz/bin` : `${formatValue((w.timebase || .01) * 1000)} ms/div` })), el('span', {}, 'V ', el('b', { text: `${formatValue(range / 4, 3)} ${w.unit || 'V'}/div` })));
        this.surface.draw('#15242c');
    }
    exportCSV() {
        const rows = ['x,channel1,channel2'];
        const length = Math.max(...this.display.map(x => x.length));
        for (let i = 0; i < length; i++)
            rows.push(`${i * this.displayDt},${this.display[0][i] ?? ''},${this.display[1][i] ?? ''}`);
        download(`${this.widget.label.replace(/[^a-z0-9-]/gi, '_')}.csv`, rows.join('\n'), 'text/csv');
    }
    dispose() { this.surface.dispose(); this.observer.disconnect(); }
}
export class Panel {
    constructor(app) {
        this.app = app;
        this.world = $('#panel-world');
        this.scroll = $('#panel-scroll');
        this.plots = new Map();
        this.elements = new Map();
        this.scale = 1;
        this.fitAll = false;
        this.layoutMode = false;
        this.stage = el('div', { class: 'panel-stage', style: { position: 'relative', margin: '0 auto', overflow: 'hidden' } });
        this.world.replaceWith(this.stage);
        this.stage.append(this.world);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.scroll);
        this.world.addEventListener('pointerdown', e => this.pointerDown(e));
        window.addEventListener('pointermove', e => this.pointerMove(e));
        window.addEventListener('pointerup', () => this.pointerUp());
        this.world.addEventListener('contextmenu', e => {
            const widgetElement = e.target.closest('.widget');
            if (!widgetElement)
                return;
            e.preventDefault();
            this.app.select({ kind: 'widget', id: widgetElement.dataset.widget });
            this.app.showContext([{ label: 'Edit front-panel layout', action: () => this.app.setLayoutMode(true) }, { label: 'Show diagram terminal', action: () => { const w = this.app.project.widgets.find(w => w.id === widgetElement.dataset.widget); this.app.openGraph(this.app.project.root); this.app.select({ kind: 'nodes', ids: [w.source?.node] }); } }, { label: 'Duplicate control', action: () => this.app.duplicate() }, { label: 'Delete control', danger: true, action: () => this.app.deleteSelection() }], e.clientX, e.clientY);
        });
    }
    render() {
        for (const plot of this.plots.values())
            plot.dispose();
        this.plots.clear();
        this.elements.clear();
        this.world.replaceChildren();
        for (const w of this.app.project.widgets)
            this.createWidget(w);
        this.resize();
        this.updateSelection();
        this.update(this.app.lastFrame);
    }
    createWidget(w) {
        const root = el('section', { class: `widget widget-${w.kind}`, dataset: { widget: w.id }, style: { left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px` }, 'aria-label': w.label });
        const badge = ['knob', 'slider', 'numeric', 'toggle', 'arrayControl'].includes(w.kind) ? 'IN' : w.kind === 'scope' ? 'CH 1 / 2' : w.kind === 'chart' ? 'GRAPH' : w.kind === 'led' ? 'BOOL' : w.kind === 'array' ? 'DBL[]' : w.kind === 'text' ? 'STR' : 'DBL';
        root.append(el('header', { class: 'widget-header' }, el('span', { class: 'widget-label', text: w.label }), el('span', { class: 'widget-type' }, el('span', { class: 'grip', text: '⠿' }), badge)));
        const body = el('div', { class: 'widget-body' });
        const node = this.app.project.graphs[this.app.project.root].nodes.find(n => n.id === w.source?.node), min = w.min ?? node?.params.min ?? 0, max = w.max ?? node?.params.max ?? 10, step = w.step || .1;
        const change = value => { if (w.source?.node)
            this.app.setControl(w.source.node, value);
        else
            this.app.toast('Bind this control to a control node in Properties.', true); };
        if (w.kind === 'knob') {
            const dial = el('div', { class: 'knob-dial', role: 'slider', tabindex: 0, 'aria-label': w.label, 'aria-valuemin': min, 'aria-valuemax': max });
            const s = svg('svg', { viewBox: '0 0 112 100' });
            for (let a = -135; a <= 135; a += 22.5) {
                const r = (a - 90) * Math.PI / 180;
                s.append(svg('line', { x1: 56 + Math.cos(r) * 42, y1: 48 + Math.sin(r) * 42, x2: 56 + Math.cos(r) * 46, y2: 48 + Math.sin(r) * 46, class: 'knob-tick' }));
            }
            const arc = svg('path', { d: 'M 30.55 73.45 A 36 36 0 1 1 81.45 73.45', class: 'knob-track' });
            const active = svg('path', { class: 'knob-active' });
            s.append(arc, active, svg('circle', { cx: 56, cy: 48, r: 29, class: 'knob-circle' }), svg('circle', { cx: 56, cy: 48, r: 24, class: 'knob-inset' }), svg('line', { x1: 56, y1: 48, x2: 56, y2: 28, class: 'knob-needle' }));
            dial.append(s);
            const number = el('input', { type: 'number', min, max, step, 'aria-label': `${w.label} value`, onchange: () => change(clamp(Number(number.value), min, max)) });
            let drag = null;
            dial.addEventListener('pointerdown', e => { e.stopPropagation(); this.app.select({ kind: 'widget', id: w.id }); drag = { y: e.clientY, value: Number(this.app.controlValue(w.source)) || 0 }; dial.setPointerCapture(e.pointerId); });
            dial.addEventListener('pointermove', e => { if (!drag)
                return; const raw = drag.value + (drag.y - e.clientY) * (max - min) / 160; change(clamp(Math.round(raw / step) * step, min, max)); });
            dial.addEventListener('pointerup', () => { drag = null; this.app.endControlEdit(); });
            dial.addEventListener('keydown', e => { if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                change(e.key === 'Home' ? min : e.key === 'End' ? max : clamp(Number(this.app.controlValue(w.source)) + (['ArrowUp', 'ArrowRight'].includes(e.key) ? step : -step), min, max));
            } });
            body.append(dial, el('div', { class: 'knob-limits' }, el('span', { text: min }), el('span', { text: max })), el('div', { class: 'knob-value' }, number, el('span', { text: w.unit || '' })));
        }
        else if (w.kind === 'slider') {
            const range = el('input', { type: 'range', min, max, step, 'aria-label': w.label }), number = el('input', { type: 'number', min, max, step, 'aria-label': `${w.label} value` });
            range.oninput = () => change(Number(range.value));
            range.onchange = () => this.app.endControlEdit();
            number.onchange = () => change(clamp(Number(number.value), min, max));
            body.classList.add('slider-body');
            body.append(el('div', { class: 'slider-row' }, range, number, el('span', { class: 'slider-unit', text: w.unit || '' })), el('div', { class: 'slider-labels' }, el('span', { text: `${min} ${w.unit || ''}` }), el('span', { text: `${max} ${w.unit || ''}` })));
        }
        else if (w.kind === 'numeric') {
            const input = el('input', { type: 'number', step, 'aria-label': w.label, onchange: () => change(Number(input.value)) });
            body.append(el('div', { class: 'numeric-control' }, input, el('span', { text: w.unit || '' })));
        }
        else if (w.kind === 'toggle') {
            const toggle = el('button', { class: 'toggle-switch', role: 'switch', 'aria-label': w.label, onclick: () => { change(!this.app.controlValue(w.source)); this.app.endControlEdit(); } }, el('span'));
            body.append(el('div', { class: 'toggle-body' }, toggle, el('span', { class: 'toggle-caption', text: 'FALSE' })));
        }
        else if (w.kind === 'arrayControl') {
            const input = el('textarea', { class: 'array-control', 'aria-label': w.label, spellcheck: false, onchange: () => change(input.value) });
            body.append(input);
        }
        else if (w.kind === 'meter') {
            body.append(el('div', { class: 'numeric-display' }, el('span', { class: 'meter-value', text: '—' }), el('small', { text: w.unit || '' })), el('div', { class: 'widget-subtitle', text: w.subtitle || 'Live measurement' }));
        }
        else if (w.kind === 'led') {
            body.append(el('div', { class: 'led-body' }, el('div', { class: 'led-light' }), el('span', { class: 'led-text', text: 'NORMAL' }), el('span', { class: 'widget-subtitle', text: w.subtitle || 'Boolean indicator' })));
        }
        else if (w.kind === 'scope' || w.kind === 'chart') {
            body.style.display = 'flex';
            body.style.flexDirection = 'column';
            this.plots.set(w.id, new ScopePlot(this, w, body));
        }
        else if (w.kind === 'gauge') {
            const s = svg('svg', { viewBox: '0 0 220 115', class: 'gauge-svg' });
            s.append(svg('path', { d: 'M30 90 A80 80 0 0 1 190 90', fill: 'none', stroke: '#dce6d2', 'stroke-width': 8 }));
            const needle = svg('line', { class: 'gauge-needle', x1: 110, y1: 90, x2: 110, y2: 20, stroke: '#829d69', 'stroke-width': 3 });
            const text = svg('text', { class: 'gauge-value', x: 110, y: 112, 'text-anchor': 'middle', fill: '#7b9563', 'font-family': 'monospace', 'font-size': 13 });
            text.textContent = '—';
            s.append(needle, text);
            body.append(s);
        }
        else if (w.kind === 'array')
            body.append(el('div', { class: 'array-grid' }));
        else
            body.append(el('div', { class: 'text-value', text: '—' }));
        root.append(body, el('div', { class: 'widget-resize', title: 'Resize control' }));
        this.world.append(root);
        this.elements.set(w.id, root);
    }
    update(frame) {
        for (const w of this.app.project.widgets) {
            const e = this.elements.get(w.id);
            if (!e)
                continue;
            const value = this.app.value(w.source), control = this.app.controlValue(w.source), node = this.app.project.graphs[this.app.project.root].nodes.find(n => n.id === w.source?.node);
            if (['knob', 'slider', 'numeric', 'arrayControl'].includes(w.kind))
                for (const input of e.querySelectorAll('input,textarea'))
                    if (document.activeElement !== input)
                        input.value = control ?? '';
            if (w.kind === 'knob') {
                const min = w.min ?? node?.params.min ?? 0, max = w.max ?? node?.params.max ?? 10, fraction = clamp((Number(control) - min) / (max - min || 1), 0, 1), angle = -135 + fraction * 270, r = (angle - 90) * Math.PI / 180;
                const needle = e.querySelector('.knob-needle');
                needle.setAttribute('x2', 56 + Math.cos(r) * 21);
                needle.setAttribute('y2', 48 + Math.sin(r) * 21);
                e.querySelector('.knob-active').setAttribute('d', fraction > .00001 ? `M30.544 73.456 A36 36 0 ${fraction * 270 > 180 ? 1 : 0} 1 ${56 + Math.cos(r) * 36} ${48 + Math.sin(r) * 36}` : '');
                e.querySelector('.knob-dial').setAttribute('aria-valuenow', String(control));
            }
            else if (w.kind === 'meter') {
                e.querySelector('.meter-value').textContent = typeof value === 'number' ? Math.abs(value) >= 1e7 ? value.toExponential(2) : value.toFixed(clamp(Math.trunc(w.digits ?? 3), 0, 10)) : '—';
            }
            else if (w.kind === 'toggle') {
                e.querySelector('.toggle-switch').classList.toggle('on', !!control);
                e.querySelector('.toggle-switch').setAttribute('aria-checked', String(!!control));
                e.querySelector('.toggle-caption').textContent = control ? 'TRUE' : 'FALSE';
            }
            else if (w.kind === 'led') {
                e.querySelector('.led-light').classList.toggle('on', !!value);
                e.querySelector('.led-text').classList.toggle('on', !!value);
                e.querySelector('.led-text').textContent = value ? 'ACTIVE' : 'NORMAL';
            }
            else if (w.kind === 'array') {
                const grid = e.querySelector('.array-grid');
                const signature = formatValue(value) + String(value?.length) + (frame?.tick ?? '');
                if (grid.dataset.value !== signature) {
                    grid.dataset.value = signature;
                    grid.replaceChildren();
                    if (value instanceof Float64Array || Array.isArray(value))
                        Array.from(value).slice(0, 128).forEach((v, i) => grid.append(el('div', { class: 'array-cell' }, el('small', { text: `[${i}]` }), formatValue(v, 6))));
                    else
                        grid.append(el('div', { class: 'array-cell', text: '—' }));
                }
            }
            else if (w.kind === 'gauge') {
                const min = w.min ?? 0, max = w.max ?? 10, a = Math.PI * (1 - clamp(((value || 0) - min) / (max - min || 1), 0, 1)), needle = e.querySelector('.gauge-needle');
                needle.setAttribute('x2', 110 + Math.cos(a) * 70);
                needle.setAttribute('y2', 90 - Math.sin(a) * 70);
                e.querySelector('.gauge-value').textContent = `${formatValue(value, 5)} ${w.unit || ''}`;
            }
            else if (w.kind === 'text')
                e.querySelector('.text-value').textContent = formatValue(value);
            if (frame)
                this.plots.get(w.id)?.ingest(frame);
        }
    }
    reset() { for (const plot of this.plots.values())
        plot.reset(); this.update(); }
    updateSelection() { for (const [id, e] of this.elements)
        e.classList.toggle('selected', this.app.selection?.kind === 'widget' && this.app.selection.id === id); }
    setLayoutMode(enabled) { this.layoutMode = enabled; this.scroll.classList.toggle('editing', enabled); this.resize(); }
    resize() {
        if (!this.scroll.clientWidth)
            return;
        const width = Math.max(1140, ...this.app.project.widgets.map(w => w.x + w.w + 24)), height = Math.max(300, ...this.app.project.widgets.map(w => w.y + w.h + 24));
        const scale = this.layoutMode ? Math.min(1, (this.scroll.clientWidth - 8) / width) : this.fitAll ? Math.min(1.25, (this.scroll.clientWidth - 8) / width, (this.scroll.clientHeight - 8) / height) : Math.min(1, (this.scroll.clientWidth - 8) / width);
        this.scale = Math.max(.25, scale);
        this.world.style.width = `${width}px`;
        this.world.style.height = `${height}px`;
        this.world.style.transform = `scale(${this.scale})`;
        this.stage.style.width = `${width * this.scale}px`;
        this.stage.style.height = `${height * this.scale}px`;
        this.stage.style.marginTop = this.fitAll ? `${Math.max(0, (this.scroll.clientHeight - height * this.scale) / 2)}px` : '0';
        for (const plot of this.plots.values())
            plot.draw();
    }
    fit() { this.fitAll = !this.fitAll; this.resize(); }
    pointerDown(e) {
        const target = e.target.closest('.widget');
        if (!target) {
            this.app.select(null);
            return;
        }
        const id = target.dataset.widget, w = this.app.project.widgets.find(w => w.id === id);
        this.app.select({ kind: 'widget', id });
        if (!this.layoutMode || e.button !== 0 || !e.target.closest('.widget-header,.widget-resize'))
            return;
        e.preventDefault();
        this.drag = { id, kind: e.target.closest('.widget-resize') ? 'resize' : 'move', startX: e.clientX, startY: e.clientY, x: w.x, y: w.y, w: w.w, h: w.h, moved: false };
        target.setPointerCapture(e.pointerId);
    }
    pointerMove(e) {
        if (!this.drag)
            return;
        const d = this.drag, widget = this.app.project.widgets.find(w => w.id === d.id), element = this.elements.get(d.id), dx = (e.clientX - d.startX) / this.scale, dy = (e.clientY - d.startY) / this.scale;
        if (!d.moved && Math.hypot(dx, dy) > 2) {
            this.app.beginChange(d.kind === 'resize' ? 'Resize control' : 'Move control');
            d.moved = true;
        }
        if (!d.moved)
            return;
        if (d.kind === 'resize') {
            widget.w = Math.max(100, snap(d.w + dx));
            widget.h = Math.max(90, snap(d.h + dy));
            element.style.width = `${widget.w}px`;
            element.style.height = `${widget.h}px`;
        }
        else {
            widget.x = Math.max(0, snap(d.x + dx));
            widget.y = Math.max(0, snap(d.y + dy));
            element.style.left = `${widget.x}px`;
            element.style.top = `${widget.y}px`;
        }
    }
    pointerUp() { if (this.drag?.moved) {
        this.app.finishChange({ runtime: false, render: false });
        this.resize();
    } this.drag = null; }
    dispose() { this.resizeObserver.disconnect(); for (const p of this.plots.values())
        p.dispose(); }
}
