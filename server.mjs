#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer from 1 to 65535.');
    process.exit(1);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.vwx': 'application/json', '.vwr': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405);
        response.end();
        return;
    }
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let file = resolve(root, '.' + pathname);
        if (file !== root && !file.startsWith(root + sep)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }
        if ((await stat(file)).isDirectory())
            file = resolve(file, 'index.html');
        const data = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        response.end(request.method === 'HEAD' ? undefined : data);
    }
    catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
    }
});
server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to another port.` : error.message);
    process.exit(1);
});
server.listen(port, host, () => console.log(`VoltWeave Studio → http://localhost:${port}\nListening on ${host}. No build step. Ctrl+C to stop.`));
