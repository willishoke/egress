/**
 * program_type_builder.ts — `ResolvedProgram → ProgramType` (thin metadata).
 *
 * Replaces the retired `compiler/ir/load.ts:loadProgramDefFromResolved`.
 * The legacy builder produced a slot-indexed `ProgramDef` carrying
 * pre-emit `ExprNode` trees so `flatten.ts` could assemble them into
 * a flat plan. Post-D2 cutover, `flatten.ts` is gone and the runtime
 * goes ResolvedProgram → compileSession → tropical_plan_4 directly.
 *
 * The `ProgramType` wrapper survives because consumers (mcp/server.ts,
 * session.ts, program.ts) read `inputNames`/`outputNames`/port types
 * for type-registry lookups, instantiation, introspection. We build a
 * metadata-only ProgramDef from the ResolvedProgram and stash it.
 */

import type { ResolvedProgram, ResolvedExpr, RegDecl, AliasTypeDef, ScalarKind, PortType as ResolvedPortType } from './nodes.js'
import type { ExprNode } from '../expr.js'
import { ProgramType, type ProgramDef } from '../program_types.js'
import { Float, Int, Bool, ArrayType, type PortType as LegacyPortType } from '../term.js'
import { buildSlotMaps } from './slots.js'

/** Build a ProgramType from a post-strata ResolvedProgram. The ProgramDef
 *  inside carries port-type / name metadata only — no ExprNode trees,
 *  no nestedCalls. The runtime goes through `compileSession` instead. */
export function resolvedToProgramType(prog: ResolvedProgram): ProgramType {
  const { regDecls } = buildSlotMaps(prog)

  const inputNames    = prog.ports.inputs.map(d => d.name)
  const outputNames   = prog.ports.outputs.map(d => d.name)
  const registerNames = regDecls.map(d => d.name)

  const inputPortTypes  = prog.ports.inputs.map(d => convertPortType(d.type))
  const outputPortTypes = prog.ports.outputs.map(d => convertPortType(d.type))
  const registerPortTypes = regDecls.map(d => regPortType(d))

  // Override register port types for array-init regs (lifted from the
  // resolved init's array shape). Mirrors the legacy override logic.
  for (let i = 0; i < regDecls.length; i++) {
    const init = regDecls[i].init
    if (Array.isArray(init)) {
      registerPortTypes[i] = ArrayType(Float, [init.length])
    } else if (typeof init === 'object' && init !== null && (init as { op?: string }).op === 'zeros') {
      const count = (init as { count: unknown }).count
      if (typeof count === 'number') registerPortTypes[i] = ArrayType(Float, [count])
    }
  }

  // rawInputDefaults: input ports with declared default values, lowered
  // to MCP wire-format ExprNode so `loadProgramAsSession` can splice
  // them into `session.inputExprNodes` for unwired ports. Defaults are
  // simple literals in practice (numbers, booleans, occasionally
  // arrays of those); a more complex form here is a future-feature
  // signal that this lowering needs extension.
  const rawInputDefaults: Record<string, ExprNode> = {}
  for (const d of prog.ports.inputs) {
    if (d.default !== undefined) rawInputDefaults[d.name] = literalDefault(d.default, d.name)
  }

  const def: ProgramDef = {
    typeName: prog.name,
    inputNames,
    outputNames,
    inputPortTypes,
    outputPortTypes,
    registerNames,
    registerPortTypes,
    rawInputDefaults,
  }

  return new ProgramType(def)
}

// ─── helpers (mirror the retired load.ts) ───────────────────────────────────

function convertPortType(pt: ResolvedPortType | undefined): LegacyPortType | undefined {
  if (pt === undefined) return undefined
  switch (pt.kind) {
    case 'scalar': return scalarToLegacy(pt.scalar)
    case 'alias':  return scalarToLegacy(pt.alias.base)
    case 'array': {
      const elem = typeof pt.element === 'string' ? scalarToLegacy(pt.element) : scalarToLegacy(pt.element.base)
      const shape = pt.shape.map(d => {
        if (typeof d !== 'number') {
          throw new Error(
            `resolvedToProgramType: array shape contains unresolved type-param '${d.name}'. ` +
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

/** Lower a `ResolvedExpr` input-default to the MCP wire-format `ExprNode`
 *  shape that gets spliced into `session.inputExprNodes`. Defaults are
 *  ref-free (they don't read other instances' outputs or program-internal
 *  decls), so this walker only needs to handle literals + arithmetic +
 *  clamp/select. The bounds-lowering pass (`parse/lower_bounds.ts`) wraps
 *  bounded defaults in `clamp` ops, which is why we accept that op here. */
function literalDefault(expr: ResolvedExpr, portName: string): ExprNode {
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr
  if (Array.isArray(expr)) return expr.map(e => literalDefault(e, portName))
  if (typeof expr !== 'object' || expr === null) {
    throw new Error(`resolvedToProgramType: input '${portName}' default has unexpected shape`)
  }
  const obj = expr as { op: string; args?: unknown[]; count?: ResolvedExpr }
  // Pass-through ops that share the resolved-IR and MCP wire-format shape.
  // Walks args recursively. A ref-bearing op or combinator surfacing here
  // is a strata bug — defaults should be pure literal expressions.
  switch (obj.op) {
    case 'add': case 'sub': case 'mul': case 'div': case 'mod':
    case 'pow': case 'floorDiv': case 'ldexp':
    case 'lt': case 'lte': case 'gt': case 'gte': case 'eq': case 'neq':
    case 'and': case 'or':
    case 'bitAnd': case 'bitOr': case 'bitXor': case 'lshift': case 'rshift':
    case 'neg': case 'not': case 'bitNot': case 'sqrt': case 'abs':
    case 'floor': case 'ceil': case 'round': case 'floatExponent':
    case 'toInt': case 'toBool': case 'toFloat':
    case 'clamp': case 'select': case 'index': case 'arraySet': {
      const args = (obj.args ?? []) as ResolvedExpr[]
      return { op: obj.op, args: args.map(a => literalDefault(a, portName)) }
    }
    case 'sampleRate': case 'sampleIndex':
      return { op: obj.op }
    case 'zeros': {
      // Pass-through with the resolved shape's `count` field.
      const c = literalDefault(obj.count as ResolvedExpr, portName)
      return { op: 'zeros', count: c }
    }
  }
  throw new Error(
    `resolvedToProgramType: input '${portName}' default has op '${obj.op}' that's not a literal-class form; ` +
    `defaults shouldn't reference decls or run combinators`,
  )
}
