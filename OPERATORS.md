# Operator reference

The runtime registry contains 47 operators. Signatures are exact; no implicit conversions are inserted. `pure` means immutable inputs/compiled parameters are sufficient for memoization. Stateful and time-dependent operators are never memoized as pure.

## Controls

### Numeric control — `control`

Inputs: None.

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `value` — Value | number | `1` | -1000000000 … 1000000000 |
| `min` — Minimum | number | `0` | -1000000000 … 1000000000 |
| `max` — Maximum | number | `10` | -1000000000 … 1000000000 |
| `unit` — Unit | text | `` | — |

### Boolean control — `boolean`

Inputs: None.

Outputs: `value: boolean`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `value` — Value | boolean | `false` | — |

### Array control — `arrayControl`

Inputs: None.

Outputs: `value: array`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `value` — Values (comma separated) | text | `1, 2, 3, 4` | — |

### String constant — `text`

Inputs: None.

Outputs: `value: string`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `value` — Text | text | `VoltWeave` | — |

## Numeric

### Numeric constant — `constant`

Inputs: None.

Outputs: `value: number`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `value` — Value | number | `1` | -1000000000 … 1000000000 |

### Add — `add`

Inputs: `a: number` (default 0), `b: number` (default 0).

Outputs: `value: number`.

Memoizable: **yes**.

### Subtract — `subtract`

Inputs: `a: number` (default 0), `b: number` (default 0).

Outputs: `value: number`.

Memoizable: **yes**.

### Multiply — `multiply`

Inputs: `a: number` (default 1), `b: number` (default 1).

Outputs: `value: number`.

Memoizable: **yes**.

### Divide — `divide`

Inputs: `a: number` (default 1), `b: number` (default 1).

Outputs: `value: number`.

Memoizable: **yes**.

### Math function — `math`

Inputs: `x: number` (default 0).

Outputs: `value: number`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `operation` — Operation | select | `sin` | sin, cos, tan, abs, sqrt, exp, log, floor, ceil, round, square, negate |
| `scale` — Input scale | number | `1` | -1000000000 … 1000000000 |
| `offset` — Output offset | number | `0` | -1000000000 … 1000000000 |

### In range / coerce — `clamp`

Inputs: `x: number` (default 0), `min: number` (default 0), `max: number` (default 1).

Outputs: `value: number`, `inside: boolean`.

Memoizable: **yes**.

## Boolean

### Compare — `compare`

Inputs: `a: number` (default 0), `b: number` (default 0).

Outputs: `value: boolean`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `operation` — Comparison | select | `>` | >, >=, <, <=, ==, != |

### Boolean logic — `logic`

Inputs: `a: boolean` (default false), `b: boolean` (default false).

Outputs: `value: boolean`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `operation` — Operation | select | `and` | and, or, xor, not |

### Select — `select`

Inputs: `selector: boolean` (default false), `yes: number` (default 1), `no: number` (default 0).

Outputs: `value: number`.

Memoizable: **yes**.

## Timing

### Simulation clock — `time`

Inputs: None.

Outputs: `time: number`, `tick: number`, `dt: number`.

Memoizable: **no**.

### Seeded random — `random`

Inputs: None.

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `min` — Minimum | number | `0` | -1000000000 … 1000000000 |
| `max` — Maximum | number | `1` | -1000000000 … 1000000000 |

### Feedback / z⁻¹ — `delay`

Inputs: `x: number` (default 0).

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `initial` — Initial value | number | `0` | -1000000000 … 1000000000 |

### Integrator — `integrate`

Inputs: `x: number` (default 0), `reset: boolean` (default false).

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `initial` — Initial value | number | `0` | -1000000000 … 1000000000 |

### Derivative — `derivative`

Inputs: `x: number` (default 0).

Outputs: `value: number`.

Memoizable: **no**.

## Signal processing

### Signal generator — `signal`

Inputs: `frequency: number` (default 40), `amplitude: number` (default 2.5).

Outputs: `wave: waveform`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `shape` — Waveform | select | `sine` | sine, square, triangle, sawtooth, dc |
| `frequency` — Frequency (Hz) | number | `40` | 0 … 1000000 |
| `amplitude` — Amplitude (V) | number | `2.5` | -1000000000 … 1000000000 |
| `offset` — DC offset | number | `0` | -1000000000 … 1000000000 |
| `phase` — Initial phase (°) | number | `0` | -360 … 360 |

### White noise — `noise`

Inputs: `amplitude: number` (default 0.12).

Outputs: `wave: waveform`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `amplitude` — Amplitude | number | `0.12` | 0 … 100 |

### Mix waveforms — `mix`

Inputs: `a: waveform`, `b: waveform`.

Outputs: `wave: waveform`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `mix` — B gain | number | `1` | -1000000000 … 1000000000 |

### Waveform gain — `gain`

Inputs: `x: waveform`, `gain: number` (default 1).

Outputs: `wave: waveform`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `gain` — Gain | number | `1` | -1000000000 … 1000000000 |
| `offset` — Offset | number | `0` | -1000000000 … 1000000000 |

### Low-pass filter — `filter`

Inputs: `x: waveform`, `cutoff: number` (default 90).

Outputs: `wave: waveform`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `cutoff` — Cutoff (Hz) | number | `90` | 0.001 … 1000000 |
| `order` — Order | select | `2` | 1, 2, 4 |

### Waveform statistics — `rms`

Inputs: `x: waveform`.

Outputs: `rms: number`, `peak: number`, `mean: number`.

Memoizable: **yes**.

### FFT spectrum — `fft`

Inputs: `x: waveform`.

Outputs: `spectrum: waveform`, `peakHz: number`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `window` — Window | select | `hann` | hann, rectangular |

## Arrays

