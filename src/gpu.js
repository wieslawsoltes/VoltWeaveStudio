/** Shared WebGPU device/pipeline; each canvas owns only its target and persistent streaming buffers. */
const STRIDE = 9;
const SHADER = `
struct VertexIn {
  @location(0) a: vec2<f32>, @location(1) b: vec2<f32>,
  @location(2) width: f32, @location(3) color: vec4<f32>
};
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) shape: vec2<f32>, @location(2) color: vec4<f32>
};
@group(0) @binding(0) var<uniform> viewport: vec4<f32>;
@vertex fn vertexMain(v: VertexIn, @builtin(vertex_index) index: u32) -> VertexOut {
  let corners = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  let delta = v.b-v.a; let len = length(delta); let tangent = select(vec2(1.,0.), delta/max(len,0.00001), len>0.00001);
  let normal = vec2(-tangent.y,tangent.x); let radius = max(0.25, v.width*0.5);
  let local = corners[index]*vec2(len*0.5+radius+1., radius+1.);
  let position = (v.a+v.b)*0.5 + tangent*local.x + normal*local.y;
  var out: VertexOut; out.position = vec4((position/viewport.xy*2.-1.)*vec2(1.,-1.),0.,1.);
  out.local=local; out.shape=vec2(len*0.5,radius); out.color=v.color; return out;
}
@fragment fn fragmentMain(v: VertexOut) -> @location(0) vec4<f32> {
  let d = length(vec2(max(abs(v.local.x)-v.shape.x,0.),v.local.y))-v.shape.y;
  let alpha=1.-smoothstep(-0.7,0.7,d); return vec4(v.color.rgb,v.color.a*alpha);
}`;
let hostPromise;
const surfaces = new Set(), listeners = new Set();
export let rendererMode = 'Initializing';
export function onRendererMode(callback) { listeners.add(callback); callback(rendererMode); return () => listeners.delete(callback); }
function notify(mode) { rendererMode = mode; for (const callback of listeners)
    callback(mode); }
