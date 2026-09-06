import { NODES, TYPES, ports, inputDefault, formatValue } from './types.js';
import { History, clone, uid, makeNode, connect, validateProject, compileProject, extractSubVI } from './graph.js';
import { DEMOS } from './demo.js';
import { Diagram } from './diagram.js';
import { Panel, WIDGETS } from './panel.js';
import { onRendererMode } from './gpu.js';
import { $, $$, el, icon, button, download, debounce, editableTarget, clamp } from './util.js';
const STORAGE_KEY = 'voltweave.project.v1';
const CONTROL_TYPES = new Set(['control', 'boolean', 'arrayControl']);
class App {
    constructor() {
        this.project = DEMOS.signal();
        this.graphId = this.project.root;
        this.selection = null;
        this.view = 'panel';
        this.debugTab = 'probes';
        this.highlight = false;
        this.errors = [];
        this.values = {};
        this.lastFrame = null;
        this.mode = 'paused';
        this.revision = 0;
        this.history = new History();
        this.recording = false;
        this.recordingData = null;
        this.recordCount = 0;
        this.replaying = false;
        this.frameQueue = [];
        this.framesThisSecond = 0;
        this.lastFpsTime = performance.now();
        this.dirty = false;
        this.renderer = 'Initializing';
        this.clipboard = null;
        this.controlEdit = null;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved)
                this.project = validateProject(JSON.parse(saved));
        }
        catch (error) {
            console.warn('Autosave could not be loaded:', error.message);
        }
        this.graphId = this.project.root;
        this.persist = debounce(() => this.saveLocal(), 400);
        this.diagram = new Diagram(this);
        this.panel = new Panel(this);
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'VoltWeave deterministic VM' });
        this.worker.onmessage = event => this.onWorker(event.data);
        this.worker.onerror = error => { this.mode = 'paused'; this.errors = [{ message: `Worker failed: ${error.message}. Serve the app over localhost or HTTPS.`, severity: 'error' }]; this.renderDebug(); this.updateStatus('Execution worker failed', true); };
        onRendererMode(mode => { this.renderer = mode; $('#engine-label').textContent = mode; });
        this.initUI();
        this.renderAll();
        this.compile({ kind: 'run' });
        window.addEventListener('beforeunload', () => { try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
        }
        catch { } });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) {
            this.diagram.invalidate();
            this.panel.resize();
        } });
        window.voltweave = { version: '1.0.0', app: this, exportProject: () => clone(this.project), validate: () => compileProject(this.project), run: () => this.execute('run'), stop: () => this.execute('stop') };
    }
    initUI() {
        const run = button('Run', () => this.execute('run'), { icon: 'play', class: 'run-primary', title: 'Run continuously (F5)' });
        run.id = 'run';
        const once = button('Run one tick', () => this.execute('tick'), { icon: 'repeat', iconOnly: true, title: 'Run one simulation tick (Ctrl R / F10)' });
        once.id = 'run-once';
        const pause = button('Pause', () => this.execute('pause'), { icon: 'pause', iconOnly: true });
        pause.id = 'pause';
        const stop = button('Stop / reset', () => this.execute('stop'), { icon: 'stop', iconOnly: true, class: 'danger', title: 'Abort execution and reset state (Shift F5)' });
        stop.id = 'stop';
        $('#execution-tools').append(run, once, pause, stop);
        $('#edit-tools').append(button('Undo', () => this.undo(), { icon: 'undo', iconOnly: true, title: 'Undo (Ctrl Z)' }), button('Redo', () => this.redo(), { icon: 'redo', iconOnly: true, title: 'Redo (Ctrl Shift Z)' }));
        const light = button('Highlight execution', () => this.toggleHighlight(), { icon: 'light', iconOnly: true });
        light.id = 'highlight';
        const step = button('Step into node', () => this.execute('node'), { icon: 'node', iconOnly: true, title: 'Step one node, including nested diagrams (F6)' });
        step.id = 'step-node';
        const probe = button('Probe selected wire', () => this.probeSelection(), { icon: 'probe', iconOnly: true, title: 'Probe selected wire (P)' });
        probe.id = 'probe-tool';
        const record = button('Record inputs', () => this.toggleRecord(), { icon: 'record', iconOnly: true, title: 'Record deterministic input stream from tick zero' });
        record.id = 'record';
        $('#debug-tools').append(light, step, probe, record);
        $('#save-project').append(icon('save', 14), el('span', { text: 'Save project' }));
        $('#save-project').onclick = () => this.saveProject();
        const labels = { panel: ['panel', 'Front Panel'], diagram: ['graph', 'Block Diagram'], split: ['split', 'Split'] };
        $$('[data-view]').forEach(b => { const [glyph, title] = labels[b.dataset.view]; b.append(icon(glyph, 14), el('span', { text: title })); b.onclick = () => this.setView(b.dataset.view); });
        $('#view-tools').append(button('Layout mode', () => this.setLayoutMode(!this.panel.layoutMode), { icon: 'lock', title: 'Switch between operating controls and editing the front-panel layout' }), button('Fit workspace', () => this.view === 'diagram' ? this.diagram.fit() : this.panel.fit(), { icon: 'fit' }), button('Add control', () => this.openPalette(this.view === 'diagram' ? 'nodes' : 'widgets'), { icon: 'plus', class: 'add-control' }));
        $('#view-tools').children[0].id = 'layout-mode';
        const menus = ['File', 'Edit', 'View', 'Operate', 'Tools', 'Help'];
        menus.forEach(name => $('#menubar').append(el('button', { text: name, onclick: e => this.showMenu(name, e.currentTarget) })));
        document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu-popup,#menubar')) {
            $('#menu-popup').hidden = true;
            $('#context-menu').hidden = true;
        } });
        $$('[data-side]').forEach(b => b.onclick = () => { $$('[data-side]').forEach(x => x.classList.toggle('active', x === b)); $('#project-pane').hidden = b.dataset.side !== 'project'; $('#palette-pane').hidden = b.dataset.side !== 'palette'; });
        $('#quick-search').oninput = () => this.renderPalette();
        $('#palette-search').oninput = () => this.renderPalette();
        $('#new-vi').onclick = () => this.newSubVI();
        $('#new-project').onclick = () => this.loadDemo('empty');
        $('#document-tab').onclick = () => { this.openGraph(this.project.root, false); this.select(null); };
        $('#empty-add').onclick = () => this.openPalette('nodes');
        $('#help-button').onclick = () => this.showHelp();
        $('#project-file').onchange = async (e) => { try {
            const file = e.target.files[0];
            if (!file)
                return;
            if (file.size > 20 * 1024 * 1024)
                throw new Error('Project exceeds the 20 MB import limit.');
            const data = JSON.parse(await file.text());
            this.loadProject(data, { history: true });
            this.toast(`Opened ${file.name}`);
        }
        catch (error) {
            this.toast(error.message, true);
        } e.target.value = ''; };
        $('#recording-file').onchange = async (e) => { try {
            const file = e.target.files[0];
            if (!file)
                return;
            if (file.size > 40 * 1024 * 1024)
                throw new Error('Recording exceeds the 40 MB import limit.');
            this.replay(JSON.parse(await file.text()));
        }
        catch (error) {
            this.toast(error.message, true);
        } e.target.value = ''; };
        $$('[data-debug]').forEach(b => b.onclick = () => { this.debugTab = b.dataset.debug; $('#debug-panel').classList.remove('collapsed'); this.renderDebug(true); });
        $('#collapse-debug').onclick = () => { $('#debug-panel').classList.toggle('collapsed'); requestAnimationFrame(() => this.panel.resize()); };
        $('#clear-log').onclick = () => { if (this.debugTab === 'errors')
            this.errors = [];
        else if (this.lastFrame)
            this.lastFrame.trace = []; this.renderDebug(true); };
        $('#debug-resize').onpointerdown = e => { const y = e.clientY, h = $('#debug-panel').clientHeight; const move = e => document.documentElement.style.setProperty('--debug-height', `${clamp(h + y - e.clientY, 34, innerHeight * .5)}px`); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); e.preventDefault(); };
        $('#command-search').oninput = () => this.renderCommands();
        $('#command-search').onkeydown = e => { if (e.key === 'Enter') {
            e.preventDefault();
            $('#command-results button')?.click();
        } };
        $$('[data-command-tab]').forEach(b => b.onclick = () => { this.commandTab = b.dataset.commandTab; this.renderCommands(); });
        document.addEventListener('keydown', e => this.keydown(e));
    }
    toast(message, error = false) { const node = el('div', { class: `toast ${error ? 'error' : ''}`, text: message }); $('#toast-region').append(node); setTimeout(() => node.remove(), error ? 6500 : 3400); }
    send(kind, data = {}) { this.worker.postMessage({ kind, revision: this.revision, ...data }); }
    controls() { return Object.fromEntries(this.project.graphs[this.project.root].nodes.filter(n => CONTROL_TYPES.has(n.type)).map(n => [n.id, n.params.value])); }
    value(source) { return source ? this.values[`${source.graph || this.project.root}/${source.node}`]?.[source.port] : undefined; }
    controlValue(source) {
        if (!source)
            return undefined;
        if (this.replaying && Object.hasOwn(this.replayControls || {}, source.node))
            return this.replayControls[source.node];
        return this.project.graphs[source.graph || this.project.root]?.nodes.find(n => n.id === source.node)?.params.value;
    }
    setControl(id, value) {
        if (this.replaying) {
            this.toast('Replay owns the inputs. Stop replay before operating controls.');
            return;
        }
        const node = this.project.graphs[this.project.root].nodes.find(n => n.id === id);
        if (!node || !CONTROL_TYPES.has(node.type)) {
            this.toast('This widget must bind to a compatible control node.', true);
            return;
        }
        if (node.type === 'control' && !Number.isFinite(value)) {
            this.toast('A numeric control requires a finite value.', true);
            return;
        }
        if (node.type === 'boolean' && typeof value !== 'boolean')
            return;
        if (node.params.value === value)
            return;
        if (!this.controlEdit || this.controlEdit.id !== id || performance.now() - this.controlEdit.time > 800)
            this.history.push(this.project, `Change ${node.name}`);
        this.controlEdit = { id, time: performance.now() };
        node.params.value = value;
        this.send('controls', { values: { [id]: value } });
        this.dirty = true;
        this.persist();
        this.panel.update();
        this.updateTitle();
        if (!editableTarget(document.activeElement))
            this.updateLiveInspector();
    }
    endControlEdit() { this.controlEdit = null; this.persist(); }
    beginChange(label = 'Edit project') { this.endControlEdit(); this.history.push(this.project, label); }
    finishChange({ runtime = true, render = true } = {}) {
        this.dirty = true;
        this.persist();
        if (render)
            this.renderAll();
        else {
            this.renderTree();
            this.renderInspector();
            this.updateTitle();
            this.updateStatistics();
        }
        if (runtime)
            this.compile();
    }
    mutate(label, action, options = {}) {
        const before = clone(this.project);
        this.beginChange(label);
        try {
            action();
            this.finishChange(options);
        }
        catch (error) {
            this.project = before;
            this.history.undoStack.pop();
            this.renderAll();
            this.toast(error.message, true);
        }
    }
    compile(pending = null) {
        this.revision++;
        this.compiledRevision = null;
        this.pendingAction = pending;
        this.errors = [];
        this.values = {};
        this.lastFrame = null;
        this.frameQueue.length = 0;
        this.panel.reset();
        this.mode = 'paused';
        this.replaying = false;
        this.send('load', { project: this.project, controls: this.controls() });
        this.updateStatus('Compiling typed dataflow…');
        this.renderDebug(true);
    }
    execute(command) {
        if (command === 'run' || command === 'tick' || command === 'node') {
            if (this.errors.length || this.compiledRevision !== this.revision) {
                this.compile({ kind: command });
                return;
            }
        }
        this.send(command);
        if (command === 'stop')
            this.active = new Set();
    }
    onWorker(message) {
        if (message.kind === 'recording') {
            this.recordingData = message.data;
            this.recordCount = message.data.frames.length;
            this.recording = false;
            this.renderDebug(true);
            this.toast(`Recorded ${this.recordCount.toLocaleString()} deterministic input ticks.`);
            return;
        }
        if (message.revision !== this.revision)
            return;
        if (message.kind === 'snapshot') {
            if (message.data)
                download('voltweave-runtime-snapshot.json', JSON.stringify(message.data, (key, value) => value instanceof Float64Array ? { type: 'Float64Array', data: Array.from(value) } : value, 2));
            return;
        }
        if (message.kind === 'frame') {
            this.frameQueue.push(message);
            if (!this.pendingFrames) {
                this.pendingFrames = true;
                requestAnimationFrame(() => { this.pendingFrames = false; for (const frame of this.frameQueue.splice(0)) {
                    if (frame.revision === this.revision)
                        this.applyFrame(frame);
                    this.send('ack', { id: frame.id });
                } });
            }
        }
        else if (message.kind === 'compiled') {
            this.errors = [];
            this.compiledRevision = this.revision;
            this.compiledCount = message.nodes;
            this.updateStatus(`Compiled · ${message.nodes} nodes across ${message.graphs} VIs`);
            this.diagram.setErrors([]);
            this.renderDebug(true);
            if (this.pendingAction) {
                const action = this.pendingAction;
                this.pendingAction = null;
                this.send(action.kind, action.data || {});
            }
        }
        else if (message.kind === 'status') {
            this.mode = message.mode;
            this.recording = message.recording;
            this.replaying = message.replaying;
            this.updateExecutionUI(message.reason);
        }
        else if (message.kind === 'reset') {
            // Discard frames received before the worker reset but not yet painted.
            this.frameQueue.length = 0;
            this.values = {};
            this.lastFrame = null;
            this.panel.reset();
            this.diagram.updateValues({}, new Set());
            this.recordCount = 0;
            this.updateLiveInspector();
            this.renderDebug(true);
        }
        else if (message.kind === 'error') {
            this.mode = 'paused';
            this.errors = message.diagnostics?.length ? message.diagnostics : [{ ...message, severity: 'error' }];
            this.debugTab = 'errors';
            this.diagram.setErrors(this.errors);
            this.renderDebug(true);
            this.updateStatus(this.errors[0].message, true);
            this.updateExecutionUI('Error');
            this.toast(this.errors[0].message, true);
        }
        else if (message.kind === 'debug' || message.kind === 'break') {
            // Drain completed ticks before displaying the paused partial transaction.
            for (const frame of this.frameQueue.splice(0)) {
                if (frame.revision === this.revision) this.applyFrame(frame);
                this.send('ack', { id: frame.id });
            }
            this.values = message.values;
            this.highlight = true;
            $('#highlight').classList.add('pressed');
            this.active = new Set([`${message.event.graph}/${message.event.node}`]);
            if (message.event.graph !== this.graphId)
                this.openGraph(message.event.graph);
            else
                this.setView('diagram');
            this.select({ kind: 'nodes', ids: [message.event.node] });
            this.diagram.updateValues(this.values, this.active);
            this.panel.update();
            this.updateLiveInspector();
            this.updateStatus(`${message.kind === 'break' ? 'Breakpoint before' : 'Stepped'} ${message.event.node} · tick ${message.event.tick}`);
        }
    }
    applyFrame(frame) {
        this.lastFrame = frame;
        this.values = frame.values;
        this.replayControls = frame.controls;
        // Input ownership is controlled by ordered worker status messages, not deferred paints.
        this.recordCount = frame.recorded || this.recordCount;
        this.active = new Set(frame.trace.map(t => `${t.graph}/${t.node}`));
        this.panel.update(frame);
        this.diagram.updateValues(frame.values, this.active);
        this.updateLiveInspector();
        $('#frame-label').textContent = `t = ${(frame.time + frame.duration).toFixed(3)} s  ·  #${frame.nextTick}`;
        $('#execution-time').textContent = `${frame.computeMs.toFixed(2)} ms / tick · ${frame.operations.toLocaleString()} ops`;
        this.framesThisSecond++;
        const now = performance.now();
        if (now - this.lastFpsTime > 1000) {
            this.fps = this.framesThisSecond * 1000 / (now - this.lastFpsTime);
            this.lastFpsTime = now;
            this.framesThisSecond = 0;
        }
        if (!this.lastDebugTime || now - this.lastDebugTime > 180) {
            this.renderDebug();
            this.lastDebugTime = now;
        }
    }
    updateExecutionUI(reason) {
        const running = this.mode === 'running', badge = $('#run-state');
        badge.classList.toggle('running', running);
        badge.classList.toggle('error', !!this.errors.length);
        badge.replaceChildren(el('i'), document.createTextNode(this.errors.length ? 'BROKEN VI' : this.recording ? 'RECORDING' : this.replaying ? 'REPLAY' : running ? 'RUNNING' : 'PAUSED'));
        $('#run').classList.toggle('pressed', running);
        $('#pause').classList.toggle('pressed', !running && !this.errors.length);
        $('#record').classList.toggle('pressed', this.recording);
        $('#bench-live').classList.toggle('active', running);
        $('#bench-status-label').textContent = this.recording ? 'RECORDING' : this.replaying ? 'REPLAYING' : running ? 'ACQUIRING' : 'PAUSED';
        if (!this.errors.length)
            this.updateStatus(reason || (running ? 'Running' : 'Paused'));
        if (this.debugTab === 'recording')
            this.renderDebug(true);
    }
    updateStatus(text, error = false) { $('#status-text').textContent = text; $('#status-text').title = text; $('#status-dot').style.background = error ? '#c58164' : '#8ca577'; }
    updateTitle() {
        document.title = `${this.project.name} · VoltWeave Studio`;
        $('#document-name').textContent = `${this.project.name}.vi`;
        $('#bench-title').textContent = this.project.name;
        $('#dirty-dot').classList.toggle('dirty', this.dirty);
        $('#seed-label').textContent = this.project.settings.seed;
        $('#panel-rate').textContent = `${formatValue(this.project.settings.sampleRate / 1000)} kS/s · ${this.project.settings.blockSize} samples / block`;
        $('#bench-description').textContent = this.project.name.includes('Array') ? 'Iterate. Transform. Compose.' : this.project.name.includes('Control') ? 'Measure. Regulate. Stabilize.' : 'Generate. Acquire. Analyze.';
    }
    updateStatistics() { const g = this.project.graphs[this.graphId]; $('#graph-stats').textContent = `${g.nodes.length} nodes · ${g.edges.length} wires`; }
    saveLocal() { try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
        $('#autosave-label').textContent = 'Saved locally';
    }
    catch (error) {
        $('#autosave-label').textContent = 'Autosave unavailable';
        this.toast('Local storage is unavailable or full. Export the project to keep your changes.', true);
    } }
    saveProject() { download(`${this.project.name.replace(/[^a-z0-9_-]/gi, '_')}.vwx`, JSON.stringify(this.project, null, 2)); this.dirty = false; this.updateTitle(); this.saveLocal(); this.toast('Project exported with front panel, diagrams, and VI library.'); }
    loadProject(raw, { history = false, run = false, replay = null } = {}) {
        const p = validateProject(raw);
        if (history)
            this.history.push(this.project, 'Open project');
        else
            this.history.clear();
        this.project = p;
        this.graphId = p.root;
        this.selection = null;
        this.dirty = false;
        this.diagram.views.clear();
        this.diagram.transform = { x: 20, y: 20, scale: .7 };
        this.renderAll();
        this.compile(replay ? { kind: 'replay', data: { data: replay } } : run ? { kind: 'run' } : null);
        this.persist();
        requestAnimationFrame(() => this.diagram.fit());
    }
    loadDemo(name) { this.loadProject(DEMOS[name](), { history: true, run: name !== 'empty' }); this.setView(name === 'empty' ? 'diagram' : 'panel'); this.toast(name === 'empty' ? 'New project. Your previous project is available through Undo.' : 'Loaded a fully executable example.'); }
    undo() { const p = this.history.undo(this.project); if (!p)
        return; this.project = p; if (!p.graphs[this.graphId])
        this.graphId = p.root; this.selection = null; this.renderAll(); this.compile(); this.persist(); this.dirty = true; this.updateTitle(); }
    redo() { const p = this.history.redo(this.project); if (!p)
        return; this.project = p; if (!p.graphs[this.graphId])
        this.graphId = p.root; this.selection = null; this.renderAll(); this.compile(); this.persist(); this.dirty = true; this.updateTitle(); }
    renderAll() { this.updateTitle(); this.updateStatistics(); this.renderTree(); this.renderPalette(); this.diagram.render(); this.panel.render(); this.renderInspector(); this.renderDebug(true); }
    setView(view) {
        this.view = view;
        $('#workspace').className = `workspace view-${view}`;
        $$('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-selected', String(b.dataset.view === view)); });
        const add = $('#view-tools .add-control span');
        if (add)
            add.textContent = view === 'diagram' ? 'Add function' : 'Add control';
        requestAnimationFrame(() => { this.panel.resize(); this.diagram.invalidate(); if (view !== 'panel' && !this.diagram.views.has(this.graphId)) {
            this.diagram.fit();
            this.diagram.views.set(this.graphId, { ...this.diagram.transform });
        } });
    }
    setLayoutMode(enabled) { this.panel.setLayoutMode(enabled); $('#layout-mode').classList.toggle('pressed', enabled); this.setView(this.view === 'diagram' ? 'panel' : this.view); this.toast(enabled ? 'Layout unlocked. Drag control headers or resize from the lower-right corner.' : 'Operate mode. Controls now drive live inputs.'); }
    select(selection, inspector = true) { this.selection = selection; this.diagram.updateSelection(); this.panel.updateSelection(); if (inspector)
        this.renderInspector(); }
    openGraph(id, showDiagram = true) { if (!this.project.graphs[id]) {
        this.toast('This subprogram is missing.', true);
        return;
    } const old = this.graphId; this.graphId = id; this.selection = null; if (showDiagram)
        this.setView('diagram'); this.diagram.switchGraph(old); this.renderTree(); this.renderInspector(); this.updateStatistics(); }
    renderTree() {
        const root = $('#project-tree');
        root.replaceChildren(el('div', { class: 'tree-root' }, el('span', { class: 'project-icon', text: '▾' }), icon('open', 15), el('span', { text: 'My Instrument Project' })));
        const main = this.project.graphs[this.project.root];
        const item = (g, isRoot) => el('div', { class: `tree-item ${this.graphId === g.id ? 'active' : ''}`, role: 'button', tabindex: 0, title: g.name, onclick: () => this.openGraph(g.id, !isRoot || this.view !== 'panel'), onkeydown: e => { if (e.key === 'Enter')
                this.openGraph(g.id); }, oncontextmenu: e => { e.preventDefault(); this.showContext([{ label: 'Open block diagram', action: () => this.openGraph(g.id) }, ...(isRoot ? [] : [{ label: 'Place SubVI in main diagram', action: () => { this.openGraph(this.project.root); this.addNode('subvi', null, { graph: g.id }); } }])], e.clientX, e.clientY); } }, el('span', { class: 'vi-mini', text: 'VI' }), el('span', { text: g.name.replace(/\.vi$/, ''), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }), el('small', { text: isRoot ? 'MAIN' : '' }));
        root.append(item(main, true), el('div', { class: 'tree-section', text: 'Reusable subprograms' }));
        for (const g of Object.values(this.project.graphs))
            if (g.id !== this.project.root)
                root.append(item(g, false));
    }
    renderPalette() {
        const render = (element, query, quick) => {
            element.replaceChildren();
            const categories = new Map();
            for (const [type, d] of Object.entries(NODES)) {
                if (d.category === 'Terminals' && this.graphId === this.project.root)
                    continue;
                if (query && !`${d.title} ${d.category} ${type}`.toLowerCase().includes(query))
                    continue;
                if (!categories.has(d.category))
                    categories.set(d.category, []);
                categories.get(d.category).push([type, d]);
            }
            for (const [category, nodes] of categories) {
                const details = el('details', { class: 'palette-category', open: !!query || (quick ? ['Numeric', 'Signal processing', 'Structures'].includes(category) : false) });
                details.append(el('summary', {}, category, el('span', { text: nodes.length })));
                for (const [type, d] of (quick && !query ? nodes.slice(0, 4) : nodes))
                    details.append(el('button', { class: `palette-item ${category === 'Structures' ? 'structures' : ''}`, title: `Insert ${d.title}`, onclick: () => this.addNode(type) }, el('span', { class: 'palette-glyph', text: d.glyph }), el('span', { text: d.title })));
                if (quick && nodes.length > 4 && !query)
                    details.append(el('button', { class: 'palette-item', text: `View all ${nodes.length}…`, onclick: () => { this.openPalette('nodes'); $('#command-search').value = category; this.renderCommands(); } }));
                element.append(details);
            }
        };
        render($('#quick-palette'), $('#quick-search').value.toLowerCase(), true);
        render($('#full-palette'), $('#palette-search').value.toLowerCase(), false);
    }
    openPalette(tab = 'nodes', at = null) { this.commandTab = tab; this.insertionPoint = at; $('#command-search').value = ''; this.renderCommands(); $('#palette-dialog').showModal(); setTimeout(() => $('#command-search').focus(), 30); }
    renderCommands() {
        $$('[data-command-tab]').forEach(b => b.classList.toggle('active', b.dataset.commandTab === this.commandTab));
        const target = $('#command-results');
        target.replaceChildren();
        const q = $('#command-search').value.toLowerCase();
        const catalog = this.commandTab === 'widgets' ? WIDGETS : NODES;
        for (const [type, spec] of Object.entries(catalog)) {
            const name = spec.name || spec.title;
            if (!`${type} ${name} ${spec.category}`.toLowerCase().includes(q))
                continue;
            if (spec.category === 'Terminals' && this.graphId === this.project.root)
                continue;
            target.append(el('button', { class: 'command-item', onclick: () => { $('#palette-dialog').close(); this.commandTab === 'widgets' ? this.addWidget(type) : this.addNode(type, this.insertionPoint); } }, el('span', { class: 'palette-glyph', text: spec.glyph }), el('span', {}, el('strong', { text: name }), el('small', { text: spec.category }))));
        }
        if (!target.children.length)
            target.append(el('div', { class: 'debug-empty', text: 'No matching operators.' }));
    }
    addNode(type, at = null, params = {}) {
        const graph = this.project.graphs[this.graphId];
        if (!at) {
            const t = this.diagram.transform, width = this.diagram.viewport.clientWidth || 700, height = this.diagram.viewport.clientHeight || 500;
            at = { x: Math.max(30, (width / 2 - t.x) / t.scale - 90), y: Math.max(30, (height / 2 - t.y) / t.scale - 60) };
            let tries = 0;
            while (graph.nodes.some(n => Math.abs(n.x - at.x) < 170 && Math.abs(n.y - at.y) < 130) && tries++ < 40) {
                at.x += 24;
                at.y += 24;
            }
        }
        if (type === 'input')
            params.port = graph.inputs[0]?.key || 'value';
        if (type === 'output')
            params.port = graph.outputs[0]?.key || 'value';
        let node;
        this.mutate(`Insert ${NODES[type].title}`, () => { node = makeNode(type, Math.round(at.x / 8) * 8, Math.round(at.y / 8) * 8, params); graph.nodes.push(node); this.selection = { kind: 'nodes', ids: [node.id] }; });
        this.setView('diagram');
        return node;
    }
    connect(from, to) { this.mutate('Connect typed wire', () => { connect(this.project, this.graphId, from, to); }); }
    toggleBreakpoint(id, graphId = this.graphId) { const node = this.project.graphs[graphId].nodes.find(n => n.id === id); if (!node)
        return; this.mutate('Toggle breakpoint', () => { node.breakpoint = !node.breakpoint; }, { runtime: false, render: false }); this.diagram.render(); this.send('breakpoints', { keys: Object.values(this.project.graphs).flatMap(g => g.nodes.filter(n => n.breakpoint).map(n => `${g.id}/${n.id}`)) }); }
    toggleProbe(id) { const edge = this.project.graphs[this.graphId].edges.find(e => e.id === id); if (!edge)
        return; this.mutate('Toggle wire probe', () => { edge.probe = !edge.probe; }, { runtime: false, render: false }); this.diagram.invalidate(); this.debugTab = 'probes'; this.renderDebug(true); }
    probeSelection() { if (this.selection?.kind === 'wire')
        this.toggleProbe(this.selection.id);
    else
        this.toast('Select a wire, then press P. Double-clicking a wire also adds a probe.'); }
    toggleHighlight() { this.highlight = !this.highlight; $('#highlight').classList.toggle('pressed', this.highlight); this.diagram.updateValues(this.values, this.active || new Set()); }
    addWidget(kind, binding = null) {
        const definition = WIDGETS[kind], root = this.project.graphs[this.project.root];
        this.mutate(`Add ${definition.name}`, () => {
            let source = binding;
            const requiresControl = definition.category === 'Controls';
            if (!source && !requiresControl && this.selection?.kind === 'nodes') {
                const selected = this.project.graphs[this.graphId].nodes.find(n => n.id === this.selection.ids[0]), output = selected && ports(selected, this.project.graphs[this.graphId], this.project).outputs.find(p => p.type === definition.type || kind === 'chart' && ['number', 'array'].includes(p.type));
                if (output)
                    source = { node: selected.id, port: output.key, ...(this.graphId !== this.project.root ? { graph: this.graphId } : {}) };
            }
            if (!source) {
                const type = requiresControl ? definition.type === 'boolean' ? 'boolean' : definition.type === 'array' ? 'arrayControl' : 'control' : definition.type === 'waveform' ? 'signal' : definition.type === 'boolean' ? 'boolean' : definition.type === 'array' ? 'range' : definition.type === 'string' ? 'text' : 'indicator';
                const node = makeNode(type, 40 + root.nodes.length % 5 * 260, 50 + Math.floor(root.nodes.length / 5) * 220);
                node.name = definition.name;
                root.nodes.push(node);
                source = { node: node.id, port: ports(node, root, this.project).outputs[0].key };
            }
            const y = this.project.widgets.length ? Math.max(...this.project.widgets.map(w => w.y + w.h)) + 24 : 24;
            const widget = { id: uid('ui'), kind, label: definition.name, source, x: 24, y, w: definition.w, h: definition.h, min: 0, max: 10, step: .1, range: 4, timebase: .01, unit: definition.type === 'waveform' ? 'V' : '', digits: 3 };
            this.project.widgets.push(widget);
            this.selection = { kind: 'widget', id: widget.id };
        }, { runtime: !binding });
        this.setView('panel');
        this.panel.fitAll = false;
        requestAnimationFrame(() => { this.panel.resize(); this.panel.scroll.scrollTop = this.panel.scroll.scrollHeight; });
    }
    createBoundWidget(source, type) { if (this.graphId !== this.project.root)
        source = { ...source, graph: this.graphId }; this.addWidget(type === 'waveform' ? 'scope' : type === 'number' ? 'meter' : type === 'boolean' ? 'led' : type === 'array' ? 'array' : 'text', source); }
    deleteSelection() {
        const selected = this.selection;
        if (!selected)
            return;
        this.mutate('Delete selection', () => {
            const g = this.project.graphs[this.graphId];
            if (selected.kind === 'nodes') {
                const ids = new Set(selected.ids);
                g.nodes = g.nodes.filter(n => !ids.has(n.id));
                g.edges = g.edges.filter(e => !ids.has(e.from.node) && !ids.has(e.to.node));
                this.project.widgets = this.project.widgets.filter(w => !w.source || (w.source.graph || this.project.root) !== this.graphId || !ids.has(w.source.node));
                for (const w of this.project.widgets)
                    if (w.source2 && (w.source2.graph || this.project.root) === this.graphId && ids.has(w.source2.node))
                        delete w.source2;
            }
            else if (selected.kind === 'wire')
                g.edges = g.edges.filter(e => e.id !== selected.id);
            else
                this.project.widgets = this.project.widgets.filter(w => w.id !== selected.id);
            this.selection = null;
        }, { runtime: selected.kind !== 'widget' });
    }
    copy(cut = false) {
        if (!this.selection)
            return;
        if (this.selection.kind === 'widget')
            this.clipboard = { kind: 'widget', widget: clone(this.project.widgets.find(w => w.id === this.selection.id)) };
        else if (this.selection.kind === 'nodes') {
            const ids = new Set(this.selection.ids), g = this.project.graphs[this.graphId];
            this.clipboard = { kind: 'nodes', nodes: clone(g.nodes.filter(n => ids.has(n.id))), edges: clone(g.edges.filter(e => ids.has(e.from.node) && ids.has(e.to.node))) };
        }
        else
            return;
        if (cut)
            this.deleteSelection();
        else
            this.toast('Copied to the workspace clipboard.');
    }
    paste(at = null) {
        if (!this.clipboard) {
            this.toast('The workspace clipboard is empty.');
            return;
        }
        const data = clone(this.clipboard);
        this.mutate('Paste selection', () => {
            if (data.kind === 'widget') {
                const w = data.widget;
                w.id = uid('ui');
                w.x += 24;
                w.y += 24;
                w.label += ' copy';
                this.project.widgets.push(w);
                this.selection = { kind: 'widget', id: w.id };
            }
            else {
                const g = this.project.graphs[this.graphId], mapping = new Map(data.nodes.map(n => [n.id, uid('n')])), minX = Math.min(...data.nodes.map(n => n.x)), minY = Math.min(...data.nodes.map(n => n.y));
                for (const n of data.nodes) {
                    n.id = mapping.get(n.id);
                    n.x += at ? at.x - minX : 32;
                    n.y += at ? at.y - minY : 32;
                    n.name += ' copy';
                    g.nodes.push(n);
                }
                for (const e of data.edges) {
                    e.id = uid('w');
                    e.from.node = mapping.get(e.from.node);
                    e.to.node = mapping.get(e.to.node);
                    g.edges.push(e);
                }
                this.selection = { kind: 'nodes', ids: data.nodes.map(n => n.id) };
            }
        }, { runtime: data.kind !== 'widget' });
    }
    duplicate() { this.copy(); this.paste(); }
    newSubVI() {
        const id = uid('vi');
        this.mutate('Create reusable VI', () => {
            const input = makeNode('input', 60, 100, { port: 'value' }), output = makeNode('output', 430, 100, { port: 'value' });
            this.project.graphs[id] = { id, name: `Subprogram ${Object.keys(this.project.graphs).length}.vi`, inputs: [{ key: 'value', type: 'number' }], outputs: [{ key: 'value', type: 'number' }], nodes: [input, output], edges: [{ id: uid('w'), from: { node: input.id, port: 'value' }, to: { node: output.id, port: 'value' } }] };
        });
        this.openGraph(id);
        this.toast('New VI created. Edit its typed interface in Properties; right-click it in the project tree to place a call.');
    }
    extractSelection() {
        if (this.selection?.kind !== 'nodes' || !this.selection.ids.length) {
            this.toast('Select the processing blocks to extract.', true);
            return;
        }
        const selected = this.project.graphs[this.graphId].nodes.filter(n => this.selection.ids.includes(n.id));
        if (selected.some(n => CONTROL_TYPES.has(n.type))) {
            this.toast('Leave front-panel controls outside the selection. Extract the processing blocks; their wires become typed VI inputs.', true);
            return;
        }
        try {
            const candidate = clone(this.project), call = extractSubVI(candidate, this.graphId, this.selection.ids, `Subprogram ${Object.keys(this.project.graphs).length}.vi`);
            compileProject(candidate);
            this.mutate('Extract reusable subprogram', () => { this.project = candidate; this.selection = { kind: 'nodes', ids: [call.id] }; });
            this.toast('Created a reusable VI with typed boundary ports and preserved indicator bindings.');
        }
        catch (error) {
            this.toast(`Extraction rejected: ${error.message}`, true);
        }
    }
    autoLayout() {
        const g = this.project.graphs[this.graphId];
        let order;
        try {
            order = compileProject(this.project).plans.get(this.graphId).instructions.map(i => i.node);
        }
        catch {
            order = g.nodes;
        }
        this.mutate('Arrange diagram', () => {
            const levels = new Map();
            for (const node of order) {
                const dependencies = node.type === 'delay' ? [] : g.edges.filter(e => e.to.node === node.id).map(e => levels.get(e.from.node) || 0);
                levels.set(node.id, dependencies.length ? Math.max(...dependencies) + 1 : 0);
            }
            const y = new Map();
            for (const node of order) {
                const level = levels.get(node.id);
                node.x = 60 + level * 275;
                node.y = y.get(level) || 60;
                y.set(level, node.y + this.diagram.height(node) + 65);
            }
        }, { runtime: false });
        this.diagram.fit();
    }
    toggleRecord() { if (this.recording)
        this.send('recordStop');
    else if (this.errors.length)
        this.toast('Fix diagram diagnostics before recording.', true);
    else {
        this.send('recordStart');
        this.debugTab = 'recording';
        this.renderDebug(true);
    } }
    exportRecording() { if (!this.recordingData) {
        this.toast('Stop a recording before exporting it.');
        return;
    } download(`${this.project.name.replace(/[^a-z0-9_-]/gi, '_')}.vwr`, JSON.stringify(this.recordingData)); }
    replay(data = this.recordingData) {
        if (!data) {
            $('#recording-file').click();
            return;
        }
        if (data.format !== 'voltweave-recording' || data.version !== 1 || !Array.isArray(data.frames) || data.frames.length > 20000 || data.frames.some((f, i) => f.tick !== i || !f.controls || typeof f.controls !== 'object')) {
            this.toast('Not a valid VoltWeave input recording.', true);
            return;
        }
        this.recordingData = clone(data);
        this.loadProject(data.project, { history: true, replay: data });
        this.debugTab = 'recording';
        this.renderDebug(true);
    }
    validate() {
        try {
            const ir = compileProject(this.project);
            this.errors = [];
            this.diagram.setErrors([]);
            this.renderDebug(true);
            this.toast(`Validation passed: ${ir.nodeCount} nodes · ${ir.plans.size} typed VIs.`);
        }
        catch (error) {
            this.errors = error.diagnostics || [{ message: error.message }];
            this.debugTab = 'errors';
            this.renderDebug(true);
            this.diagram.setErrors(this.errors);
            this.toast(this.errors[0].message, true);
        }
    }
    field(label, value, onChange, spec = {}) {
        const id = uid('field'), wrapper = el('label', { class: 'property-field', htmlFor: id }, el('span', { text: label }));
        let input;
        if (spec.options) {
            input = el('select', { id, 'aria-label': label });
            for (const o of spec.options) {
                const option = typeof o === 'object' ? o : { value: o, label: o };
                input.append(el('option', { value: option.value, text: option.label, selected: String(option.value) === String(value) }));
            }
        }
        else if (spec.type === 'textarea')
            input = el('textarea', { id, value: value ?? '', spellcheck: false, 'aria-label': label });
        else
            input = el('input', { id, type: spec.type || (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'checkbox' : 'text'), ...(typeof value === 'boolean' ? { checked: value } : { value: value ?? '' }), min: spec.min, max: spec.max, step: spec.step || 'any', 'aria-label': label });
        input.addEventListener('change', () => { const next = input.type === 'checkbox' ? input.checked : (input.type === 'number' || spec.numeric) ? Number(input.value) : input.value; if ((input.type === 'number' || spec.numeric) && !Number.isFinite(next)) {
            input.value = value;
            this.toast('Enter a finite number.', true);
            return;
        } onChange(next); });
        wrapper.append(input);
        return wrapper;
    }
    section(label) { return el('div', { class: 'property-section', text: label }); }
    propertyButton(label, action, danger = false) { return button(label, action, { class: `property-button ${danger ? 'danger' : ''}` }); }
    hero(glyph, title, text) { return el('div', { class: 'property-hero' }, el('span', { class: 'property-icon', text: glyph }), el('div', {}, el('h3', { text: title }), el('p', { text }))); }
    liveValue(graph, node, port) { return el('b', { dataset: { liveGraph: graph, liveNode: node, livePort: port }, text: formatValue(this.values[`${graph}/${node}`]?.[port], 6) }); }
    sourceOptions(widget, second = false) {
        const type = WIDGETS[widget.kind].type, control = WIDGETS[widget.kind].category === 'Controls', options = [{ value: '', label: second ? 'No second channel' : 'Unbound' }];
        for (const graph of Object.values(this.project.graphs))
            for (const node of graph.nodes) {
                if (control && (graph.id !== this.project.root || !CONTROL_TYPES.has(node.type)))
                    continue;
                for (const pin of ports(node, graph, this.project).outputs) {
                    const matches = pin.type === type || widget.kind === 'chart' && ['number', 'array', 'waveform'].includes(pin.type);
                    if (!matches)
                        continue;
                    options.push({ value: `${graph.id}|${node.id}|${pin.key}`, label: `${graph.id === this.project.root ? '' : graph.name.replace('.vi', '') + ' / '}${node.name} · ${pin.key}` });
                }
            }
        return options;
    }
    renderInspector() {
        const root = $('#inspector-content');
        root.replaceChildren();
        const selected = this.selection, g = this.project.graphs[this.graphId];
        if (selected?.kind === 'nodes' && selected.ids.length === 1) {
            const node = g.nodes.find(n => n.id === selected.ids[0]);
            if (!node) {
                this.selection = null;
                this.renderInspector();
                return;
            }
            const definition = NODES[node.type], signature = ports(node, g, this.project);
            $('#inspector-kind').textContent = 'FUNCTION';
            root.append(this.hero(definition.glyph, definition.title, definition.category), this.field('Label', node.name, value => this.mutate('Rename block', () => { node.name = value; }, { runtime: false })), this.section('PARAMETERS'));
            for (const [key, spec] of Object.entries(definition.parameters)) {
                let options = spec.options;
                if (spec.kind === 'graph')
                    options = Object.values(this.project.graphs).filter(x => x.id !== g.id).map(x => ({ value: x.id, label: x.name }));
                if (key === 'port' && ['input', 'output'].includes(node.type))
                    options = g[node.type === 'input' ? 'inputs' : 'outputs'].map(p => ({ value: p.key, label: `${p.key} · ${TYPES[p.type].label}` }));
                root.append(this.field(spec.label, node.params[key], value => {
                    if (key === 'value' && CONTROL_TYPES.has(node.type) && this.graphId === this.project.root) {
                        this.setControl(node.id, value);
                        this.endControlEdit();
                    }
                    else
                        this.mutate(`Edit ${spec.label}`, () => { node.params[key] = value; validateProject(this.project); });
                }, { options, type: spec.kind === 'boolean' ? 'checkbox' : spec.kind === 'number' ? 'number' : spec.kind === 'text' && key === 'value' && node.type === 'arrayControl' ? 'textarea' : undefined, min: spec.min, max: spec.max, step: spec.step }));
            }
            const defaults = signature.inputs.filter(pin => !g.edges.some(e => e.to.node === node.id && e.to.port === pin.key) && !Object.hasOwn(definition.parameters, pin.key) && ['number', 'boolean', 'string'].includes(pin.type));
            if (defaults.length) {
                root.append(this.section('UNWIRED INPUT DEFAULTS'));
                for (const pin of defaults)
                    root.append(this.field(pin.label || pin.key, inputDefault(node, pin) ?? (pin.type === 'number' ? 0 : pin.type === 'boolean' ? false : ''), value => this.mutate('Edit input default', () => { node.params[pin.key] = value; })));
            }
            if (signature.inputs.length) {
                root.append(this.section('INPUT TERMINALS'));
                for (const pin of signature.inputs) {
                    const wire = g.edges.find(e => e.to.node === node.id && e.to.port === pin.key), source = wire && g.nodes.find(n => n.id === wire.from.node);
                    root.append(el('div', { class: 'port-info', style: { '--port-color': TYPES[pin.type].color } }, el('i'), `${pin.key}`, el('small', { text: source ? source.name : inputDefault(node, pin) !== undefined ? 'default' : 'REQUIRED' })));
                }
            }
            if (signature.outputs.length) {
                root.append(this.section('LIVE OUTPUTS'));
                for (const pin of signature.outputs)
                    root.append(el('div', { class: 'property-stat' }, el('span', { text: pin.key }), this.liveValue(g.id, node.id, pin.key)));
            }
            root.append(this.section('DEBUGGING'), this.field('Breakpoint before execution', !!node.breakpoint, () => this.toggleBreakpoint(node.id)));
            if (['subvi', 'for', 'while', 'case'].includes(node.type))
                root.append(this.propertyButton(node.type === 'case' ? 'Open true-case diagram ↗' : 'Open subdiagram ↗', () => this.openGraph(node.type === 'case' ? node.params.trueGraph : node.params.graph)));
            if (node.type === 'case')
                root.append(this.propertyButton('Open false-case diagram ↗', () => this.openGraph(node.params.falseGraph)));
            if (signature.outputs.length)
                root.append(this.propertyButton('Create front-panel indicator', () => this.createBoundWidget({ node: node.id, port: signature.outputs[0].key }, signature.outputs[0].type)));
            root.append(this.propertyButton('Delete block', () => this.deleteSelection(), true));
            $('#context-tip').textContent = node.type === 'delay' ? 'Feedback publishes the previous tick, then commits its input after the graph completes. This explicitly breaks a cycle.' : node.type === 'while' ? 'The loop body returns value and continue. True repeats. The safety limit is enforced in the worker.' : 'A function runs when its upstream dependencies are available. Defaults are used only on unwired inputs.';
        }
        else if (selected?.kind === 'widget') {
            const w = this.project.widgets.find(w => w.id === selected.id);
            if (!w)
                return;
            $('#inspector-kind').textContent = 'CONTROL';
            const def = WIDGETS[w.kind];
            root.append(this.hero(def.glyph, def.name, def.category), this.field('Label', w.label, value => this.mutate('Rename panel control', () => { w.label = value; }, { runtime: false })), this.section('DATA BINDING'));
            const sourceValue = s => s ? `${s.graph || this.project.root}|${s.node}|${s.port}` : '';
            const sourceField = (key, label, second) => this.field(label, sourceValue(w[key]), value => this.mutate('Bind front-panel control', () => { if (!value)
                delete w[key];
            else {
                const [graph, node, port] = value.split('|');
                w[key] = { node, port, ...(graph !== this.project.root ? { graph } : {}) };
            } }, { runtime: false }), { options: this.sourceOptions(w, second) });
            root.append(sourceField('source', 'Source terminal', false));
            if (['chart', 'scope'].includes(w.kind))
                root.append(sourceField('source2', 'Second channel', true));
            root.append(this.field('Unit', w.unit || '', value => this.mutate('Change unit label', () => { w.unit = value; }, { runtime: false })), this.field('Subtitle', w.subtitle || '', value => this.mutate('Edit subtitle', () => { w.subtitle = value; }, { runtime: false })));
            if (w.kind === 'meter')
                root.append(this.field('Decimal places', w.digits ?? 3, value => this.mutate('Meter precision', () => { w.digits = clamp(Math.trunc(value), 0, 10); }, { runtime: false }), { min: 0, max: 10, step: 1 }));
            if (['knob', 'slider', 'numeric', 'gauge'].includes(w.kind))
                for (const [key, label, fallback] of [['min', 'Minimum', 0], ['max', 'Maximum', 10], ['step', 'Increment', .1]])
                    root.append(this.field(label, w[key] ?? fallback, value => this.mutate('Control range', () => { w[key] = value; }, { runtime: false })));
            if (['scope', 'chart'].includes(w.kind)) {
                root.append(this.section('ACQUISITION DISPLAY'));
                for (const [key, label, fallback] of [['range', 'Vertical half-range', 4], ['timebase', 'Seconds per division', .01], ['triggerLevel', 'Rising trigger level', 0]])
                    root.append(this.field(label, w[key] ?? fallback, value => this.mutate('Scope configuration', () => { if (key !== 'triggerLevel' && value <= 0)
                        throw new Error('Range and timebase must be positive.'); w[key] = value; }, { runtime: false })));
                root.append(this.field('Frequency-domain display', !!w.spectrum, value => this.mutate('Plot domain', () => { w.spectrum = value; }, { runtime: false })));
                if (w.spectrum)
                    root.append(this.field('Maximum frequency (Hz)', w.maxFrequency || 1024, value => this.mutate('Spectrum span', () => { w.maxFrequency = Math.max(1, value); }, { runtime: false })));
            }
            root.append(this.section('LAYOUT · PIXELS'));
            for (const pair of [[['x', 'X'], ['y', 'Y']], [['w', 'Width'], ['h', 'Height']]])
                root.append(el('div', { class: 'property-row' }, ...pair.map(([key, label]) => this.field(label, w[key], value => this.mutate('Panel geometry', () => { w[key] = clamp(value, ['w', 'h'].includes(key) ? 90 : 0, 4000); }, { runtime: false }), { step: 8 }))));
            root.append(this.propertyButton(this.panel.layoutMode ? 'Lock layout / operate' : 'Unlock layout editing', () => this.setLayoutMode(!this.panel.layoutMode)), this.propertyButton('Delete front-panel control', () => this.deleteSelection(), true));
            $('#context-tip').textContent = 'Front-panel controls drive typed terminals. Indicators observe results. Deleting an indicator does not remove its source function.';
        }
        else if (selected?.kind === 'wire') {
            const edge = g.edges.find(e => e.id === selected.id);
            if (!edge)
                return;
            const from = g.nodes.find(n => n.id === edge.from.node), to = g.nodes.find(n => n.id === edge.to.node), pin = ports(from, g, this.project).outputs.find(p => p.key === edge.from.port);
            $('#inspector-kind').textContent = 'WIRE';
            root.append(this.hero('⌁', 'Typed data wire', TYPES[pin?.type]?.description || 'Invalid terminal'), this.section('CONNECTION'), el('div', { class: 'property-note', text: `${from.name}.${edge.from.port}\n↓\n${to.name}.${edge.to.port}`, style: { whiteSpace: 'pre-line' } }), el('div', { class: 'property-stat' }, el('span', { text: 'Data type' }), el('b', { text: TYPES[pin?.type]?.label || 'INVALID' })), this.section('LIVE VALUE'), el('div', { class: 'property-stat' }, el('span', { text: 'Current value' }), this.liveValue(g.id, from.id, edge.from.port)), this.field('Probe enabled', !!edge.probe, () => this.toggleProbe(edge.id)), this.propertyButton('Delete wire', () => this.deleteSelection(), true));
            $('#context-tip').textContent = 'Each input has one driver; outputs may fan out. Numeric arrays and waveform samples are immutable inside the runtime.';
        }
        else if (selected?.kind === 'nodes' && selected.ids.length > 1) {
            $('#inspector-kind').textContent = 'SELECTION';
            root.append(this.hero('▦', `${selected.ids.length} blocks`, 'Multi-selection'), this.propertyButton('Create reusable SubVI', () => this.extractSelection()), this.propertyButton('Duplicate selection', () => this.duplicate()), this.propertyButton('Delete selection', () => this.deleteSelection(), true));
        }
        else {
            $('#inspector-kind').textContent = this.graphId === this.project.root ? 'PROJECT' : 'SUBPROGRAM';
            root.append(this.hero('VI', this.graphId === this.project.root ? 'Virtual instrument' : 'Reusable subprogram', this.graphId === this.project.root ? 'Front panel + typed block diagram' : g.name), this.field('Project name', this.project.name, value => this.mutate('Rename project', () => { this.project.name = value; this.project.graphs[this.project.root].name = `${value}.vi`; }, { runtime: false })));
            if (this.graphId !== this.project.root) {
                root.append(this.field('Subprogram name', g.name, value => this.mutate('Rename VI', () => { g.name = value; }, { runtime: false })), this.section('TYPED INTERFACE'));
                for (const key of ['inputs', 'outputs'])
                    root.append(this.field(key === 'inputs' ? 'Inputs (JSON)' : 'Outputs (JSON)', JSON.stringify(g[key], null, 2), text => this.mutate('Edit VI interface', () => {
                        const pins = JSON.parse(text);
                        if (!Array.isArray(pins))
                            throw new Error('Interface must be an array of {key,type,default?}.');
                        g[key] = pins;
                        validateProject(this.project);
                        const terminal = key === 'inputs' ? 'input' : 'output', removed = new Set(g.nodes.filter(n => n.type === terminal && !pins.some(p => p.key === n.params.port)).map(n => n.id));
                        g.nodes = g.nodes.filter(n => !removed.has(n.id));
                        g.edges = g.edges.filter(e => !removed.has(e.from.node) && !removed.has(e.to.node));
                        pins.forEach((pin, index) => { if (!g.nodes.some(n => n.type === terminal && n.params.port === pin.key))
                            g.nodes.push(makeNode(terminal, terminal === 'input' ? 20 : 720, 50 + index * 180, { port: pin.key })); });
                    }), { type: 'textarea' }));
                root.append(this.propertyButton('Place a call in main VI', () => { const id = this.graphId; this.openGraph(this.project.root); this.addNode('subvi', null, { graph: id }); }));
            }
            root.append(this.section('SIMULATION CLOCK'));
            for (const [key, label, min, max, step] of [['sampleRate', 'Sample rate (Hz)', 1, 1e6, 1], ['blockSize', 'Samples per tick', 1, 8192, 1], ['seed', 'Deterministic seed', 0, 0xffffffff, 1], ['speed', 'Playback speed', .01, 100, .1]])
                root.append(this.field(label, this.project.settings[key], value => this.mutate('Simulation settings', () => { this.project.settings[key] = value; validateProject(this.project); }), { min, max, step }));
            root.append(this.section('EXECUTION ENGINE'), el('div', { class: 'property-stat' }, el('span', { text: 'Renderer' }), el('b', { id: 'renderer-property', text: this.renderer })), el('div', { class: 'property-stat' }, el('span', { text: 'Tick duration' }), el('b', { text: `${formatValue(this.project.settings.blockSize / this.project.settings.sampleRate * 1000)} ms` })), el('div', { class: 'property-stat' }, el('span', { text: 'Transport limit' }), el('b', { text: '2 frames' })), el('div', { class: 'property-stat' }, el('span', { text: 'Numeric precision' }), el('b', { text: 'Float64' })), el('div', { class: 'property-stat' }, el('span', { text: 'Operator library' }), el('b', { text: `${Object.keys(NODES).length} operators` })), this.section('PROJECT ACTIONS'), this.propertyButton('Validate typed diagrams', () => this.validate()), this.propertyButton('Create reusable subprogram', () => this.newSubVI()), this.propertyButton('Export project', () => this.saveProject()), el('div', { class: 'property-note', text: 'Worker-based execution. Fixed simulation time. Seeded noise. No external hardware or network services.' }));
            $('#context-tip').textContent = 'Start with the working example. Change a knob, probe a wire, or open Block Diagram to edit the program behind the panel.';
        }
    }
    updateLiveInspector() {
        $$('[data-live-node]').forEach(e => { const { liveGraph, liveNode, livePort } = e.dataset; const value = this.values[`${liveGraph}/${liveNode}`]?.[livePort]; e.textContent = formatValue(value, 6); e.title = formatValue(value, 10); });
        const renderer = $('#renderer-property');
        if (renderer)
            renderer.textContent = this.renderer;
    }
    renderDebug(force = false) {
        const target = $('#debug-content');
        if (!target)
            return;
        $$('[data-debug]').forEach(b => b.classList.toggle('active', b.dataset.debug === this.debugTab));
        const probes = Object.values(this.project.graphs).flatMap(g => g.edges.filter(e => e.probe).map(e => ({ graph: g, edge: e })));
        $('#probe-count').textContent = probes.length;
        $('#error-count').textContent = this.errors.length;
        if ($('#debug-panel').classList.contains('collapsed') && !force)
            return;
        target.replaceChildren();
        const table = (headers, widths) => { const t = el('table', { class: 'debug-table' }), head = el('thead'), row = el('tr'), body = el('tbody'); headers.forEach((h, i) => row.append(el('th', { text: h, style: { width: widths?.[i] || 'auto' } }))); head.append(row); t.append(head, body); target.append(t); return body; };
        if (this.debugTab === 'probes') {
            if (!probes.length) {
                target.append(el('div', { class: 'debug-empty' }, icon('probe', 18), 'No probes yet. Double-click a wire, or select one and press P.'));
                return;
            }
            const body = table(['PROBE', 'SOURCE', 'TYPE', 'CURRENT VALUE', 'STATUS'], ['13%', '28%', '12%', '35%', '12%']);
            probes.forEach(({ graph, edge }, index) => {
                const n = graph.nodes.find(n => n.id === edge.from.node);
                if (!n)
                    return;
                const p = ports(n, graph, this.project).outputs.find(p => p.key === edge.from.port), value = this.values[`${graph.id}/${n.id}`]?.[edge.from.port];
                const row = el('tr', { ondblclick: () => { this.openGraph(graph.id); this.select({ kind: 'wire', id: edge.id }); }, title: 'Double-click to locate wire' }, el('td', {}, el('div', { class: 'probe-cell' }, el('span', { class: 'probe-badge', text: `P${index + 1}` }), `Probe ${index + 1}`)), el('td', { text: `${n.name} · ${edge.from.port}` }), el('td', {}, el('span', { class: 'type-badge', text: TYPES[p?.type]?.label || '?' })), el('td', { class: 'mono', text: formatValue(value, 6), title: formatValue(value, 12) }), el('td', { text: value === undefined ? 'Waiting' : this.mode === 'running' ? '● Live' : 'Paused' }));
                body.append(row);
            });
        }
        else if (this.debugTab === 'trace') {
            const trace = this.lastFrame?.trace || [];
            if (!trace.length) {
                target.append(el('div', { class: 'debug-empty' }, icon('node', 18), 'Execute a tick to inspect node scheduling. F6 steps into individual nodes.'));
                return;
            }
            const body = table(['ORDER', 'FUNCTION', 'SUBPROGRAM / INSTANCE', 'EVALUATION', 'TICK'], ['8%', '24%', '39%', '18%', '11%']);
            trace.slice(-256).forEach((entry, index) => {
                const graph = this.project.graphs[entry.graph], node = graph?.nodes.find(n => n.id === entry.node);
                body.append(el('tr', { ondblclick: () => { this.openGraph(entry.graph); this.select({ kind: 'nodes', ids: [entry.node] }); } }, el('td', { class: 'mono', text: index + 1 }), el('td', { text: node?.name || entry.node }), el('td', { class: 'mono', text: entry.instance, title: entry.instance }), el('td', { text: entry.cached ? 'Memoized' : 'Executed' }), el('td', { class: 'mono', text: entry.tick })));
            });
        }
        else if (this.debugTab === 'errors') {
            if (!this.errors.length) {
                target.append(el('div', { class: 'debug-empty' }, icon('check', 18), 'No diagnostics. Port types, required inputs, dependency cycles, and VI interfaces are checked before execution.'));
                return;
            }
            for (const error of this.errors)
                target.append(el('div', { class: 'diagnostic-row', onclick: () => { if (error.graph) {
                        this.openGraph(error.graph);
                        if (error.node)
                            this.select({ kind: 'nodes', ids: [error.node] });
                        this.diagram.setErrors(this.errors);
                    } } }, el('span', { text: '●' }), el('span', { text: error.message })));
        }
        else {
            const controls = el('div', { class: 'recording-controls' });
            controls.append(button(this.recording ? 'Stop recording' : 'Record from tick 0', () => this.toggleRecord(), { icon: 'record', size: 12 }), button('Replay', () => this.replay(), { icon: 'repeat', size: 12 }), button('Open recording', () => $('#recording-file').click(), { icon: 'open', size: 12 }), button('Export', () => this.exportRecording(), { icon: 'download', size: 12 }), el('p', { text: this.recording ? `${this.recordCount.toLocaleString()} ticks captured` : this.recordingData ? `${this.recordingData.frames.length.toLocaleString()} recorded ticks · ${this.recordingData.project.name}` : 'Fixed clock + seed + input log = repeatable execution' }));
            target.append(controls);
            const frames = this.recordingData?.frames.slice(-10) || [];
            if (frames.length) {
                const body = table(['TICK', 'RECORDED CONTROL INPUTS'], ['12%', '88%']);
                frames.forEach(frame => body.append(el('tr', {}, el('td', { class: 'mono', text: frame.tick }), el('td', { class: 'mono', text: Object.entries(frame.controls).map(([key, value]) => `${key}=${formatValue(value)}`).join('    ') }))));
            }
        }
    }
    showContext(entries, x, y, target = $('#context-menu')) {
        $('#menu-popup').hidden = true;
        $('#context-menu').hidden = true;
        target.replaceChildren();
        for (const entry of entries) {
            if (!entry) {
                target.append(el('div', { class: 'menu-separator' }));
                continue;
            }
            if (entry.heading) {
                target.append(el('div', { class: 'menu-title', text: entry.heading }));
                continue;
            }
            const item = el('button', { class: `menu-item ${entry.danger ? 'danger' : ''}`, disabled: entry.disabled || false, onclick: () => { target.hidden = true; entry.action(); } }, el('span', { text: entry.label }), el('small', { text: entry.shortcut || '' }));
            target.append(item);
        }
        target.hidden = false;
        target.style.left = `${clamp(x, 5, innerWidth - target.offsetWidth - 5)}px`;
        target.style.top = `${clamp(y, 5, innerHeight - target.offsetHeight - 5)}px`;
    }
    showMenu(name, anchor) {
        const options = {
            File: [{ label: 'New instrument', shortcut: 'Ctrl N', action: () => this.loadDemo('empty') }, { label: 'Open project…', shortcut: 'Ctrl O', action: () => $('#project-file').click() }, { label: 'Save / export project', shortcut: 'Ctrl S', action: () => this.saveProject() }, null, { heading: 'EXECUTABLE EXAMPLES' }, { label: 'Signal Integrity Bench', action: () => this.loadDemo('signal') }, { label: 'Structures & Array Laboratory', action: () => this.loadDemo('structures') }, { label: 'Closed-loop Control Bench', action: () => this.loadDemo('feedback') }, null, { label: 'Open input recording…', action: () => $('#recording-file').click() }, { label: 'Export input recording', action: () => this.exportRecording() }],
            Edit: [{ label: 'Undo', shortcut: 'Ctrl Z', action: () => this.undo(), disabled: !this.history.undoStack.length }, { label: 'Redo', shortcut: 'Ctrl Shift Z', action: () => this.redo(), disabled: !this.history.redoStack.length }, null, { label: 'Cut', shortcut: 'Ctrl X', action: () => this.copy(true) }, { label: 'Copy', shortcut: 'Ctrl C', action: () => this.copy() }, { label: 'Paste', shortcut: 'Ctrl V', action: () => this.paste() }, { label: 'Duplicate', shortcut: 'Ctrl D', action: () => this.duplicate() }, { label: 'Delete', shortcut: 'Del', action: () => this.deleteSelection() }, null, { label: 'Select all blocks', shortcut: 'Ctrl A', action: () => { this.setView('diagram'); this.select({ kind: 'nodes', ids: this.project.graphs[this.graphId].nodes.map(n => n.id) }); } }],
            View: [{ label: 'Front Panel', shortcut: 'Ctrl E', action: () => this.setView('panel') }, { label: 'Block Diagram', shortcut: 'Ctrl E', action: () => this.setView('diagram') }, { label: 'Split workspace', action: () => this.setView('split') }, null, { label: 'Fit workspace', shortcut: 'F', action: () => this.view === 'diagram' ? this.diagram.fit() : this.panel.fit() }, { label: this.panel.layoutMode ? 'Lock front-panel layout' : 'Edit front-panel layout', action: () => this.setLayoutMode(!this.panel.layoutMode) }, { label: 'Toggle debug panel', action: () => $('#collapse-debug').click() }, { label: 'Toggle properties', action: () => { const sidebar = $('#inspector'); sidebar.style.display = getComputedStyle(sidebar).display === 'none' ? 'flex' : 'none'; } }, { label: 'Toggle project explorer', action: () => { const sidebar = $('#sidebar'); sidebar.style.display = getComputedStyle(sidebar).display === 'none' ? 'flex' : 'none'; } }],
            Operate: [{ label: 'Run continuously', shortcut: 'F5', action: () => this.execute('run') }, { label: 'Run one tick', shortcut: 'Ctrl R', action: () => this.execute('tick') }, { label: 'Pause', action: () => this.execute('pause') }, { label: 'Stop and reset', shortcut: 'Shift F5', action: () => this.execute('stop') }, null, { label: 'Step into node', shortcut: 'F6', action: () => this.execute('node') }, { label: 'Step one tick', shortcut: 'F10', action: () => this.execute('tick') }, { label: this.highlight ? 'Disable execution highlighting' : 'Highlight execution', action: () => this.toggleHighlight() }, { label: 'Probe selected wire', shortcut: 'P', action: () => this.probeSelection() }, null, { label: this.recording ? 'Stop recording inputs' : 'Record inputs from tick zero', action: () => this.toggleRecord() }, { label: 'Replay recorded inputs', action: () => this.replay() }],
            Tools: [{ label: 'Validate all diagrams', action: () => this.validate() }, { label: 'Auto-arrange blocks', action: () => this.autoLayout() }, { label: 'Extract selected blocks as SubVI', shortcut: 'Ctrl G', action: () => this.extractSelection() }, { label: 'New reusable subprogram', action: () => this.newSubVI() }, null, { label: 'Export typed intermediate representation', action: () => this.exportIR() }, { label: 'Export runtime snapshot', action: () => this.send('snapshot') }, { label: 'Insert function…', shortcut: 'Tab', action: () => this.openPalette('nodes') }],
            Help: [{ label: 'Workflow and keyboard shortcuts', shortcut: 'F1', action: () => this.showHelp() }, { label: 'About VoltWeave Studio', action: () => this.showHelp() }]
        };
        const r = anchor.getBoundingClientRect();
        this.showContext(options[name], r.left, r.bottom + 4, $('#menu-popup'));
    }
    exportIR() {
        try {
            const ir = compileProject(this.project);
            const data = { format: 'voltweave-ir', version: 1, root: this.project.root, settings: this.project.settings, graphs: [...ir.plans.values()].map(p => ({ id: p.graph.id, inputs: p.graph.inputs, outputs: p.graph.outputs, instructions: p.instructions.map(i => ({ id: i.id, operator: i.node.type, parameters: i.node.params, signature: i.signature, bindings: i.bindings, memoizable: i.pure, phase: i.node.type === 'delay' ? 'read-then-commit' : 'dataflow' })) })) };
            download('voltweave-typed-ir.json', JSON.stringify(data, null, 2));
        }
        catch (error) {
            this.toast(error.message, true);
        }
    }
    showHelp() {
        const root = $('#help-content');
        root.replaceChildren();
        root.append(el('div', { class: 'help-callout', text: 'VoltWeave Studio is an independent, local-first graphical programming workbench. Every instrument on the example front panel is driven by the editable dataflow diagram. All instrument I/O is simulated.' }), el('h3', { text: 'Operate the instrument' }), el('p', { text: 'Run starts continuous acquisition. Knobs, sliders, switches, numeric inputs, and array editors change typed control values at tick boundaries. Pause preserves execution; Stop cancels the current tick and resets simulation time, random streams, and node state.' }), el('h3', { text: 'Edit a dataflow program' }), el('p', { text: 'Open Block Diagram. Click an output terminal, then a matching input terminal, or drag between them. Orange wires carry numbers; green wires carry Booleans; blue wires carry arrays; purple wires carry waveforms. A terminal accepts one driver. Explicit conversion blocks bridge array and waveform types.' }), el('p', { text: 'Add functions with Tab or the Functions palette. Drag blocks to arrange them; drag an empty area for box selection. Hold Space or use the middle mouse button to pan. The wheel zooms around the pointer. Right-click a function or wire for actions.' }), el('h3', { text: 'Loops, cases, and reusable VIs' }), el('p', { text: 'Double-click a structure to open its real subdiagram. For and While bodies receive number inputs value/index. Both return value; While also returns Boolean continue. For produces an auto-indexed array. While repeats while continue is true and errors at its safety limit. Case executes only the selected branch.' }), el('p', { text: 'Create a VI from the project explorer or extract selected processing blocks with Ctrl G. Boundary wires become typed interface ports. Edit the input/output JSON interface in the subprogram Properties. Leave front-panel controls outside an extracted selection. Right-click a library VI to place a call in the main diagram.' }), el('h3', { text: 'Front-panel editing and oscilloscopes' }), el('p', { text: 'Unlock Layout mode to move control headers and resize their lower-right corners. Select any control to edit its source binding and geometry. Scope HOLD freezes only the display; acquisition continues. AUTO scales the vertical range. TRIG finds a rising edge at the configured trigger level. CURS exposes two measurement cursors; click near one to move it. CSV exports the visible samples.' }), el('h3', { text: 'Debugging and deterministic replay' }), el('p', { text: 'Double-click a wire to add a probe. Set breakpoints with a block’s dot button or B. F6 steps into one operator, including nested VI calls; F10 finishes a tick. State writes are committed only after a complete tick. A feedback z⁻¹ publishes the old value and commits the new value at its graph boundary.' }), el('p', { text: 'Recording restarts at tick zero and stores the project, deterministic seed, and effective input controls for each tick. Stop recording to export a .vwr file. Replay executes that recorded project and ignores live control changes. Recordings hold up to 20,000 ticks. Floating-point replay is exact on the same JS engine; cross-engine transcendental functions can differ in their final bits.' }), el('h3', { text: 'Keyboard shortcuts' }));
        const table = el('table');
        for (const [key, action] of [['F5 / Shift F5', 'Run / stop and reset'], ['Ctrl R or F10', 'Run one simulation tick'], ['F6', 'Step into one node'], ['Ctrl E', 'Switch front panel / block diagram'], ['Tab', 'Insert function or control'], ['F', 'Fit the workspace'], ['P / B', 'Probe selected wire / toggle block breakpoint'], ['Ctrl G', 'Extract selected processing blocks into a VI'], ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'], ['Ctrl C / V / D', 'Copy / paste / duplicate'], ['Ctrl S / O / N', 'Export / open / new project'], ['Delete', 'Delete selection'], ['Escape', 'Cancel wiring or close a dialog']])
            table.append(el('tr', {}, el('td', {}, el('kbd', { text: key })), el('td', { text: action })));
        root.append(table, el('h3', { text: 'Runtime and limits' }), el('p', { text: 'The CPU dataflow VM runs inside an ES-module Web Worker with Float64 values, fixed simulation time, per-instance state, memoized pure operators, bounded instruction fuel, and cooperative cancellation. WebGPU renders antialiased diagram wires and scope traces with a shared instanced pipeline; Canvas2D is an explicitly labeled fallback. Numerical execution is not moved to the GPU, so rendering capabilities cannot change program results.' }), el('p', { text: 'Projects support up to 4,096 nodes, 16,384 wires, 128 graphs, 512 panel controls, 65,536-element arrays, and 10,000 loop iterations, subject to the per-tick execution budget. Recursive calls, implicit numeric coercions, native NI drivers, binary .vi import, and physical DAQ/VISA integration are not implemented.' }), el('div', { class: 'help-footer', text: 'VoltWeave Studio 1.0.0 · Original independent implementation. Not affiliated with NI. Source is plain HTML, CSS, and JavaScript. Projects remain in this browser unless explicitly exported.' }));
        $('#help-dialog').showModal();
    }
    keydown(event) {
        if (event.key === 'F1') {
            event.preventDefault();
            if (!$('#help-dialog').open)
                this.showHelp();
            return;
        }
        if (document.querySelector('dialog[open]') || editableTarget(event.target))
            return;
        const ctrl = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
        let action;
        if (ctrl) {
            if (key === 's')
                action = () => this.saveProject();
            else if (key === 'o')
                action = () => $('#project-file').click();
            else if (key === 'n')
                action = () => this.loadDemo('empty');
            else if (key === 'z')
                action = () => event.shiftKey ? this.redo() : this.undo();
            else if (key === 'y')
                action = () => this.redo();
            else if (key === 'r')
                action = () => this.execute('tick');
            else if (key === 'e')
                action = () => this.setView(this.view === 'panel' ? 'diagram' : 'panel');
            else if (key === 'c')
                action = () => this.copy();
            else if (key === 'x')
                action = () => this.copy(true);
            else if (key === 'v')
                action = () => this.paste();
            else if (key === 'd')
                action = () => this.duplicate();
            else if (key === 'g')
                action = () => this.extractSelection();
            else if (key === 'a' && this.view !== 'panel')
                action = () => this.select({ kind: 'nodes', ids: this.project.graphs[this.graphId].nodes.map(n => n.id) });
        }
        else {
            if (key === 'f5')
                action = () => this.execute(event.shiftKey ? 'stop' : 'run');
            else if (key === 'f6')
                action = () => this.execute('node');
            else if (key === 'f10')
                action = () => this.execute('tick');
            else if (key === 'tab')
                action = () => this.openPalette(this.view === 'panel' ? 'widgets' : 'nodes');
            else if (key === 'delete' || key === 'backspace')
                action = () => this.deleteSelection();
            else if (key === 'f')
                action = () => this.view === 'diagram' ? this.diagram.fit() : this.panel.fit();
            else if (key === 'p')
                action = () => this.probeSelection();
            else if (key === 'b' && this.selection?.kind === 'nodes')
                action = () => this.selection.ids.forEach(id => this.toggleBreakpoint(id));
            else if (key === 'escape')
                action = () => { this.diagram.wiring = null; this.select(null); $('#menu-popup').hidden = true; $('#context-menu').hidden = true; };
        }
        if (action) {
            event.preventDefault();
            action();
        }
    }
}
try {
    new App();
}
catch (error) {
    console.error(error);
    $('#status-text').textContent = `Startup failed: ${error.message}`;
    $('#inspector-content').append(el('div', { class: 'property-note', text: 'Use npm start or python3 -m http.server 8080, then open localhost. ES modules and workers do not run from file:// URLs.' }));
}
