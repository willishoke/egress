/**
 * Regression tests originally written for two flatten.ts bugs in
 * bubble-synth:
 *
 *   Bug 1: Outer program's delay_ref inside a nested instance's input
 *          wiring survived as unresolved delay_value(node_id).
 *   Bug 2: Wrapping a stateful stdlib program in program_decl produced
 *          wrong output (zero or unbounded amplification).
 *
 * Post-D2-cutover, both shapes go through the strata pipeline +
 * `compileSession`. The leak-detection assertion is structurally
 * impossible to fail (inlineInstances + buildSlotMaps would refuse to
 * produce a delayRef whose decl isn't in the body), so we drop it.
 * The audio-equivalence assertions (wrapped == bare) survive — they
 * stay relevant whatever the pipeline.
 */

import { describe, test, expect } from 'bun:test'
import { makeSession, loadJSON } from './session'
import { loadStdlib } from './program'
import { interpretSession } from './interpret_resolved'
import type { ProgramFile } from './program'

describe('flatten regression — wrapping stateful stdlib programs in program_decl', () => {
  test('Wrap(OnePole) matches unwrapped OnePole', () => {
    const impulse = { op: 'select', args: [{ op: 'eq', args: [{ op: 'sampleIndex' }, 10] }, 1, 0] }

    const wrapped = (() => {
      const session = makeSession(44100)
      loadStdlib(session)
      loadJSON({
        schema: 'tropical_program_2',
        name: 't',
        body: { op: 'block', decls: [
          { op: 'programDecl', name: 'Wrap', program: {
            op: 'program', name: 'Wrap',
            ports: {
              inputs: [{ name: 'x', type: 'signal', default: 0 }],
              outputs: [{ name: 'out', type: 'float' }],
            },
            body: { op: 'block', decls: [
              { op: 'instanceDecl', name: 'op', program: 'OnePole', inputs: {
                input: { op: 'input', name: 'x' }, g: 0.1,
              }},
            ], assigns: [
              { op: 'outputAssign', name: 'out', expr: { op: 'nestedOut', ref: 'op', output: 'out' } },
            ]},
          }},
          { op: 'instanceDecl', name: 'w', program: 'Wrap', inputs: { x: impulse } },
        ]},
        audio_outputs: [{ instance: 'w', output: 'out' }],
      } as ProgramFile, session)
      return interpretSession(session, 30)
    })()

    const bare = (() => {
      const session = makeSession(44100)
      loadStdlib(session)
      loadJSON({
        schema: 'tropical_program_2',
        name: 't',
        body: { op: 'block', decls: [
          { op: 'instanceDecl', name: 'op', program: 'OnePole', inputs: {
            input: impulse, g: 0.1,
          }},
        ]},
        audio_outputs: [{ instance: 'op', output: 'out' }],
      } as ProgramFile, session)
      return interpretSession(session, 30)
    })()

    for (let i = 0; i < 30; i++) {
      expect(wrapped[i]).toBeCloseTo(bare[i], 10)
    }
  })

  test('Wrap(LadderFilter) matches unwrapped LadderFilter', () => {
    const makeImpulsePatch = (useWrap: boolean): ProgramFile => {
      const impulse = { op: 'select', args: [{ op: 'eq', args: [{ op: 'sampleIndex' }, 10] }, 1, 0] }
      if (useWrap) {
        return {
          schema: 'tropical_program_2',
          name: 't',
          body: { op: 'block', decls: [
            { op: 'programDecl', name: 'Wrap', program: {
              op: 'program', name: 'Wrap',
              ports: {
                inputs: [{ name: 'x', type: 'signal', default: 0 }],
                outputs: [{ name: 'out', type: 'float' }],
              },
              body: { op: 'block', decls: [
                { op: 'instanceDecl', name: 'lf', program: 'LadderFilter', inputs: {
                  input: { op: 'input', name: 'x' }, cutoff: 800, resonance: 0.5, drive: 1,
                }},
              ], assigns: [
                { op: 'outputAssign', name: 'out', expr: { op: 'nestedOut', ref: 'lf', output: 'lp' } },
              ]},
            }},
            { op: 'instanceDecl', name: 'w', program: 'Wrap', inputs: { x: impulse } },
          ]},
          audio_outputs: [{ instance: 'w', output: 'out' }],
        } as ProgramFile
      }
      return {
        schema: 'tropical_program_2',
        name: 't',
        body: { op: 'block', decls: [
          { op: 'instanceDecl', name: 'lf', program: 'LadderFilter', inputs: {
            input: impulse, cutoff: 800, resonance: 0.5, drive: 1,
          }},
        ]},
        audio_outputs: [{ instance: 'lf', output: 'lp' }],
      } as ProgramFile
    }

    const sessionW = makeSession(44100); loadStdlib(sessionW); loadJSON(makeImpulsePatch(true), sessionW)
    const wrapped = interpretSession(sessionW, 60)

    const sessionB = makeSession(44100); loadStdlib(sessionB); loadJSON(makeImpulsePatch(false), sessionB)
    const bare = interpretSession(sessionB, 60)

    for (let i = 0; i < 60; i++) {
      expect(wrapped[i]).toBeCloseTo(bare[i], 10)
    }
  })

  test('Wrap(Bubble) matches unwrapped Bubble', () => {
    const impulse = { op: 'select', args: [{ op: 'eq', args: [{ op: 'sampleIndex' }, 100] }, 1, 0] }

    const wrapped = (() => {
      const session = makeSession(44100)
      loadStdlib(session)
      loadJSON({
        schema: 'tropical_program_2',
        name: 't',
        body: { op: 'block', decls: [
          { op: 'programDecl', name: 'Wrap', program: {
            op: 'program', name: 'Wrap',
            ports: {
              inputs: [{ name: 'trigger', type: 'signal', default: 0 }],
              outputs: [{ name: 'out', type: 'float' }],
            },
            body: { op: 'block', decls: [
              { op: 'instanceDecl', name: 'b', program: 'Bubble', inputs: {
                trigger: { op: 'input', name: 'trigger' },
                radius: 0.003, decay_scale: 12, amp_scale: 0.3,
              }},
            ], assigns: [
              { op: 'outputAssign', name: 'out', expr: { op: 'nestedOut', ref: 'b', output: 'out' } },
            ]},
          }},
          { op: 'instanceDecl', name: 'w', program: 'Wrap', inputs: { trigger: impulse } },
        ]},
        audio_outputs: [{ instance: 'w', output: 'out' }],
      } as ProgramFile, session)
      return interpretSession(session, 300)
    })()

    const bare = (() => {
      const session = makeSession(44100)
      loadStdlib(session)
      loadJSON({
        schema: 'tropical_program_2',
        name: 't',
        body: { op: 'block', decls: [
          { op: 'instanceDecl', name: 'b', program: 'Bubble', inputs: {
            trigger: impulse, radius: 0.003, decay_scale: 12, amp_scale: 0.3,
          }},
        ]},
        audio_outputs: [{ instance: 'b', output: 'out' }],
      } as ProgramFile, session)
      return interpretSession(session, 300)
    })()

    for (let i = 0; i < 300; i++) {
      expect(wrapped[i]).toBeCloseTo(bare[i], 10)
    }
  })
})
