import { NODES, TYPES, defaults, ports, inputDefault } from './types.js';
export const VERSION = 1;
export const LIMITS = Object.freeze({ nodes: 4096, edges: 16384, graphs: 128, widgets: 512, array: 65536, iterations: 10000, fuel: 250000 });
export const clone = value => structuredClone(value);
export const uid = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
export const keyOf = (id, port) => `${id}:${port}`;
export function makeNode(type, x = 100, y = 100, params = {}, id = uid('n')) {
    return { id, type, name: NODES[type]?.title || type, x, y, params: { ...defaults(type), ...params }, breakpoint: false };
}
export class CompileError extends Error {
    constructor(diagnostics) { super(diagnostics.map(d => d.message).join('\n')); this.name = 'CompileError'; this.diagnostics = diagnostics; }
}
function validIdentifier(v) { return typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,96}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v); }
export function validateProject(input) {
    if (!input || input.format !== 'voltweave' || input.version !== VERSION)
        throw new Error('Not a supported VoltWeave project (expected format=voltweave, version=1).');
    if (!input.graphs || typeof input.graphs !== 'object' || Array.isArray(input.graphs))
        throw new Error('Missing graph library.');
    const p = clone(input);
    if (Object.keys(p.graphs).length > LIMITS.graphs)
        throw new Error('Graph library limit exceeded.');
    if (!validIdentifier(p.root) || !Object.hasOwn(p.graphs, p.root))
        throw new Error('Missing root graph.');
    p.name = String(p.name || 'Untitled instrument').slice(0, 200);
    const s = p.settings || {};
    p.settings = { sampleRate: Number(s.sampleRate ?? 8192), blockSize: Number(s.blockSize ?? 256), seed: Number(s.seed ?? 1337), speed: Number(s.speed ?? 1) };
    if (!Number.isFinite(p.settings.sampleRate) || p.settings.sampleRate < 1 || p.settings.sampleRate > 1e6)
        throw new Error('Sample rate must be between 1 and 1,000,000 Hz.');
    if (!Number.isInteger(p.settings.blockSize) || p.settings.blockSize < 1 || p.settings.blockSize > 8192)
        throw new Error('Block size must be an integer from 1 to 8192.');
    if (!Number.isInteger(p.settings.seed) || p.settings.seed < 0 || p.settings.seed > 0xffffffff)
        throw new Error('Seed must be an unsigned 32-bit integer.');
    if (!Number.isFinite(p.settings.speed) || p.settings.speed <= 0 || p.settings.speed > 100)
        throw new Error('Speed must be in (0, 100].');
    let count = 0, edges = 0;
    for (const [id, g] of Object.entries(p.graphs)) {
        if (!validIdentifier(id) || g.id !== id)
            throw new Error('Invalid graph identity.');
        if (!Array.isArray(g.nodes) || !Array.isArray(g.edges))
            throw new Error(`Invalid graph ${id}.`);
        count += g.nodes.length;
        edges += g.edges.length;
        g.name = String(g.name || id).slice(0, 200);
        g.inputs ||= [];
        g.outputs ||= [];
        for (const ps of [g.inputs, g.outputs]) {
            if (!Array.isArray(ps) || ps.length > 32)
                throw new Error('An interface supports up to 32 ports.');
            const names = new Set();
            for (const x of ps) {
                if (!validIdentifier(x.key) || !Object.hasOwn(TYPES, x.type) || names.has(x.key))
                    throw new Error(`Invalid or duplicate interface port in ${id}.`);
                names.add(x.key);
            }
        }
        const ids = new Set();
        for (const n of g.nodes) {
            if (!validIdentifier(n.id) || ids.has(n.id))
                throw new Error(`Duplicate or invalid node ID in ${id}.`);
            ids.add(n.id);
            if (!Object.hasOwn(NODES, n.type))
                throw new Error(`Unknown operator ${n.type}.`);
            if (!Number.isFinite(n.x) || !Number.isFinite(n.y))
                throw new Error(`Invalid node coordinates: ${n.id}.`);
            n.name = String(n.name || NODES[n.type].title).slice(0, 120);
            n.params = { ...defaults(n.type), ...n.params };
            for (const [key, spec] of Object.entries(NODES[n.type].parameters)) {
                const value = n.params[key];
                if (spec.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max))
                    throw new Error(`${n.name}: ${spec.label} must be within ${spec.min} … ${spec.max}.`);
                if (spec.kind === 'select' && !spec.options.includes(value))
                    throw new Error(`${n.name}: invalid ${spec.label}.`);
                if ((spec.kind === 'text' || spec.kind === 'graph') && (typeof value !== 'string' || value.length > 1000000))
                    throw new Error(`${n.name}: invalid text parameter.`);
                if (spec.kind === 'boolean' && typeof value !== 'boolean')
                    throw new Error(`${n.name}: invalid Boolean parameter.`);
            }
        }
        const edgeIds = new Set();
        for (const e of g.edges) {
            if (!validIdentifier(e.id) || edgeIds.has(e.id) || !e.from || !e.to)
                throw new Error(`Invalid wire in ${id}.`);
            edgeIds.add(e.id);
        }
    }
    if (count > LIMITS.nodes || edges > LIMITS.edges)
        throw new Error('Project resource limits exceeded.');
    p.widgets ||= [];
    if (!Array.isArray(p.widgets) || p.widgets.length > LIMITS.widgets)
        throw new Error('Invalid front panel.');
    const widgetIds = new Set();
    const kinds = new Set(['knob', 'slider', 'numeric', 'toggle', 'arrayControl', 'meter', 'gauge', 'led', 'chart', 'scope', 'array', 'text']);
    for (const w of p.widgets) {
        if (!validIdentifier(w.id) || widgetIds.has(w.id) || !kinds.has(w.kind))
            throw new Error('Invalid or duplicate front-panel widget.');
        widgetIds.add(w.id);
        if (![w.x, w.y, w.w, w.h].every(Number.isFinite) || w.w < 60 || w.h < 50 || w.w > 4000 || w.h > 4000)
            throw new Error('Invalid widget geometry.');
        w.label = String(w.label || w.kind).slice(0, 160);
        if (w.source && (typeof w.source.node !== 'string' || typeof w.source.port !== 'string'))
            throw new Error('Invalid widget binding.');
    }
    return p;
}
/** Compile all callable graphs into a stable typed IR; Delay inputs are commit-phase edges. */
export function compileProject(rawProject) {
    const project = validateProject(rawProject), diagnostics = [], plans = new Map();
    const report = (graph, node, message, edge) => diagnostics.push({ severity: 'error', graph, node, edge, message });
    for (const graph of Object.values(project.graphs)) {
        const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
        const inputEdges = new Map(), signatures = new Map(), successors = new Map(), degrees = new Map();
        for (const n of graph.nodes) {
            signatures.set(n.id, ports(n, graph, project));
            successors.set(n.id, []);
            degrees.set(n.id, 0);
        }
        for (const edge of graph.edges) {
            const a = nodeMap.get(edge.from.node), b = nodeMap.get(edge.to.node);
            if (!a || !b) {
                report(graph.id, null, 'A wire references a missing node.', edge.id);
                continue;
            }
            const out = signatures.get(a.id).outputs.find(p => p.key === edge.from.port), inp = signatures.get(b.id).inputs.find(p => p.key === edge.to.port);
            if (!out || !inp) {
                report(graph.id, b.id, `Wire has a missing terminal (${a.name} → ${b.name}).`, edge.id);
                continue;
            }
            if (out.type !== inp.type)
                report(graph.id, b.id, `Type mismatch: ${TYPES[out.type].label} → ${TYPES[inp.type].label} on ${b.name}.${inp.key}.`, edge.id);
            const key = keyOf(b.id, inp.key);
            if (inputEdges.has(key))
                report(graph.id, b.id, `Input ${b.name}.${inp.key} has more than one driver.`, edge.id);
            inputEdges.set(key, edge);
            if (b.type !== 'delay') {
                successors.get(a.id).push(b.id);
                degrees.set(b.id, degrees.get(b.id) + 1);
            }
        }
        for (const node of graph.nodes) {
            const sig = signatures.get(node.id);
            if ((node.type === 'input' && !sig.outputs.length) || (node.type === 'output' && !sig.inputs.length))
                report(graph.id, node.id, `${node.name}: terminal is not declared on the graph interface.`);
            for (const pin of sig.inputs)
                if (!inputEdges.has(keyOf(node.id, pin.key)) && inputDefault(node, pin) === undefined)
                    report(graph.id, node.id, `Required input ${node.name}.${pin.key} is not wired.`);
        }
        for (const output of graph.outputs) {
            const terminals = graph.nodes.filter(n => n.type === 'output' && n.params.port === output.key);
            if (terminals.length !== 1)
                report(graph.id, null, `Output ${output.key} requires exactly one output terminal (found ${terminals.length}).`);
        }
        const ready = graph.nodes.filter(n => degrees.get(n.id) === 0).map(n => n.id), order = [];
        for (let i = 0; i < ready.length; i++) {
            const id = ready[i];
            order.push(id);
            for (const dst of successors.get(id)) {
                degrees.set(dst, degrees.get(dst) - 1);
                if (degrees.get(dst) === 0)
                    ready.push(dst);
            }
        }
        if (order.length !== graph.nodes.length)
            report(graph.id, null, 'Combinational cycle detected. Insert Feedback / z⁻¹ to define a tick boundary.');
        const instructions = order.map(id => {
            const node = nodeMap.get(id), signature = signatures.get(id);
            return { id, node, signature, bindings: signature.inputs.map(pin => ({ pin, source: inputEdges.get(keyOf(id, pin.key))?.from, fallback: inputDefault(node, pin) })), pure: !!NODES[node.type].pure };
        });
        plans.set(graph.id, { graph, instructions, nodeMap, inputEdges, signatures, delayed: instructions.filter(i => i.node.type === 'delay') });
    }
    const refs = node => node.type === 'case' ? [node.params.trueGraph, node.params.falseGraph] : ['subvi', 'for', 'while'].includes(node.type) ? [node.params.graph] : [];
    const checked = new Set(), visiting = new Set();
    const visit = id => {
        if (visiting.has(id)) {
            report(id, null, 'Recursive subprogram calls are not allowed. Use a bounded loop.');
            return;
        }
        if (checked.has(id))
            return;
        visiting.add(id);
        for (const n of plans.get(id)?.graph.nodes || []) {
            for (const childId of refs(n)) {
                const child = plans.get(childId)?.graph;
                if (!child) {
                    report(id, n.id, `Subprogram ${childId || '(none)'} does not exist.`);
                    continue;
                }
                if (n.type === 'for' || n.type === 'while') {
                    if (!child.inputs.some(p => p.key === 'value' && p.type === 'number') || !child.inputs.some(p => p.key === 'index' && p.type === 'number') || !child.outputs.some(p => p.key === 'value' && p.type === 'number'))
                        report(id, n.id, 'Loop bodies require number inputs value/index and number output value.');
                    if (n.type === 'while' && !child.outputs.some(p => p.key === 'continue' && p.type === 'boolean'))
                        report(id, n.id, 'While body requires Boolean output continue (true repeats).');
                }
                if (n.type === 'case' && (!child.inputs.some(p => p.key === 'value' && p.type === 'number') || !child.outputs.some(p => p.key === 'value' && p.type === 'number')))
                    report(id, n.id, 'Case branches require number input value and number output value.');
                if (['case', 'for', 'while'].includes(n.type))
                    for (const pin of child.inputs)
                        if (!['value', 'index'].includes(pin.key) && !Object.hasOwn(pin, 'default'))
                            report(id, n.id, `Structure cannot supply required body input ${pin.key}.`);
                visit(childId);
            }
        }
        visiting.delete(id);
        checked.add(id);
    };
    for (const id of plans.keys())
        visit(id);
    if (diagnostics.length)
        throw new CompileError(diagnostics);
    return { project, plans, root: plans.get(project.root), diagnostics, nodeCount: [...plans.values()].reduce((sum, p) => sum + p.instructions.length, 0) };
}
/** Bounded whole-document transactions. Runtime buffers and UI selections are intentionally excluded. */
export class History {
    constructor(limit = 80) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
    push(project, label = 'Edit') { this.undoStack.push({ project: clone(project), label }); if (this.undoStack.length > this.limit)
        this.undoStack.shift(); this.redoStack.length = 0; }
    undo(current) { const item = this.undoStack.pop(); if (!item)
        return null; this.redoStack.push({ project: clone(current), label: item.label }); return clone(item.project); }
    redo(current) { const item = this.redoStack.pop(); if (!item)
        return null; this.undoStack.push({ project: clone(current), label: item.label }); return clone(item.project); }
    clear() { this.undoStack.length = this.redoStack.length = 0; }
}
export function connect(project, graphId, from, to) {
    const g = project.graphs[graphId], a = g.nodes.find(n => n.id === from.node), b = g.nodes.find(n => n.id === to.node);
    if (!a || !b)
        throw new Error('A wire endpoint no longer exists.');
    const source = ports(a, g, project).outputs.find(p => p.key === from.port), target = ports(b, g, project).inputs.find(p => p.key === to.port);
    if (!source || !target)
        throw new Error('Invalid terminal.');
    if (source.type !== target.type)
        throw new Error(`Cannot connect ${source.type} to ${target.type}. Use an explicit conversion operator.`);
    g.edges = g.edges.filter(e => e.to.node !== to.node || e.to.port !== to.port);
    const edge = { id: uid('w'), from: { ...from }, to: { ...to }, probe: false };
    g.edges.push(edge);
    return edge;
}
/** Extract a selection, preserving boundary types and front-panel bindings. */
export function extractSubVI(project, graphId, selected, name = 'Reusable subprogram') {
    const g = project.graphs[graphId], ids = new Set(selected), nodes = g.nodes.filter(n => ids.has(n.id));
    if (!nodes.length)
        throw new Error('Select at least one block first.');
    if (nodes.some(n => n.type === 'input' || n.type === 'output'))
        throw new Error('Interface terminals cannot be extracted.');
    const id = uid('vi'), inMap = new Map(), outMap = new Map();
    const child = { id, name, inputs: [], outputs: [], nodes: clone(nodes), edges: clone(g.edges.filter(e => ids.has(e.from.node) && ids.has(e.to.node))) };
    const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
    child.nodes.forEach(n => { n.x = n.x - minX + 250; n.y = n.y - minY + 80; });
    const call = makeNode('subvi', minX, minY, { graph: id });
    call.name = name;
    function exported(source) {
        const key = keyOf(source.node, source.port);
        if (outMap.has(key))
            return outMap.get(key);
        const node = g.nodes.find(n => n.id === source.node), type = ports(node, g, project).outputs.find(p => p.key === source.port).type;
        const port = `out${outMap.size}`, terminal = makeNode('output', 800, 80 + outMap.size * 180, { port });
        child.outputs.push({ key: port, type, label: `${node.name}.${source.port}` });
        child.nodes.push(terminal);
        child.edges.push({ id: uid('w'), from: { ...source }, to: { node: terminal.id, port: 'value' } });
        outMap.set(key, port);
        return port;
    }
    const remaining = [];
    for (const e of g.edges) {
        const a = ids.has(e.from.node), b = ids.has(e.to.node);
        if (a && b)
            continue;
        if (!a && b) {
            const key = keyOf(e.from.node, e.from.port);
            let port = inMap.get(key);
            if (!port) {
                port = `in${inMap.size}`;
                const source = g.nodes.find(n => n.id === e.from.node), type = ports(source, g, project).outputs.find(p => p.key === e.from.port).type;
                const terminal = makeNode('input', 0, 80 + inMap.size * 180, { port });
                child.inputs.push({ key: port, type, label: `${source.name}.${e.from.port}` });
                child.nodes.push(terminal);
                inMap.set(key, port);
                remaining.push({ ...e, to: { node: call.id, port } });
            }
            const terminal = child.nodes.find(n => n.type === 'input' && n.params.port === port);
            child.edges.push({ id: uid('w'), from: { node: terminal.id, port: 'value' }, to: { ...e.to } });
        }
        else if (a && !b)
            remaining.push({ ...e, from: { node: call.id, port: exported(e.from) } });
        else
            remaining.push(e);
    }
    if (graphId === project.root)
        for (const w of project.widgets)
            for (const prop of ['source', 'source2'])
                if (w[prop] && (w[prop].graph || project.root) === graphId && ids.has(w[prop].node))
                    w[prop] = { node: call.id, port: exported(w[prop]) };
    if (!child.outputs.length) {
        const last = nodes.at(-1), out = ports(last, g, project).outputs[0];
        if (out)
            exported({ node: last.id, port: out.key });
    }
    g.nodes = g.nodes.filter(n => !ids.has(n.id));
    g.nodes.push(call);
    g.edges = remaining;
    project.graphs[id] = child;
    return call;
}
