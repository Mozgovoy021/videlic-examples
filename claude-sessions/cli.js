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
  --json              Print the same data as a JSON array
  --since <when>      Only sessions started at or after <when>
  --export <project>  Write every session of <project> to one text file
  --out <file>        Where --export writes (default <project>-sessions.txt,
                      "-" for stdout)
  -h, --help          Show this help

  <when> is YYYY-MM-DD, an ISO timestamp, or a relative age such as 7d,
  12h or 2w. A bare date means midnight local time.

  <project> is a name from the PROJECT column, or a full project path
  when one name covers several directories.

Notes:
  "turns" counts user prompts, excluding tool results and "[Request
  interrupted by user]" markers. "date" is the timestamp of the first
  transcript entry, falling back to the file's modification time.

  Reads ${DEFAULT_ROOT} by default; set CLAUDE_PROJECTS_DIR to override.
`;

function fail(message) {
  process.stderr.write(`claude-sessions: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { json: false, help: false, since: null, project: null, out: null };
  const takesValue = new Set(['--since', '--export', '--out']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Value options accept both "--opt value" and "--opt=value".
    let name = arg;
    let value;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    if (eq !== -1) {
      name = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (takesValue.has(arg)) {
      value = argv[++i];
      if (value === undefined) fail(`option '${arg}' needs a value\n\n${USAGE}`);
    }

    if (name === '--json' && value === undefined) opts.json = true;
    else if ((name === '-h' || name === '--help') && value === undefined) opts.help = true;
    else if (name === '--since' && value !== undefined) opts.since = parseSince(value);
    else if (name === '--export' && value !== undefined) opts.project = value;
    else if (name === '--out' && value !== undefined) opts.out = value;
    else {
      process.stderr.write(`claude-sessions: unknown option '${arg}'\n\n${USAGE}`);
      process.exit(2);
    }
  }

  if (opts.out !== null && opts.project === null) fail(`'--out' only applies to --export`);
  if (opts.json && opts.project !== null) fail(`'--json' cannot be combined with '--export'`);

  return opts;
}

// Returns an epoch-ms cutoff. Accepts a relative age ("7d"), a bare date
// (midnight local time, so "--since <today>" keeps everything the table shows
// for today), or anything Date understands -- in practice an ISO timestamp.
function parseSince(input) {
  const value = input.trim();

  const relative = /^(\d+)([hdw])$/i.exec(value);
  if (relative) {
    const ms = { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[relative[2].toLowerCase()];
    return Date.now() - Number(relative[1]) * ms;
  }

  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bareDate) {
    const at = new Date(Number(bareDate[1]), Number(bareDate[2]) - 1, Number(bareDate[3]));
    if (!Number.isNaN(at.getTime())) return at.getTime();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail(`could not read --since '${input}' (want YYYY-MM-DD, an ISO timestamp, or e.g. 7d)`);
  }
  return parsed.getTime();
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

// With `collect`, also gathers the conversation itself for --export. That is
// off by default because a listing only needs the counts, and holding the text
// of every transcript in memory at once would be wasteful.
async function readSession(file, { collect = false } = {}) {
  const stat = await fsp.stat(file);

  let turns = 0;
  let cwd = null;
  let startedAt = null;
  const messages = [];

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
      const interesting = collect
        ? line.includes('"type":"user"') || line.includes('"type":"assistant"')
        : line.includes('"type":"user"');
      if (!needsMeta && !interesting) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // partially written or corrupt line
      }

      if (cwd === null && typeof entry.cwd === 'string') cwd = entry.cwd;
      if (startedAt === null && typeof entry.timestamp === 'string') startedAt = entry.timestamp;
      if (isUserTurn(entry)) turns++;

      if (collect) {
        const message = extractMessage(entry);
        if (message) messages.push(message);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  const projectPath = cwd || decodeProjectDir(path.basename(path.dirname(file)));

  const session = {
    date: startedAt || stat.mtime.toISOString(),
    project: path.basename(projectPath) || projectPath,
    projectPath,
    turns,
    bytes: stat.size,
    sessionId: path.basename(file, '.jsonl'),
    file,
  };
  // Only when asked: --json prints this object verbatim and must keep its
  // existing shape.
  if (collect) session.messages = messages;
  return session;
}

// One transcript entry as it should read in an export, or null to drop it.
// Tool calls survive as a bare name: what the agent did is part of the story,
// while the arguments and output are bulk that would bury the conversation.
function extractMessage(entry) {
  if (entry.isSidechain || entry.isMeta || entry.isCompactSummary) return null;

  if (isUserTurn(entry)) {
    const text = messageText(entry.message.content);
    return text ? { role: 'user', at: entry.timestamp, text } : null;
  }

  if (entry.type === 'assistant') {
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) return null;

    const text = messageText(content);
    if (text) return { role: 'assistant', at: entry.timestamp, text };

    const tools = content
      .filter((block) => block && block.type === 'tool_use' && block.name)
      .map((block) => block.name);
    if (tools.length) return { role: 'tool', at: entry.timestamp, text: tools.join(', ') };
  }

  return null;
}

