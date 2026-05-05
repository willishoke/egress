# tropical

Realtime audio synthesis driven by Claude Code over MCP.

Describe a patch — oscillators, filters, envelopes, effects, wiring — and
tropical compiles the entire signal graph into a single per-sample
kernel. Native runtime via LLVM ORC JIT, browser runtime via
WebAssembly. Every wiring change hot-swaps a fresh kernel; matching
state transfers by name so delay lines and oscillators don't click.

## Install

```bash
brew install <tap>/tropical    # macOS — coming soon
```

Or [build from source](INSTALL.md). Requires LLVM ≥ 19, CMake, and Bun.

## Quick start

### Through Claude Code (MCP)

tropical ships with `.mcp.json`. Open the repo in Claude Code and the
`tropical` toolset is wired up immediately. Then talk to it:

> Load `patches/compressor_harmonics.json` and start audio.

> Define a sine oscillator, run it through a ladder filter with
> resonance at 0.8, and start audio.

The MCP server handles compilation, kernel loading, and audio output.
22 tools cover program definition, instance/wiring graph editing,
audio control, and patch I/O — see [`mcp/CLAUDE.md`](mcp/CLAUDE.md).

### Browser

The same compiler emits WebAssembly. Curated patches are precompiled
offline and served as JSON; the browser fetches a plan, emits a WASM
module, and runs it in an `AudioWorkletProcessor`.

```bash
bun web/build.ts        # build web/dist/
bun web/dev.ts          # dev server (sets COOP/COEP for SharedArrayBuffer)
```

See [`web/CLAUDE.md`](web/CLAUDE.md).

## Programs

31 stdlib programs ship as `.trop` source files in
[`stdlib/`](stdlib/README.md). Math functions, filters, delays,
oscillators, effects, envelopes, sequencers, utility — every type is
just code. `LadderFilter` is four `OnePole`s plus a `Tanh`; `Pow` is
`Exp(y · Log(x))`. Swap a file to change the math.

Highlights:

- **Math** — `Sin`, `Cos`, `Tanh`, `Exp`, `Log`, `Pow` as polynomial
  approximations
- **Filters** — `OnePole`, `LadderFilter` (4-pole Moog), `SVF`,
  `SoftClip`, `BitCrusher`
- **Delays** — `AllpassDelay`, `CombDelay`, generic `Delay<N>`
- **Oscillators** — `SinOsc`, `BlepSaw` (BLEP-corrected sawtooth)
- **Effects** — `Phaser`, `Phaser16`, `Bubble`, `BubbleCloud`
- **Sequencing** — `Clock`, `EnvExpDecay`, `Sequencer<N>`,
  `SampleHold`, `TriggerRamp`, `PoissonEvent`

New types can be defined at runtime via the MCP `define_program` tool;
no rebuild required.

## How it works

Patches are graphs of typed signal-flow nodes — written in `.trop`
source or built incrementally via the MCP tools. The compiler simplifies that graph through a short
pipeline: names resolve to direct references, generic types
specialize, sum types decompose, cycles get broken with one-sample
delays, instances inline into a single body, array operations unroll
to scalars. The result is a flat, typed instruction stream that
crosses a stable C API; the C++ engine JIT-compiles it to a native
kernel using LLVM ORC, and the kernel runs per-sample in an audio
callback. For browsers the same instruction stream emits to
WebAssembly and runs in an AudioWorklet.

Rewiring a connection recompiles the whole program and atomically
swaps the kernel — state transfers by name, so registers and delay
lines survive the swap. No click, no gap. Feedback loops (A→B→A or
A→A) resolve automatically with a one-sample delay, just like
hardware propagation — no special configuration needed.

The TypeScript pipeline, the C++ JIT, and the WASM backend are
pinned to each other by sample-for-sample equivalence tests.

See [`design/architecture.md`](design/architecture.md) for the full
technical reference and [`CLAUDE.md`](CLAUDE.md) for a contributor
overview.

## Patches

Example patches in [`patches/`](patches/CLAUDE.md): cross-FM
synthesis, acid noise, microtonal sequencing, granular bubbles. The
patch format is documented there.

## Development

```bash
make build      # build the C++ engine
make validate   # build + bun test + ctest + stdlib audit
make mcp-ts     # build + launch MCP server on stdio

cmake --build build -j4 && ctest --test-dir build   # C++ tests in isolation
bun test                                              # TS tests in isolation

bun run mcp/test_patch.ts patches/sequencer_demo.json [n_frames]
                                                      # offline smoke: load a patch,
                                                      # run N samples, report peak output
```

## Troubleshooting

**JIT compilation failure** — JIT failures on the audio path are
fatal; there is no interpreter fallback. Check that your LLVM matches
what `CMakeLists.txt` expects (≥ 19). Stale cached kernels can also
cause issues — clear `~/.cache/tropical/kernels/` and rebuild.

**No audio output** — Verify your default output device is correct.
The MCP `audio_status` tool reports device info and callback stats;
`audio_status.is_reconnecting` flags an in-progress disconnect recovery.

**Browser: SharedArrayBuffer unavailable** — The web demo prefers SAB
for low-latency live param updates and falls back to a plain
`ArrayBuffer` when COOP/COEP isn't enabled. Static params still work
via init-time snapshot; live updates won't cross the worklet boundary.
`bun web/dev.ts` sets the right headers for local development.

## License

MIT
