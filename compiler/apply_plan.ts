/**
 * apply_plan.ts — Apply the compilation pipeline to a live session.
 *
 * Flow: SessionState → compileSession() → tropical_plan_4 JSON → runtime.loadPlan()
 *
 * The resolved-IR pipeline (`compile_session.ts`) is the production
 * runtime path; the legacy `flatten.ts` was retired in Phase D D3.
 */

import type { SessionState } from './session'
import { compileSession } from './ir/compile_session'
import type { Runtime } from './runtime/runtime'

/**
 * Compile the session's program graph through the resolved-IR pipeline
 * and push to a FlatRuntime. Call this after any mutation to
 * `inputExprNodes` or `graphOutputs`.
 */
export function applyFlatPlan(session: SessionState, runtime: Runtime): void {
  const plan = compileSession(session)
  const json = JSON.stringify(plan)
  runtime.loadPlan(json)
}

export function applySessionWiring(session: SessionState): void {
  applyFlatPlan(session, session.runtime)
}
