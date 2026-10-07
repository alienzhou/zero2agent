import { describe, expect, it } from 'vitest'
import { Session } from '../session.js'
import { validateSessionSnapshot, type SessionSnapshot } from '../session-snapshot.js'

const fixture = (): SessionSnapshot => ({
  messages: [
    { role: 'user', content: 'remember the result' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'one', name: 'read_file', input: { path: 'a' } }],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'evidence' }] },
    { role: 'assistant', content: 'done' },
  ],
  context: { through: 3, summary: 'read a: evidence' },
})
describe('durable session snapshots', () => {
  it('restores adopted summary and detached raw history without executing tools', () => {
    const session = new Session()
    const input = fixture()
    session.restore(input)
    expect(session.getContext()[0].content).toContain('read a: evidence')
    expect(session.getContext()).toContainEqual({ role: 'user', content: 'remember the result' })
    expect(session.snapshot()).toEqual(input)
    input.messages.length = 0
    session.snapshot().messages.length = 0
    expect(session.getHistory()).toHaveLength(4)
  })
  it.each([
    (s: SessionSnapshot) => {
      s.context.through = 2
    },
    (s: SessionSnapshot) => {
      s.context.through = 7
    },
    (s: SessionSnapshot) => {
      s.context.summary = ''
    },
    (s: SessionSnapshot) => {
      s.messages.splice(2, 1)
    },
    (s: SessionSnapshot) => {
      s.messages[2] = {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'wrong', content: 'x' }],
      }
    },
  ])('rejects damaged history atomically', mutate => {
    const session = new Session()
    session.restore(fixture())
    const before = session.snapshot()
    const invalid = fixture()
    mutate(invalid)
    expect(() => session.restore(invalid)).toThrow('Invalid session')
    expect(session.snapshot()).toEqual(before)
  })
  it('rejects restore and snapshot while a turn is running', async () => {
    const session = new Session()
    let finish!: () => void
    const wait = new Promise<void>(resolve => {
      finish = resolve
    })
    const run = session.runTurn('wait', async () => {
      await wait
      return 'done'
    })
    expect(() => session.restore(fixture())).toThrow('already running')
    expect(() => session.snapshot()).toThrow('already running')
    finish()
    await run
  })
  it('accepts reused tool IDs after their preceding turn was fully paired', () => {
    const s = fixture()
    s.messages.push(...fixture().messages)
    expect(validateSessionSnapshot(s).messages).toHaveLength(8)
  })
})
