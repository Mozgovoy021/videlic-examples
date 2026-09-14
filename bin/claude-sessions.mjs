#!/usr/bin/env node
// Lists Claude Code sessions found in ~/.claude/projects, one line per session:
//   date  project  turns  size
//
// This file is the CLI surface only — flags, filtering, formatting, exit codes.
// Reading and parsing transcripts lives in ../lib/transcripts.mjs.
//
// Zero dependencies — Node stdlib only. Kept as .mjs so it runs the same whether
// or not an enclosing package.json declares "type": "module".

import os from 'node:os';
import path from 'node:path';

import { DEFAULT_PROJECTS_DIR, listSessions } from '../lib/transcripts.mjs';

const USAGE = `Usage: claude-sessions [options]

Lists Claude Code transcript sessions, one line per session:
  date (last activity), project name, number of turns, file size.

Options:
  --json           Output the same data as a JSON array
  --since <when>   Only sessions active on or after <when>. Accepts a date
                   (2026-09-01), an ISO timestamp, a relative age (30m, 12h,
                   7d, 2w), or today/yesterday.
  --dir <path>     Directory holding project folders (default: ~/.claude/projects)
  --quiet          Suppress warnings and status notes; errors still print
  -h, --help       Show this help
`;

function parseArgs(argv, now) {
  const opts = { dir: DEFAULT_PROJECTS_DIR, json: false, since: null, quiet: false };
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
    } else if (name === '--quiet') {
      opts.quiet = true;
    } else if (name === '--dir') {
      opts.dir = expandHome(takeValue());
    } else if (name === '--since') {
      opts.since = parseSince(takeValue(), now);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
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

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
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

// Set once from the parsed flags, before anything is read.
let quiet = false;

// Failures. Printed even under --quiet — a non-zero exit with nothing to
// explain it is worse than one line of output. Like everything the CLI says
// about itself this goes to stderr, leaving stdout to the listing alone so
// --json stays safe to pipe.
function error(message) {
  process.stderr.write(`claude-sessions: ${message}\n`);
}

// Non-fatal notes: a skipped file, nothing matched. Silenced by --quiet.
function warn(message) {
  if (!quiet) error(message);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), new Date());
  } catch (err) {
    error(err.message);
    process.stderr.write(`\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  quiet = opts.quiet;

  // Explicitly asked for, so --quiet does not apply.
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  let sessions;
  try {
    sessions = await listSessions({ dir: opts.dir, onWarn: warn });
  } catch (err) {
    if (err.code === 'ENOENT') {
      error(`no such directory: ${opts.dir}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (!sessions.length) warn(`no transcripts found in ${opts.dir}`);

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
  error(err.stack || String(err));
  process.exitCode = 1;
});