// Plain text only: "thinking" blocks are internal and tool traffic is handled
// by the caller.
function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
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

// Resolves --export to a single project. A name from the PROJECT column is
// usually enough, but the same basename can appear in several directories, and
// silently exporting the wrong one would be worse than asking.
function selectProject(sessions, wanted) {
  const byPath = new Map();
  for (const session of sessions) {
    if (session.projectPath === wanted || session.project === wanted) {
      const group = byPath.get(session.projectPath);
      if (group) group.push(session);
      else byPath.set(session.projectPath, [session]);
    }
  }

  if (byPath.size === 0) {
    const known = [...new Set(sessions.map((s) => s.project))].sort();
    const hint = known.length ? `\nknown projects: ${known.join(', ')}` : '';
    fail(`no sessions for project '${wanted}'${hint}`);
  }

  if (byPath.size > 1) {
    const paths = [...byPath.keys()].sort();
    fail(`'${wanted}' matches several projects, pass a full path:\n  ${paths.join('\n  ')}`);
  }

  return [...byPath.values()][0];
}

const RULE = '='.repeat(72);

// Oldest first: an export is an archive of how the project unfolded, which
// reads forwards, unlike the listing.
function renderExport(projectPath, sessions) {
  const ordered = [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const totalTurns = ordered.reduce((sum, s) => sum + s.turns, 0);

  const out = [
    RULE,
    `Project:  ${projectPath}`,
    `Sessions: ${ordered.length}`,
    `Turns:    ${totalTurns}`,
    RULE,
  ];

  for (const session of ordered) {
    out.push(
      '',
      RULE,
      `Session ${session.sessionId}`,
      `${formatDate(session.date)}  ${session.turns} turns  ${formatSize(session.bytes)}`,
      RULE,
    );

    if (session.messages.length === 0) {
      out.push('', '(no messages)');
      continue;
    }

    for (const message of session.messages) {
      out.push('', `--- ${message.role} ${formatDate(message.at)} ---`, message.text);
    }
  }

  return `${out.join('\n')}\n`;
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

  const scanned = settled
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const since = (list) =>
    opts.since === null ? list : list.filter((s) => new Date(s.date).getTime() >= opts.since);

  if (opts.project !== null) {
    // Resolve the project against every session, then apply --since inside it,
    // so a date filter that excludes everything reads as "nothing in range"
    // rather than "no such project".
    const chosen = since(selectProject(scanned, opts.project));
    if (chosen.length === 0) fail(`no sessions for '${opts.project}' at or after --since`);

    const full = await mapPool(chosen, CONCURRENCY, (session) =>
      readSession(session.file, { collect: true }),
    );
    const text = renderExport(chosen[0].projectPath, full);

    const target = opts.out || `${chosen[0].project}-sessions.txt`;
    if (target === '-') {
      process.stdout.write(text);
      return;
    }

    await fsp.writeFile(target, text);
    process.stderr.write(
      `claude-sessions: wrote ${chosen.length} session${chosen.length === 1 ? '' : 's'} to ${target}\n`,
    );
    return;
  }

  const sessions = since(scanned);

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
