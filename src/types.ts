export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced'

export type BlockKind = 'input' | 'retrieval' | 'condition' | 'transform' | 'retry' | 'output' | 'prompt' | 'tool' | 'validate' | 'fallback' | 'review' | 'safeStop'

export type RunStatus = 'idle' | 'queued' | 'running' | 'success' | 'retry' | 'fallback' | 'review' | 'failed' | 'stopped'

export interface WorkflowBlock {
  id: string
  kind: BlockKind
  label: string
  detail: string
  config: string
}

export interface FailureRule {
  blockId: string
  kind: BlockKind
  config: string
  message: string
}

export interface Puzzle {
  id: string
  number: number
  title: string
  difficulty: Difficulty
  emoji: string
  color: string
  brief: string
  objective: string
  hint: string
  goal: string
  starter: WorkflowBlock[]
  failureRule: FailureRule
}

export interface TraceEntry {
  id: string
  blockId: string
  name: string
  type: BlockKind
  status: RunStatus
  input: string
  output: string
  recovery?: string
  timestamp: string
}

export interface RunReport {
  traces: TraceEntry[]
  status: RunStatus
  score: number
  retries: number
  safeguards: number
  message: string
}