async function host() {
    if (!hostPromise)
        hostPromise = (async () => {
            if (!globalThis.navigator?.gpu) {
                notify('Canvas2D fallback');
                return null;
            }
            try {
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (!adapter)
                    throw new Error('No GPU adapter available');
                const device = await adapter.requestDevice(), format = navigator.gpu.getPreferredCanvasFormat();
                const module = device.createShaderModule({ label: 'VoltWeave antialiased instanced line shader', code: SHADER });
                const compilation = await module.getCompilationInfo();
                const errors = compilation.messages.filter(m => m.type === 'error');
                if (errors.length)
                    throw new Error(errors.map(m => m.message).join('\n'));
                const pipeline = await device.createRenderPipelineAsync({ label: 'VoltWeave geometry pipeline', layout: 'auto',
                    vertex: { module, entryPoint: 'vertexMain', buffers: [{ arrayStride: STRIDE * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }, { shaderLocation: 2, offset: 16, format: 'float32' }, { shaderLocation: 3, offset: 20, format: 'float32x4' }] }] },
                    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' } });
                device.lost.then(info => { console.warn('GPU device lost:', info.message); notify('Canvas2D · GPU lost'); for (const s of surfaces)
                    s.useFallback(); });
                device.addEventListener('uncapturederror', e => { console.error('WebGPU:', e.error.message); });
                notify('WebGPU');
                return { device, format, pipeline };
            }
            catch (error) {
                console.warn('WebGPU unavailable:', error.message);
                notify('Canvas2D fallback');
                return null;
            }
        })();
    return hostPromise;
}
const colors = new Map();
export function rgba(color, alpha = 1) {
    if (Array.isArray(color))
        return color;
    const key = `${color}/${alpha}`;
    if (colors.has(key))
        return colors.get(key);
    const h = color.replace('#', ''), c = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    const value = [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255, alpha];
    colors.set(key, value);
    return value;
}
export class Mesh {
    constructor(capacity = 2048) { this.data = new Float32Array(capacity * STRIDE); this.count = 0; }
    reset() { this.count = 0; }
    line(x1, y1, x2, y2, width, color, alpha = 1) {
        if (![x1, y1, x2, y2, width].every(Number.isFinite))
            return;
        const offset = this.count * STRIDE;
        if (offset + STRIDE > this.data.length) {
            const next = new Float32Array(this.data.length * 2);
            next.set(this.data);
            this.data = next;
        }
        const c = rgba(color, alpha);
        this.data.set([x1, y1, x2, y2, width, ...c], offset);
        this.count++;
    }
    rect(x, y, w, h, thickness, color) { this.line(x, y, x + w, y, thickness, color); this.line(x + w, y, x + w, y + h, thickness, color); this.line(x + w, y + h, x, y + h, thickness, color); this.line(x, y + h, x, y, thickness, color); }
    dot(x, y, diameter, color) { this.line(x, y, x + .001, y, diameter, color); }
    polyline(points, thickness, color) { for (let i = 1; i < points.length; i++)
        this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], thickness, color); }
}
export class Surface {
    constructor(canvas, onReady = () => { }) {
        this.canvas = canvas;
        this.width = 1;
        this.height = 1;
        this.disposed = false;
        this.mesh = new Mesh();
        this.capacity = 0;
        this.metrics = { segments: 0, bytes: 0, submitMs: 0 };
        surfaces.add(this);
        this.ready = host().then(h => {
            if (this.disposed)
                return;
            this.host = h;
            if (h) {
                const { device } = h;
                this.context = canvas.getContext('webgpu');
                if (!this.context) {
                    this.useFallback();
                    onReady();
                    return;
                }
                this.context.configure({ device, format: h.format, alphaMode: 'opaque' });
                this.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                this.bindGroup = device.createBindGroup({ layout: h.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
            }
            else
                this.useFallback();
            onReady();
        });
    }
    useFallback() {
        if (this.disposed)
            return;
        if (this.host && this.context) {
            const replacement = this.canvas.cloneNode(false);
            this.canvas.replaceWith(replacement);
            this.canvas = replacement;
        }
        this.vertexBuffer?.destroy();
        this.uniform?.destroy();
        this.host = null;
        this.context = this.canvas.getContext('2d', { alpha: false });
        this.is2D = true;
    }
    resize(width, height) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        const scale = Math.min(globalThis.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.scale = scale;
    }
    draw(background = '#f7f8fa') {
        if (this.disposed || !this.context)
            return;
        const start = performance.now(), mesh = this.mesh, color = rgba(background);
        this.metrics.segments = mesh.count;
        this.metrics.bytes = mesh.count * STRIDE * 4;
        if (this.host) {
            const { device, pipeline } = this.host, bytes = mesh.count * STRIDE * 4;
            if (bytes > this.capacity) {
                this.vertexBuffer?.destroy();
                this.capacity = Math.max(4096, 2 ** Math.ceil(Math.log2(bytes)));
                this.vertexBuffer = device.createBuffer({ label: 'Persistent line instance stream', size: this.capacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            }
            device.queue.writeBuffer(this.uniform, 0, new Float32Array([this.width, this.height, 0, 0]));
            if (bytes)
                device.queue.writeBuffer(this.vertexBuffer, 0, mesh.data.buffer, 0, bytes);
            const encoder = device.createCommandEncoder({ label: 'VoltWeave surface frame' });
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: color[0], g: color[1], b: color[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
            if (mesh.count) {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, this.bindGroup);
                pass.setVertexBuffer(0, this.vertexBuffer);
                pass.draw(6, mesh.count);
            }
            pass.end();
            device.queue.submit([encoder.finish()]);
        }
        else {
            const context = this.context;
            context.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
            context.fillStyle = background;
            context.fillRect(0, 0, this.width, this.height);
            context.lineCap = 'round';
            for (let i = 0; i < mesh.count; i++) {
                const j = i * STRIDE, a = mesh.data;
                context.strokeStyle = `rgba(${a[j + 5] * 255},${a[j + 6] * 255},${a[j + 7] * 255},${a[j + 8]})`;
                context.lineWidth = a[j + 4];
                context.beginPath();
                context.moveTo(a[j], a[j + 1]);
                context.lineTo(a[j + 2], a[j + 3]);
                context.stroke();
            }
        }
        this.metrics.submitMs = performance.now() - start;
    }
    dispose() { this.disposed = true; surfaces.delete(this); this.vertexBuffer?.destroy(); this.uniform?.destroy(); if (this.host)
        this.context?.unconfigure(); }
}
export class RingBuffer {
    constructor(capacity = 32768) { this.data = new Float64Array(capacity); this.head = 0; this.length = 0; this.dt = 1; this.t0 = 0; }
    clear() { this.head = this.length = 0; this.t0 = 0; }
    append(values, dt, t0) {
        if (dt !== this.dt && this.length)
            this.clear();
        this.dt = dt;
        for (const v of values) {
            this.data[this.head] = v;
            this.head = (this.head + 1) % this.data.length;
            this.length = Math.min(this.length + 1, this.data.length);
        }
        this.t0 = t0 + values.length * dt - this.length * dt;
    }
    tail(count = this.length) { const length = Math.min(this.length, Math.max(0, Math.floor(count))), a = new Float64Array(length), start = (this.head - length + this.data.length) % this.data.length; for (let i = 0; i < length; i++)
        a[i] = this.data[(start + i) % this.data.length]; return a; }
}
/** Min/max envelope decimation retains spikes; source data and cursor measurements remain unmodified. */
export function decimate(samples, pixels) {
    if (samples.length <= pixels * 2)
        return Array.from(samples, (v, i) => [i, v]);
    const result = [], bucket = samples.length / Math.max(1, pixels);
    for (let x = 0; x < pixels; x++) {
        const begin = Math.floor(x * bucket), end = Math.min(samples.length, Math.floor((x + 1) * bucket));
        let lo = Infinity, hi = -Infinity, li = begin, hiIndex = begin;
        for (let j = begin; j < end; j++) {
            if (samples[j] < lo) {
                lo = samples[j];
                li = j;
            }
            if (samples[j] > hi) {
                hi = samples[j];
                hiIndex = j;
            }
        }
        if (li <= hiIndex)
            result.push([li, lo], [hiIndex, hi]);
        else
            result.push([hiIndex, hi], [li, lo]);
    }
    return result;
}
