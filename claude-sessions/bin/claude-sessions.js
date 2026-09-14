#!/usr/bin/env node
import { DEFAULT_PROJECTS_DIR, scanSessions } from '../src/scan.js'
import { formatTable, toJson } from '../src/format.js'

const HELP = `claude-sessions — list Claude Code sessions on this machine

Usage: claude-sessions [options]

Prints one line per session transcript: start date, project name, number of
turns, and transcript size. Newest first.

Options:
  --json           print the same data as JSON
  --dir <path>     transcripts directory (default: ${DEFAULT_PROJECTS_DIR})
  -h, --help       show this help

A turn is one conversational message: a prompt you typed, or one assistant
reply. Tool calls and their results are part of the reply they belong to.
`

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }

  const sessions = await scanSessions(options.dir, {
    onWarning: (message) => process.stderr.write(`claude-sessions: ${message}\n`),
  })

  if (options.json) {
    process.stdout.write(`${toJson(sessions)}\n`)
  } else if (sessions.length === 0) {
    process.stderr.write(`claude-sessions: no sessions found in ${options.dir}\n`)
  } else {
    process.stdout.write(`${formatTable(sessions)}\n`)
  }
  return 0
}

function parseArgs(argv) {
  const options = { json: false, help: false, dir: DEFAULT_PROJECTS_DIR }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--dir') {
      const value = argv[++i]
      if (!value) throw new Error('--dir needs a path')
      options.dir = value
    } else throw new Error(`unknown option: ${arg}`)
  }
  return options
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`claude-sessions: ${err.message}\n`)
  process.exitCode = 1
}
