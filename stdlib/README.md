# stdlib/

The 31 built-in DSP program types, written in tropical's `.trop` surface
syntax. Loaded by `loadStdlib()` (`compiler/program.ts`); for the browser
build the same files are inlined into `compiler/stdlib_bundled.ts` by
`web/bundle_stdlib.ts`.

Every program in this directory is *just code* — no privileged primitives.
Transcendentals are polynomial approximations defined in `.trop`; filters
compose from one-pole sections; effects are graphs of these. Swap a file
to change the math.

## Compilation

Each `.trop` file goes through the same pipeline as a user-defined program:

```
parse  →  elaborate  →  strata  →  ResolvedProgram
```

The strata pipeline (`compiler/ir/strata.ts`) progressively retires
structure — type parameters, sum types, cycles, instance nesting,
shapes, combinators — until the program is a graph of scalar decls
ready for any backend (`compileResolved` → JIT, `interpret_resolved`,
`emit_wasm`). See `compiler/CLAUDE.md` for the per-stratum description.

## Catalog

### Transcendentals

Polynomial approximations. The math sits in the `.trop` source — change
the coefficients and the JIT picks up the new approximation on the next
build.

| Type   | Ports | Notes |
|--------|-------|-------|
| `Sin`  | `(x: float) → out` | Range-reduce by `n = round(x/π)`, sign flip on odd `n`, 5-term Horner on `r²`. |
| `Cos`  | `(x: float) → out` | `Sin(x + π/2)`. |
| `Tanh` | `(x: float) → out` | Padé `c·(27 + c²) / (27 + 9c²)` after `clamp(x, -3, 3)`. |
| `Exp`  | `(x: float) → out` | Cody-Waite range reduction `clamp(x, -87, 88)`, 6-term Horner, final `ldexp(_, n)`. |
| `Log`  | `(x: float) → out` | `floatExponent` for the integer part, 14-term polynomial on `m - 1`. |
| `Pow`  | `(x: float, y: float) → out` | `Exp(y · Log(x))`. |

### Filters and shapers

| Type            | Ports |
|-----------------|-------|
| `OnePole`       | `(input: signal, g: float) → out`. One-pole IIR with `tanh` saturation on input and state. |
| `LadderFilter`  | `(input, cutoff: freq, resonance: unipolar, drive) → (lp, bp, hp, notch)`. 4-pole Moog-style; four `OnePole`s plus `Tanh` on the input. |
| `SoftClip`      | `(input: signal, drive: float) → out`. `Tanh(drive · input)`. |
| `SVF`           | `(input, cutoff: freq, q: float) → (lp, bp, hp)`. ZDF state-variable filter. |
| `BitCrusher`    | `(audio, bit_depth, sample_rate_hz) → output`. Quantization + sample-rate decimation. |

### Delays

| Type           | Ports |
|----------------|-------|
| `AllpassDelay` | `(input: signal, coeff: float) → out`. First-order allpass, transposed direct form II. |
| `CombDelay`    | `(input: signal, feedback: float) → out`. Single-tap feedback comb. |
| `Delay<N>`     | `<N: int = 44100>(x) → y breaks_cycles`. Generic ring buffer of length `N`; the `breaks_cycles` flag tells `traceCycles` it's a feedback-safe boundary. |

### Oscillators

| Type     | Ports |
|----------|-------|
| `SinOsc` | `(freq: freq) → sine`. Phase-correct sine via `Sin(2π · sampleIndex · freq / sampleRate)`. |
| `BlepSaw`| `(freq: freq) → saw`. Polynomial-BLEP-corrected sawtooth (no aliasing at the discontinuity). |

### Effects

| Type        | Ports |
|-------------|-------|
| `Phaser`    | `(input, feedback, lfo_speed) → (output, lfo)`. 4-stage allpass network with one feedback tap, modulated by an internal `Sin` LFO. |
| `Phaser16`  | `(input, feedback, lfo_speed) → (output, lfo)`. Same shape, 16 stages. |
| `Bubble`    | `(trigger, radius, q, sigma, decay_scale, amp_scale, attack_g) → out`. SVF excited by a `TriggerRamp`, gated through `EnvExpDecay`; a single drop. |
| `BubbleCloud` | `(trigger, radius, q, sigma, decay_scale, amp_scale) → out`. 8-voice round-robin over `Bubble`. |

