/**
 * compiler/ir/load.ts — resolved IR → ProgramDef bridge (Phase C2).
 *
 * `loadProgramDefFromResolved` is the parallel function to
 * `compiler/session.ts:loadProgramDef`. The legacy version reads a
 * `ProgramNode` (tropical_program_2 shape, names everywhere); this one
 * reads a `ResolvedProgram` (graph IR with decl identity).
 *
 * Both paths produce the same `ProgramDef` (slot-indexed `ExprNode`
 * trees) consumed by `flatten.ts` and `emit_numeric.ts`. C2 is purely
 * additive — production still goes through the legacy path. The new
 * function is reachable only from tests, where it powers the dual-run
 * byte-equality gate in `compiler/phase_c_equiv.test.ts`.
 *
 * Shape mapping (resolved IR ref → legacy `ExprNode`):
 *   regRef       → {op:'reg', id}
 *   inputRef     → {op:'input', id}
 *   delayRef     → {op:'delayValue', node_id}
 *   nestedOut    → {op:'nestedOutput', node_id, output_id}
 *   paramRef     → {op:'param', name}        (kind: 'param')
 *   paramRef     → {op:'trigger', name}      (kind: 'trigger')
 *   typeParamRef → {op:'typeParam', name}
 *   bindingRef   → {op:'binding', name}
 *   sampleRate, sampleIndex — unchanged leaves
 *
 * For all other ops (binary/unary/clamp/select/index/zeros/arraySet/
 * combinators/let/tag/match) the function emits the legacy on-the-wire
 * shape recursively. The reference for every legacy shape is what
 * `compiler/parse/lower.ts:lowerExpr` produces today.
 *
 * Slot-allocation order matches the legacy walker: inputs in declaration
 * order, then regs, delays, instances, outputs. Sticking to declaration
 * order is what makes the eventual byte-equality gate (Phase C7)
 * tractable.
 */

import type {
  ResolvedProgram, ResolvedExpr, ResolvedExprOpNode,
  RegDecl, DelayDecl, InstanceDecl, InputDecl, OutputDecl,
  PortType as ResolvedPortType,
  ScalarKind, AliasTypeDef,
} from './nodes.js'
import type { ExprNode } from '../expr.js'
import type { SessionState } from '../session.js'
import { coerce } from '../expr.js'
import {
  ProgramType,
  type ProgramDef, type NestedCall, type ValueCoercible, type Bounds,
} from '../program_types.js'
import {
  type PortType as LegacyPortType,
  Float, Int, Bool, ArrayType,
} from '../term.js'

// ─────────────────────────────────────────────────────────────
// Slot tables — built once per `loadProgramDefFromResolved` call
// ─────────────────────────────────────────────────────────────

interface Slots {
  inputs:    Map<InputDecl, number>
  regs:      Map<RegDecl, number>
  delays:    Map<DelayDecl, number>
  instances: Map<InstanceDecl, number>
}

// ─────────────────────────────────────────────────────────────
// Public entry: ResolvedProgram → ProgramType
// ─────────────────────────────────────────────────────────────

type LoadSession = Pick<
  SessionState,
  'typeRegistry' | 'instanceRegistry' | 'paramRegistry' | 'triggerRegistry'
  | 'specializationCache' | 'genericTemplates'
> & Partial<Pick<SessionState, 'typeAliasRegistry' | 'typeResolver'>>

