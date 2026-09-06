import { Engine } from './runtime.js';
/** Two-credit transport. The UI returns credit only after consuming a frame. */
let engine = null, mode = 'paused', iterator = null, controls = {}, breakpoints = new Set();
let revision = 0, generation = 0, sequence = 0, scheduled = null, pumping = false, due = 0;
let credits = new Set(), recording = null, replay = null, tickComputeMs = 0, lastBefore = null, lastControls = {};
const MAX_IN_FLIGHT = 2, MAX_RECORDED_TICKS = 20000;
const send = data => postMessage({ ...data, revision });
function errorMessage(error) { return { message: error.message, graph: error.graph, node: error.node, tick: error.tick, instance: error.instance, diagnostics: error.diagnostics }; }
function status(reason) { send({ kind: 'status', mode, reason, tick: engine?.index || 0, recording: !!recording, replaying: !!replay, queued: credits.size }); }
function clearSchedule() { if (scheduled !== null)
    clearTimeout(scheduled); scheduled = null; }
function abortTick() { iterator?.return(); iterator = null; engine?.abort(); lastBefore = null; }
function cancel(reset = false) { generation++; mode = 'paused'; clearSchedule(); abortTick(); credits.clear(); if (reset)
    engine?.reset(); }
function copyAndTransfer(frame) {
    const copy = structuredClone(frame), buffers = new Set(), seen = new Set();
    const walk = object => { if (!object || typeof object !== 'object' || seen.has(object))
        return; seen.add(object); if (ArrayBuffer.isView(object))
        buffers.add(object.buffer);
    else
        for (const value of Object.values(object))
            walk(value); };
    walk(copy);
    postMessage(copy, [...buffers]);
}
function schedule(delay = 0) { if (scheduled !== null || pumping || !engine || mode === 'paused')
    return; scheduled = setTimeout(() => { scheduled = null; pump(); }, delay); }
