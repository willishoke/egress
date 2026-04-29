/**
 * compiler/ir/compile_resolved.ts — single-program tropical_plan_4 emit boundary.
 *
 * Phase D D1 entry point. Takes a `ResolvedProgram` (post-strata: no
 * instances, no combinators, no instance refs) and produces the same
 * `tropical_plan_4` JSON that the legacy `flattenSession` /
 * `loadProgramDefFromResolved` pair would produce for an equivalent
 * single-instance session.
 *
 * Boundaries:
 *   - This function handles a *single* program. Session-level
 *     materialization (multiple instances + wiring + graph outputs) is
 *     `compileSession`'s job (D2; not yet implemented).
 *   - Post-strata invariant: `prog.body.decls` contains zero
 *     `instanceDecl` entries (`inlineInstances` lifts them all into a
 *     flat decl list of regs/delays). If an instanceDecl survives, the
 *     strata pipeline didn't run — caller bug.
 *
 * Implementation note: this iteration uses `resolvedToSlotted` (legacy
 * tree producer) + `emitNumericProgram` (the existing instruction
 * emitter) under the hood. A from-scratch ResolvedExpr-walking emitter
 * is still planned (PHASE_D_PLAN §2.1) but the dual-run gate
 * (emit.compat.test.ts) gives byte-equality across the boundary already
 * — so the rewrite is risk-free to land incrementally.
 */

import type { ResolvedProgram, ResolvedExpr, OutputDecl, RegDecl, DelayDecl } from './nodes.js'
import type { ExprNode } from '../expr.js'
import type { FlatPlan } from '../flatten.js'
import { resolvedToSlotted } from './load.js'
import { buildSlotMaps, type SlotMaps } from './slots.js'
import { emitNumericProgram, type ScalarType } from '../emit_numeric.js'

