#!/usr/bin/env python3
"""Optional end-to-end smoke test. Requires Python Playwright; no application dependency.

By default opens the served modular build. --standalone uses set_content() for
restricted test environments without network navigation; that synthetic origin
cannot exercise native localStorage, secure-context WebGPU, or module Workers.
The standalone build still runs a real (classic) Worker and identical runtime.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:8080')
parser.add_argument('--standalone', action='store_true')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', default=str(ROOT / 'test-artifacts'))
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
results = []

def passed(name):
    results.append({'name': name, 'passed': True})
    print('PASS:', name, flush=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
        args=['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1150}, device_scale_factor=1)
    page.set_default_timeout(6000)
    errors, warnings = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: warnings.append(message.text) if message.type in ['warning', 'error'] else None)
    if args.standalone:
        page.set_content((ROOT / 'VoltWeave-Standalone.html').read_text(), wait_until='load')
    else:
        page.goto(args.url, wait_until='networkidle')
    page.wait_for_function('window.voltweave?.app.lastFrame?.tick >= 4')
    app = 'window.voltweave.app'

    def ev(code):
        return page.evaluate(f'() => {{ const a = {app}; {code} }}')

    def ready():
        page.wait_for_function(f'{app}.compiledRevision === {app}.revision')

    def pause():
        page.locator('#pause').click()
        page.wait_for_function(f'{app}.mode === "paused"')
        page.wait_for_timeout(70)

    def menu(name, item):
        page.locator('#menubar').get_by_role('button', name=name, exact=True).click()
        page.locator('#menu-popup').get_by_role('button', name=item, exact=True).click()

    def drag(locator, dx, dy):
        box = locator.bounding_box()
        x, y = box['x'] + min(24, box['width'] / 2), box['y'] + box['height'] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + dx, y + dy, steps=8)
        page.mouse.up()

    passed('Application boots and simulated acquisition produces real worker frames')
    page.get_by_role('button', name='Fit workspace', exact=True).click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(out / 'front-panel.png'), full_page=True)

    page.get_by_label('Amplitude value', exact=True).fill('4')
    page.get_by_label('Amplitude value', exact=True).press('Tab')
    page.wait_for_function(f'{app}.values["main/amplitude"]?.value === 4')
    assert ev('return Math.max(...a.values["main/generator"].wave.samples)') > 3.9
    passed('Front-panel numeric control changes the live waveform amplitude')

    pause()
    before = ev('return a.lastFrame.tick')
    page.wait_for_timeout(100)
    assert ev('return a.lastFrame.tick') == before
    page.locator('#run-once').click()
    page.wait_for_function(f'{app}.lastFrame?.tick === {before + 1}')
    passed('Pause is stable and single-tick execution advances exactly once')

    page.get_by_role('tab', name='Block Diagram', exact=True).click()
    page.wait_for_timeout(150)
    original = ev('return a.project.graphs.main.nodes.find(n=>n.id === "frequency").x')
    drag(page.locator('.graph-node[data-node="frequency"] .node-heading'), 30, 18)
    moved = ev('return a.project.graphs.main.nodes.find(n=>n.id === "frequency").x')
    assert moved != original
    page.keyboard.press('Control+z'); ready()
    assert ev('return a.project.graphs.main.nodes.find(n=>n.id === "frequency").x') == original
    page.keyboard.press('Control+Shift+z'); ready()
    assert ev('return a.project.graphs.main.nodes.find(n=>n.id === "frequency").x') == moved
    passed('Graph node dragging, undo, and redo preserve document geometry')

    page.locator('.port[data-node="frequency"][data-direction="out"]').click()
    page.locator('.port[data-node="filter"][data-port="cutoff"][data-direction="in"]').click()
    ready()
    assert ev('return a.project.graphs.main.edges.find(e=>e.to.node==="filter" && e.to.port==="cutoff").from.node') == 'frequency'
    page.locator('#run-once').click()
    page.wait_for_function(f'{app}.lastFrame !== null')
    assert ev('return a.errors.length') == 0
    passed('Terminal-to-terminal typed wiring replaces the input driver and executes')

    count = ev('return a.project.graphs.main.edges.length')
    page.locator('.port[data-node="generator"][data-direction="out"]').click()
    page.locator('.port[data-node="filter"][data-port="cutoff"][data-direction="in"]').click()
    assert ev('return a.project.graphs.main.edges.length') == count
    assert 'Cannot connect waveform to number' in page.locator('#toast-region').inner_text()
    passed('Editor rejects incompatible wire types without corrupting the graph')

    # Restore the source wiring, then exercise a true pre-execution breakpoint.
    page.keyboard.press('Control+z'); ready()
    page.locator('.graph-node[data-node="generator"] .node-break').click()
    page.locator('#run').click()
    page.wait_for_function(f'{app}.mode === "paused" && {app}.selection?.ids?.[0] === "generator"')
    assert ev('return a.values["main/generator"] === undefined')
    page.locator('#step-node').click()
    page.wait_for_function(f'{app}.values["main/generator"]?.wave.samples.length === 256')
    page.locator('.graph-node[data-node="generator"] .node-break').click()
    page.locator('#run-once').click()
    page.wait_for_function(f'{app}.lastFrame !== null')
    passed('Breakpoint stops before evaluation; node step computes the selected operator')
    page.screenshot(path=str(out / 'block-diagram.png'), full_page=True)

    # Function insertion through the actual palette dialog.
    initial_nodes = ev('return a.project.graphs.main.nodes.length')
    page.locator('#graph-viewport').focus()
    page.keyboard.press('Tab')
    page.locator('#command-search').fill('Numeric constant')
    page.locator('#command-results button').first.click()
    ready()
    assert ev('return a.project.graphs.main.nodes.length') == initial_nodes + 1
    page.keyboard.press('Delete'); ready()
    assert ev('return a.project.graphs.main.nodes.length') == initial_nodes
    passed('Searchable function palette inserts an executable node; Delete removes it')

    page.get_by_role('tab', name='Front Panel', exact=True).click()
    page.locator('#layout-mode').click()
    original_widget = ev('return {...a.project.widgets.find(w=>w.id==="amplitude-knob")}')
    drag(page.locator('[data-widget="amplitude-knob"] .widget-header'), -18, 12)
    assert ev('return a.project.widgets.find(w=>w.id==="amplitude-knob").x') != original_widget['x']
    page.keyboard.press('Control+z'); ready()
    assert ev('return a.project.widgets.find(w=>w.id==="amplitude-knob").x') == original_widget['x']
    drag(page.locator('[data-widget="amplitude-knob"] .widget-resize'), -10, 16)
    assert ev('return a.project.widgets.find(w=>w.id==="amplitude-knob").h') != original_widget['h']
    page.locator('#layout-mode').click()
    passed('Front-panel layout supports dragging, resizing, and undo')

    menu('File', 'Structures & Array Laboratory')
    page.wait_for_function(f'{app}.values["main/loop"]?.value === 120')
    page.get_by_label('Iteration count value', exact=True).fill('5')
    page.get_by_label('Iteration count value', exact=True).press('Tab')
    page.wait_for_function(f'{app}.values["main/loop"]?.value === 10')
    assert ev('return Array.from(a.values["main/loop"].values)') == [0, 1, 3, 6, 10]
    assert ev('return a.values["main/while"].iterations') == 13
    assert ev('return a.values["main/case"].value') == 20
    page.get_by_role('switch', name='Case selector', exact=True).click()
    page.wait_for_function(f'{app}.values["main/case"]?.value === -10')
    passed('For, bounded While, array auto-indexing, and lazy Boolean cases execute from editable diagrams')
    page.get_by_role('button', name='Fit workspace', exact=True).click()
    page.wait_for_timeout(100)
    page.screenshot(path=str(out / 'structures.png'), full_page=True)

    pause()
    page.get_by_role('tab', name='Block Diagram', exact=True).click()
    page.locator('.graph-node[data-node="loop"] .sub-open').click()
    assert ev('return a.graphId') == 'loop-body'
    assert page.locator('.graph-node').count() == 4
    page.get_by_role('button', name='← Main VI', exact=True).click()
    assert ev('return a.graphId') == 'main'
    passed('Structures open their real nested subdiagrams and navigate back to the caller')

    menu('File', 'Signal Integrity Bench')
    page.wait_for_function(f'{app}.lastFrame?.tick >= 2')
    page.locator('#record').click()
    page.wait_for_function(f'{app}.recording && {app}.recordCount >= 3')
    page.get_by_label('Amplitude value', exact=True).fill('1')
    page.get_by_label('Amplitude value', exact=True).press('Tab')
    page.wait_for_function(f'{app}.values["main/amplitude"]?.value === 1')
    page.wait_for_timeout(100)
    page.locator('#record').click()
    page.wait_for_function(f'{app}.recordingData?.frames.length > 3')
    ticks = ev('return a.recordingData.frames.length')
    page.locator('[data-debug="recording"]').click()
    page.locator('#debug-content').get_by_role('button', name='Replay', exact=True).click()
    page.wait_for_function(f'{app}.mode === "paused" && !{app}.replaying && {app}.lastFrame?.tick === {ticks - 1}')
    assert ev('return a.values["main/amplitude"].value') == 1
    passed('Input recording and replay work through the UI and release live-input ownership at completion')

    exported = ev('return window.voltweave.exportProject()')
    page.locator('#project-file').set_input_files({'name': 'roundtrip.vwx', 'mimeType': 'application/json', 'buffer': json.dumps(exported).encode()})
    ready()
    assert ev('return window.voltweave.exportProject()') == exported
    page.locator('#run-once').click()
    page.wait_for_function(f'{app}.lastFrame?.tick === 0')
    passed('Project JSON export/import round-trip restores executable diagrams and panel bindings')

    menu('File', 'Closed-loop Control Bench')
    page.wait_for_function(f'{app}.lastFrame?.tick >= 5')
    assert ev('return a.values["main/plant"].value') > 0
    page.locator('#stop').click()
    page.wait_for_function(f'{app}.lastFrame === null && {app}.mode === "paused"')
    page.locator('#run-once').click()
    page.wait_for_function(f'{app}.lastFrame?.tick === 0')
    passed('PID feedback executes and Stop resets the instrument to tick zero')

    page.get_by_role('tab', name='Split', exact=True).click()
    page.wait_for_timeout(100)
    assert page.locator('#graph-viewport').is_visible()
    assert page.locator('#panel-world').is_visible()
    page.locator('#help-button').click()
    assert page.locator('#help-dialog').is_visible()
    page.keyboard.press('Escape')
    passed('Split workspace and embedded workflow/help dialog are operational')

    assert not errors, errors
    passed('No uncaught browser page exceptions during the full workflow')
    report = {'mode': 'standalone-synthetic-origin' if args.standalone else 'served-modular',
        'renderer': ev('return a.renderer'), 'secure_context': page.evaluate('isSecureContext'),
        'checks': results, 'page_errors': errors, 'console_warnings': warnings}
    (out / 'browser-results.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'passed': len(results), 'renderer': report['renderer'], 'page_errors': errors}, indent=2))
    browser.close()