function makeIterator() {
    if (replay && engine.index >= replay.frames.length) {
        mode = 'paused';
        replay = null;
        status('Replay complete');
        return false;
    }
    lastControls = replay ? replay.frames[engine.index].controls : structuredClone(controls);
    iterator = engine.begin(lastControls);
    tickComputeMs = 0;
    return true;
}
function pump() {
    if (pumping || !engine || mode === 'paused' || credits.size >= MAX_IN_FLIGHT)
        return;
    pumping = true;
    const myGeneration = generation, budgetEnd = performance.now() + 5;
    let activeSliceStart = 0;
    try {
        if (!iterator && !makeIterator())
            return;
        activeSliceStart = performance.now();
        while (myGeneration === generation && mode !== 'paused') {
            const next = iterator.next();
            if (next.done) {
                iterator = null;
                lastBefore = null;
                if (recording) {
                    recording.frames.push({ tick: next.value.tick, controls: structuredClone(lastControls) });
                    if (recording.frames.length >= MAX_RECORDED_TICKS)
                        finishRecording('Recording capacity reached');
                }
                const id = ++sequence;
                credits.add(id);
                copyAndTransfer({ kind: 'frame', revision, id, ...next.value, computeMs: tickComputeMs + performance.now() - activeSliceStart, recorded: recording?.frames.length || 0, replaying: !!replay, controls: lastControls });
                if (mode !== 'running') {
                    mode = 'paused';
                    status('Step complete');
                }
                due = performance.now() + engine.dt * 1000 / engine.project.settings.speed;
                break;
            }
            const event = next.value;
            if (event.kind === 'before') {
                lastBefore = event;
                if (mode !== 'node' && breakpoints.has(`${event.graph}/${event.node}`)) {
                    mode = 'paused';
                    send({ kind: 'break', event, values: Object.fromEntries(engine.partialValues) });
                    status('Breakpoint');
                    break;
                }
            }
            else if (mode === 'node') {
                mode = 'paused';
                send({ kind: 'debug', event, values: Object.fromEntries(engine.partialValues) });
                status('Node step');
                break;
            }
            if (performance.now() >= budgetEnd)
                break; // Yield so pause, stop and graph changes remain responsive.
        }
    }
    catch (error) {
        mode = 'paused';
        abortTick();
        send({ kind: 'error', ...errorMessage(error) });
        status('Execution error');
    }
    finally {
        if (activeSliceStart) tickComputeMs += performance.now() - activeSliceStart;
        pumping = false;
        if (mode !== 'paused' && credits.size < MAX_IN_FLIGHT)
            schedule(iterator ? 0 : Math.max(0, due - performance.now()));
    }
}
function finishRecording(reason = 'Recording stopped') {
    if (!recording)
        return;
    const data = recording;
    recording = null;
    send({ kind: 'recording', data });
    status(reason);
}
onmessage = event => {
    const message = event.data;
    try {
        if (message.kind === 'load') {
            finishRecording('Project changed');
            cancel();
            revision = message.revision;
            engine = null;
            engine = new Engine(message.project);
            controls = message.controls || {};
            replay = null;
            due = 0;
            breakpoints = new Set(Object.values(engine.project.graphs).flatMap(g => g.nodes.filter(n => n.breakpoint).map(n => `${g.id}/${n.id}`)));
            send({ kind: 'compiled', nodes: engine.ir.nodeCount, graphs: engine.ir.plans.size });
            status('Ready');
            return;
        }
        if (message.revision !== undefined && message.revision !== revision)
            return;
        switch (message.kind) {
            case 'run':
                if (engine) {
                    mode = 'running';
                    due = 0;
                    status('Running');
                    schedule();
                }
                break;
            case 'pause':
                mode = 'paused';
                clearSchedule();
                status('Paused');
                break;
            case 'stop':
                cancel(true);
                replay = null;
                finishRecording();
                send({ kind: 'reset' });
                status('Stopped / reset');
                break;
            case 'tick':
                mode = 'tick';
                status('Single tick');
                schedule();
                break;
            case 'node':
                mode = 'node';
                status('Node stepping');
                schedule();
                break;
            case 'controls':
                controls = { ...controls, ...message.values };
                break;
            case 'breakpoints':
                breakpoints = new Set(message.keys);
                break;
            case 'ack':
                credits.delete(message.id);
                schedule(Math.max(0, due - performance.now()));
                break;
            case 'recordStart':
                if (!engine)
                    break;
                cancel(true);
                replay = null;
                recording = { format: 'voltweave-recording', version: 1, project: structuredClone(engine.project), frames: [] };
                mode = 'running';
                due = 0;
                send({ kind: 'reset' });
                status('Recording from tick zero');
                schedule();
                break;
            case 'recordStop':
                finishRecording();
                break;
            case 'replay': {
                const data = message.data;
                if (data?.format !== 'voltweave-recording' || data.version !== 1 || !Array.isArray(data.frames) || data.frames.length > MAX_RECORDED_TICKS || data.frames.some((f, i) => f.tick !== i || !f.controls || typeof f.controls !== 'object'))
                    throw new Error('Invalid recording.');
                cancel();
                finishRecording();
                engine = new Engine(data.project);
                replay = data;
                controls = {};
                mode = 'running';
                due = 0;
                send({ kind: 'reset' });
                send({ kind: 'compiled', nodes: engine.ir.nodeCount, graphs: engine.ir.plans.size });
                status('Replaying recorded inputs');
                schedule();
                break;
            }
            case 'snapshot':
                send({ kind: 'snapshot', data: engine?.snapshot() });
                break;
            case 'dispose':
                cancel();
                engine = null;
                close();
                break;
        }
    }
    catch (error) {
        mode = 'paused';
        engine = message.kind === 'load' ? null : engine;
        send({ kind: 'error', ...errorMessage(error) });
        status('Error');
    }
};
