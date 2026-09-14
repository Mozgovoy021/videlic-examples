import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'

export const DEFAULT_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

// Enough parallelism to keep the disk busy without opening hundreds of streams.
const READ_CONCURRENCY = 8

/**
 * Find every session transcript under `projectsDir` and summarize it.
 *
 * Layout: <projectsDir>/<mangled-project-path>/<session-uuid>.jsonl
 * Anything deeper (subagent and workflow transcripts) belongs to a session
 * rather than being one, so only the top level of each project dir is read.
 */
export async function scanSessions(projectsDir = DEFAULT_PROJECTS_DIR, { onWarning } = {}) {
  const warn = onWarning ?? (() => {})
  const files = await findTranscripts(projectsDir, warn)

  const sessions = []
  await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
    try {
      sessions.push(await summarizeSession(file))
    } catch (err) {
      warn(`skipping ${file.path}: ${err.message}`)
    }
  })

  // Newest first, the order you usually want when asking "what did I work on?".
  sessions.sort((a, b) => b.date - a.date)
  return sessions
}

async function findTranscripts(projectsDir, warn) {
  let projectDirs
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`no transcripts directory at ${projectsDir}`)
    throw err
  }

  const files = []
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue
    const dir = join(projectsDir, projectDir.name)

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      warn(`skipping ${dir}: ${err.message}`)
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      files.push({
        path: join(dir, entry.name),
        sessionId: entry.name.slice(0, -'.jsonl'.length),
        dirName: projectDir.name,
      })
    }
  }
  return files
}

async function summarizeSession(file) {
  const { size, mtime } = await stat(file.path)
  const parsed = await readTranscript(file.path)

  return {
    sessionId: file.sessionId,
    // A transcript with no timestamped records still has a file date to report.
    date: parsed.startedAt ?? mtime,
    endedAt: parsed.endedAt ?? mtime,
    project: parsed.cwd ? basename(parsed.cwd) : file.dirName,
    projectPath: parsed.cwd ?? null,
    turns: parsed.prompts + parsed.responses,
    bytes: size,
    path: file.path,
  }
}

/**
 * Stream one transcript, collecting only what a listing needs.
 *
 * A "turn" is one conversational message: a prompt you typed, or one assistant
 * reply. Assistant replies arrive as several records (thinking, text, each tool
 * call), all sharing a requestId, so they are grouped back into one turn.
 * Tool results are recorded as user messages but nobody typed them, so they
 * are not prompts. Sidechain records belong to subagents, not the conversation.
 */
async function readTranscript(path) {
  let startedAt = null
  let endedAt = null
  let cwd = null
  let prompts = 0
  const responses = new Set()

  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    if (!line.trim()) continue

    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue // A partially flushed last line shouldn't sink the whole session.
    }
    if (!record || typeof record !== 'object' || record.isSidechain) continue

    const at = parseDate(record.timestamp)
    if (at) {
      if (!startedAt || at < startedAt) startedAt = at
      if (!endedAt || at > endedAt) endedAt = at
    }
    if (typeof record.cwd === 'string' && isCloserToRoot(record.cwd, cwd)) cwd = record.cwd

    if (record.type === 'user' && isTypedPrompt(record)) prompts++
    else if (record.type === 'assistant') responses.add(record.requestId ?? record.uuid ?? prompts)
  }

  return { startedAt, endedAt, cwd, prompts, responses: responses.size }
}

// The user role carries a lot besides what you typed: tool results, compaction
// summaries, task notifications, interruption markers and the expansion of
// slash commands. In local transcripts these account for a fifth of all user
// records, so a naive count overstates the conversation noticeably.
const SYNTHETIC_PREFIXES = [
  '[Request interrupted',
  '<command-name>',
  '<command-message>',
  '<local-command',
  '<task-notification>',
]

function isTypedPrompt(record) {
  if (record.isMeta || record.isCompactSummary || 'toolUseResult' in record) return false
  // Newer transcripts label the source outright; older ones omit it, so a
  // missing origin has to stay eligible.
  if (record.origin?.kind && record.origin.kind !== 'human') return false

  const text = promptText(record)
  if (text === null) return false

  const stripped = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (!stripped) return false
  return !SYNTHETIC_PREFIXES.some((prefix) => stripped.startsWith(prefix))
}

/** The typed text of a user record, or null if it isn't a message at all. */
function promptText(record) {
  const content = record.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  // Anything carrying a tool_result is the record of a tool call, not a turn.
  if (!content.every((block) => block?.type === 'text')) return null
  return content.map((block) => block.text ?? '').join('')
}

// cwd moves around as the session cds into subdirectories; the shallowest one
// seen is the project root.
function isCloserToRoot(candidate, current) {
  if (!current) return true
  return candidate.length < current.length
}

function parseDate(value) {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}
