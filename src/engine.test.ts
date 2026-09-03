import { describe, expect, it } from 'vitest'
import { executeWorkflow } from './engine'
import { puzzles } from './puzzles'

const puzzle = (id: string) => puzzles.find((item) => item.id === id)!

describe('deterministic workflow engine', () => {
  it('safe-stops an empty path', () => {
    const report = executeWorkflow(puzzle('support'), [])
    expect(report.status).toBe('stopped')
    expect(report.score).toBeGreaterThan(80)
    expect(report.traces).toEqual([])
  })

  it('blocks normal downstream steps after an unresolved failure', () => {
    const source = puzzle('support')
    const blocks = source.starter.filter((block) => block.kind !== 'fallback')
    const report = executeWorkflow(source, blocks)
    expect(report.status).toBe('failed')
    expect(report.message).toContain('unresolved')
    expect(report.traces.find((item) => item.type === 'review')?.status).toBe('queued')
    expect(report.traces.some((item) => item.status === 'success' && item.name === 'Send for approval')).toBe(false)
  })

  it('uses one fallback and records a successful retry', () => {
    const report = executeWorkflow(puzzle('support'), puzzle('support').starter)
    expect(report.retries).toBe(1)
    expect(report.traces.filter((item) => item.status === 'fallback')).toHaveLength(1)
    expect(report.traces.filter((item) => item.status === 'retry')).toHaveLength(1)
    expect(report.status).toBe('review')
  })

  it('stops safely when a failure reaches a safe stop', () => {
    const report = executeWorkflow(puzzle('safety'), puzzle('safety').starter)
    expect(report.status).toBe('stopped')
    expect(report.score).toBeGreaterThanOrEqual(90)
    expect(report.traces.some((item) => item.status === 'stopped')).toBe(true)
  })

  it('uses explicit Retry with a bounded max-attempt configuration', () => {
    const report = executeWorkflow(puzzle('invoice'), puzzle('invoice').starter)
    const retry = report.traces.find((item) => item.type === 'retry')
    expect(report.status).toBe('review')
    expect(retry?.status).toBe('retry')
    expect(retry?.output).toContain('Attempt 2 of 2')
    expect(report.retries).toBe(1)
  })

  it('runs core input, retrieval, condition, transform, and output blocks deterministically', () => {
    const museum = executeWorkflow(puzzle('museum'), puzzle('museum').starter.slice(0, 4))
    expect(museum.traces.map((item) => item.type)).toEqual(['input', 'prompt', 'retrieval', 'tool'])
    expect(museum.traces.every((item) => item.status === 'success')).toBe(true)
    const recipe = executeWorkflow(puzzle('recipe'), puzzle('recipe').starter.slice(0, 3))
    expect(recipe.traces.some((item) => item.type === 'condition' && item.output.includes('Condition evaluated'))).toBe(true)
    const data = executeWorkflow(puzzle('data'), puzzle('data').starter.slice(0, 3))
    expect(data.traces.some((item) => item.type === 'transform' && item.output.includes('Transformed'))).toBe(true)
    const outputOnly = executeWorkflow(puzzle('recipe'), [puzzle('recipe').starter.at(-1)!])
    expect(outputOnly.traces[0].output).toContain('Presented the final')
  })

  it('only lets the first fallback handle a failure', () => {
    const source = puzzle('support')
    const duplicate = { ...source.starter[2], id: 'extra-fallback' }
    const report = executeWorkflow(source, [...source.starter.slice(0, 3), duplicate, source.starter[3]])
    expect(report.traces.filter((item) => item.status === 'fallback')).toHaveLength(1)
    expect(report.traces.filter((item) => item.status === 'retry')).toHaveLength(1)
  })
})
