/**
 * program_types.ts — `ProgramType` / `ProgramInstance`.
 *
 * Thin wrappers over a post-strata `ResolvedProgram`. Everything they
 * expose — port names, port types, register lists, default-input
 * expressions — is derived on demand from the resolved IR. Slot-derived
 * fields (register names + types) are computed lazily via `buildSlotMaps`
 * and cached; everything else is a one-line walk over `prog.ports`.
 */

import type { ExprCoercible, ExprNode } from './expr.js'
import type { PortType as LegacyPortType } from './term.js'
import { Float, Int, Bool, ArrayType } from './term.js'
import type {
  ResolvedProgram, ResolvedExpr, RegDecl, AliasTypeDef, ScalarKind,
  PortType as ResolvedPortType,
} from './ir/nodes.js'
import { buildSlotMaps } from './ir/slots.js'

// ---------- Value helpers ----------

export type ValueCoercible = boolean | number | number[] | number[][]

/** A register initialiser: either a bare value or { init, type }. */
export type RegInit = ValueCoercible | { init: ValueCoercible; type: string }

// ---------- ProgramType ----------

export class ProgramType {
  readonly prog: ResolvedProgram

  // Slot-derived fields are expensive to compute (full buildSlotMaps walk
  // over the post-strata program). Cache lazily on first read.
  private _regCache?: { names: string[]; types: (LegacyPortType | undefined)[] }
  private _defaultsCache?: Record<string, ExprNode>

  constructor(prog: ResolvedProgram) {
    this.prog = prog
  }

  get name(): string { return this.prog.name }

  /** session-local rename used when caching a specialized type under
   *  `Type<N=8>`-style key. The resolved IR carries `name`; we mutate it
   *  so downstream serializers print the cached key. */
  rename(newName: string): void { this.prog.name = newName }

  get inputNames(): string[] {
    return this.prog.ports.inputs.map(d => d.name)
  }

  get outputNames(): string[] {
    return this.prog.ports.outputs.map(d => d.name)
  }

  get inputPortTypes(): (LegacyPortType | undefined)[] {
    return this.prog.ports.inputs.map(d => convertPortType(d.type))
  }

  get outputPortTypes(): (LegacyPortType | undefined)[] {
    return this.prog.ports.outputs.map(d => convertPortType(d.type))
  }

  get registerNames(): string[] {
    return this._regs().names
  }

  get registerPortTypes(): (LegacyPortType | undefined)[] {
    return this._regs().types
  }

  inputPortType(idx: number): LegacyPortType | undefined  { return this.inputPortTypes[idx] }
  outputPortType(idx: number): LegacyPortType | undefined { return this.outputPortTypes[idx] }
  registerPortType(idx: number): LegacyPortType | undefined { return this.registerPortTypes[idx] }

  /** Default expressions per input port name; seeded into
   *  `session.inputExprNodes` by `loadProgramAsSession` when the user
   *  doesn't wire that input. */
  get rawInputDefaults(): Record<string, ExprNode> {
    if (this._defaultsCache) return this._defaultsCache
    const out: Record<string, ExprNode> = {}
    for (const d of this.prog.ports.inputs) {
      if (d.default !== undefined) out[d.name] = literalDefault(d.default, d.name)
    }
    this._defaultsCache = out
    return out
  }

  /** Instantiate with an explicit instance name. */
  instantiateAs(name: string, opts?: { baseTypeName?: string; typeArgs?: Record<string, number> }): ProgramInstance {
    return new ProgramInstance(this, name, opts?.baseTypeName, opts?.typeArgs)
  }

  private _regs(): { names: string[]; types: (LegacyPortType | undefined)[] } {
    if (this._regCache) return this._regCache
    const { regDecls } = buildSlotMaps(this.prog)
    const names = regDecls.map(d => d.name)
    const types: (LegacyPortType | undefined)[] = regDecls.map(d => regPortType(d))
    // Override register port types for array-init regs — lift the shape
    // from the resolved init's array literal / `zeros{count}` form.
    for (let i = 0; i < regDecls.length; i++) {
      const init = regDecls[i].init
      if (Array.isArray(init)) {
        types[i] = ArrayType(Float, [init.length])
      } else if (typeof init === 'object' && init !== null && (init as { op?: string }).op === 'zeros') {
        const count = (init as { count: unknown }).count
        if (typeof count === 'number') types[i] = ArrayType(Float, [count])
      }
    }
    this._regCache = { names, types }
    return this._regCache
  }
}

// ---------- ProgramInstance ----------

export class ProgramInstance {
  readonly type: ProgramType
  readonly name: string
  /** Base (pre-specialization) type name. Equals type.name for non-generic types. */
  readonly baseTypeName: string
  /** Resolved compile-time args if this instance was specialized. */
  readonly typeArgs?: Record<string, number>
  /** Per-usage gating; the materializer wraps outputs in `select(gate, raw, fallback)`. */
  gateable: boolean = false
  gateInput: ExprNode | undefined = undefined

  constructor(type: ProgramType, name: string, baseTypeName?: string, typeArgs?: Record<string, number>) {
    this.type = type
    this.name = name
    this.baseTypeName = baseTypeName ?? type.name
    this.typeArgs = typeArgs
  }

  get typeName(): string { return this.baseTypeName }

  get inputNames():    string[] { return this.type.inputNames }
  get outputNames():   string[] { return this.type.outputNames }
  get registerNames(): string[] { return this.type.registerNames }

  inputPortType(idx: number):    LegacyPortType | undefined { return this.type.inputPortType(idx) }
  outputPortType(idx: number):   LegacyPortType | undefined { return this.type.outputPortType(idx) }
  registerPortType(idx: number): LegacyPortType | undefined { return this.type.registerPortType(idx) }

  inputIndex(name: string): number {
    const idx = this.type.inputNames.indexOf(name)
    if (idx === -1) throw new Error(`Unknown input '${name}' on instance '${this.name}'.`)
    return idx
  }

  outputIndex(name: string): number {
    const idx = this.type.outputNames.indexOf(name)
    if (idx === -1) throw new Error(`Unknown output '${name}' on instance '${this.name}'.`)
    return idx
  }
}

// ─── helpers (resolved → legacy port type, default-expr lowering) ───────────

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
            `ProgramType: array shape contains unresolved type-param '${d.name}'. ` +
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
    throw new Error(`ProgramType: input '${portName}' default has unexpected shape`)
  }
  const obj = expr as { op: string; args?: unknown[]; count?: ResolvedExpr }
  switch (obj.op) {
    case 'add': case 'sub': case 'mul': case 'div': case 'mod':
    case 'floorDiv': case 'ldexp':
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
      const c = literalDefault(obj.count as ResolvedExpr, portName)
      return { op: 'zeros', count: c }
    }
  }
  throw new Error(
    `ProgramType: input '${portName}' default has op '${obj.op}' that's not a literal-class form; ` +
    `defaults shouldn't reference decls or run combinators`,
  )
}