### Envelopes and sequencing

| Type                  | Ports |
|-----------------------|-------|
| `EnvExpDecay`         | `(trigger: signal, decay: float) → env`. Sum-typed delay (`Idle | Decaying(level)`) — the canonical example of a sum that `sum_lower` decomposes into a tag register plus one scalar slot per (variant, field). |
| `Sequencer<N>`        | `<N: int = 8>(clock: unipolar, values: float[N]) → value`. Edge-triggered step sequencer over an `N`-element array. |
| `Seq4MinorTranspose`  | `(trigger: unipolar) → freq: freq`. Four-step minor-key sequencer; demonstrates an instance of `Sequencer<N=4>`. |
| `SampleHold`          | `(trigger: signal, input: signal) → value`. Captures `input` on rising edge of `trigger`; holds otherwise. |
| `TriggerRamp`         | `(trigger: signal) → (frames: float, edge: float)`. Sum-typed delay (`Quiescent | Counting(n)`) that emits a frame counter from each rising edge. |
| `PoissonEvent`        | `(rate: float) → trigger: signal`. xorshift-based stochastic event generator at the requested rate. |

### Utility and control

| Type          | Ports |
|---------------|-------|
| `VCA`         | `(audio: float, cv: float) → out`. Multiplicative gain. |
| `CrossFade`   | `(a: signal, b: signal, mix: unipolar) → out`. Linear two-channel mix. |
| `Clock`       | `(freq: freq, ratios_in: float[1]) → (output: unipolar, ratios_out: float[1])`. Master clock + ratio-array fan-out. |
| `NoiseLFSR`   | `(clock) → out: signal`. 16-bit LFSR clocked by an external trigger. |
| `WhiteNoise`  | `() → out: float`. xorshift64 noise. |

## Generic programs

Two stdlib programs declare type parameters:

- `Delay<N: int = 44100>` — array of `N` samples; specialized at instance time via `type_args: { N: 8 }` etc.
- `Sequencer<N: int = 8>` — `N`-step value sequencer.

Specialization happens in the `specialize` stratum: the concrete `N` is
substituted into every `ShapeDim` and expression-position `TypeParamRef`,
producing a fresh `ResolvedProgram` per `(template, args)` pair.

## Composition examples

Several stdlib programs are non-trivial compositions:

- `LadderFilter` instantiates `Tanh` once and `OnePole` four times.
- `Phaser` and `Phaser16` define an inline `_allpassStage` subprogram
  and instantiate it 4 (resp. 16) times.
- `Bubble` graphs together `SampleHold`, `TriggerRamp`, `Exp`,
  `EnvExpDecay`, and `SVF`.
- `BubbleCloud` instantiates `Bubble` eight times and gates each voice
  by an integer round-robin counter.

The `inline_instances` stratum splices these subgraphs into a single
flat body before emit; the JIT sees no "stdlib" — only scalar instructions.

## Surface syntax

Anchor points for `.trop` syntax:

- `compiler/parse/lexer.ts`, `expressions.ts`, `statements.ts`,
  `declarations.ts` — the four parsing layers.
- `compiler/parse/lower_bounds.ts` — desugaring of bounds annotations
  (`signal[-1, 1]`, `unipolar`, `freq`, etc.) to `clamp` ops at parse time.
- `compiler/parse/print.ts` — pretty-printer used by the round-trip
  test in `compiler/parse/stdlib_round_trip.test.ts`. Every file in
  this directory must round-trip through the printer.

## Adding a program

1. Create `stdlib/MyType.trop` in surface syntax.
2. `loadStdlib()` discovers it by filename on next session boot.
3. Run `bun run scripts/validate_stdlib.ts` to confirm it parses,
   elaborates, and lowers cleanly.
4. No C++ changes unless you need a new expression op.
