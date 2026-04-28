/**
 * Golden FlatPlan round-trip: every frozen fixture must reproduce byte-for-byte
 * when its tropical_program_2 input is loaded into a session and re-flattened.
 * Protects the compile pipeline from silent regressions.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeSession, loadJSON } from './session.js'
import { loadStdlib } from './program.js'
import { flattenSession } from './flatten.js'
import { useNewPipeline } from './feature_flags.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '__fixtures__/flat_plan')

const fixtures = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

/** Phase C7: golden FlatPlans were captured against the legacy pipeline.
 *  Instance-using fixtures slot-reorder under the new pipeline (the
 *  tropical_plan_4 byte-equality dual-run gate documents this in
 *  `phase_c_equiv.test.ts`). When the flag is on, only fixtures whose
 *  flat layout aligns under both pipelines participate. The flag-off
 *  default keeps every fixture green. */
const FLAG_ON_DIVERGENT = new Set([
  'stdlib_delay.json',
  'stdlib_ladder.json',
  'stdlib_phaser.json',
  'stdlib_sequencer.json',
])

describe('FlatPlan golden fixtures', () => {
  for (const file of fixtures) {
    test(file, () => {
      if (useNewPipeline() && FLAG_ON_DIVERGENT.has(file)) {
        // Documented divergence — the new pipeline inlines instances
        // earlier and produces a different (but semantically equivalent)
        // slot layout. The dual-run gate in phase_c_equiv.test.ts
        // tracks the structural divergence; this golden fixture was
        // frozen for the legacy slot order.
        return
      }
      const { input, expected_plan } = JSON.parse(
        readFileSync(join(FIXTURE_DIR, file), 'utf-8'),
      ) as { input: { schema: string; [k: string]: unknown }; expected_plan: unknown }

      const session = makeSession()
      loadStdlib(session)
      loadJSON(input, session)
      const plan = flattenSession(session)

      expect(JSON.stringify(plan)).toBe(JSON.stringify(expected_plan))
    })
  }
})
