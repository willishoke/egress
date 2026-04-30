# compiler/

TypeScript layer. Handles program definition, expression construction, the strata pipeline, instruction emission, and the FFI bridge to C++. No audio processing happens here — this layer produces the `tropical_plan_4` JSON that the C++ engine JIT-compiles.

## Layout

```
expr.ts               ExprNode type, SignalExpr wrapper, all named operations
program_types.ts      ProgramType, ProgramInstance (slot-indexed legacy view; D3 retires this)
program.ts            ProgramNode (tropical_program_2) types, conversions, stdlib loading
session.ts            SessionState, generic-program resolution, JSON ingest
schema.ts             Zod validation schemas for tropical_program_2
flat_plan.ts          tropical_plan_4 schema (the boundary type with the C++ engine)
emit_numeric.ts       ExprNode trees → FlatProgram instruction stream (structural CSE)
apply_plan.ts         compileSession → JSON.stringify → runtime.loadPlan
compiler.ts           Dependency graph, topological sort, SCC, port type conversion
term.ts               Port types (PortType, ScalarKind), shape algebra, type utilities
array_wiring.ts       Typed port validation, auto-broadcast insertion
flatten.ts            LEGACY session-flattener; not on the runtime path post-D2 cutover.
                      Retained for the equivalence gates and a handful of consumers; D3
                      finishes its retirement.
interpret.ts          Pure-TS evaluator over post-flatten ExprNode trees. Independent
                      oracle for jit_interp_equiv. D3 will retarget to ResolvedExpr.
bench_compile.ts      Compilation benchmarks

ir/                   The strata pipeline + resolved-IR emit boundary
  nodes.ts            ResolvedProgram + decl/ref node types
  elaborator.ts       ParsedProgram → ResolvedProgram (name resolution → decl identity)
  specialize.ts       Type-arg substitution (generic monomorphization)
  sum_lower.ts        Lower sum-typed regs/delays to scalar bundles
  trace_cycles.ts     Detect cycles, insert synthetic delays
  inline_instances.ts Recursively inline InstanceDecls into the outer body
  array_lower.ts      Lower array ops + combinators to scalar primitives
  strata.ts           strataPipeline: compose specialize → sumLower → traceCycles
                      → inlineInstances → arrayLower
  slots.ts            buildSlotMaps: per-call slot allocator (decl identity → integer)
  load.ts             ResolvedProgram → ProgramDef bridge (legacy emit boundary; D3 retires)
  compile_resolved.ts Per-program emit: post-strata ResolvedProgram → tropical_plan_4
  compile_session.ts  Session emit: synthetic top-level + strata + compile_resolved.
                      Handles wiring translation, gateable subgraph wrap, session-level
                      delay extraction.
  clone.ts            Identity-preserving clone with substitution (used by specialize +
                      inline_instances input substitution)

parse/                .trop surface syntax + JSON-ingest adapter
  lexer.ts, declarations.ts, expressions.ts, statements.ts, markdown.ts, print.ts
  raise.ts            JSON `tropical_program_2` → ParsedProgram (one sanctioned input
                      adapter; produces only NameRef-bearing output, never resolved-IR
                      refs — that's the elaborator's job)
  lower_bounds.ts     Parse-time desugaring of `in [lo, hi]` annotations to clamp ops
  nodes.ts            ParsedProgram + ParsedExprNode (strict discriminated union)

runtime/
  bindings.ts         koffi FFI declarations matching tropical_c.h
  runtime.ts          Runtime class (tropical_runtime_t wrapper, FinalizationRegistry)
  audio.ts            DAC class (tropical_dac_t wrapper, device listing)
  param.ts            Param (smoothed) and Trigger (fire-once), with .asExpr()
  audio_smoke.ts      Smoke test for audio output
```

## Compilation pipeline (post-D2 cutover)

```
ProgramNode JSON (tropical_program_2)
  → raiseProgram → ParsedProgram
  → elaborate → ResolvedProgram (graph IR; refs are decl objects, not names)
  → loaded into session.resolvedRegistry / genericTemplatesResolved

session has instances + wiring + graph_outputs
  → compileSession (compiler/ir/compile_session.ts)
       1. materializeSession: synthetic top-level ResolvedProgram
          - one InstanceDecl per session instance (type pre-specialized)
          - wiring expressions translated session-ExprNode → ResolvedExpr
          - dac.out graph_outputs → outputAssign per wire
          - gateable instances: pre-strata wrap with __gate__ synthetic input;
            gate exprs routed through strata as synthetic outputs to inline
            their nestedOut refs alongside the rest
       2. strataPipeline (compiler/ir/strata.ts):
            specialize → sumLower → traceCycles → inlineInstances → arrayLower
       3. (post-strata gateable wrap of lifted sub-instance regs/delays)
       4. compileResolved (compiler/ir/compile_resolved.ts):
            buildSlotMaps + resolvedToSlotted + resolveDelayValues
            → emit_numeric → FlatProgram → tropical_plan_4
  ─── C API boundary (tropical_c.h, koffi FFI) ───
  → NumericProgramParser (JSON → FlatProgram struct)
  → JIT compilation (FlatProgram → LLVM IR → native kernel)
  → FlatRuntime (per-sample execution, double-buffered hot-swap)
  → Audio output (RtAudio / CoreAudio)
```

## Expression system (`expr.ts`)

`ExprNode` is the recursive JSON-serializable union:

```typescript
type ExprNode = number | boolean | ExprNode[] | { op: string; ... }
```

`SignalExpr` wraps `ExprNode` with optional static shape metadata. All operations are free functions (no operator overloading in TS):

