import { NODES, TYPES, ports, formatValue } from './types.js';
import { Surface } from './gpu.js';
import { $, el, svg, clamp, snap } from './util.js';
const NODE_WIDTH = 180;
function cubic(a, b, t) {
    const dx = Math.max(70, Math.abs(b.x - a.x) * .48), u = 1 - t;
    return { x: u ** 3 * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * b.y };
}
export class Diagram {
    constructor(app) {
        this.app = app;
        this.viewport = $('#graph-viewport');
        this.layer = $('#node-layer');
        this.hits = $('#wire-hits');
        this.probes = $('#probe-layer');
        this.surface = new Surface($('#graph-canvas'), () => this.invalidate());
        this.transform = { x: 30, y: 35, scale: .8 };
        this.views = new Map();
        this.pending = false;
        this.values = {};
        this.active = new Set();
        this.errorNodes = new Set();
        this.wiring = null;
        this.pointer = { x: 0, y: 0 };
        this.space = false;
        this.resizeObserver = new ResizeObserver(() => this.invalidate());
        this.resizeObserver.observe(this.viewport);
        this.viewport.addEventListener('pointerdown', e => this.pointerDown(e));
        this.viewport.addEventListener('pointermove', e => this.pointerMove(e));
        window.addEventListener('pointerup', e => this.pointerUp(e));
        this.viewport.addEventListener('wheel', e => { e.preventDefault(); const r = this.viewport.getBoundingClientRect(); if (e.shiftKey) {
            this.transform.x -= e.deltaY;
            this.applyTransform();
        }
        else
            this.zoom(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
        this.viewport.addEventListener('contextmenu', e => this.contextMenu(e));
        window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest('input,textarea,select'))
            this.space = true; if (e.key === 'Escape') {
            this.wiring = null;
            this.invalidate();
        } });
        window.addEventListener('keyup', e => { if (e.code === 'Space')
            this.space = false; });
        window.addEventListener('blur', () => { this.space = false; if (this.drag)
            this.pointerUp({}); });
        $('#zoom-in').onclick = () => this.zoom(1.2);
        $('#zoom-out').onclick = () => this.zoom(1 / 1.2);
        $('#zoom-value').onclick = () => this.fit();
    }
    get graph() { return this.app.project.graphs[this.app.graphId]; }
    height(node) { const p = ports(node, this.graph, this.app.project); return 96 + Math.max(1, p.inputs.length, p.outputs.length) * 22; }
    world(clientX, clientY) { const r = this.viewport.getBoundingClientRect(), t = this.transform; return { x: (clientX - r.left - t.x) / t.scale, y: (clientY - r.top - t.y) / t.scale }; }
    screen(point) { return { x: point.x * this.transform.scale + this.transform.x, y: point.y * this.transform.scale + this.transform.y }; }
    portPosition(node, direction, key) { const ps = ports(node, this.graph, this.app.project)[direction === 'in' ? 'inputs' : 'outputs'], index = ps.findIndex(p => p.key === key); return { x: node.x + (direction === 'out' ? NODE_WIDTH : 0), y: node.y + 75 + Math.max(0, index) * 22 }; }
    render() {
        this.layer.replaceChildren();
        this.elements = new Map();
        if (!this.graph)
            return;
        $('#graph-empty').hidden = !!this.graph.nodes.length;
        for (const node of this.graph.nodes) {
            const d = NODES[node.type], sig = ports(node, this.graph, this.app.project), special = ['for', 'while', 'case', 'subvi'].includes(node.type);
            const root = el('div', { class: `graph-node ${special ? 'structure' : ''} ${d.category === 'Controls' ? 'control-node' : ''}`, dataset: { node: node.id }, style: { left: `${node.x}px`, top: `${node.y}px` }, role: 'group', 'aria-label': node.name });
            root.classList.toggle('has-breakpoint', !!node.breakpoint);
            const breakpoint = el('button', { class: 'node-break', text: '●', title: 'Toggle breakpoint', 'aria-label': `Breakpoint on ${node.name}`, onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); this.app.toggleBreakpoint(node.id); } });
            root.append(el('div', { class: 'node-heading' }, el('span', { text: node.name, title: node.name }), breakpoint), el('div', { class: 'node-op' }, el('span', { class: 'node-glyph', text: d.glyph }), el('span', { class: 'node-type-name', text: special ? 'SUBDIAGRAM' : d.category })));
            const ps = el('div', { class: 'node-ports' });
            const makePort = (pin, direction) => {
                const b = el('button', { class: `port ${direction} ${pin.type}`, dataset: { node: node.id, port: pin.key, direction }, title: `${node.name}.${pin.key} · ${TYPES[pin.type].label}${Object.hasOwn(pin, 'default') ? ` (default: ${pin.default})` : ''}`, 'aria-label': `${direction === 'in' ? 'Input' : 'Output'} ${node.name}.${pin.key} (${pin.type})`, style: { '--port-color': TYPES[pin.type].color } }, el('span', { class: 'pin' }), el('span', { text: pin.label || pin.key }));
                return b;
            };
            for (let i = 0; i < Math.max(1, sig.inputs.length, sig.outputs.length); i++)
                ps.append(el('div', { class: 'node-port-row' }, sig.inputs[i] ? makePort(sig.inputs[i], 'in') : el('span'), sig.outputs[i] ? makePort(sig.outputs[i], 'out') : el('span')));
            root.append(ps);
            const footer = el('div', { class: 'node-footer' }, el('span', { class: 'node-value', text: '—' }));
            if (special)
                footer.append(el('button', { class: 'sub-open', text: 'Open VI ↗', onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); this.openBody(node); } }));
            else
                footer.append(el('span', { text: sig.outputs[0] ? TYPES[sig.outputs[0].type].label : 'OUT' }));
            root.append(footer);
            root.addEventListener('dblclick', e => { if (e.target.closest('.port,.node-break'))
                return; if (special)
                this.openBody(node);
            else
                this.app.select({ kind: 'nodes', ids: [node.id] }); });
            this.layer.append(root);
            this.elements.set(node.id, root);
        }
        this.applyTransform();
        this.updateValues(this.values, this.active);
        this.updateSelection();
        this.renderBreadcrumb();
    }
    openBody(node) { this.app.openGraph(node.type === 'case' ? node.params.trueGraph : node.params.graph); }
    renderBreadcrumb() {
        const root = $('#graph-breadcrumb');
        root.replaceChildren();
        root.append(el('button', { text: this.app.project.name, onclick: () => this.app.openGraph(this.app.project.root) }), el('span', { text: '›' }), el('strong', { text: this.graph?.name || '' }));
        if (this.app.graphId !== this.app.project.root)
            root.append(el('button', { text: '← Main VI', style: { marginLeft: 'auto' }, onclick: () => this.app.openGraph(this.app.project.root) }));
        const info = el('span', { text: 'Typed dataflow', style: { marginLeft: 'auto', color: '#a2afb1', fontSize: '8px' } });
        root.append(info);
    }
    updateSelection() {
        const ids = this.app.selection?.kind === 'nodes' ? this.app.selection.ids : [];
        for (const [id, e] of this.elements || [])
            e.classList.toggle('selected', ids.includes(id));
        this.invalidate();
    }
    updateValues(values, active = new Set()) {
        this.values = values || {};
        this.active = active;
        for (const [id, element] of this.elements || []) {
            const outputs = this.values[`${this.app.graphId}/${id}`], value = outputs && Object.values(outputs)[0];
            element.querySelector('.node-value').textContent = formatValue(value, 5);
            element.classList.toggle('executing', this.app.highlight && active.has(`${this.app.graphId}/${id}`));
            element.classList.toggle('error-node', this.errorNodes.has(id));
        }
        this.invalidate();
    }
    setErrors(errors) { this.errorNodes = new Set(errors.filter(x => x.graph === this.app.graphId && x.node).map(x => x.node)); this.updateValues(this.values, this.active); }
    switchGraph(previous) { if (previous)
        this.views.set(previous, { ...this.transform }); this.transform = this.views.get(this.app.graphId) || { x: 25, y: 35, scale: .8 }; this.render(); if (!this.views.has(this.app.graphId))
        requestAnimationFrame(() => this.fit()); }
    applyTransform() {
        const t = this.transform, style = `translate(${t.x}px,${t.y}px) scale(${t.scale})`;
        this.layer.style.transform = style;
        this.probes.style.transform = style;
        $('#zoom-value').textContent = `${Math.round(t.scale * 100)}%`;
        this.invalidate();
    }
    zoom(factor, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
        const t = this.transform, scale = clamp(t.scale * factor, .15, 2.5), wx = (x - t.x) / t.scale, wy = (y - t.y) / t.scale;
        t.x = x - wx * scale;
        t.y = y - wy * scale;
        t.scale = scale;
        this.applyTransform();
    }
    fit() {
        if (!this.viewport.clientWidth || !this.viewport.clientHeight || !this.graph?.nodes.length)
            return;
        const g = this.graph, minX = Math.min(...g.nodes.map(n => n.x)), maxX = Math.max(...g.nodes.map(n => n.x + NODE_WIDTH)), minY = Math.min(...g.nodes.map(n => n.y)), maxY = Math.max(...g.nodes.map(n => n.y + this.height(n)));
        const scale = clamp(Math.min((this.viewport.clientWidth - 110) / (maxX - minX), (this.viewport.clientHeight - 95) / (maxY - minY)), .15, 1.3);
        this.transform = { x: (this.viewport.clientWidth - (maxX - minX) * scale) / 2 - minX * scale, y: (this.viewport.clientHeight - (maxY - minY) * scale) / 2 - minY * scale - 10, scale };
        this.applyTransform();
    }
    invalidate() { if (this.pending)
        return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.draw(); }); }
    draw() {
        const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
        if (!width || !height || !this.graph)
            return;
        this.surface.resize(width, height);
        const mesh = this.surface.mesh;
        mesh.reset();
        const t = this.transform;
        const step = 24 * t.scale;
        if (step > 7)
            for (let x = ((t.x % step) + step) % step; x < width; x += step)
                for (let y = ((t.y % step) + step) % step; y < height; y += step)
                    mesh.dot(x, y, 1, '#cfd9de');
        const hits = document.createDocumentFragment(), probes = document.createDocumentFragment();
        let probeIndex = 0;
        const nodes = new Map(this.graph.nodes.map(n => [n.id, n]));
        for (const edge of this.graph.edges) {
            const source = nodes.get(edge.from.node), target = nodes.get(edge.to.node);
            if (!source || !target)
                continue;
            const pin = ports(source, this.graph, this.app.project).outputs.find(p => p.key === edge.from.port);
            if (!pin)
                continue;
            const a = this.portPosition(source, 'out', edge.from.port), b = this.portPosition(target, 'in', edge.to.port);
            const color = TYPES[pin.type].color, selected = this.app.selection?.kind === 'wire' && this.app.selection.id === edge.id;
            const points = Array.from({ length: 33 }, (_, i) => this.screen(cubic(a, b, i / 32)));
            const isActive = this.app.highlight && this.active.has(`${this.app.graphId}/${source.id}`);
            for (let i = 1; i < points.length; i++) {
                const x = points[i - 1], y = points[i];
                if (selected)
                    mesh.line(x.x, x.y, y.x, y.y, 7, color, .16);
                mesh.line(x.x, x.y, y.x, y.y, pin.type === 'array' || pin.type === 'waveform' ? 2.5 : 1.7, color, isActive ? 1 : .73);
            }
            if (isActive) {
                const dot = this.screen(cubic(a, b, (performance.now() * .0003 + source.x * .0002) % 1));
                mesh.dot(dot.x, dot.y, 5, '#ffffd5');
            }
            const sa = this.screen(a), sb = this.screen(b), dx = Math.max(70, Math.abs(b.x - a.x) * .48) * t.scale;
            const path = svg('path', { d: `M${sa.x},${sa.y} C${sa.x + dx},${sa.y} ${sb.x - dx},${sb.y} ${sb.x},${sb.y}`, 'data-edge': edge.id });
            path.addEventListener('dblclick', e => { e.stopPropagation(); this.app.toggleProbe(edge.id); });
            hits.append(path);
            if (edge.probe) {
                probeIndex++;
                const middle = cubic(a, b, .5), value = this.values[`${this.app.graphId}/${source.id}`]?.[edge.from.port];
                const label = el('div', { class: 'probe-tag', style: { left: `${middle.x}px`, top: `${middle.y - 18}px` }, title: formatValue(value), onclick: e => { e.stopPropagation(); this.app.select({ kind: 'wire', id: edge.id }); } }, el('span', { class: 'probe-index', text: `P${probeIndex}` }), el('span', { text: formatValue(value, 4) }));
                probes.append(label);
            }
        }
        if (this.wiring) {
            const n = nodes.get(this.wiring.node), start = this.portPosition(n, this.wiring.direction, this.wiring.port), a = this.wiring.direction === 'out' ? start : this.pointer, b = this.wiring.direction === 'out' ? this.pointer : start;
            const pts = Array.from({ length: 33 }, (_, i) => this.screen(cubic(a, b, i / 32)));
            for (let i = 1; i < pts.length; i++)
                mesh.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, 2, '#728f7b', .9);
        }
        this.hits.replaceChildren(hits);
        this.probes.replaceChildren(probes);
        this.surface.draw('#f8fafb');
    }
    pointerDown(e) {
        if (e.button === 2)
            return;
        this.viewport.focus({ preventScroll: true });
        const port = e.target.closest('.port'), wire = e.target.closest('[data-edge]'), nodeElement = e.target.closest('.graph-node');
        if (e.button === 1 || this.space) {
            e.preventDefault();
            this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, start: { ...this.transform } };
            this.viewport.setPointerCapture(e.pointerId);
            return;
        }
        if (port) {
            e.preventDefault();
            e.stopPropagation();
            const terminal = { ...port.dataset };
            if (this.wiring && this.wiring.direction !== terminal.direction)
                this.finishWire(terminal);
            else {
                this.wiring = terminal;
                this.pointer = this.world(e.clientX, e.clientY);
                this.invalidate();
            }
            return;
        }
        if (e.target.closest('button,.probe-tag'))
            return;
        if (wire) {
            this.app.select({ kind: 'wire', id: wire.dataset.edge });
            return;
        }
        if (nodeElement) {
            const id = nodeElement.dataset.node, selection = this.app.selection?.kind === 'nodes' ? this.app.selection.ids : [];
            const ids = e.ctrlKey || e.metaKey || e.shiftKey ? (selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id]) : selection.includes(id) ? selection : [id];
            this.app.select({ kind: 'nodes', ids });
            this.drag = { kind: 'nodes', x: e.clientX, y: e.clientY, positions: this.graph.nodes.filter(n => ids.includes(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })), moved: false };
            this.viewport.setPointerCapture(e.pointerId);
            return;
        }
        this.wiring = null;
        this.app.select(null);
        this.drag = { kind: 'box', x: e.clientX, y: e.clientY, start: this.world(e.clientX, e.clientY) };
        this.viewport.setPointerCapture(e.pointerId);
        this.invalidate();
    }
    pointerMove(e) {
        this.pointer = this.world(e.clientX, e.clientY);
        if (this.wiring)
            this.invalidate();
        if (!this.drag)
            return;
        const d = this.drag, dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (d.kind === 'pan') {
            this.transform.x = d.start.x + dx;
            this.transform.y = d.start.y + dy;
            this.applyTransform();
        }
        else if (d.kind === 'nodes') {
            if (!d.moved && Math.hypot(dx, dy) > 3) {
                this.app.beginChange('Move blocks');
                d.moved = true;
            }
            if (!d.moved)
                return;
            for (const p of d.positions) {
                const n = this.graph.nodes.find(n => n.id === p.id);
                n.x = snap(p.x + dx / this.transform.scale);
                n.y = snap(p.y + dy / this.transform.scale);
                const element = this.elements.get(n.id);
                element.style.left = `${n.x}px`;
                element.style.top = `${n.y}px`;
            }
            this.invalidate();
        }
        else if (d.kind === 'box') {
            const a = this.screen(d.start), b = this.screen(this.pointer), selection = $('#selection-box');
            selection.hidden = false;
            Object.assign(selection.style, { left: `${Math.min(a.x, b.x)}px`, top: `${Math.min(a.y, b.y)}px`, width: `${Math.abs(a.x - b.x)}px`, height: `${Math.abs(a.y - b.y)}px` });
            const minX = Math.min(d.start.x, this.pointer.x), maxX = Math.max(d.start.x, this.pointer.x), minY = Math.min(d.start.y, this.pointer.y), maxY = Math.max(d.start.y, this.pointer.y);
            this.app.select({ kind: 'nodes', ids: this.graph.nodes.filter(n => n.x + NODE_WIDTH >= minX && n.x <= maxX && n.y + this.height(n) >= minY && n.y <= maxY).map(n => n.id) }, false);
        }
    }
    pointerUp(e) {
        if (this.wiring && Number.isFinite(e.clientX)) {
            const terminal = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port');
            if (terminal && terminal.dataset.direction !== this.wiring.direction)
                this.finishWire({ ...terminal.dataset });
        }
        if (!this.drag)
            return;
        if (this.drag.kind === 'nodes' && this.drag.moved)
            this.app.finishChange({ runtime: false, render: false });
        if (this.drag.kind === 'box')
            this.app.renderInspector();
        this.drag = null;
        $('#selection-box').hidden = true;
    }
    finishWire(terminal) {
        const start = this.wiring;
        this.wiring = null;
        if (start.direction === terminal.direction)
            return;
        const from = start.direction === 'out' ? start : terminal, to = start.direction === 'in' ? start : terminal;
        this.app.connect({ node: from.node, port: from.port }, { node: to.node, port: to.port });
        this.invalidate();
    }
    contextMenu(e) {
        e.preventDefault();
        const nodeElement = e.target.closest('.graph-node'), wire = e.target.closest('[data-edge]');
        if (nodeElement) {
            const id = nodeElement.dataset.node, n = this.graph.nodes.find(n => n.id === id);
            this.app.select({ kind: 'nodes', ids: [id] });
            const output = ports(n, this.graph, this.app.project).outputs[0];
            this.app.showContext([{ label: 'Properties', action: () => this.app.renderInspector() }, { label: n.breakpoint ? 'Remove breakpoint' : 'Set breakpoint', action: () => this.app.toggleBreakpoint(id) }, ...(output ? [{ label: 'Create front-panel indicator', action: () => this.app.createBoundWidget({ node: id, port: output.key }, output.type) }] : []), { label: 'Duplicate', shortcut: 'Ctrl D', action: () => this.app.duplicate() }, { label: 'Create SubVI from selection', action: () => this.app.extractSelection() }, null, { label: 'Delete', shortcut: 'Del', danger: true, action: () => this.app.deleteSelection() }], e.clientX, e.clientY);
        }
        else if (wire) {
            const id = wire.dataset.edge;
            this.app.select({ kind: 'wire', id });
            this.app.showContext([{ label: 'Toggle probe', shortcut: 'P', action: () => this.app.toggleProbe(id) }, { label: 'Delete wire', action: () => this.app.deleteSelection() }], e.clientX, e.clientY);
        }
        else {
            const at = this.world(e.clientX, e.clientY);
            this.app.showContext([{ label: 'Insert function…', shortcut: 'Tab', action: () => this.app.openPalette('nodes', at) }, { label: 'Paste', shortcut: 'Ctrl V', action: () => this.app.paste(at) }, { label: 'Fit diagram', shortcut: 'F', action: () => this.fit() }, { label: 'Auto arrange', action: () => this.app.autoLayout() }], e.clientX, e.clientY);
        }
    }
    dispose() { this.resizeObserver.disconnect(); this.surface.dispose(); }
}
