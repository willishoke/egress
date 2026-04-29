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

import type { ResolvedProgram, RegDecl, AliasTypeDef, ScalarKind, PortType as ResolvedPortType } from './nodes.js'
import type { ExprNode } from '../expr.js'
import { ProgramType, type ProgramDef } from '../program_types.js'
import { Float, Int, Bool, ArrayType, type PortType as LegacyPortType } from '../term.js'
import { resolvedToSlotted } from './lower_to_exprnode.js'
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

  // rawInputDefaults: for each input port with a `default`, lower it to
  // an ExprNode so consumers can splice it into session.inputExprNodes.
  // The lowering uses an empty slots table because input defaults today
  // are simple literal expressions — they don't reference instance
  // outputs or other inner decls. If a complex default ever appeared,
  // resolvedToSlotted would throw on the missing slot, surfacing the
  // problem at compile time.
  const emptySlots = { inputs: new Map(), regs: new Map(), delays: new Map(), instances: new Map() }
  const memo = new WeakMap<object, ExprNode>()
  const rawInputDefaults: Record<string, ExprNode> = {}
  for (const d of prog.ports.inputs) {
    if (d.default !== undefined) rawInputDefaults[d.name] = resolvedToSlotted(d.default, emptySlots, memo)
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
