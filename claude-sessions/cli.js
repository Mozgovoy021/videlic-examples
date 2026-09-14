#!/usr/bin/env node
'use strict';

// Lists Claude Code sessions found in ~/.claude/projects.
//
// Layout of that directory:
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl   <- a session transcript
//   ~/.claude/projects/<encoded-cwd>/<session-id>/...     <- subagent/workflow logs
//
// Only the top-level *.jsonl files are sessions; everything nested below a
// session directory belongs to subagents and is deliberately ignored.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_ROOT = path.join(os.homedir(), '.claude', 'projects');

// How many transcripts to scan at once. Transcripts reach tens of MB, so the
// work is IO bound and a small pool keeps things fast without thrashing.
const CONCURRENCY = 8;

const USAGE = `Usage: claude-sessions [options]

Lists one line per Claude Code session: date, project, turns, size.

Options:
  --json      Print the same data as a JSON array
  -h, --help  Show this help

Notes:
  "turns" counts user prompts, excluding tool results and "[Request
  interrupted by user]" markers. "date" is the timestamp of the first
  transcript entry, falling back to the file's modification time.

  Reads ${DEFAULT_ROOT} by default; set CLAUDE_PROJECTS_DIR to override.
`;

function parseArgs(argv) {
  const opts = { json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else {
      process.stderr.write(`claude-sessions: unknown option '${arg}'\n\n${USAGE}`);
      process.exit(2);
    }
  }
  return opts;
}

// A transcript line is a real user turn when it is a user-role entry that is
// not a tool result and not one of the markers Claude Code writes inline.
function isUserTurn(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isCompactSummary) return false;
  if (entry.isSidechain) return false; // subagent traffic, not the user's

  const content = entry.message && entry.message.content;
  if (Array.isArray(content)) {
    if (content.some((block) => block && block.type === 'tool_result')) return false;
    const text = content.map((block) => (block && block.text) || '').join('');
    if (text.startsWith('[Request interrupted')) return false;
    return true;
  }
  return typeof content === 'string';
}

async function readSession(file) {
  const stat = await fsp.stat(file);

  let turns = 0;
  let cwd = null;
  let startedAt = null;

  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line) continue;

      // Most lines are assistant output or tool results, which we never need to
      // inspect once the session metadata is known. Parsing JSON is by far the
      // hot path here, so skip lines that cannot possibly matter. A false
      // positive only costs a wasted parse -- the checks below still decide.
      const needsMeta = cwd === null || startedAt === null;
      if (!needsMeta && !line.includes('"type":"user"')) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // partially written or corrupt line
      }

      if (cwd === null && typeof entry.cwd === 'string') cwd = entry.cwd;
      if (startedAt === null && typeof entry.timestamp === 'string') startedAt = entry.timestamp;
      if (isUserTurn(entry)) turns++;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  const projectPath = cwd || decodeProjectDir(path.basename(path.dirname(file)));

  return {
    date: startedAt || stat.mtime.toISOString(),
    project: path.basename(projectPath) || projectPath,
    projectPath,
    turns,
    bytes: stat.size,
    sessionId: path.basename(file, '.jsonl'),
    file,
  };
}

// Fallback only. Claude Code encodes the cwd by replacing every path separator
// with "-", which collides with dashes already in the path, so this cannot be
// inverted reliably -- we prefer the `cwd` recorded inside the transcript.
function decodeProjectDir(name) {
  return name.replace(/-/g, '/');
}

async function findSessionFiles(root) {
  let projectDirs;
  try {
    projectDirs = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const files = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue; // unreadable project directory
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }
  return files;
}

// Runs `worker` over `items` with at most `limit` in flight, preserving order.
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '?';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderTable(sessions) {
  const rows = sessions.map((s) => [
    formatDate(s.date),
    s.project,
    String(s.turns),
    formatSize(s.bytes),
  ]);

  const header = ['DATE', 'PROJECT', 'TURNS', 'SIZE'];
  const widths = header.map((name, i) =>
    Math.max(name.length, ...rows.map((row) => row[i].length)),
  );

  // Numeric columns read better right-aligned; the last column needs no padding.
  const rightAligned = new Set([2, 3]);
  const line = (cells) =>
    cells
      .map((cell, i) =>
        i === cells.length - 1
          ? rightAligned.has(i)
            ? cell.padStart(widths[i])
            : cell
          : rightAligned.has(i)
            ? cell.padStart(widths[i])
            : cell.padEnd(widths[i]),
      )
      .join('  ');

  return [line(header), ...rows.map(line)].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const root = process.env.CLAUDE_PROJECTS_DIR || DEFAULT_ROOT;
  const files = await findSessionFiles(root);

  const settled = await mapPool(files, CONCURRENCY, async (file) => {
    try {
      return await readSession(file);
    } catch (err) {
      process.stderr.write(`claude-sessions: skipping ${file}: ${err.message}\n`);
      return null;
    }
  });

  const sessions = settled
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }

  if (sessions.length === 0) {
    process.stderr.write(`claude-sessions: no sessions found in ${root}\n`);
    return;
  }

  process.stdout.write(`${renderTable(sessions)}\n`);
}

main().catch((err) => {
  process.stderr.write(`claude-sessions: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
