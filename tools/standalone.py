#!/usr/bin/env python3
"""Build an optional single HTML distribution using native ES modules, not eval or a runtime loader."""
from pathlib import Path
import base64
import json
import re
ROOT = Path(__file__).resolve().parents[1]
cache = {}
def module_url(name):
    if name in cache:
        return cache[name]
    source = module_source(name)
    value = 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()
    cache[name] = value
    return value

def module_source(name):
    source = (ROOT / 'src' / name).read_text()
    source = re.sub(r"from\s+(['\"])\./([^'\"]+)\1", lambda m: 'from ' + json.dumps(module_url(m[2])), source)
    if name == 'app.js':
        if "new URL('./worker.js', import.meta.url)" not in source:
            raise ValueError('Worker entry pattern changed; update the standalone packager.')
        worker = '\n'.join(re.sub(r'^import .*?;\s*', '', (ROOT / 'src' / part).read_text(), flags=re.MULTILINE) for part in ['types.js', 'graph.js', 'runtime.js', 'worker.js'])
        worker = re.sub(r'^export ', '', worker, flags=re.MULTILINE)
        source = source.replace("new URL('./worker.js', import.meta.url)", 'URL.createObjectURL(new Blob([' + json.dumps(worker) + '], { type: "text/javascript" }))')
        source = source.replace("{ type: 'module', name: 'VoltWeave deterministic VM' }", "{ name: 'VoltWeave deterministic VM' }")
    return source

def build():
    html = (ROOT / 'index.html').read_text()
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
    html = html.replace('<script type="module" src="src/app.js"></script>', '<script type="module" src="' + module_url('app.js') + '"></script>')
    output = ROOT / 'VoltWeave-Standalone.html'
    output.write_text(html)
    print(f'{output.name}: {output.stat().st_size:,} bytes')
    return output
if __name__ == '__main__':
    build()
