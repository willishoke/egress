/**
 * Edge-case fixtures for jit_interp_stdlib_equiv.test.ts (Phase D P0.1).
 *
 * Each fixture is a hand-built program that stresses an axis the stdlib
 * corpus doesn't cover well: division by zero, sqrt of negatives, denormal
 * propagation, conditional branches with NaN inputs, etc. The fixtures
 * are programs (not patches) so they can be loaded as types and instantiated.
 *
 * Documents expected behavior at the boundary of the C++ FTZ/DAZ flag
 * (flush-to-zero / denormals-are-zero on x86). Where the JIT and pure-TS
 * interpreter diverge by design (e.g. `0/0` is NaN in interpret, 0 in JIT
 * because of div-guard), the fixture's `tolerance` is loosened or the
 * fixture is excluded from strict comparison.
 */

import type { ProgramNode } from '../../program.js'

export interface EdgeFixture {
  /** Display name for the test. */
  name: string
  /** Program node to load. */
  program: ProgramNode
  /** Inputs for the test instance — keyed by `${input_name}`. */
  inputs?: Record<string, import('../../expr.js').ExprNode>
  /** Output port name to read for the assertion (default: first output). */
  output?: string
  /** Tolerance for `toBeCloseTo` digit-of-precision check. Default 8. */
  tolerance?: number
  /** If set, sample[i] must be `Number.isFinite(...)` — catches NaN
   *  propagation regressions even when both sides agree on a NaN. */
  expectAllFinite?: boolean
  /** If true, skip strict numeric agreement and only check finiteness. */
  finitenessOnly?: boolean
}

/** div(x, 0) — both interpreter and JIT guard divide-by-zero, returning 0
 *  rather than +Infinity/NaN. This fixture pins that contract. */
const divByZero: EdgeFixture = {
  name: 'div_by_zero',
  program: {
    op: 'program',
    name: 'DivByZero',
    ports: { inputs: [{ name: 'x', default: 1 }], outputs: ['out'] },
    body: { op: 'block',
      assigns: [{ op: 'outputAssign', name: 'out',
        expr: { op: 'div', args: [{ op: 'input', name: 'x' }, 0] } }],
    },
  },
  expectAllFinite: true,
  tolerance: 10,
}

/** sqrt of a guaranteed-negative value. JS Math.sqrt(-1) is NaN; the JIT
 *  also produces NaN. Propagation is consistent on both sides. We assert
 *  finiteness fails for at least one sample (the negative branch) — a
 *  pure equivalence check would need NaN-aware comparison. */
const sqrtNegative: EdgeFixture = {
  name: 'sqrt_negative',
  program: {
    op: 'program',
    name: 'SqrtNegative',
    ports: { inputs: [{ name: 'x', default: -1 }], outputs: ['out'] },
    body: { op: 'block',
      assigns: [{ op: 'outputAssign', name: 'out',
        expr: { op: 'sqrt', args: [{ op: 'input', name: 'x' }] } }],
    },
  },
  finitenessOnly: true,  // both sides produce NaN; agreement on NaN is
                         // not testable via `toBeCloseTo`.
}

/** 1e-310 * 1e-310 produces a denormal on x86 without FTZ; with FTZ it
 *  flushes to zero. The interpreter (pure JS) never flushes; the JIT may
 *  or may not depending on the C++ build. The product is also below the
 *  smallest-positive normal (~2.2e-308), so this hits the denormal range
 *  before flushing. */
const denormalMul: EdgeFixture = {
  name: 'denormal_multiplication',
  program: {
    op: 'program',
    name: 'DenormalMul',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      assigns: [{ op: 'outputAssign', name: 'out',
        expr: { op: 'mul', args: [1e-310, 1e-310] } }],
    },
  },
  expectAllFinite: true,
  finitenessOnly: true,  // tolerance for denormal divergence is system-dependent.
}

/** A reg that accumulates a small per-sample increment. Over many
 *  samples the running sum stays in healthy float range. Pin floor/abs
 *  on a sub-normal input to confirm those pass through cleanly. */