### Waveform → array — `toArray`

Inputs: `x: waveform`.

Outputs: `array: array`.

Memoizable: **yes**.

### Array → waveform — `toWave`

Inputs: `array: array`, `dt: number` (default 0.001).

Outputs: `wave: waveform`.

Memoizable: **no**.

### Ramp array — `range`

Inputs: `count: number` (default 16).

Outputs: `array: array`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `start` — Start | number | `0` | -1000000000 … 1000000000 |
| `step` — Step | number | `1` | -1000000000 … 1000000000 |
| `count` — Count | number | `16` | 0 … 65536 |

### Build array — `arrayBuild`

Inputs: `a: number` (default 0), `b: number` (default 1), `c: number` (default 2), `d: number` (default 3).

Outputs: `array: array`.

Memoizable: **yes**.

### Map array — `arrayMap`

Inputs: `array: array`.

Outputs: `array: array`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `operation` — Operation | select | `scale` | scale, sin, cos, abs, square, sqrt |
| `scale` — Scale | number | `2` | -1000000000 … 1000000000 |
| `offset` — Offset | number | `0` | -1000000000 … 1000000000 |

### Index array — `arrayIndex`

Inputs: `array: array`, `index: number` (default 0).

Outputs: `value: number`, `valid: boolean`.

Memoizable: **yes**.

### Array statistics — `arrayStats`

Inputs: `array: array`.

Outputs: `sum: number`, `mean: number`, `min: number`, `max: number`, `length: number`.

Memoizable: **yes**.

### Concatenate arrays — `arrayConcat`

Inputs: `a: array`, `b: array`.

Outputs: `array: array`.

Memoizable: **yes**.

### Sort array — `arraySort`

Inputs: `array: array`.

Outputs: `array: array`.

Memoizable: **yes**.

## Structures

### For loop — `for`

Inputs: `count: number` (default 8), `seed: number` (default 0).

Outputs: `value: number`, `values: array`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `graph` — Body VI | graph | `loop-body` | — |
| `count` — Iteration count | number | `8` | 0 … 10000 |

### While loop — `while`

Inputs: `seed: number` (default 0).

Outputs: `value: number`, `values: array`, `iterations: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `graph` — Body VI | graph | `while-body` | — |
| `limit` — Maximum iterations | number | `128` | 1 … 10000 |

### Case structure — `case`

Inputs: `selector: boolean` (default false), `value: number` (default 0).

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `trueGraph` — True case | graph | `case-true` | — |
| `falseGraph` — False case | graph | `case-false` | — |

### SubVI — `subvi`

Inputs: Declared by the containing graph interface or referenced SubVI.

Outputs: Declared by the containing graph interface or referenced SubVI.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `graph` — Subprogram | graph | `gain-vi` | — |

## Terminals

### Input terminal — `input`

Inputs: Declared by the containing graph interface or referenced SubVI.

Outputs: Declared by the containing graph interface or referenced SubVI.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `port` — Interface input | text | `value` | — |

### Output terminal — `output`

Inputs: Declared by the containing graph interface or referenced SubVI.

Outputs: Declared by the containing graph interface or referenced SubVI.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `port` — Interface output | text | `value` | — |

## Instruments

### Virtual RC instrument — `instrument`

Inputs: `drive: waveform`.

Outputs: `voltage: waveform`, `current: waveform`, `temperature: number`, `overload: boolean`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `resistance` — Resistance (Ω) | number | `1000` | 0.01 … 1000000000 |
| `capacitance` — Capacitance (µF) | number | `1` | 0.00001 … 1000000 |
| `ambient` — Ambient (°C) | number | `23` | -1000000000 … 1000000000 |
| `limit` — Current limit (A) | number | `0.02` | 0 … 1000000 |

### PID controller — `pid`

Inputs: `setpoint: number` (default 1), `process: number` (default 0).

Outputs: `value: number`.

Memoizable: **no**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `kp` — Kp | number | `1` | -1000000000 … 1000000000 |
| `ki` — Ki | number | `0.1` | -1000000000 … 1000000000 |
| `kd` — Kd | number | `0` | -1000000000 … 1000000000 |
| `min` — Output minimum | number | `-10` | -1000000000 … 1000000000 |
| `max` — Output maximum | number | `10` | -1000000000 … 1000000000 |

## Indicators

### Numeric indicator — `indicator`

Inputs: `value: number` (default 0).

Outputs: `value: number`.

Memoizable: **yes**.

### Boolean indicator — `led`

Inputs: `value: boolean` (default false).

Outputs: `value: boolean`.

Memoizable: **yes**.

### Oscilloscope — `scope`

Inputs: `channel1: waveform`, `channel2: waveform` (default null).

Outputs: `wave: waveform`.

Memoizable: **yes**.

### Format number — `format`

Inputs: `value: number` (default 0).

Outputs: `text: string`.

Memoizable: **yes**.

| Parameter | Kind | Default | Choices / limits |
|---|---|---|---|
| `digits` — Decimal places | number | `3` | 0 … 12 |
| `prefix` — Prefix | text | `` | — |
| `suffix` — Suffix | text | `` | — |

## Structure and domain notes

For and While bodies take numeric `value`/`index`. Both return `value`; While also returns Boolean `continue`. Case branches take and return numeric `value`; SubVI signatures follow the declared interface. Input/output terminal signatures come from their containing graph. Feedback is scalar and commits at its graph invocation boundary. See ARCHITECTURE.md for transactional semantics.

FFT produces amplitude bins, with frequency spacing in its sampled-series `dt` field. It uses the largest power-of-two prefix of the input block. It is not a PSD calculation. Signal generators validate the requested fundamental frequency against Nyquist but do not band-limit discontinuous waveforms.
