import { describe, expect, it } from 'vitest'
import { renderAgentOutput } from '@yeisme/muweave-bundle'

describe('muweave bundle --agent rendering', () => {
  it('renders the stable preamble and flattens nested data without JSON containers', () => {
    const output = renderAgentOutput(
      {
        ok: true,
        project: { id: 'project:demo', owner: { name: 'MuWeave' } },
        candidates: [
          { artifact_id: 'artifact:one', title: 'One' },
          { artifact_id: 'artifact:two', title: 'Two' },
        ],
        body: 'x'.repeat(200),
      },
      'muweave-bundle.inspect',
    )
    const lines = output.trimEnd().split('\n')

    expect(lines.slice(0, 4)).toEqual([
      'spec_version=1.0',
      'mode=agent',
      'command=muweave-bundle.inspect',
      'status=success',
    ])
    expect(lines).toContain('fact.project.owner.name=MuWeave')
    expect(lines).toContain('fact.candidates_count=2')
    expect(lines).toContain('fact.candidates=artifact:one,artifact:two')
    expect(lines).toContain('fact.body_length=200')
    expect(lines.every((line: string) => !line.includes('{') && !line.includes('['))).toBe(true)
    expect(output).not.toContain('x'.repeat(200))
  })

  it('uses a stable reference for long text when a payload id exists', () => {
    const output = renderAgentOutput(
      { id: 'note:001', content: 'long body'.repeat(25) },
      'muweave-bundle.inspect',
    )

    expect(output).toContain('fact.content_ref=text:note:001')
    expect(output).not.toContain('long body'.repeat(25))
    expect(output).not.toContain('{')
    expect(output).not.toContain('[')
  })
})