const stableAccumulator: EdgeFixture = {
  name: 'stable_accumulator',
  program: {
    op: 'program',
    name: 'StableAccum',
    ports: { inputs: [{ name: 'inc', default: 1e-10 }], outputs: ['out'] },
    body: { op: 'block',
      decls: [{ op: 'regDecl', name: 's', init: 0 }],
      assigns: [
        { op: 'outputAssign', name: 'out', expr: { op: 'reg', name: 's' } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 's' },
          expr: { op: 'add', args: [{ op: 'reg', name: 's' }, { op: 'input', name: 'inc' }] } },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

/** Conditional select where one branch produces a special value. JIT
 *  evaluates both branches eagerly (no short-circuit). */
const selectWithSpecials: EdgeFixture = {
  name: 'select_with_special_values',
  program: {
    op: 'program',
    name: 'SelectSpecial',
    ports: { inputs: [{ name: 'gate', default: 1 }], outputs: ['out'] },
    body: { op: 'block',
      assigns: [{ op: 'outputAssign', name: 'out',
        // gate ? 0.5 : (1.0 / 0.0)
        expr: { op: 'select', args: [
          { op: 'input', name: 'gate' },
          0.5,
          { op: 'div', args: [1.0, 0.0] },
        ] },
      }],
    },
  },
  // With gate=1, output should be 0.5 sample-for-sample.
  expectAllFinite: true,
  tolerance: 12,
}

/** Wholesale array-reg writeback. Produces an inline-array expression
 *  (here `generate(N, i => i + sampleIndex())`) and assigns it to a
 *  reg whose init is `zeros(N)` — i.e. `next arr = <expr>` rather than
 *  the in-place `next arr = arraySet(arr, idx, x)` pattern.
 *
 *  Regression test for a JIT bug where the writeback path emitted no
 *  copy from the expression's fresh array slot into the reg's
 *  persistent storage slot, leaving the reg permanently zeros (only
 *  arraySet, used by Delay, worked because it writes in-place to the
 *  persistent slot). The interpreter handled the case correctly all
 *  along, so the bug surfaced as a JIT/interp divergence.
 *
 *  After 4 samples (buffer 256, sampleIndex per buffer = 0,256,512,...):
 *  arr[2] on each subsequent sample reads the previous sample's value
 *  of (sampleIndex_of_previous_sample + 2). With the bug, the JIT
 *  always reads 0 from the persistent slot; the interpreter reads the
 *  scan output. */
const arrayRegWholesaleWriteback: EdgeFixture = {
  name: 'array_reg_wholesale_writeback',
  program: {
    op: 'program',
    name: 'ArrayRegWholesaleWriteback',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      decls: [
        { op: 'regDecl', name: 'arr', init: { zeros: 4 } as any },
      ],
      assigns: [
        { op: 'outputAssign', name: 'out',
          expr: { op: 'index', args: [{ op: 'reg', name: 'arr' }, 3] } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 'arr' },
          expr: { op: 'generate', count: 4, var: 'i',
            body: { op: 'add', args: [
              { op: 'sampleIndex' },
              { op: 'binding', name: 'i' },
            ] } } as any },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

/** Bool-expected propagation through arithmetic. compileBinary's
 *  `secondExpected = l.scalarType` for comparisons used to forward the
 *  left arg's `bool` type to the right arg, and then non-comparison /
 *  non-bitwise binaries forwarded that `bool` straight to their own
 *  args. So in `eq(bool_value, x + 0.5)`, the `0.5` literal would try
 *  to narrow to bool and throw — even though arithmetic on float/int
 *  args can never produce bool.
 *
 *  Reproduces in cross_fm_evolved via `Mul(Greater(_,_), LessEq(_,_))`
 *  inside NoiseLFSR's tick computation, which becomes a Select cond
 *  after inlining and propagates bool through the comparison's RHS.
 *
 *  This fixture isolates the pattern: an `eq` whose left arg returns
 *  bool, whose right arg is an arithmetic expression with a non-0/1
 *  float literal. */
const boolPropagationThroughArith: EdgeFixture = {
  name: 'bool_propagation_through_arith',
  program: {
    op: 'program',
    name: 'BoolPropagation',
    ports: { inputs: [{ name: 'x', default: 0.3 }], outputs: ['out'] },
    body: { op: 'block',
      assigns: [{ op: 'outputAssign', name: 'out',
        // eq( gt(x, 0), x * 0.5 + 0.25 )
        expr: {
          op: 'eq',
          args: [
            { op: 'gt', args: [{ op: 'input', name: 'x' }, 0] },
            { op: 'add', args: [
              { op: 'mul', args: [{ op: 'input', name: 'x' }, 0.5] },
              0.25,
            ] },
          ],
        },
      }],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

// ─────────────────────────────────────────────────────────────
// Phase B — wholesale-array writebacks beyond `generate`
// (TDD plan: ~/.claude/plans/we-re-doing-a-tdd-eager-waffle.md)
//
// Same shape as `arrayRegWholesaleWriteback`: `next arr = <expr>` where
// `<expr>` is built from a different combinator each fixture. Each one
// exercises an independent unrolling path in `array_lower.ts` followed
// by the same JIT writeback fix from 66ae9f9.
// ─────────────────────────────────────────────────────────────

/** (D) `next arr = select(cond, arr1, arr2)` — array-typed Select.
 *  cond is `sampleIndex < 4`; arr1=[1,2,3,4], arr2=[10,20,30,40].
 *  Sample 0..3 reads arr1; sample 4+ reads arr2. Output is index 2,
 *  so sample 0 → 3, sample 4 → 30 (post-/20: 0.15, 1.5).
 *
 *  Note: select on whole arrays may not be supported by the lowering
 *  pipeline today. If `applyFlatPlan` throws, that's a pinned
 *  type-error (per the plan); record here and downgrade to a
 *  direct-error fixture if needed. */
const arraySelectWriteback: EdgeFixture = {
  name: 'array_reg_select_writeback',
  program: {
    op: 'program',
    name: 'ArrayRegSelectWriteback',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      decls: [
        { op: 'regDecl', name: 'arr', init: [0, 0, 0, 0] as any },
      ],
      assigns: [
        { op: 'outputAssign', name: 'out',
          expr: { op: 'index', args: [{ op: 'reg', name: 'arr' }, 2] } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 'arr' },
          expr: { op: 'select', args: [
            { op: 'lt', args: [{ op: 'sampleIndex' }, 4] },
            [1, 2, 3, 4],
            [10, 20, 30, 40],
          ]} as any },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

/** (D) `next arr = zipWith(arr_a, arr_b, (x, y) => x + y)` — exercises
 *  array_lower's zipWith unroll in nextUpdate position. The plan calls
 *  this `map2`, but tropical's `map2` is single-array; the right
 *  primitive for two arrays is `zipWith`. */
const arrayZipWithWriteback: EdgeFixture = {
  name: 'array_reg_zipwith_writeback',
  program: {
    op: 'program',
    name: 'ArrayRegZipWithWriteback',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      decls: [
        { op: 'regDecl', name: 'arr', init: [0, 0, 0, 0] as any },
      ],
      assigns: [
        { op: 'outputAssign', name: 'out',
          expr: { op: 'index', args: [{ op: 'reg', name: 'arr' }, 2] } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 'arr' },
          expr: { op: 'zipWith',
            a: [1, 2, 3, 4],
            b: [10, 20, 30, 40],
            x_var: 'x', y_var: 'y',
            body: { op: 'add', args: [
              { op: 'binding', name: 'x' },
              { op: 'binding', name: 'y' },
            ]},
          } as any },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

/** (D) `next arr = scan(over, init, f)` — scan emits intermediate
 *  accumulators. With over=[1,2,3,4], init=0, f=acc+elem: result is
 *  [1, 3, 6, 10] (running sums). Reads index 3 → 10 (post-/20: 0.5). */
const arrayScanWriteback: EdgeFixture = {
  name: 'array_reg_scan_writeback',
  program: {
    op: 'program',
    name: 'ArrayRegScanWriteback',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      decls: [
        { op: 'regDecl', name: 'arr', init: [0, 0, 0, 0] as any },
      ],
      assigns: [
        { op: 'outputAssign', name: 'out',
          expr: { op: 'index', args: [{ op: 'reg', name: 'arr' }, 3] } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 'arr' },
          expr: { op: 'scan',
            over: [1, 2, 3, 4],
            init: 0,
            acc_var: 'acc', elem_var: 'x',
            body: { op: 'add', args: [
              { op: 'binding', name: 'acc' },
              { op: 'binding', name: 'x' },
            ]},
          } as any },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

/** (D) `next arr = let { tmp = generate(N, ...) } in tmp` — the
 *  let-binding indirection between the producer combinator and the
 *  writeback exercises the let-elimination path. */
const arrayLetGenerateWriteback: EdgeFixture = {
  name: 'array_reg_let_generate_writeback',
  program: {
    op: 'program',
    name: 'ArrayRegLetGenerateWriteback',
    ports: { inputs: [], outputs: ['out'] },
    body: { op: 'block',
      decls: [
        { op: 'regDecl', name: 'arr', init: [0, 0, 0, 0] as any },
      ],
      assigns: [
        { op: 'outputAssign', name: 'out',
          expr: { op: 'index', args: [{ op: 'reg', name: 'arr' }, 2] } },
        { op: 'nextUpdate', target: { kind: 'reg', name: 'arr' },
          expr: { op: 'let',
            bind: {
              tmp: { op: 'generate', count: 4, var: 'i',
                body: { op: 'add', args: [
                  { op: 'sampleIndex' },
                  { op: 'binding', name: 'i' },
                ]},
              },
            },
            in: { op: 'binding', name: 'tmp' },
          } as any },
      ],
    },
  },
  expectAllFinite: true,
  tolerance: 12,
}

// (D) Sum-typed delay carrying an array field — Phase B Test 11 (deferred).
// The plan calls for a variant whose payload is `float[N]` (e.g. a Box4
// holding a 4-element payload), with the wholesale writeback covered by
// the same fix as `arrayRegWholesaleWriteback`. Today this isn't
// expressible in the IR: `StructField` is `{name, type: ScalarKind}`
// with no shape field, so array-typed payload fields are silently
// dropped at elaboration. Implementing the full path requires extending
// StructField + parse + elaborator + sum_lower (multi-slot allocation
// per payload field) and bindings/extract paths. Tracked as a
// follow-up; not in this PR's scope.

export const EDGE_FIXTURES: EdgeFixture[] = [
  divByZero,
  sqrtNegative,
  denormalMul,
  stableAccumulator,
  selectWithSpecials,
  arrayRegWholesaleWriteback,
  boolPropagationThroughArith,
  // Phase B — wholesale-array writebacks
  arraySelectWriteback,
  arrayZipWithWriteback,
  arrayScanWriteback,
  arrayLetGenerateWriteback,
]
