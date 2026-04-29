/**
 * compiler/ir/compile_session.ts — Phase D D2 session emit boundary.
 *
 * `compileSession(session)` materializes a session — a partially-typed
 * graph of `ProgramInstance`s plus session-keyed wiring `ExprNode`s
 * plus `dac.out` graph outputs — into a synthetic top-level
 * `ResolvedProgram`, then runs the strata pipeline + `compileResolved`
 * to produce a `tropical_plan_4` plan.
 *
 * Per PHASE_D_PLAN §5e, this is the highest-risk single piece of code
 * in Phase D: the session represents a partially-typed graph; the
 * resolved IR represents a fully-typed graph; the materializer is the
 * coproduct injection between the two universes.
 *
 * Invariants (per category-theorist review §5e):
 *  - Zero scope analysis. The translator does no name resolution other
 *    than `instanceRegistry.get(instanceName)` and
 *    `findOutput(instance, outputName)`. Every reference becomes a
 *    direct decl-identity ResolvedExpr ref.
 *  - Coproduct injection: instance types come pre-resolved (resolved
 *    registry / specialization cache); the materializer only stitches
 *    them into a top-level shell.
 *  - Decl creation is bounded: the materializer creates fresh
 *    `DelayDecl` objects for session-level `delay()` nodes and fresh
 *    `OutputDecl` objects for graph_outputs. Nothing else.
 *
 * This is a first-cut implementation: handles non-generic instances,
 * literal/ref/param/binary/unary/clamp/select wiring, `dac.out` graph
 * outputs. Out of scope (TODO):
 *  - Session-level `delay()` extraction
 *  - Self-feedback / inter-instance cycle handling (defer to traceCycles
 *    after materialization for the simple case; non-trivial cases
 *    still need pre-materialization rewrites)
 *  - Gateable subgraph wiring
 *  - Generic instance type resolution
 *  - Array-valued wiring (broadcast_to insertion)
 */

import type {
  ResolvedProgram, ResolvedExpr, ResolvedExprOpNode, ResolvedBlock,
  ResolvedProgramPorts,
  InputDecl, OutputDecl, ParamDecl, DelayDecl, InstanceDecl,
  BodyDecl, BodyAssign, OutputAssign,
  TypeParamDecl,
} from './nodes.js'
import type { ExprNode } from '../expr.js'
import type { SessionState } from '../session.js'
import type { ProgramInstance } from '../program_types.js'
import { strataPipeline } from './strata.js'
import { compileResolved } from './compile_resolved.js'
import type { FlatPlan } from '../flatten.js'
import { specializeProgram } from './specialize.js'

export function compileSession(session: SessionState): FlatPlan {
  const synthetic = materializeSession(session)
  const lowered = strataPipeline(synthetic)
  return compileResolved(lowered)
}

// ─────────────────────────────────────────────────────────────────────────────
// Session → synthetic ResolvedProgram
// ─────────────────────────────────────────────────────────────────────────────

interface MaterializeContext {
  /** Fresh InstanceDecl per session instance name. Identity-keyed; shared
   *  across the wiring translation so refs map to the same object. */
  instanceDecls: Map<string, InstanceDecl>
  /** ParamDecl per param/trigger name. Created lazily as wiring expressions
   *  reference them; same identity reused across all references. */
  paramDecls: Map<string, ParamDecl>
  /** Synthetic DelayDecls for session-level `delay()` nodes extracted
   *  from wiring expressions. The translator creates one DelayDecl per
   *  `delay` node; subsequent translations of the same identity-shared
   *  ExprNode reuse the same decl via exprMemo. */
  syntheticDelayDecls: DelayDecl[]
  /** Identity memoization: shared session ExprNode objects produce shared
   *  ResolvedExpr objects so downstream CSE memo (in resolvedToSlotted +
   *  emit_numeric) treats them as identical. */
  exprMemo: WeakMap<object, ResolvedExpr>
  /** Direct lookup into the session for type-resolution + port lookup. */
  session: SessionState
}

