/**
 * Golden FlatPlan round-trip: every frozen fixture must reproduce
 * byte-for-byte when its `tropical_program_2` input is loaded into a
 * session and re-compiled through `compileSession`. Protects the
 * resolved-IR pipeline from silent regressions.
 *
 * Audio equivalence between the legacy `flattenSession` and the
 * post-cutover `compileSession` is gated separately by
 * `compile_session_equiv.test.ts`; this file pins the
 * `tropical_plan_4` shape directly.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeSession, loadJSON } from './session.js'
import { loadStdlib } from './program.js'
import { compileSession } from './ir/compile_session'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '__fixtures__/flat_plan')

const fixtures = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

/** Goldens anchor what `compileSession` emits. */

describe('FlatPlan golden fixtures', () => {
  for (const file of fixtures) {
    test(file, () => {
      const { input, expected_plan } = JSON.parse(
        readFileSync(join(FIXTURE_DIR, file), 'utf-8'),
      ) as { input: { schema: string; [k: string]: unknown }; expected_plan: unknown }

      const session = makeSession()
      loadStdlib(session)
      loadJSON(input, session)
      const plan = compileSession(session)

      expect(JSON.stringify(plan)).toBe(JSON.stringify(expected_plan))
    })
  }
})
