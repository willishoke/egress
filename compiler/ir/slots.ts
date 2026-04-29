/**
 * compiler/ir/slots.ts — slot-table allocation for resolved programs.
 *
 * Phase D introduces a single owner of the decl-identity → slot-integer
 * mapping that the C++ engine consumes. Both `loadProgramDefFromResolved`
 * (legacy emit boundary) and `compileResolved` (new emit boundary) call
 * `buildSlotMaps` to allocate slots in the same order, so the emitted
 * `tropical_plan_4` is byte-equal across the two paths.
 *
 * Slot order (legacy convention preserved through D2 — the
 * "legacy-mimicking sort" referenced in PHASE_D_PLAN §2.3):
 *   inputs:    in port-declaration order
 *   regs:      in body-decl order
 *   delays:    in body-decl order
 *   instances: in body-decl order  (pre-`inlineInstances` only; post-
 *              strata there are zero `instanceDecl` body entries)
 *
 * No name parsing: the maps key on decl object identity. `_liftedFrom`
 * sorting (the §2.3 backward-compat tag) is deferred to a follow-up;
 * post-`inlineInstances`, the body decls are already in the legacy
 * convention order, so a clean linear scan reproduces it.
 */

import type {
  ResolvedProgram, RegDecl, DelayDecl, InstanceDecl, InputDecl,
} from './nodes.js'

export interface Slots {
  inputs:    Map<InputDecl, number>
  regs:      Map<RegDecl, number>
  delays:    Map<DelayDecl, number>
  instances: Map<InstanceDecl, number>
}

/** Allocate slot indices for every decl in `prog`. Returns the slot
 *  maps plus the parallel arrays of decls (caller-friendly: indexed
 *  iteration is the common consumption pattern). */
export interface SlotMaps extends Slots {
  inputDecls:    InputDecl[]
  regDecls:      RegDecl[]
  delayDecls:    DelayDecl[]
  instanceDecls: InstanceDecl[]
}

export function buildSlotMaps(prog: ResolvedProgram): SlotMaps {
  const slots: Slots = {
    inputs:    new Map(),
    regs:      new Map(),
    delays:    new Map(),
    instances: new Map(),
  }

  const inputDecls    = prog.ports.inputs.slice()
  inputDecls.forEach((d, i) => slots.inputs.set(d, i))

  const regDecls:      RegDecl[]      = []
  const delayDecls:    DelayDecl[]    = []
  const instanceDecls: InstanceDecl[] = []

  for (const decl of prog.body.decls) {
    switch (decl.op) {
      case 'regDecl':
        slots.regs.set(decl, regDecls.length)
        regDecls.push(decl)
        break
      case 'delayDecl':
        slots.delays.set(decl, delayDecls.length)
        delayDecls.push(decl)
        break
      case 'instanceDecl':
        slots.instances.set(decl, instanceDecls.length)
        instanceDecls.push(decl)
        break
      case 'paramDecl':   /* session-scoped; not part of slot allocation */ break
      case 'programDecl': /* type-decl only; nothing runtime-shaped */ break
    }
  }

  return { ...slots, inputDecls, regDecls, delayDecls, instanceDecls }
}
