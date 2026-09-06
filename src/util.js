export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null)
            continue;
        if (key === 'class')
            e.className = value;
        else if (key === 'text')
            e.textContent = value;
        else if (key === 'dataset')
            Object.assign(e.dataset, value);
        else if (key === 'style')
            Object.assign(e.style, value);
        else if (key.startsWith('on'))
            e.addEventListener(key.slice(2), value);
        else if (key in e && key !== 'list')
            e[key] = value;
        else
            e.setAttribute(key, value);
    }
    for (const child of children.flat())
        if (child !== undefined && child !== null)
            e.append(typeof child === 'string' ? document.createTextNode(child) : child);
    return e;
}
export function svg(tag, attrs = {}) { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs))
    node.setAttribute(k, v); return node; }
export const escapeHtml = text => String(text).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
export function download(name, content, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })), a = el('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
export function debounce(fn, ms = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }
export function editableTarget(target) { return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true]'); }
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const snap = x => Math.round(x / 8) * 8;
const PATHS = {
    play: 'M7 4l13 8-13 8z', repeat: 'M19 7a8 8 0 00-13-1L3 9m0-6v6h6M5 17a8 8 0 0013 1l3-3m0 6v-6h-6', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6z', step: 'M5 5l10 7-10 7zM19 5v14', node: 'M3 6h6v12H3zM15 6h6v12h-6zM9 12h6', light: 'M9 18h6M10 21h4M8 14a6 6 0 118 0l-1 2H9z', save: 'M5 3h13l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8', open: 'M3 6h7l2 3h9l-3 11H3zM3 9V4h7l2 3h7v2', undo: 'M9 5L3 11l6 6M3 11h11a6 6 0 010 12', redo: 'M15 5l6 6-6 6M21 11H10a6 6 0 000 12', plus: 'M12 4v16M4 12h16', search: 'M21 21l-6-6M17 10a7 7 0 11-14 0 7 7 0 0114 0', fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 7h10v10H7z', panel: 'M3 4h18v16H3zM3 9h18M8 9v11', graph: 'M3 3h6v6H3zM15 15h6v6h-6zM9 6h9v9M6 9v9h9', split: 'M3 4h18v16H3zM12 4v16', record: 'M19 12a7 7 0 11-14 0 7 7 0 0114 0', probe: 'M4 20l5-5M7 13l4 4M10 14L20 4M16 4h4v4', check: 'M4 12l5 5L20 6', chevron: 'M9 5l7 7-7 7', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7', close: 'M5 5l14 14M19 5L5 19', chart: 'M3 3v18h18M5 15l4-6 4 4 7-9', file: 'M14 3H5v18h14V8zM14 3v5h5', help: 'M12 17v1M8 8a4 4 0 017.5 2c-1 1-3.5 1.5-3.5 4M22 12a10 10 0 11-20 0 10 10 0 0120 0', download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 018 0v4', edit: 'M4 16l12-12 4 4L8 20H4zM14 6l4 4'
};
export function icon(name, size = 18) { const s = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true }); s.append(svg('path', { d: PATHS[name] || PATHS.node })); return s; }
export function button(label, action, opts = {}) { const b = el('button', { type: 'button', title: opts.title || label, class: opts.class || '', onclick: action }); if (opts.icon)
    b.append(icon(opts.icon, opts.size || 17)); if (!opts.iconOnly)
    b.append(el('span', { text: label })); if (opts.iconOnly)
    b.setAttribute('aria-label', label); return b; }
