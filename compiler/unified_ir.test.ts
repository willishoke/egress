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

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '__fixtures__/flat_plan')

const fixtures = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

/** Phase C8: goldens regenerated against the new pipeline (the post-flip
 *  default). Four fixtures — stdlib_delay, stdlib_ladder, stdlib_phaser,
 *  stdlib_sequencer — previously diverged structurally because they use
 *  instances and the new pipeline inlines earlier, producing a different
 *  (but semantically equivalent) slot layout. Since the legacy path is
 *  scheduled for deletion in C9, the goldens now anchor what production
 *  emits.
 *
 *  Running the suite under TROPICAL_USE_NEW_PIPELINE=0 (the legacy
 *  parachute) will fail those four assertions — that's expected, the
 *  goldens are no longer the legacy shape. The dual-run byte-equality
 *  gate in `phase_c_equiv.test.ts` continues to track structural
 *  divergence between the two paths until C9. */

describe('FlatPlan golden fixtures', () => {
  for (const file of fixtures) {
    test(file, () => {
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
