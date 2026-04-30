/**
 * lower_to_exprnode.ts — `ResolvedExpr → ExprNode` walker.
 *
 * Bridges the resolved IR (decl-identity refs) to the legacy ExprNode
 * shape that `emit_numeric` consumes. Refs become slot-indexed via the
 * `Slots` tables built per-emit-call by `compile_resolved.ts`.
 *
 * Hoisted out of the retired `compiler/ir/load.ts` in Phase D D3-b.
 * The eventual §2.1 from-scratch port of `emit_numeric` to walk
 * `ResolvedExpr` directly would let us delete this file too.
 */

import type {
  ResolvedExpr, ResolvedExprOpNode,
  RegDecl, DelayDecl, InstanceDecl, InputDecl,
} from './nodes.js'
import type { EmitExprNode as ExprNode } from './emit_node.js'

export interface Slots {
  inputs:    Map<InputDecl, number>
  regs:      Map<RegDecl, number>
  delays:    Map<DelayDecl, number>
  instances: Map<InstanceDecl, number>
  /** Total scalar-register count (regs.size). Threads through so
   *  `delayRef` can emit `{op:'reg', id: regCount + delaySlot}` directly,
   *  without a downstream `resolveDelayValues` rewrite pass. */
  regCount?: number
}

/**
 * Walk a `ResolvedExpr` and emit the legacy `ExprNode` shape that
 * `emit_numeric` expects. References resolve to slot IDs via the
 * per-call slot tables. Combinator and let-binding shapes preserve
 * the legacy on-the-wire field names (`acc_var`, `elem_var`, `var`,
 * `x_var`, `y_var`).
 */
export function resolvedToSlotted(expr: ResolvedExpr, slots: Slots, memo?: WeakMap<object, ExprNode>): ExprNode {
  if (typeof expr === 'number')  return expr
  if (typeof expr === 'boolean') return expr
  if (Array.isArray(expr)) {
    if (memo) {
      const cached = memo.get(expr)
      if (cached !== undefined) return cached
    }
    const out = expr.map(e => resolvedToSlotted(e, slots, memo))
    if (memo) memo.set(expr, out)
    return out
  }
  if (memo) {
    const cached = memo.get(expr)
    if (cached !== undefined) return cached
  }
  const out = opNodeToSlotted(expr, slots, memo)
  if (memo) memo.set(expr, out)
  return out
}

function opNodeToSlotted(node: ResolvedExprOpNode, slots: Slots, memo?: WeakMap<object, ExprNode>): ExprNode {
  const recur = (e: ResolvedExpr) => resolvedToSlotted(e, slots, memo)

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
      // Emit a state-register read at the combined slot index. emit_numeric
      // sees `{op:'reg', id}` and produces a `state_reg` operand. Folding
      // this in here lets compile_resolved skip a downstream rewrite pass.
      if (slots.regCount === undefined) {
        // Defensive fallback for callers that build a Slots table by hand
        // (e.g. program_type_builder for input-default lowering, where no
        // delays appear). Emit the legacy delayValue op; an absent
        // regCount means there are no regs to combine with, so the bare
        // node_id matches the delay slot.
        return { op: 'delayValue', node_id: id }
      }
      return { op: 'reg', id: slots.regCount + id }
    }
    case 'nestedOut': {
      const node_id = slots.instances.get(node.instance)
      if (node_id === undefined) throw new Error(`resolvedToSlotted: instance '${node.instance.name}' missing from slot table`)
      const output_id = node.instance.type.ports.outputs.indexOf(node.output)
      if (output_id === -1) throw new Error(`resolvedToSlotted: output '${node.output.name}' not on instance type`)
      return { op: 'nestedOutput', node_id, output_id }
    }
    case 'paramRef': {
      const op = node.decl.kind === 'trigger' ? 'trigger' : 'param'
      return { op, name: node.decl.name }
    }
    case 'typeParamRef': return { op: 'typeParam', name: node.decl.name }
    case 'bindingRef':   return { op: 'binding', name: node.decl.name }

    // ── Sentinel leaves ──
    case 'sampleRate':  return { op: 'sampleRate' }
    case 'sampleIndex': return { op: 'sampleIndex' }

    // ── Binary ops ──
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

    // ── zeros: legacy uses `shape: [count]` with a static numeric count. ──
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

    // ── Tag construction ──
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

    // ── Match elimination ──
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