export function loadProgramDefFromResolved(
  prog: ResolvedProgram,
  _session: LoadSession,
): ProgramType {
  // ── Allocate slots in declaration order ──
  const slots: Slots = {
    inputs:    new Map(),
    regs:      new Map(),
    delays:    new Map(),
    instances: new Map(),
  }
  prog.ports.inputs.forEach((d, i) => slots.inputs.set(d, i))

  const regDecls:      RegDecl[]      = []
  const delayDecls:    DelayDecl[]    = []
  const instanceDecls: InstanceDecl[] = []

  for (const decl of prog.body.decls) {
    switch (decl.op) {
      case 'regDecl':      slots.regs.set(decl, regDecls.length);       regDecls.push(decl); break
      case 'delayDecl':    slots.delays.set(decl, delayDecls.length);   delayDecls.push(decl); break
      case 'instanceDecl': slots.instances.set(decl, instanceDecls.length); instanceDecls.push(decl); break
      case 'paramDecl':    /* session-scoped, not part of ProgramDef */ break
      case 'programDecl':  /* registered by loadProgramAsType in legacy; nothing to do */ break
    }
  }

  // ── Names and port types ──
  const inputNames    = prog.ports.inputs.map(d => d.name)
  const outputNames   = prog.ports.outputs.map(d => d.name)
  const registerNames = regDecls.map(d => d.name)

  const inputPortTypes  = prog.ports.inputs.map(d => convertPortType(d.type))
  const outputPortTypes = prog.ports.outputs.map(d => convertPortType(d.type))
  const registerPortTypes = regDecls.map(d => regPortType(d))

  // Legacy emits null-but-typed-undefined entries as `[null]` after JSON
  // round-trip; in-memory they are `undefined`. Match by leaving undefined.
  const inputBounds:  (Bounds | null)[] = prog.ports.inputs .map(d => d.bounds ?? null)
  const outputBounds: (Bounds | null)[] = prog.ports.outputs.map(d => d.bounds ?? null)

  // ── Register init values ──
  // Legacy emits the bare value for non-zeros initialisers; for `zeros{N}`
  // it expands to a zero-filled array and an array port type. The
  // resolved IR represents zeros as `{op:'zeros', count}` — handle that
  // separately. For trivial cases (number/boolean/array literal), pass
  // the bare value through.
  const registerInitValues: ValueCoercible[] = regDecls.map(d => regInitValue(d))

  // Re-shape the per-register port type for `zeros{N}` initialisers
  // (legacy overrides the type for the array case even when the user
  // didn't declare one). Done in lockstep with regInitValue above.
  for (let i = 0; i < regDecls.length; i++) {
    const init = regDecls[i].init
    if (isZerosInit(init)) {
      const n = zerosCount(init)
      registerPortTypes[i] = ArrayType(Float, [n])
    }
  }

  // ── Delay init values ──
  const delayInitValues: number[] = delayDecls.map(d => {
    if (typeof d.init === 'number') return d.init
    if (typeof d.init === 'boolean') return d.init ? 1 : 0
    // Trivial subset only carries number inits; richer handling is
    // a Phase C3+ concern.
    return 0
  })

  // ── Lower each reachable expression ──
  const lower = (e: ResolvedExpr) => resolvedToSlotted(e, slots)

  // The 'dac' boundary leaf is a top-level patch concern; not produced
  // by stdlib programs. Skip it here — a stdlib's outputs map directly
  // to OutputDecl targets.
  const outputExprNodes = new Map<OutputDecl, ResolvedExpr>()
  for (const a of prog.body.assigns) {
    if (a.op !== 'outputAssign') continue
    if ('op' in a.target && a.target.op === 'outputDecl') {
      outputExprNodes.set(a.target, a.expr)
    }
  }

  const outputExprs: ExprNode[] = prog.ports.outputs.map(out => {
    const expr = outputExprNodes.get(out)
    if (expr === undefined) {
      throw new Error(`${prog.name}: output '${out.name}' has no output_assign`)
    }
    return lower(expr)
  })

  // ── Register and delay update expressions (from next_update assigns) ──
  const regUpdate   = new Map<RegDecl, ResolvedExpr>()
  const delayUpdate = new Map<DelayDecl, ResolvedExpr>()
  for (const a of prog.body.assigns) {
    if (a.op !== 'nextUpdate') continue
    if (a.target.op === 'regDecl')   regUpdate.set(a.target, a.expr)
    if (a.target.op === 'delayDecl') delayUpdate.set(a.target, a.expr)
  }

  const registerExprNodes: (ExprNode | null)[] = regDecls.map(d => {
    const u = regUpdate.get(d)
    return u === undefined ? null : lower(u)
  })

  // Delays carry their `update` field on the decl itself (the elaborator
  // attaches the parsed update there); a parallel `next_update` may also
  // exist. Prefer next_update when present, fall back to decl.update.
  const delayUpdateNodes: ExprNode[] = delayDecls.map(d => {
    const u = delayUpdate.get(d) ?? d.update
    return lower(u)
  })

  // ── Instance call args (for nested_output references) ──
  // Trivial subset has no instances; this is a placeholder for C5+.
  const nestedCalls: NestedCall[] = instanceDecls.map(_inst => {
    throw new Error(
      `loadProgramDefFromResolved: instance decls require Phase C5 (inlineInstances) — '${prog.name}' has nested instances`,
    )
  })

  // ── Input defaults ──
  const rawInputDefaults: Record<string, ExprNode> = {}
  const inputDefaults: (import('../expr.js').SignalExpr | null)[] = new Array(prog.ports.inputs.length).fill(null)
  for (let i = 0; i < prog.ports.inputs.length; i++) {
    const d = prog.ports.inputs[i]
    if (d.default === undefined) continue
    const lowered = lower(d.default)
    rawInputDefaults[d.name] = lowered
    // SignalExpr.coerce accepts ExprNode — number/boolean/object — unchanged.
    inputDefaults[i] = coerce(lowered as import('../expr.js').ExprCoercible)
  }

  const def: ProgramDef = {
    typeName: prog.name,
    inputNames,
    outputNames,
    inputPortTypes,
    outputPortTypes,
    registerNames,
    registerPortTypes,
    registerInitValues,
    sampleRate: 44100.0,
    rawInputDefaults,
    inputDefaults,
    delayInitValues,
    outputExprNodes: outputExprs,
    registerExprNodes,
    delayUpdateNodes,
    nestedCalls,
    breaksCycles: false,
    inputBounds,
    outputBounds,
  }

  return new ProgramType(def)
}

