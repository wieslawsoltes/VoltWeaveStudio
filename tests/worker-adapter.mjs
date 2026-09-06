/** Run the unchanged browser ES-module worker through Node's actual worker transport. */
import { parentPort } from 'node:worker_threads';
globalThis.postMessage = (message, transfers = []) => parentPort.postMessage(message, transfers);
globalThis.onmessage = null;
globalThis.close = () => process.exit(0);
await import('../src/worker.js');
parentPort.on('message', data => globalThis.onmessage({ data }));