function materializeSession(session: SessionState): ResolvedProgram {
  const ctx: MaterializeContext = {
    instanceDecls:       new Map(),
    paramDecls:          new Map(),
    syntheticDelayDecls: [],
    exprMemo:            new WeakMap(),
    session,
  }

  // 1. Build InstanceDecl per session instance, in iteration order.
  //    Each instance's `type` is resolved via the session's resolved
  //    registry / generic templates; `inputs` is filled in step 2.
  for (const [name, inst] of session.instanceRegistry) {
    const decl = buildInstanceDecl(name, inst, ctx)
    ctx.instanceDecls.set(name, decl)
  }

  // 2. Translate session.inputExprNodes → InstanceDecl.inputs entries.
  //    Key shape is `${instance}:${input}`.
  for (const [key, expr] of session.inputExprNodes) {
    const colon = key.indexOf(':')
    if (colon < 0) continue
    const instName = key.slice(0, colon)
    const inputName = key.slice(colon + 1)
    const instDecl = ctx.instanceDecls.get(instName)
    if (instDecl === undefined) continue  // stale wiring entry
    const port = instDecl.type.ports.inputs.find(p => p.name === inputName)
    if (port === undefined) {
      throw new Error(
        `compileSession: instance '${instName}' has no input port '${inputName}' on type '${instDecl.type.name}'.`,
      )
    }
    const value = translateExpr(expr, ctx)
    instDecl.inputs.push({ port, value })
  }

  // 3. Build OutputDecls + OutputAssigns from session.graphOutputs (dac.out
  //    wires). Each graph_output entry produces one OutputDecl in
  //    ports.outputs (named after `${instance}.${output}`) and one
  //    OutputAssign whose expr reads that instance's output.
  const outputDecls: OutputDecl[] = []
  const outputAssigns: OutputAssign[] = []
  for (const go of session.graphOutputs) {
    const instDecl = ctx.instanceDecls.get(go.instance)
    if (instDecl === undefined) {
      throw new Error(`compileSession: graph output references unknown instance '${go.instance}'.`)
    }
    const outDecl = instDecl.type.ports.outputs.find(p => p.name === go.output)
    if (outDecl === undefined) {
      throw new Error(
        `compileSession: instance '${go.instance}' has no output port '${go.output}' on type '${instDecl.type.name}'.`,
      )
    }
    const sessionOutput: OutputDecl = {
      op: 'outputDecl',
      name: `${go.instance}.${go.output}`,
    }
    if (outDecl.type !== undefined) sessionOutput.type = outDecl.type
    outputDecls.push(sessionOutput)
    const ref: ResolvedExprOpNode = { op: 'nestedOut', instance: instDecl, output: outDecl }
    outputAssigns.push({ op: 'outputAssign', target: sessionOutput, expr: ref })
  }

  // 4. Assemble body decls in source order: synthetic delays first
  //    (so their slots claim low indices, matching legacy convention
  //    where session delays come before instance regs), then instance
  //    decls, then params.
  const bodyDecls: BodyDecl[] = []
  for (const decl of ctx.syntheticDelayDecls)   bodyDecls.push(decl)
  for (const decl of ctx.instanceDecls.values()) bodyDecls.push(decl)
  for (const decl of ctx.paramDecls.values())    bodyDecls.push(decl)

  const bodyAssigns: BodyAssign[] = outputAssigns

  const block: ResolvedBlock = {
    op: 'block',
    decls:   bodyDecls,
    assigns: bodyAssigns,
  }

  const ports: ResolvedProgramPorts = {
    inputs:   [] as InputDecl[],
    outputs:  outputDecls,
    typeDefs: [],
  }

  const prog: ResolvedProgram = {
    op: 'program',
    name: '__session__',
    typeParams: [] as TypeParamDecl[],
    ports,
    body: block,
  }
  return prog
}

// ─────────────────────────────────────────────────────────────────────────────
// Build InstanceDecl
// ─────────────────────────────────────────────────────────────────────────────

