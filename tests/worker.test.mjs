import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEMOS } from '../src/demo.js';
import { Engine } from '../src/runtime.js';
class Harness {
    constructor(t) {
        this.worker = new Worker(new URL('./worker-adapter.mjs', import.meta.url));
        this.messages = [];
        this.waiters = new Set();
        this.revision = 1;
        this.worker.on('message', message => {
            this.messages.push(message);
            for (const check of [...this.waiters])
                check();
        });
        this.worker.on('error', error => { this.failure = error; for (const check of this.waiters)
            check(); });
        t.after(() => this.worker.terminate());
    }
    send(kind, data = {}) { this.worker.postMessage({ kind, revision: this.revision, ...data }); }
    async wait(predicate, after = 0, timeout = 3000) {
        const find = () => this.messages.slice(after).find(predicate);
        if (find())
            return find();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(check);
                reject(new Error(`Worker response timeout; messages: ${this.messages.slice(after).map(m => `${m.kind}:${m.reason || m.message || m.tick || ''}`).join(', ')}`));
            }, timeout);
            const check = () => {
                const result = find();
                if (result || this.failure) {
                    clearTimeout(timer);
                    this.waiters.delete(check);
                    this.failure ? reject(this.failure) : resolve(result);
                }
            };
            this.waiters.add(check);
            check();
        });
    }
    async load(project = DEMOS.signal()) {
        project.settings.speed = 64;
        this.send('load', { project });
        await this.wait(m => m.kind === 'compiled');
        return project;
    }
    get frames() { return this.messages.filter(m => m.kind === 'frame'); }
}
test('worker transport stops at two unacknowledged frames and returns exactly one credit', async (t) => {
    const h = new Harness(t);
    await h.load();
    h.send('run');
    await h.wait(m => m.kind === 'frame' && m.tick === 1);
    await sleep(60);
    assert.equal(h.frames.length, 2);
    h.send('ack', { id: h.frames[0].id });
    await h.wait(m => m.kind === 'frame' && m.tick === 2);
    await sleep(60);
    assert.equal(h.frames.length, 3);
});
test('worker transferred waveform buffers do not detach engine or cached values', async (t) => {
    const h = new Harness(t);
    const p = await h.load();
    const expected = new Engine(p);
    for (let tick = 0; tick < 8; tick++) {
        const start = h.messages.length;
        h.send('tick');
        const frame = await h.wait(m => m.kind === 'frame', start);
        assert.equal(frame.tick, tick);
        assert.deepEqual(frame.values['main/mixer'].wave.samples, expected.tick().values['main/mixer'].wave.samples);
        assert.equal(frame.values['main/mixer'].wave.samples.byteLength, 256 * 8);
        h.send('ack', { id: frame.id });
    }
});
test('worker pauses without consuming a tick, then resets state on stop', async (t) => {
    const h = new Harness(t);
    await h.load(DEMOS.feedback());
    h.send('run');
    await h.wait(m => m.kind === 'frame' && m.tick === 1);
    let start = h.messages.length;
    h.send('pause');
    await h.wait(m => m.kind === 'status' && m.reason === 'Paused', start);
    h.frames.forEach(f => h.send('ack', { id: f.id }));
    await sleep(50);
    assert.equal(h.frames.length, 2);
    start = h.messages.length;
    h.send('stop');
    await h.wait(m => m.kind === 'reset', start);
    h.send('tick');
    const reset = await h.wait(m => m.kind === 'frame', start);
    assert.equal(reset.tick, 0);
    assert.deepEqual(reset.values, h.frames[0].values);
});
test('worker breakpoint pauses before evaluation, node-step enters the node, tick-step commits', async (t) => {
    const h = new Harness(t);
    const p = DEMOS.signal();
    p.graphs.main.nodes.find(n => n.id === 'generator').breakpoint = true;
    await h.load(p);
    h.send('run');
    const stopped = await h.wait(m => m.kind === 'break');
    assert.equal(stopped.event.node, 'generator');
    assert.equal(h.frames.length, 0);
    assert.equal(stopped.values['main/generator'], undefined);
    let start = h.messages.length;
    h.send('node');
    const stepped = await h.wait(m => m.kind === 'debug', start);
    assert.equal(stepped.event.node, 'generator');
    assert.equal(stepped.values['main/generator'].wave.samples.length, 256);
    start = h.messages.length;
    h.send('breakpoints', { keys: [] });
    h.send('tick');
    const frame = await h.wait(m => m.kind === 'frame', start);
    assert.equal(frame.tick, 0);
    const status = await h.wait(m => m.kind === 'status' && m.reason === 'Step complete', start);
    assert.equal(status.mode, 'paused');
});
test('worker cancellation aborts a partially evaluated transaction', async (t) => {
    const h = new Harness(t);
    const p = DEMOS.feedback();
    p.graphs.main.nodes.find(n => n.id === 'error').breakpoint = true;
    await h.load(p);
    h.send('run');
    await h.wait(m => m.kind === 'break');
    let start = h.messages.length;
    h.send('stop');
    await h.wait(m => m.kind === 'reset', start);
    h.send('snapshot');
    const snapshot = await h.wait(m => m.kind === 'snapshot', start);
    assert.equal(snapshot.data.index, 0);
    assert.deepEqual(snapshot.data.states, []);
    start = h.messages.length;
    h.send('breakpoints', { keys: [] });
    h.send('tick');
    const frame = await h.wait(m => m.kind === 'frame', start);
    assert.deepEqual(frame.values, new Engine(p).tick().values);
});
test('worker records effective controls and replays exactly, ignoring concurrent live controls', async (t) => {
    const h = new Harness(t);
    await h.load();
    h.send('controls', { values: { amplitude: 1.25 } });
    h.send('recordStart');
    await h.wait(m => m.kind === 'frame' && m.tick === 1);
    h.send('controls', { values: { amplitude: 4.25 } });
    h.frames.forEach(f => h.send('ack', { id: f.id }));
    await h.wait(m => m.kind === 'frame' && m.tick === 3);
    h.send('pause');
    h.send('recordStop');
    const { data } = await h.wait(m => m.kind === 'recording');
    assert.equal(data.frames.length, 4);
    assert.equal(data.frames[0].controls.amplitude, 1.25);
    assert.equal(data.frames[3].controls.amplitude, 4.25);
    const expected = h.frames.slice(0, 4);
    let start = h.messages.length;
    h.send('replay', { data });
    h.send('controls', { values: { amplitude: 1000 } });
    for (let tick = 0; tick < 4; tick++) {
        const frame = await h.wait(m => m.kind === 'frame' && m.tick === tick, start);
        assert.deepEqual(frame.values, expected[tick].values);
        h.send('ack', { id: frame.id });
    }
    const done = await h.wait(m => m.kind === 'status' && m.reason === 'Replay complete', start);
    assert.equal(done.mode, 'paused');
    assert.equal(done.replaying, false);
});
test('worker ignores messages from stale document revisions', async (t) => {
    const h = new Harness(t);
    await h.load();
    h.send('controls', { revision: 0, values: { amplitude: 1000 } });
    h.send('tick');
    const frame = await h.wait(m => m.kind === 'frame');
    assert.equal(frame.revision, 1);
    assert.equal(frame.values['main/amplitude'].value, 2.5);
});
test('worker reports malformed recordings without executing them', async (t) => {
    const h = new Harness(t);
    await h.load();
    h.send('replay', { data: { format: 'voltweave-recording', version: 1, frames: [{ tick: 9, controls: {} }] } });
    const error = await h.wait(m => m.kind === 'error');
    assert.match(error.message, /Invalid recording/);
    assert.equal(h.frames.length, 0);
});
