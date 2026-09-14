#!/usr/bin/env node
// Lists Claude Code sessions found in ~/.claude/projects, one line per session:
//   date  project  turns  size
//
// This file is the CLI surface only — flags, filtering, formatting, exit codes.
// Reading and parsing transcripts lives in ../lib/transcripts.mjs.
//
// Zero dependencies — Node stdlib only. Kept as .mjs so it runs the same whether
// or not an enclosing package.json declares "type": "module".

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_PROJECTS_DIR, listSessions, readConversation } from '../lib/transcripts.mjs';

const USAGE = `Usage: claude-sessions [options]

Lists Claude Code transcript sessions, one line per session:
  date (last activity), project name, number of turns, file size.

Options:
  --json             Output the same data as a JSON array
  --export <project> Write every session of one project into a single text
                     file, oldest first. Takes a project name, or a full path
                     when one name covers more than one directory.
  --out <path>       Where --export writes (default: <project>-sessions.txt in
                     the current directory; "-" for stdout). Overwrites.
  --since <when>     Only sessions active on or after <when>. Accepts a date
                     (2026-09-01), an ISO timestamp, a relative age (30m, 12h,
                     7d, 2w), or today/yesterday.
  --dir <path>       Directory holding project folders (default: ~/.claude/projects)
  -h, --help         Show this help
`;

function parseArgs(argv, now) {
  const opts = { dir: DEFAULT_PROJECTS_DIR, json: false, since: null, export: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Accept both "--flag value" and "--flag=value".
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = () => {
      const value = inline !== null ? inline : argv[++i];
      if (!value) throw new Error(`${name} requires a value`);
      return value;
    };

    if (name === '-h' || name === '--help') {
      opts.help = true;
    } else if (name === '--json') {
      opts.json = true;
    } else if (name === '--export') {
      opts.export = takeValue().trim();
    } else if (name === '--out') {
      opts.out = takeValue();
    } else if (name === '--dir') {
      opts.dir = expandHome(takeValue());
    } else if (name === '--since') {
      opts.since = parseSince(takeValue(), now);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (opts.out !== null && !opts.export) throw new Error('--out only applies with --export');
  // One writes a conversation for reading, the other rows for piping; there is
  // no sensible output that is both.
  if (opts.export && opts.json) throw new Error('--export and --json cannot be combined');
  if (opts.export === '') throw new Error('--export requires a project name');

  return opts;
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Returns a Date, or throws. `now` is injected so this stays testable.
function parseSince(input, now) {
  const value = input.trim();

  if (/^today$/i.test(value)) return startOfDay(now);
  if (/^yesterday$/i.test(value)) {
    const d = startOfDay(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // Relative age: 30m, 12h, 7d, 2w.
  const relative = value.match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/i);
  if (relative) {
    const units = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };
    const ms = Number(relative[1]) * units[relative[2].toLowerCase()];
    return new Date(now.getTime() - ms);
  }

  // Bare calendar date means local midnight, not UTC — the Date constructor
  // would read "2026-09-01" as UTC and shift the cutoff for most time zones.
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    if (Number.isNaN(parsed.getTime())) throw new Error(`invalid --since date: ${input}`);
    return parsed;
  }

  // Anything else: let Date try (full ISO timestamps, with or without zone).
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `invalid --since value: ${input} (try 2026-09-01, 7d, 12h, or today)`
    );
  }
  return parsed;
}

