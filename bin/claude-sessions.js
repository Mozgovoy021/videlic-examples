#!/usr/bin/env node
// List Claude Code transcript sessions: date, project, turns, file size.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

const USAGE = `Usage: claude-sessions [options]

List Claude Code sessions found in ~/.claude/projects.

Options:
  --json          print the sessions as a JSON array instead of a table
  --dir <path>    read transcripts from <path> instead of ~/.claude/projects
  -h, --help      show this help
`;

function parseArgs(argv) {
  const opts = { json: false, root: join(homedir(), '.claude', 'projects') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--dir') {
      const value = argv[++i];
      if (!value) throw new Error('--dir requires a path');
      opts.root = value;
    } else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

// `~/.claude/projects/-Users-admin-videlic` -> `/Users/admin/videlic`, used only
// when no transcript record carries a `cwd`. Dashes inside a directory name are
// indistinguishable from path separators, so this is a best effort.
function projectNameFromDir(dirName) {
  const decoded = dirName.replace(/^-/, '').replace(/-/g, '/');
  return basename(decoded) || dirName;
}

function isHumanPrompt(record) {
  if (record.type !== 'user' || record.isSidechain || record.isMeta) return false;
  // Newer transcripts tag every user record with its origin; anything that is
  // not `human` is a tool result, a hook, or a system-generated notification.
  if (record.origin && typeof record.origin === 'object') {
    return record.origin.kind === 'human';
  }
  const content = record.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return content.some((block) => block?.type !== 'tool_result');
  return false;
}

// One turn = one human prompt plus the assistant's reply to it. Tool results,
// sidechains (subagents) and system records are not turns.
async function readSession(file, dirName) {
  const info = await stat(file);
  const session = {
    id: basename(file, '.jsonl'),
    project: projectNameFromDir(dirName),
    date: info.mtime.toISOString(),
    turns: 0,
    bytes: info.size,
    path: file,
  };

  let sawTimestamp = false;
  let sawCwd = false;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a partially written trailing line, or a corrupt record
    }
    if (!sawTimestamp && typeof record.timestamp === 'string') {
      session.date = record.timestamp;
      sawTimestamp = true;
    }
    if (!sawCwd && typeof record.cwd === 'string' && record.cwd) {
      session.project = basename(record.cwd) || record.cwd;
      sawCwd = true;
    }
    if (isHumanPrompt(record)) session.turns++;
  }
  return session;
}

async function findTranscripts(root) {
  let projectDirs;
  try {
    projectDirs = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`no transcripts directory at ${root}`);
    throw err;
  }

  const found = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const projectPath = join(root, dir.name);
    // Only the top level holds sessions; nested directories hold subagent and
    // workflow transcripts that belong to the session next to them.
    for (const entry of await readdir(projectPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push({ file: join(projectPath, entry.name), dirName: dir.name });
      }
    }
  }
  return found;
}

// Run at most `limit` reads at a time so a few thousand transcripts don't
// exhaust the file descriptor table.
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
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

function printTable(sessions) {
  const rows = sessions.map((s) => [
    s.date.slice(0, 10),
    s.project,
    String(s.turns),
    formatSize(s.bytes),
  ]);
  const widths = [0, 1, 2, 3].map((col) => Math.max(...rows.map((r) => r[col].length), 0));
  for (const row of rows) {
    console.log(
      [
        row[0],
        row[1].padEnd(widths[1]),
        row[2].padStart(widths[2]),
        row[3].padStart(widths[3]),
      ].join('  '),
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const transcripts = await findTranscripts(opts.root);
  const sessions = await mapWithLimit(transcripts, 16, ({ file, dirName }) =>
    readSession(file, dirName),
  );
  sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2));
  } else if (sessions.length === 0) {
    console.error(`no sessions found in ${opts.root}`);
  } else {
    printTable(sessions);
  }
}

main().catch((err) => {
  console.error(`claude-sessions: ${err.message}`);
  process.exitCode = 1;
});