// ─────────────────────────────────────────────────────────────
// resolvedToSlotted — pure exhaustive walk
// ─────────────────────────────────────────────────────────────

/**
 * Walk a `ResolvedExpr` and emit the legacy `ExprNode` shape that
 * `flatten.ts` / `emit_numeric.ts` expect. References resolve to slot
 * IDs via the per-call slot tables. Combinator and let-binding shapes
 * preserve the legacy on-the-wire field names (`acc_var`, `elem_var`,
 * `var`, etc. — see `compiler/parse/lower.ts` for the canonical
 * legacy form).
 */
export function resolvedToSlotted(expr: ResolvedExpr, slots: Slots): ExprNode {
  if (typeof expr === 'number')  return expr
  if (typeof expr === 'boolean') return expr
  if (Array.isArray(expr))       return expr.map(e => resolvedToSlotted(e, slots))
  return opNodeToSlotted(expr, slots)
}

function opNodeToSlotted(node: ResolvedExprOpNode, slots: Slots): ExprNode {
  const recur = (e: ResolvedExpr) => resolvedToSlotted(e, slots)

  switch (node.op) {
    // ── References → slot-indexed legacy refs ──
    case 'inputRef': {
      const id = slots.inputs.get(node.decl)
      if (id === undefined) throw new Error(`resolvedToSlotted: input '${node.decl.name}' missing from slot table`)
      return { op: 'input', id }
    }
    case 'regRef': {
      const id = slots.regs.get(node.decl)
      if (id === undefined) throw new Error(`resolvedToSlotted: reg '${node.decl.name}' missing from slot table`)
      return { op: 'reg', id }
    }
    case 'delayRef': {
      const id = slots.delays.get(node.decl)
      if (id === undefined) throw new Error(`resolvedToSlotted: delay '${node.decl.name}' missing from slot table`)
      return { op: 'delayValue', node_id: id }
    }
    case 'nestedOut': {
      const node_id = slots.instances.get(node.instance)
      if (node_id === undefined) throw new Error(`resolvedToSlotted: instance '${node.instance.name}' missing from slot table`)
      const output_id = node.instance.type.ports.outputs.indexOf(node.output)
      if (output_id === -1) throw new Error(`resolvedToSlotted: output '${node.output.name}' not on instance type`)
      return { op: 'nestedOutput', node_id, output_id }
    }
    case 'paramRef': {
      // The session keeps params and triggers in separate registries
      // keyed by name. The IR distinguishes via `decl.kind`.
      const op = node.decl.kind === 'trigger' ? 'trigger' : 'param'
      return { op, name: node.decl.name }
    }
    case 'typeParamRef': return { op: 'typeParam', name: node.decl.name }
    case 'bindingRef':   return { op: 'binding', name: node.decl.name }

    // ── Sentinel leaves ──
    case 'sampleRate':  return { op: 'sampleRate' }
    case 'sampleIndex': return { op: 'sampleIndex' }

    // ── Binary ops (uniform `args` shape, op tag identical) ──
    case 'add': case 'sub': case 'mul': case 'div': case 'mod':
    case 'lt':  case 'lte': case 'gt':  case 'gte': case 'eq':  case 'neq':
    case 'and': case 'or':
    case 'bitAnd': case 'bitOr': case 'bitXor': case 'lshift': case 'rshift':
    case 'pow': case 'floorDiv': case 'ldexp':
      return { op: node.op, args: [recur(node.args[0]), recur(node.args[1])] }

    // ── Unary ops ──
    case 'neg': case 'not': case 'bitNot':
    case 'sqrt': case 'abs': case 'floor': case 'ceil': case 'round':
    case 'floatExponent': case 'toInt': case 'toBool': case 'toFloat':
      return { op: node.op, args: [recur(node.args[0])] }

    // ── Ternary ops ──
    case 'clamp':
      return { op: 'clamp', args: [recur(node.args[0]), recur(node.args[1]), recur(node.args[2])] }
    case 'select':
      return { op: 'select', args: [recur(node.args[0]), recur(node.args[1]), recur(node.args[2])] }

    // ── Index, arraySet ──
    case 'index':
      return { op: 'index', args: [recur(node.args[0]), recur(node.args[1])] }
    case 'arraySet':
      return { op: 'arraySet', args: [recur(node.args[0]), recur(node.args[1]), recur(node.args[2])] }

    // ── zeros: legacy uses `shape: [count]`. The resolved IR carries a
    //    `count` expression that lower.ts already statically resolved
    //    (must be a number); preserve that invariant here. ──
    case 'zeros': {
      const c = recur(node.count)
      if (typeof c !== 'number') {
        throw new Error('resolvedToSlotted: zeros count must lower to a numeric literal')
      }
      return { op: 'zeros', shape: [c] }
    }

    // ── Combinators (legacy field names: acc_var/elem_var/var/x_var/y_var) ──
    case 'fold':
      return {
        op: 'fold',
        over: recur(node.over),
        init: recur(node.init),
        acc_var: node.acc.name,
        elem_var: node.elem.name,
        body: recur(node.body),
      }
    case 'scan':
      return {
        op: 'scan',
        over: recur(node.over),
        init: recur(node.init),
        acc_var: node.acc.name,
        elem_var: node.elem.name,
        body: recur(node.body),
      }
    case 'generate':
      return { op: 'generate', count: recur(node.count), var: node.iter.name, body: recur(node.body) }
    case 'iterate':
      return { op: 'iterate', count: recur(node.count), var: node.iter.name, init: recur(node.init), body: recur(node.body) }
    case 'chain':
      return { op: 'chain', count: recur(node.count), var: node.iter.name, init: recur(node.init), body: recur(node.body) }
    case 'map2':
      return { op: 'map2', over: recur(node.over), elem_var: node.elem.name, body: recur(node.body) }
    case 'zipWith':
      return {
        op: 'zipWith',
        a: recur(node.a),
        b: recur(node.b),
        x_var: node.x.name,
        y_var: node.y.name,
        body: recur(node.body),
      }

    // ── Let: legacy carries `bind: Record<string, ExprNode>` + `in: ExprNode` ──
    case 'let': {
      const bind: Record<string, ExprNode> = {}
      for (const entry of node.binders) bind[entry.binder.name] = recur(entry.value)
      return { op: 'let', bind, in: recur(node.in) }
    }

    // ── Tag construction: payload as Record<fieldName, ExprNode>;
    //    omit when empty, matching legacy output. ──
    case 'tag': {
      const out: { op: 'tag'; type: string; variant: string; payload?: Record<string, ExprNode> } = {
        op: 'tag',
        type: node.variant.parent.name,
        variant: node.variant.name,
      }
      if (node.payload.length > 0) {
        const payload: Record<string, ExprNode> = {}
        for (const entry of node.payload) payload[entry.field.name] = recur(entry.value)
        out.payload = payload
      }
      return out
    }

    // ── Match elimination: legacy single-bind shape (string | string[]) ──
    case 'match': {
      const arms: Record<string, { bind?: string | string[]; body: ExprNode }> = {}
      for (const arm of node.arms) {
        const armOut: { bind?: string | string[]; body: ExprNode } = { body: recur(arm.body) }
        if (arm.binders.length === 1) armOut.bind = arm.binders[0].name
        else if (arm.binders.length > 1) armOut.bind = arm.binders.map(b => b.name)
        arms[arm.variant.name] = armOut
      }
      return {
        op: 'match',
        type: node.type.name,
        scrutinee: recur(node.scrutinee),
        arms,
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function convertPortType(pt: ResolvedPortType | undefined): LegacyPortType | undefined {
  if (pt === undefined) return undefined
  switch (pt.kind) {
    case 'scalar': return scalarToLegacy(pt.scalar)
    case 'alias':  return scalarToLegacy(pt.alias.base)
    case 'array': {
      const elem = typeof pt.element === 'string'
        ? scalarToLegacy(pt.element)
        : scalarToLegacy(pt.element.base)
      const shape = pt.shape.map(d => {
        if (typeof d !== 'number') {
          throw new Error(
            `loadProgramDefFromResolved: array shape contains unresolved type-param '${d.name}'. ` +
            `Run specializeProgram first.`,
          )
        }
        return d
      })
      return ArrayType(elem, shape)
    }
  }
}

function scalarToLegacy(s: ScalarKind): LegacyPortType {
  switch (s) {
    case 'float': return Float
    case 'int':   return Int
    case 'bool':  return Bool
  }
}

function regPortType(d: RegDecl): LegacyPortType | undefined {
  if (d.type === undefined) return undefined
  if (typeof d.type === 'string') return scalarToLegacy(d.type)
  return scalarToLegacy((d.type as AliasTypeDef).base)
}

function regInitValue(d: RegDecl): ValueCoercible {
  const init = d.init
  if (typeof init === 'number')  return init
  if (typeof init === 'boolean') return init
  if (Array.isArray(init))       return init as ValueCoercible
  if (isZerosInit(init)) return new Array(zerosCount(init)).fill(0)
  // Phase C3+ may admit richer init expressions. For now the trivial
  // subset only sees number/boolean/array literals.
  throw new Error('loadProgramDefFromResolved: register init must lower to a literal value (Phase C2 limitation)')
}

function isZerosInit(e: ResolvedExpr): e is { op: 'zeros'; count: ResolvedExpr } {
  return typeof e === 'object' && e !== null && !Array.isArray(e) && (e as { op: string }).op === 'zeros'
}

function zerosCount(e: ResolvedExpr): number {
  if (!isZerosInit(e)) throw new Error('zerosCount: not a zeros expression')
  const c = e.count
  if (typeof c !== 'number') {
    throw new Error('loadProgramDefFromResolved: zeros count must be a literal integer')
  }
  return c
}
