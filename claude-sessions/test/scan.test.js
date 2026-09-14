import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { scanSessions } from '../src/scan.js'
import { formatSize, formatTable } from '../src/format.js'

const root = await mkdtemp(join(tmpdir(), 'claude-sessions-test-'))
after(() => rm(root, { recursive: true, force: true }))

function jsonl(...records) {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`
}

async function fixture(name, projects) {
  const dir = join(root, name)
  for (const [project, files] of Object.entries(projects)) {
    await mkdir(join(dir, project), { recursive: true })
    for (const [file, contents] of Object.entries(files)) {
      await writeFile(join(dir, project, file), contents)
    }
  }
  return dir
}

const user = (timestamp, content, extra = {}) => ({
  type: 'user',
  timestamp,
  cwd: '/Users/me/app',
  message: { role: 'user', content },
  ...extra,
})

const assistantBlock = (timestamp, requestId, blockType) => ({
  type: 'assistant',
  timestamp,
  requestId,
  cwd: '/Users/me/app',
  message: { role: 'assistant', content: [{ type: blockType }] },
})

test('counts prompts and groups assistant blocks into one turn each', async () => {
  const dir = await fixture('turns', {
    '-Users-me-app': {
      'a.jsonl': jsonl(
        { type: 'queue-operation', timestamp: '2026-09-01T10:00:00.000Z' },
        user('2026-09-01T10:00:01.000Z', 'hello'),
        assistantBlock('2026-09-01T10:00:02.000Z', 'req_1', 'thinking'),
        assistantBlock('2026-09-01T10:00:03.000Z', 'req_1', 'tool_use'),
        user('2026-09-01T10:00:04.000Z', [{ type: 'tool_result' }], { toolUseResult: {} }),
        assistantBlock('2026-09-01T10:00:05.000Z', 'req_2', 'text'),
        user('2026-09-01T10:00:06.000Z', [{ type: 'text', text: 'thanks' }]),
        assistantBlock('2026-09-01T10:00:07.000Z', 'req_3', 'text'),
      ),
    },
  })

  const [session] = await scanSessions(dir)
  // 2 prompts + 3 assistant replies; tool result and queue records are not turns.
  assert.equal(session.turns, 5)
  assert.equal(session.project, 'app')
  assert.equal(session.sessionId, 'a')
  assert.equal(session.date.toISOString(), '2026-09-01T10:00:00.000Z')
})

test('ignores synthetic prompts, sidechains and unparsable lines', async () => {
  const dir = await fixture('noise', {
    '-Users-me-app': {
      'a.jsonl':
        jsonl(
          user('2026-09-01T10:00:00.000Z', 'real prompt'),
          user('2026-09-01T10:00:01.000Z', 'injected reminder', { isMeta: true }),
          user('2026-09-01T10:00:02.000Z', 'subagent prompt', { isSidechain: true }),
          assistantBlock('2026-09-01T10:00:03.000Z', 'req_sub', 'text'),
        ) + '{"type":"user", truncated\n',
    },
  })

  const [session] = await scanSessions(dir)
  assert.equal(session.turns, 2)
})

test('ignores notifications, interrupts and slash-command expansions', async () => {
  const dir = await fixture('synthetic', {
    '-Users-me-app': {
      'a.jsonl': jsonl(
        user('2026-09-01T10:00:00.000Z', 'real prompt', { origin: { kind: 'human' } }),
        user('2026-09-01T10:00:01.000Z', '<task-notification>agent done</task-notification>', {
          origin: { kind: 'task-notification' },
        }),
        user('2026-09-01T10:00:02.000Z', '[Request interrupted by user]'),
        user('2026-09-01T10:00:03.000Z', '<command-name>/review</command-name>'),
        user('2026-09-01T10:00:04.000Z', '<system-reminder>be good</system-reminder>'),
        user('2026-09-01T10:00:05.000Z', '   '),
        user('2026-09-01T10:00:06.000Z', 'summary of earlier work', { isCompactSummary: true }),
      ),
    },
  })

  const [session] = await scanSessions(dir)
  assert.equal(session.turns, 1)
})

test('counts a typed prompt that arrives alongside a system reminder', async () => {
  const dir = await fixture('reminder', {
    '-Users-me-app': {
      'a.jsonl': jsonl(
        user('2026-09-01T10:00:00.000Z', [
          { type: 'text', text: '<system-reminder>context</system-reminder>' },
          { type: 'text', text: 'ship it' },
        ]),
      ),
    },
  })

  const [session] = await scanSessions(dir)
  assert.equal(session.turns, 1)
})

test('reports the project root even when the session cds into subdirectories', async () => {
  const dir = await fixture('cwd', {
    '-Users-me-app': {
      'a.jsonl': jsonl(
        { type: 'user', timestamp: '2026-09-01T10:00:00.000Z', cwd: '/Users/me/app/packages/db' },
        { type: 'user', timestamp: '2026-09-01T10:00:01.000Z', cwd: '/Users/me/app' },
      ),
    },
  })

  const [session] = await scanSessions(dir)
  assert.equal(session.project, 'app')
  assert.equal(session.projectPath, '/Users/me/app')
})

test('lists one row per session, newest first, skipping non-transcripts', async () => {
  const dir = await fixture('many', {
    '-Users-me-app': {
      'old.jsonl': jsonl(user('2026-09-01T10:00:00.000Z', 'hi')),
      'new.jsonl': jsonl(user('2026-09-03T10:00:00.000Z', 'hi')),
      'old.desktop-released.json': '{}',
    },
    '-Users-me-other': {
      'mid.jsonl': jsonl(user('2026-09-02T10:00:00.000Z', 'hi')),
    },
  })

  const sessions = await scanSessions(dir)
  assert.deepEqual(
    sessions.map((s) => s.sessionId),
    ['new', 'mid', 'old'],
  )
  assert.equal(formatTable(sessions).split('\n').length, 3)
})

test('nested subagent transcripts are not sessions', async () => {
  const dir = await fixture('nested', {
    '-Users-me-app': { 'a.jsonl': jsonl(user('2026-09-01T10:00:00.000Z', 'hi')) },
    '-Users-me-app/a/subagents': { 'agent-1.jsonl': jsonl(user('2026-09-01T10:00:01.000Z', 'hi')) },
  })

  const sessions = await scanSessions(dir)
  assert.deepEqual(
    sessions.map((s) => s.sessionId),
    ['a'],
  )
})

test('falls back to the dir name and file mtime for an empty transcript', async () => {
  const dir = await fixture('empty', { '-Users-me-app': { 'a.jsonl': '' } })

  const [session] = await scanSessions(dir)
  assert.equal(session.project, '-Users-me-app')
  assert.equal(session.turns, 0)
  assert.ok(session.date instanceof Date && !Number.isNaN(session.date.getTime()))
})

test('missing transcripts directory is an error, not an empty list', async () => {
  await assert.rejects(() => scanSessions(join(root, 'nope')), /no transcripts directory/)
})

test('formatSize scales units', () => {
  assert.equal(formatSize(0), '0 B')
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(1536), '1.5 KB')
  assert.equal(formatSize(9_750_000), '9.3 MB')
})