function buildInstanceDecl(
  name: string,
  inst: ProgramInstance,
  ctx: MaterializeContext,
): InstanceDecl {
  const session = ctx.session
  const baseTypeName = inst.baseTypeName ?? inst._def.typeName
  const rawTypeArgs = inst.typeArgs ?? {}

  // Try non-generic first (concrete type registered with this base name).
  const registered = session.resolvedRegistry.get(baseTypeName)
  let resolvedType: ResolvedProgram | undefined
  let typeArgsList: Array<{ param: TypeParamDecl; value: number }> = []

  if (registered !== undefined && registered.typeParams.length === 0) {
    resolvedType = registered
  } else {
    // Generic case: pull the template, build TypeParamDecl-keyed subst,
    // re-specialize. Mirrors session.ts:resolveProgramType.
    const template = session.genericTemplatesResolved.get(baseTypeName)
      ?? registered
    if (template === undefined) {
      throw new Error(
        `compileSession: instance '${name}' has type '${baseTypeName}' which is not registered as a resolved program.`,
      )
    }
    const subst = new Map<TypeParamDecl, number>()
    for (const [paramName, value] of Object.entries(rawTypeArgs)) {
      const decl = template.typeParams.find(p => p.name === paramName)
      if (!decl) {
        throw new Error(
          `compileSession: instance '${name}' carries unknown type-arg '${paramName}' for '${baseTypeName}'.`,
        )
      }
      subst.set(decl, value)
      typeArgsList.push({ param: decl, value })
    }
    // Fill in defaults for any unspecified param.
    for (const decl of template.typeParams) {
      if (subst.has(decl)) continue
      if (decl.default === undefined) {
        throw new Error(
          `compileSession: instance '${name}' missing required type-arg '${decl.name}' for '${baseTypeName}' (no default).`,
        )
      }
      subst.set(decl, decl.default)
      typeArgsList.push({ param: decl, value: decl.default })
    }
    resolvedType = specializeProgram(template, subst)
  }

  // After buildInstanceDecl, `resolvedType` is fully specialized (empty
  // typeParams). `inlineInstances` will then short-circuit on the
  // empty-typeParams + empty-typeArgs path. Carrying typeArgsList through
  // would re-trigger specializeProgram against an already-specialized
  // template, which throws "type-arg X is not a declared type-param".
  return {
    op: 'instanceDecl',
    name,
    type: resolvedType,
    typeArgs: [],
    inputs: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExprNode → ResolvedExpr translation
// ─────────────────────────────────────────────────────────────────────────────

const BINARY_OPS = new Set([
  'add', 'sub', 'mul', 'div', 'mod',
  'lt', 'lte', 'gt', 'gte', 'eq', 'neq',
  'and', 'or',
  'bitAnd', 'bitOr', 'bitXor', 'lshift', 'rshift',
  'pow', 'floorDiv', 'ldexp',
])

const UNARY_OPS = new Set([
  'neg', 'not', 'bitNot',
  'sqrt', 'abs', 'floor', 'ceil', 'round',
  'floatExponent', 'toInt', 'toBool', 'toFloat',
])

const TERNARY_OPS = new Set(['clamp', 'select', 'arraySet'])

function translateExpr(expr: ExprNode, ctx: MaterializeContext): ResolvedExpr {
  if (typeof expr === 'number')  return expr
  if (typeof expr === 'boolean') return expr
  if (Array.isArray(expr)) {
    const cached = ctx.exprMemo.get(expr)
    if (cached !== undefined) return cached
    const out = expr.map(e => translateExpr(e, ctx)) as ResolvedExpr
    ctx.exprMemo.set(expr, out)
    return out
  }
  if (typeof expr !== 'object' || expr === null) {
    throw new Error(`compileSession: invalid expr value: ${JSON.stringify(expr)}`)
  }

  const cached = ctx.exprMemo.get(expr)
  if (cached !== undefined) return cached

  const obj = expr as Record<string, unknown>
  const op = obj.op
  if (typeof op !== 'string') {
    throw new Error(`compileSession: expression missing op tag: ${JSON.stringify(expr).slice(0, 100)}`)
  }

  const out = translateOpNode(obj, op, ctx)
  ctx.exprMemo.set(expr, out)
  return out
}

function translateOpNode(
  obj: Record<string, unknown>,
  op: string,
  ctx: MaterializeContext,
): ResolvedExpr {
  // ── Reference ops ─────────────────────────────────────────────────
  if (op === 'ref') {
    const instName = obj.instance as string
    const outputName = obj.output as string
    const instDecl = ctx.instanceDecls.get(instName)
    if (instDecl === undefined) {
      throw new Error(`compileSession: ref to unknown instance '${instName}'.`)
    }
    const outDecl = instDecl.type.ports.outputs.find(p => p.name === outputName)
    if (outDecl === undefined) {
      throw new Error(
        `compileSession: ref to '${instName}.${outputName}' — '${outputName}' is not a port on type '${instDecl.type.name}'.`,
      )
    }
    return { op: 'nestedOut', instance: instDecl, output: outDecl }
  }

  if (op === 'param' || op === 'paramExpr') {
    return paramRef(obj.name as string, 'param', ctx)
  }

  if (op === 'trigger' || op === 'triggerParamExpr') {
    return paramRef(obj.name as string, 'trigger', ctx)
  }

  if (op === 'sampleRate')  return { op: 'sampleRate' }
  if (op === 'sampleIndex') return { op: 'sampleIndex' }

  // ── Pass-through binary / unary / ternary ─────────────────────────
  if (BINARY_OPS.has(op)) {
    const args = (obj.args as ExprNode[]).map(a => translateExpr(a, ctx))
    return { op, args: [args[0], args[1]] } as ResolvedExpr
  }

  if (UNARY_OPS.has(op)) {
    const args = (obj.args as ExprNode[]).map(a => translateExpr(a, ctx))
    return { op, args: [args[0]] } as ResolvedExpr
  }

  if (TERNARY_OPS.has(op)) {
    const args = (obj.args as ExprNode[]).map(a => translateExpr(a, ctx))
    return { op, args: [args[0], args[1], args[2]] } as ResolvedExpr
  }

  if (op === 'index') {
    const args = (obj.args as ExprNode[]).map(a => translateExpr(a, ctx))
    return { op: 'index', args: [args[0], args[1]] }
  }

  // Array literal: `{op:'array', items:[...]}` → bare array (ResolvedExpr[]).
  // The resolved IR represents arrays as ResolvedExpr[]; the parser-level
  // wrapper drops away.
  if (op === 'array') {
    const items = (obj.items as ExprNode[]).map(item => translateExpr(item, ctx))
    return items as ResolvedExpr
  }

  // Session-level `delay()`: extract into a synthesized DelayDecl whose
  // `update` is the inner expression; the original delay node becomes a
  // delayRef. Init defaults to 0 (legacy convention). The decl is
  // appended to ctx.syntheticDelayDecls so it lands in body.decls.
  // exprMemo reuse means a shared `delay()` ExprNode produces a single
  // DelayDecl, matching legacy CSE.
  if (op === 'delay') {
    const update = translateExpr((obj.args as ExprNode[])[0], ctx)
    const init = typeof obj.init === 'number' ? obj.init : 0
    const decl: DelayDecl = { op: 'delayDecl', name: `__sd${ctx.syntheticDelayDecls.length}`, update, init }
    ctx.syntheticDelayDecls.push(decl)
    return { op: 'delayRef', decl }
  }

  // TODO: gateable subgraph wiring (source_tag)
  // TODO: broadcastTo / matmul (less common in patches; defer)

  throw new Error(`compileSession: unhandled wiring op '${op}' (TODO: extend translator coverage).`)
}

function paramRef(name: string, kind: 'param' | 'trigger', ctx: MaterializeContext): ResolvedExpr {
  let decl = ctx.paramDecls.get(name)
  if (decl === undefined) {
    decl = { op: 'paramDecl', name, kind }
    ctx.paramDecls.set(name, decl)
  } else if (decl.kind !== kind) {
    throw new Error(
      `compileSession: param/trigger name collision on '${name}' (declared as '${decl.kind}', ref demands '${kind}').`,
    )
  }
  return { op: 'paramRef', decl }
}

export type { ProgramInstance }
