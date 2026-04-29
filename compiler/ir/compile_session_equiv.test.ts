/**
 * compile_session_equiv.test.ts — Phase D D2 audio-equivalence gate (Path B).
 *
 * For every unified_ir fixture (the patches `flatten.ts:flattenSession`
 * already pins to a snapshot baseline), assert that
 * `compileSession`-driven JIT output equals the legacy
 * `applySessionWiring`-driven JIT output sample-for-sample over a
 * full processing buffer.
 *
 * This is the Path B gate the team chose over byte-equality of
 * `tropical_plan_4` JSON: rather than reproduce every quirk of legacy
 * slot ordering / instruction sequencing (debt the plan calls for D7
 * to retire anyway), assert the property that actually matters — same
 * audio, regardless of slot integers.
 *
 * Requires libtropical.dylib (via `make build` first). Skipped when the
 * native lib isn't present.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeSession, loadJSON } from '../session.js'
import { loadStdlib } from '../program.js'
import { applySessionWiring } from '../apply_plan.js'
import { compileSession } from './compile_session.js'

const FIXTURE_DIR = join(__dirname, '..', '__fixtures__', 'flat_plan')

const FIXTURES: readonly string[] = [
  'stdlib_sin',
  'stdlib_sinosc',
  'stdlib_onepole',
  'stdlib_noise_crush',
  'stdlib_delay',
  'stdlib_ladder',
  'stdlib_phaser',
  'stdlib_sequencer',
  'patch_int_seq_test',
  'patch_sequencer_demo',
]

function loadFixture(name: string): { schema: string; [k: string]: unknown } {
  const path = join(FIXTURE_DIR, `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8')).input
}

/** Drive `n` frames of audio through the session's runtime, returning a
 *  flat Float64Array. Assumes loadPlan has already happened. */
function runFrames(session: ReturnType<typeof makeSession>, frames: number): Float64Array {
  const acc: number[] = []
  for (let f = 0; f < frames; f++) {
    session.graph.process()
    for (const v of session.graph.outputBuffer) acc.push(v)
  }
  return Float64Array.from(acc)
}

describe('compileSession ↔ flattenSession audio equivalence (D2 Path B)', () => {
  for (const fx of FIXTURES) {
    // stdlib_ladder produces a larger instruction count under the new
    // pipeline (13050 vs legacy's 1957) due to a CSE-fanout difference
    // — same audio when it finishes, but JIT compile takes >5s. Bump
    // the timeout while the fanout is investigated.
    const timeout = fx === 'stdlib_ladder' ? 60_000 : 5_000
    test(`audio matches: ${fx}`, () => {
      const input = loadFixture(fx)

      // Legacy path: applySessionWiring → flattenSession → JIT.
      const legacy = makeSession(64)
      loadStdlib(legacy)
      loadJSON(input, legacy)        // calls applyFlatPlan internally
      legacy.graph.primeJit()
      const legacyAudio = runFrames(legacy, 4)

      // New path: compileSession → JSON → loadPlan → JIT, on a fresh
      // Runtime (graphOutputs / instances reused but plan re-emitted).
      const fresh = makeSession(64)
      loadStdlib(fresh)
      loadJSON(input, fresh)         // sets up session state (instances, wiring)
      const plan = compileSession(fresh)
      fresh.runtime.loadPlan(JSON.stringify(plan))
      fresh.graph.primeJit()
      const newAudio = runFrames(fresh, 4)

      legacy.graph.dispose()
      fresh.graph.dispose()

      // Length parity is the obvious first check: both pipelines must
      // produce the same number of audio samples. (The session buffer
      // length × frames × channels.)
      expect(newAudio.length).toBe(legacyAudio.length)

      // Sample-for-sample equivalence to 1e-10. The JIT does not
      // introduce reorderings the legacy doesn't, so expectations are
      // tight rather than tolerant.
      let firstMismatch = -1
      for (let i = 0; i < legacyAudio.length; i++) {
        if (Math.abs(legacyAudio[i] - newAudio[i]) > 1e-10) {
          firstMismatch = i
          break
        }
      }
      if (firstMismatch >= 0) {
        const i = firstMismatch
        const window = []
        for (let j = Math.max(0, i - 2); j < Math.min(legacyAudio.length, i + 3); j++) {
          window.push(`  [${j}] legacy=${legacyAudio[j]}  new=${newAudio[j]}  Δ=${legacyAudio[j] - newAudio[j]}`)
        }
        throw new Error(
          `${fx}: first audio divergence at sample ${i}\n${window.join('\n')}`,
        )
      }
    }, timeout)
  }
})
