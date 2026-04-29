/**
 * program_types.ts — Data types for the compiler's internal program
 * representation.
 *
 * Post-D3-b: `ProgramDef` is metadata-only. The runtime IR lives in
 * `compiler/ir/nodes.ts:ResolvedProgram` and is wired through
 * `compileSession`. ProgramType / ProgramInstance survive as thin
 * wrappers used by the type/instance registries; their fields back
 * MCP introspection tools and `inputName → default` seeding in
 * `program.ts:loadProgramAsSession`.
 */

import type { ExprCoercible, ExprNode } from './expr.js'
import type { PortType } from './term.js'

// ---------- Value helpers ----------

export type ValueCoercible = boolean | number | number[] | number[][]

/** A register initialiser: either a bare value or { init, type }. */
export type RegInit = ValueCoercible | { init: ValueCoercible; type: string }

// ---------- ProgramDef ----------

/**
 * Type-registry metadata for a program. Built from a `ResolvedProgram`
 * by `compiler/ir/program_type_builder.ts:resolvedToProgramType`.
 */
export interface ProgramDef {
  typeName: string
  inputNames: string[]
  outputNames: string[]
  inputPortTypes: (PortType | undefined)[]
  outputPortTypes: (PortType | undefined)[]
  registerNames: string[]
  registerPortTypes: (PortType | undefined)[]
  /** Default expressions per input port name; seeded into
   *  `session.inputExprNodes` by `loadProgramAsSession` when the user
   *  doesn't wire that input. */
  rawInputDefaults: Record<string, ExprNode>
}

// ---------- ProgramType ----------

export class ProgramType {
  readonly _def: ProgramDef

  constructor(def: ProgramDef) {
    this._def = def
  }

  get name(): string { return this._def.typeName }

  /** Instantiate with an explicit instance name. */
  instantiateAs(name: string, opts?: { baseTypeName?: string; typeArgs?: Record<string, number> }): ProgramInstance {
    return new ProgramInstance(this._def, name, opts?.baseTypeName, opts?.typeArgs)
  }
}

// ---------- ProgramInstance ----------

export class ProgramInstance {
  readonly _def: ProgramDef
  readonly name: string
  /** Base (pre-specialization) type name. Equals _def.typeName for non-generic types. */
  readonly baseTypeName: string
  /** Resolved compile-time args if this instance was specialized. */
  readonly typeArgs?: Record<string, number>
  /** Per-usage gating (see ProgramJSON.instances.gateable). Phase 2 plumbing;
   *  flatten.ts will emit source_tag wrappers in a later phase. */
  gateable: boolean = false
  gateInput: ExprNode | undefined = undefined

  constructor(def: ProgramDef, name: string, baseTypeName?: string, typeArgs?: Record<string, number>) {
    this._def = def
    this.name = name
    this.baseTypeName = baseTypeName ?? def.typeName
    this.typeArgs = typeArgs
  }

  get inputNames(): string[] { return this._def.inputNames }
  get outputNames(): string[] { return this._def.outputNames }
  get registerNames(): string[] { return this._def.registerNames }
  get typeName(): string { return this.baseTypeName }

  inputPortType(idx: number): PortType | undefined { return this._def.inputPortTypes[idx] }
  outputPortType(idx: number): PortType | undefined { return this._def.outputPortTypes[idx] }
  registerPortType(idx: number): PortType | undefined { return this._def.registerPortTypes[idx] }

  inputIndex(name: string): number {
    const idx = this._def.inputNames.indexOf(name)
    if (idx === -1) throw new Error(`Unknown input '${name}' on instance '${this.name}'.`)
    return idx
  }

  outputIndex(name: string): number {
    const idx = this._def.outputNames.indexOf(name)
    if (idx === -1) throw new Error(`Unknown output '${name}' on instance '${this.name}'.`)
    return idx
  }
}
