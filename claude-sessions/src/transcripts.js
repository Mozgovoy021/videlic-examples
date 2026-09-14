'use strict';

// Reading and parsing Claude Code transcripts.
//
// Layout of the transcripts directory:
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl   <- a session transcript
//   ~/.claude/projects/<encoded-cwd>/<session-id>/...     <- subagent/workflow logs
//
// Only the top-level *.jsonl files are sessions; everything nested below a
// session directory belongs to subagents and is deliberately ignored.
//
// Nothing here writes to stdout/stderr or exits: callers decide how to report
// a transcript that cannot be read.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_ROOT = path.join(os.homedir(), '.claude', 'projects');

// How many transcripts to scan at once. Transcripts reach tens of MB, so the
// work is IO bound and a small pool keeps things fast without thrashing.
const CONCURRENCY = 8;

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
// Lives here because the only thing worth pooling is transcript IO.
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

module.exports = {
  CONCURRENCY,
  DEFAULT_ROOT,
  findSessionFiles,
  mapPool,
  readSession,
};