function startOfDay(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

const pad = (n) => String(n).padStart(2, '0');

function formatDate(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${formatTime(date)}`
  );
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// Machine-readable counterparts of the columns: full-precision timestamp and
// raw bytes instead of the rounded display forms.
function toJson(sessions) {
  return JSON.stringify(
    sessions.map((s) => ({
      date: s.date.toISOString(),
      project: s.project,
      turns: s.turns,
      bytes: s.size,
      sessionId: s.sessionId,
      file: s.file,
    })),
    null,
    2
  );
}

function toTable(sessions) {
  const rows = sessions.map((s) => [
    formatDate(s.date),
    s.project,
    String(s.turns),
    formatSize(s.size),
  ]);
  const widths = rows.reduce(
    (acc, row) => row.map((cell, i) => Math.max(acc[i], cell.length)),
    [0, 0, 0, 0]
  );

  let out = '';
  for (const [date, project, turns, size] of rows) {
    const label = turns === '1' ? 'turn ' : 'turns'; // Padded, so the size column stays aligned.
    out +=
      `${date}  ${project.padEnd(widths[1])}  ` +
      `${turns.padStart(widths[2])} ${label}  ${size.padStart(widths[3])}\n`;
  }
  return out;
}

// --- export -----------------------------------------------------------------

const RULE = '='.repeat(72);

/**
 * The sessions belonging to one project. A name is matched against the project
 * column; anything path-shaped is matched against the recorded cwd, which is
 * the way out when one basename covers two checkouts.
 */
function selectProject(sessions, target) {
  if (target.includes('/') || target.startsWith('~')) {
    const wanted = expandHome(target).replace(/\/+$/, '');
    return sessions.filter((s) => s.cwd === wanted);
  }
  return sessions.filter((s) => s.project === target);
}

function sessionHeading(session, index, total, start) {
  return (
    `${RULE}\n` +
    `session ${index}/${total}  ${session.sessionId}\n` +
    `${formatSpan(start, session.date)}  ${plural(session.turns, 'turn')}\n` +
    `${RULE}\n\n`
  );
}

/** First activity to last, collapsed to one stamp when they agree to the minute. */
function formatSpan(start, end) {
  if (!start || formatDate(start) === formatDate(end)) return formatDate(end);
  return `${formatDate(start)} - ${sameDay(start, end) ? formatTime(end) : formatDate(end)}`;
}

/**
 * One message. The date is repeated only when the conversation crosses
 * midnight, which sessions do; otherwise the time alone is enough.
 */
function messageBlock(message, showDate) {
  const when = !message.timestamp
    ? ''
    : ` ${showDate ? formatDate(message.timestamp) : formatTime(message.timestamp)}`;
  return `--- ${message.role}${when} ---\n${message.text}\n\n`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Project names are directory basenames, which may still hold spaces. */
function defaultOutPath(project) {
  return `${project.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'claude'}-sessions.txt`;
}

// Resolves once the chunk has been handed off, so awaiting it is also the
// backpressure: a 40 MB transcript never queues up in memory.
const writeChunk = (stream, chunk) =>
  new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });

function openOutput(dest) {
  const toStdout = dest === '-';
  const stream = toStdout ? process.stdout : fs.createWriteStream(dest, { encoding: 'utf8' });

  // The error listener goes on before the first write, not at close: opening a
  // file is asynchronous, so an unwritable path reports itself while chunks are
  // already in flight, and an unhandled 'error' event takes the process down
  // with a stack trace instead of a message.
  let failure = null;
  const failed = new Promise((resolve) => {
    stream.on('error', (err) => {
      failure = err;
      resolve();
    });
  });
  const guard = (work) =>
    Promise.race([work, failed]).then(() => {
      if (failure) throw failure;
    });

  return {
    write: (chunk) => guard(writeChunk(stream, chunk)),
    // stdout is not ours to close — the process owns it.
    close: () => guard(toStdout ? Promise.resolve() : new Promise((resolve) => stream.end(resolve))),
  };
}

/**
 * Writes every session of one project as a single document.
 * @returns {Promise<number>} Process exit code.
 */
async function runExport(opts, sessions, now) {
  const matched = selectProject(sessions, opts.export);
  if (!matched.length) {
    warn(`no sessions for project: ${opts.export}`);
    const known = [...new Set(sessions.map((s) => s.project))].sort();
    if (known.length) warn(`known projects: ${known.join(', ')}`);
    return 1;
  }

  // Two checkouts of the same repo share a basename. Guessing which one was
  // meant would silently export the wrong history, or both at once.
  const dirs = [...new Set(matched.map((s) => s.cwd).filter(Boolean))].sort();
  if (dirs.length > 1) {
    warn(`"${opts.export}" covers ${dirs.length} directories — pass one of these instead:`);
    for (const dir of dirs) warn(`  --export ${dir}`);
    return 2;
  }

  const project = matched[0].project;
  const chosen = (opts.since ? matched.filter((s) => s.date >= opts.since) : matched).sort(
    (a, b) => a.date - b.date
  );
  if (!chosen.length) {
    warn(`no ${project} sessions on or after ${formatDate(opts.since)}`);
    return 1;
  }

  const dest = opts.out || defaultOutPath(project);
  const turns = chosen.reduce((total, s) => total + s.turns, 0);
  const out = openOutput(dest);

  try {
    await out.write(
      `${project}\n${dirs[0] || '(directory unknown)'}\n` +
        `${plural(chosen.length, 'session')}, ${plural(turns, 'turn')}` +
        `, exported ${formatDate(now)}\n\n`
    );

    let empty = 0;
    for (const [i, session] of chosen.entries()) {
      // null is a file that could not be read, which readConversation has
      // already reported; [] is a transcript that holds no conversation.
      const messages = await readConversation(session.file, { onWarn: warn });
      await out.write(sessionHeading(session, i + 1, chosen.length, messages?.[0]?.timestamp));
      if (!messages || !messages.length) {
        if (messages) empty++;
        await out.write(`(${messages ? 'no conversation recorded' : 'transcript unreadable'})\n\n`);
        continue;
      }
      let lastDay = null;
      for (const message of messages) {
        const showDate = !!message.timestamp && (!lastDay || !sameDay(lastDay, message.timestamp));
        await out.write(messageBlock(message, showDate));
        if (message.timestamp) lastDay = message.timestamp;
      }
    }
    await out.close();

    if (dest !== '-') {
      const note = empty ? `, ${empty} with nothing recorded` : '';
      warn(`wrote ${plural(chosen.length, `${project} session`)}${note} to ${dest}`);
    }
  } catch (err) {
    // A closed pipe (`--out - | head`) is the reader's decision, not a failure.
    if (err.code === 'EPIPE') return 0;
    warn(`cannot write ${dest}: ${err.message}`);
    return 1;
  }
  return 0;
}

// --- output -----------------------------------------------------------------

function warn(message) {
  process.stderr.write(`claude-sessions: ${message}\n`);
}

async function main() {
  const now = new Date();
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), now);
  } catch (err) {
    warn(err.message);
    process.stderr.write(`\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  let sessions;
  try {
    sessions = await listSessions({ dir: opts.dir, onWarn: warn });
  } catch (err) {
    if (err.code === 'ENOENT') {
      warn(`no such directory: ${opts.dir}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (!sessions.length) warn(`no transcripts found in ${opts.dir}`);

  // Export picks its own sessions: the project filter has to run before
  // --since, so that an unknown project name is distinguishable from a known
  // one with nothing recent.
  if (opts.export) {
    process.exitCode = await runExport(opts, sessions, now);
    return;
  }

  const selected = opts.since ? sessions.filter((s) => s.date >= opts.since) : sessions;
  selected.sort((a, b) => a.date - b.date); // Oldest first, so the newest lands next to the prompt.

  // Always valid JSON, even when nothing matched, so it's safe to pipe blind.
  if (opts.json) {
    process.stdout.write(`${toJson(selected)}\n`);
    return;
  }

  if (!selected.length) {
    if (opts.since) warn(`no sessions on or after ${formatDate(opts.since)}`);
    return;
  }

  process.stdout.write(toTable(selected));
}

main().catch((err) => {
  warn(err.stack || String(err));
  process.exitCode = 1;
});
