import type { Puzzle, RunReport, RunStatus, TraceEntry, WorkflowBlock } from './types'

const timestamp = (n: number) => `10:${String(n).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}`
const entry = (block: WorkflowBlock, index: number, status: RunStatus, output: string, recovery?: string): TraceEntry => ({
  id: `${block.id}-${index}-${status}`,
  blockId: block.id,
  name: block.label,
  type: block.kind,
  status,
  input: block.config || block.detail,
  output,
  recovery,
  timestamp: timestamp(index + 1),
})

const scoreFor = (status: RunStatus, safeguards: number, unresolved: boolean) => {
  if (status === 'stopped') return 90
  if (status === 'review') return unresolved ? 52 : 86
  if (unresolved) return 42
  return Math.min(100, 82 + safeguards * 6)
}

/** Runs a deterministic, sequential workflow. A failure gates normal steps until one explicit retry, fallback, or safe-stop handles it. */
export function executeWorkflow(puzzle: Puzzle, blocks: WorkflowBlock[]): RunReport {
  if (!blocks.length) return { traces: [], status: 'stopped', score: 92, retries: 0, safeguards: 1, message: 'Safe stop: the path is empty, so nothing was run.' }

  const traces: TraceEntry[] = []
  let pendingFailure = false
  let failureHandled = false
  let stopped = false
  let reviewPending = false
  let retries = 0
  let safeguards = 0

  blocks.forEach((block, index) => {
    const matchesFailure = block.id === puzzle.failureRule.blockId && block.kind === puzzle.failureRule.kind && block.config === puzzle.failureRule.config
    if (stopped || reviewPending) {
      traces.push(entry(block, index, 'queued', stopped ? 'Not run: workflow safely stopped.' : 'Not run: waiting for human review.'))
      return
    }
    if (pendingFailure) {
      if (block.kind === 'retry' && !failureHandled) {
        const match = block.config.match(/max:\s*(\d+)/)
        const maxAttempts = match ? Math.max(1, Number(match[1])) : 1
        failureHandled = true
        pendingFailure = false
        safeguards += 1
        retries += 1
        traces.push(entry(block, index, 'retry', `Attempt 2 of ${maxAttempts} succeeded with the same stable input.`, 'Retry resumed the path.'))
        return
      }
      if (block.kind === 'fallback' && !failureHandled) {
        failureHandled = true
        pendingFailure = false
        safeguards += 1
        retries += 1
        traces.push(entry(block, index, 'fallback', 'Recovery path prepared a conservative retry.', 'Recovery contained the issue.'))
        traces.push(entry(block, index + 100, 'retry', 'Retry succeeded using the fallback output.', 'Resumed after one retry.'))
        return
      }
      if (block.kind === 'safeStop') {
        stopped = true
        safeguards += 1
        traces.push(entry(block, index, 'stopped', 'Stopped without guessing. Suggested a safe handoff.', 'Safe stop protected the user.'))
        return
      }
      traces.push(entry(block, index, 'queued', 'Blocked until a fallback or safe-stop handles the issue.'))
      return
    }
    if (matchesFailure && !failureHandled) {
      pendingFailure = true
      traces.push(entry(block, index, 'failed', puzzle.failureRule.message))
      return
    }
    if (block.kind === 'review') {
      reviewPending = true
      traces.push(entry(block, index, 'review', 'Waiting for a human decision.'))
      return
    }
    if (block.kind === 'safeStop') {
      traces.push(entry(block, index, 'success', 'Guardrail armed; no stop needed.'))
      return
    }
    if (block.kind === 'fallback') {
      traces.push(entry(block, index, 'success', 'Fallback is ready if needed.'))
      return
    }
    if (block.kind === 'retry') {
      traces.push(entry(block, index, 'success', 'Retry is armed for the next pending failure.'))
      return
    }
    const outputs: Partial<Record<WorkflowBlock['kind'], string>> = {
      input: 'Captured a structured, deterministic input packet.',
      retrieval: 'Retrieved grounded mock context with source IDs.',
      condition: 'Condition evaluated deterministically: safe branch selected.',
      transform: 'Transformed allowed fields into a safe working format.',
      output: 'Presented the final grounded result to the learner.',
      tool: 'Mock tool returned grounded sample data.',
      validate: 'Validation checks passed.',
      prompt: 'Mock AI created a concise, evidence-aware draft.',
    }
    const output = outputs[block.kind] ?? 'Step completed safely.'
    traces.push(entry(block, index, 'success', output))
  })

  const unresolved = pendingFailure
  const status: RunStatus = stopped ? 'stopped' : reviewPending ? 'review' : unresolved ? 'failed' : 'success'
  const message = stopped ? 'Safe stop complete — nothing was invented.' : reviewPending ? (unresolved ? 'A human review is waiting, but the unresolved issue still blocks completion.' : 'A human decision will complete this run.') : unresolved ? 'Issue unresolved: add a fallback or safe stop after the failure.' : 'Workflow completed with grounded output.'
  return { traces, status, score: scoreFor(status, safeguards, unresolved), retries, safeguards, message }
}

export function completeReview(report: RunReport, decision: 'approved' | 'edited' | 'rejected', note = ''): RunReport {
  const traces = report.traces.map((item) => item.status === 'review' ? {
    ...item,
    status: decision === 'rejected' ? 'stopped' as const : 'success' as const,
    output: decision === 'edited' ? `Approved after edit: ${note || 'copy tightened'}` : `Human ${decision} this step.`,
  } : item)
  const unresolved = traces.some((item) => item.status === 'failed') && !traces.some((item) => item.status === 'fallback' || item.status === 'stopped')
  const status: RunStatus = decision === 'rejected' ? 'stopped' : unresolved ? 'failed' : 'success'
  const safeguards = report.safeguards + (decision === 'rejected' ? 1 : 0)
  return { ...report, traces, status, safeguards, score: scoreFor(status, safeguards, unresolved), message: decision === 'rejected' ? 'Human reviewer rejected the draft. Run ended safely.' : unresolved ? 'Review recorded, but an unresolved issue still blocks completion.' : `Human reviewer ${decision} the draft. Workflow complete.` }
}