/** Compile a post-strata `ResolvedProgram` to `tropical_plan_4`. */
export function compileResolved(prog: ResolvedProgram): FlatPlan {
  const slots = buildSlotMaps(prog)

  // Reject anything the strata pipeline should have removed. A surviving
  // instanceDecl means inlineInstances didn't run.
  if (slots.instanceDecls.length > 0) {
    throw new Error(
      `compileResolved: program '${prog.name}' has ${slots.instanceDecls.length} surviving instanceDecl entries; ` +
      `compileResolved expects post-strata (post-inlineInstances) input.`,
    )
  }

  const memo = new WeakMap<object, ExprNode>()
  const regCount = slots.regDecls.length
  const lower = (e: ResolvedExpr): ExprNode =>
    resolveDelayValues(resolvedToSlotted(e, slots, memo), regCount)

  // ── Output expressions ──
  const outputExprByDecl = new Map<OutputDecl, ResolvedExpr>()
  for (const a of prog.body.assigns) {
    if (a.op !== 'outputAssign') continue
    if ('op' in a.target && a.target.op === 'outputDecl') {
      outputExprByDecl.set(a.target, a.expr)
    }
  }
  const outputExprs: ExprNode[] = prog.ports.outputs.map(out => {
    const expr = outputExprByDecl.get(out)
    if (expr === undefined) {
      throw new Error(`compileResolved: program '${prog.name}' output '${out.name}' has no outputAssign.`)
    }
    return lower(expr)
  })

  // ── Register update expressions ──
  const regUpdateByDecl   = new Map<RegDecl, ResolvedExpr>()
  const delayUpdateByDecl = new Map<DelayDecl, ResolvedExpr>()
  for (const a of prog.body.assigns) {
    if (a.op !== 'nextUpdate') continue
    if (a.target.op === 'regDecl')   regUpdateByDecl.set(a.target, a.expr)
    if (a.target.op === 'delayDecl') delayUpdateByDecl.set(a.target, a.expr)
  }

  const registerExprs: (ExprNode | null)[] = []
  const stateInit:     (number | boolean | number[])[] = []
  const registerNames: string[] = []
  const registerTypes: ScalarType[] = []

  // Reg decls are state registers. Each contributes one slot; the update
  // expression (if any) drives the per-tick writeback.
  for (const d of slots.regDecls) {
    registerNames.push(d.name)
    registerTypes.push(regScalarType(d))
    stateInit.push(regInit(d))
    const u = regUpdateByDecl.get(d)
    registerExprs.push(u === undefined ? null : lower(u))
  }

  // Delay decls also occupy state-reg slots; their `update` lives on the
  // decl (or a parallel nextUpdate may override).
  for (const d of slots.delayDecls) {
    registerNames.push(d.name)
    registerTypes.push(delayScalarType(d))
    stateInit.push(delayInit(d))
    const u = delayUpdateByDecl.get(d) ?? d.update
    registerExprs.push(lower(u))
  }

  // Input port types — typed input operands so int/bool inputs don't get floated.
  const inputPortTypes: ScalarType[] = slots.inputDecls.map(d => {
    if (d.type === undefined) return 'float'
    if (d.type.kind === 'scalar') return d.type.scalar
    if (d.type.kind === 'alias')  return d.type.alias.base
    // Array inputs: the element scalar drives operand typing for the
    // element-wise ops; the array itself is bundled at a higher level.
    if (typeof d.type.element === 'string') return d.type.element
    return d.type.element.base
  })

  const program = emitNumericProgram(outputExprs, registerExprs, stateInit, registerTypes, inputPortTypes)

  // Compute array_slot_names — registers whose stateInit is a literal array.
  const arraySlotNames: string[] = []
  for (let i = 0; i < stateInit.length; i++) {
    if (Array.isArray(stateInit[i])) arraySlotNames.push(registerNames[i])
  }

  // Output indices: each outputExpr maps to its position in outputs.
  const outputIndices: number[] = outputExprs.map((_, i) => i)

  const plan: FlatPlan = {
    schema: 'tropical_plan_4',
    config: { sampleRate: 44100 },
    state_init: stateInit as (number | boolean)[],
    register_names: registerNames,
    register_types: registerTypes,
    array_slot_names: arraySlotNames,
    outputs:          outputIndices,
    instructions:     program.instructions,
    register_count:   program.register_count,
    array_slot_count: program.array_slot_count,
    array_slot_sizes: program.array_slot_sizes,
    output_targets:   program.output_targets,
    register_targets: program.register_targets,
  }
  if (program.groups) plan.groups = program.groups
  return plan
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function regScalarType(d: RegDecl): ScalarType {
  if (d.type === undefined) return 'float'
  if (typeof d.type === 'string') return d.type
  return d.type.base
}

function regInit(d: RegDecl): number | boolean | number[] {
  const init = d.init
  if (typeof init === 'number') return init
  if (typeof init === 'boolean') return init
  if (Array.isArray(init)) return init as number[]
  // {op:'zeros', count: N} survives only when arrayLower didn't unroll
  // (e.g. typeParam-shaped zeros — but those are rejected earlier). For
  // a literal numeric count, expand to a zero-filled array.
  if (typeof init === 'object' && init !== null && (init as { op?: string }).op === 'zeros') {
    const count = (init as { count: ResolvedExpr }).count
    if (typeof count !== 'number') {
      throw new Error('compileResolved: zeros count must be a literal integer')
    }
    return new Array(count).fill(0)
  }
  throw new Error('compileResolved: register init must lower to a literal value')
}

function delayScalarType(_d: DelayDecl): ScalarType {
  // Delay decls today carry no scalar-type annotation in the resolved IR;
  // the legacy emitter assumes float, which matches the C++ DAC contract
  // (delays are always continuous float buffers in tropical_plan_4).
  return 'float'
}

function delayInit(d: DelayDecl): number {
  if (typeof d.init === 'number') return d.init
  if (typeof d.init === 'boolean') return d.init ? 1 : 0
  return 0
}

/** Walk a lowered `ExprNode` tree and rewrite every `{op: 'delayValue',
 *  node_id}` to `{op: 'reg', id: regCount + node_id}` — a state-register
 *  read at the combined slot index. emit_numeric only knows the
 *  unified state-register layout (`reg` op kind); the legacy
 *  `flatten.ts:resolveDelayValues` runs the same rewrite before
 *  emit_numeric. Doing the rewrite here keeps `resolvedToSlotted`'s
 *  output identical across the legacy and new emit paths. */
function resolveDelayValues(node: ExprNode, regCount: number): ExprNode {
  if (typeof node !== 'object' || node === null) return node
  if (Array.isArray(node)) {
    let mutated = false
    const out: ExprNode[] = []
    for (const item of node) {
      const r = resolveDelayValues(item, regCount)
      if (r !== item) mutated = true
      out.push(r)
    }
    return mutated ? out : node
  }
  const obj = node as Record<string, unknown>
  if (obj.op === 'delayValue' && typeof obj.node_id === 'number') {
    return { op: 'reg', id: regCount + obj.node_id }
  }
  // Recurse into args (the common case) and any other ExprNode-shaped fields.
  let mutated = false
  const fresh: Record<string, unknown> = { ...obj }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'op') continue
    if (typeof v === 'object' && v !== null) {
      const r = resolveDelayValues(v as ExprNode, regCount)
      if (r !== v) { fresh[k] = r; mutated = true }
    }
  }
  return mutated ? (fresh as unknown as ExprNode) : node
}

void buildSlotMaps  // satisfies linter when SlotMaps is the only export consumed
export type { SlotMaps }