- **Arithmetic**: `add`, `sub`, `mul`, `div`, `mod`, `floorDiv`, `ldexp` (`Pow` lives in stdlib as `Exp(y * Log(x))`)
- **Comparison**: `lt`, `lte`, `gt`, `gte`, `eq`, `neq`
- **Bitwise**: `bitAnd`, `bitOr`, `bitXor`, `lshift`, `rshift`, `bitNot`
- **Math**: `neg`, `abs`, `sqrt`, `floatExponent`, `not`. Transcendentals (`sin`, `cos`, `tanh`, `exp`, `log`) live in `stdlib/` as program types, not primitives.
- **Ternary**: `clamp`, `select`, `arraySet`
- **Array / matrix**: `arrayPack`, `index`, `zeros`, `reshape`, `transpose`, `slice`, `reduce`, `broadcastTo`, `matmul`
- **References**: `input`, `reg`, `delayValue`, `nestedOutput`, `param`, `trigger`, `binding`
- **Sentinels**: `sampleRate`, `sampleIndex`

Compile-time combinators (`let`, `generate`, `iterate`, `fold`, `scan`, `map2`, `zipWith`, `chain`) are embedded directly in JSON as ExprNode ops; the strata `array_lower` stratum unrolls them. Phase D D4 will narrow `ExprNode` to the MCP wire-format ops only — combinators move to parse-time-only types.

## Resolved IR (`ir/nodes.ts`)

The strata pipeline operates on `ResolvedProgram` — a graph IR where every reference is a direct decl-object pointer:

- **Decls**: `InputDecl`, `OutputDecl`, `RegDecl`, `DelayDecl`, `ParamDecl`, `InstanceDecl`, `ProgramDecl`, `BinderDecl`, `TypeParamDecl`
- **Refs**: `InputRef`, `RegRef`, `DelayRef`, `ParamRef`, `TypeParamRef`, `BindingRef`, `NestedOut` — each carries a `decl` field pointing at the introducing decl
- **Ops**: `BinaryOpNode`, `UnaryOpNode`, `ClampNode`, `SelectNode`, `IndexNode`, `ZerosNode`, `ArraySetNode`, plus combinator and ADT nodes

The elaborator (`ir/elaborator.ts`) is the unique site for name resolution. Every other stratum operates on resolved decl identity — no string lookups, no scope walks.

## Instruction emission (`emit_numeric.ts`)

Walks lowered ExprNode trees (post-`resolvedToSlotted`), emits a `FlatProgram`:

- `NInstr`: `tag` (op name → C++ `OpTag`), `dst` (temp slot), `args` (`NOperand[]`), `loop_count`, `strides`, `result_type`
- Operand kinds: `const`, `input`, `reg`, `array_reg`, `state_reg`, `param`, `rate`, `tick`
- Terminals embed inline; non-terminals get a temp register
- **Structural CSE**: `compileNode` keys its memo on a bottom-up structural id (interned via `${op}|${field=}|${child_id}` strings), not node identity. This catches duplicates the strata pipeline's clone-then-substitute introduces.

## Standard library (`stdlib/*.trop`)

19+ built-in types as `.trop` surface-syntax files, loaded by `loadStdlib()` in `program.ts` via the parser → elaborator pipeline:

- **Transcendentals** (polynomial approximations): `Sin`, `Cos`, `Tanh`, `Exp`, `Log`, `Pow`
- **Filters / shapers**: `OnePole`, `LadderFilter` (4-pole Moog), `SoftClip`, `BitCrusher`, `SVF`
- **Delays**: `AllpassDelay`, `CombDelay`, `Delay` (generic — `<N: int = 44100>`)
- **Effects**: `Phaser`, `Phaser16`
- **Utility**: `VCA`, `CrossFade`, `Clock`, `NoiseLFSR`, `BlepSaw`, `EnvExpDecay`, `Sequencer`, `Seq4MinorTranspose`, `SampleHold`, `Bubble`, `BubbleCloud`

## FFI bridge (`runtime/`)

- `bindings.ts` — koffi function declarations matching `tropical_c.h`. Loads `libtropical.dylib` from `build/` or `build-profile/`.
- `runtime.ts` — `Runtime` class wrapping `tropical_runtime_t`. Uses FinalizationRegistry for GC-driven cleanup.
- `audio.ts` — `DAC` class wrapping `tropical_dac_t`. Static `listDevices()`.
- `param.ts` — `Param` (smoothed, one-pole lowpass) and `Trigger` (fire-once). `.asExpr()` returns a `SignalExpr` for wiring into expression trees.

## Tests

Run with `bun test`. Notable suites:

- `compile_session_equiv.test.ts` — audio-equivalence gate: every unified_ir fixture produces sample-for-sample identical audio under the new and legacy paths
- `jit_interp_equiv.test.ts` — JIT vs. pure-TS interpreter (independent oracle)
- `unified_ir.test.ts` — pinned `tropical_plan_4` snapshots over the fixture corpus
- `ir/*.test.ts` — strata pipeline unit tests (specialize, sum_lower, trace_cycles, inline_instances, array_lower, slots)
- `parse/*.test.ts` — lexer, parser, raise, round-trip
- `apply_plan.test.ts` — plan application integration (requires native lib)
- `wasm_runtime.test.ts`, `wasm_vs_jit_equiv.test.ts`, `web_plans_vs_jit.test.ts` — WASM emission

## Adding a program type

1. Create a `stdlib/MyType.trop` file in surface syntax, OR a JSON `tropical_program_2` file.
2. The file is automatically loaded by `loadStdlib()` on startup; raised through `parse → raise → elaborate` to a `ResolvedProgram`.
3. No C++ changes needed unless you need a new expression op.
