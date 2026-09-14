// Reading and parsing of Claude Code transcripts.
//
// Knows the on-disk layout and the JSONL entry shapes; knows nothing about how
// results get displayed. Non-fatal problems (an unreadable project folder, a
// vanished file) go to an optional `onWarn` callback so the caller decides
// whether they reach stderr, a log, or nowhere.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Text that arrives as role:user but nobody typed. Derived from the actual
// distribution of non-tool_result user text in ~/.claude/projects; background
// task notifications alone are ~19% of it. Slash-command blocks
// (<command-name>, <command-message>) are deliberately absent — the user did
// type those, so they count as turns.
export const HARNESS_PREFIXES = [
  '<task-notification>',
  '<local-command-stdout>',
  '<system-reminder>',
  '[Request interrupted',
  '[Request cancelled',
  'Caveat: The messages below were generated',
];

const noop = () => {};

/**
 * A session as read from disk.
 * @typedef {object} Session
 * @property {string} file       Absolute path to the .jsonl transcript.
 * @property {string} sessionId  Transcript filename without the extension.
 * @property {string} project    Basename of the recorded cwd, or a dir-name fallback.
 * @property {?string} cwd       The recorded cwd, or null if no entry carried one.
 * @property {number} turns      Human prompts; see isHumanTurn.
 * @property {number} size       File size in bytes.
 * @property {Date}   date       Last recorded activity.
 */

/**
 * Reads every session under `dir`.
 * Throws if `dir` itself is unreadable (check `err.code === 'ENOENT'`);
 * per-project and per-file failures are reported via `onWarn` and skipped.
 * @returns {Promise<Session[]>} Unsorted — order follows directory traversal.
 */
export async function listSessions({ dir = DEFAULT_PROJECTS_DIR, onWarn = noop, concurrency = 16 } = {}) {
  const queue = findTranscripts(dir, { onWarn });
  const sessions = [];
  // Bounded concurrency: enough to keep the disk busy, not enough to exhaust file handles.
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const session = await readSession(queue.shift(), { onWarn });
      if (session) sessions.push(session);
    }
  });
  await Promise.all(workers);
  return sessions;
}

/**
 * Locates transcript files. They live exactly one level down:
 * `<dir>/<encoded-project>/<sessionId>.jsonl`. Nested directories hold session
 * scratch space (tool-results, workflows, memory) and subagent logs, not sessions.
 * @returns {{file: string, dirName: string}[]}
 */
export function findTranscripts(dir = DEFAULT_PROJECTS_DIR, { onWarn = noop } = {}) {
  const found = [];
  for (const project of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(dir, project.name);
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch (err) {
      onWarn(`skipping ${projectDir}: ${err.message}`);
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push({ file: path.join(projectDir, entry.name), dirName: project.name });
      }
    }
  }
  return found;
}

/**
 * Streams one transcript and derives its summary.
 * @returns {Promise<Session|null>} null if the file could not be read.
 */
export async function readSession({ file, dirName }, { onWarn = noop } = {}) {
  let size = 0;
  let mtime = null;
  try {
    const stats = fs.statSync(file);
    size = stats.size;
    mtime = stats.mtime;
  } catch (err) {
    onWarn(`skipping ${file}: ${err.message}`);
    return null;
  }

  const session = {
    file,
    sessionId: path.basename(file, '.jsonl'),
    project: null,
    cwd: null,
    turns: 0,
    size,
    date: mtime,
  };
  let lastTimestamp = null;

  const read = await streamLines(file, { onWarn }, (line) => {
    // Cheap prefilter: only the lines that can carry what we need get parsed.
    // Transcripts run to hundreds of MB in aggregate, and most lines are neither.
    const needsParse =
      line.indexOf('"type":"user"') !== -1 || line.indexOf('"timestamp"') !== -1;
    if (!needsParse) return;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return; // Truncated or partially written line — ignore it.
    }
    if (typeof entry !== 'object' || entry === null) return;

    if (typeof entry.timestamp === 'string') {
      const when = new Date(entry.timestamp);
      if (!Number.isNaN(when.getTime())) lastTimestamp = when;
    }
    if (!session.cwd && typeof entry.cwd === 'string' && entry.cwd) {
      session.cwd = entry.cwd;
      session.project = path.basename(entry.cwd);
    }
    if (isHumanTurn(entry)) session.turns++;
  });
  if (!read) return null;

  // Timestamps inside the file beat mtime: copying or syncing a transcript
  // rewrites mtime but not the recorded conversation time.
  if (lastTimestamp) session.date = lastTimestamp;
  if (!session.project) session.project = decodeProjectDir(dirName);
  return session;
}

/**
 * Feeds `file` to `onLine` one line at a time.
 *
 * The error handler goes on the readline interface as well as the stream:
 * readline re-emits its input's error on itself, and an 'error' event with no
 * listener is fatal, so reporting an unreadable file and carrying on takes
 * both. One `onWarn` per file either way.
 *
 * @returns {Promise<boolean>} false if the file could not be read.
 */
function streamLines(file, { onWarn = noop } = {}, onLine) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (err) onWarn(`skipping ${file}: ${err.message}`);
      resolve(!err);
    };

    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    stream.on('error', settle);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('error', settle);
    lines.on('line', onLine);
    lines.on('close', () => settle(null));
  });
}

/**
 * One message in a conversation.
 * @typedef {object} Message
 * @property {'user'|'assistant'} role
 * @property {?Date}  timestamp  When it was recorded, or null if the entry had none.
 * @property {string} text       Non-empty; see readConversation for what's in it.
 */

/**
 * Streams one transcript and returns the conversation in the order it happened.
 *
 * Kept is what a person would recognise as the conversation: human prompts and
 * assistant replies. Dropped are the things `turns` already excludes — tool
 * results, subagent traffic, harness-injected text — plus thinking blocks,
 * which are reasoning rather than reply. Tool calls survive as bare names, so
 * "let me check the tests" isn't followed by an unexplained silence.
 *
 * One reply to one prompt is recorded as many entries — the tool loop splits
 * it at every call, 7067 entries for 846 prompts in the set this was built
 * against. They are merged back into one message per prompt, which is what a
 * reader means by a reply.
 *
 * @returns {Promise<Message[]|null>} null if the file could not be read.
 */
export function readConversation(file, { onWarn = noop } = {}) {
  return new Promise((resolve) => {
    const messages = [];
    let pending = null; // Assistant parts gather here until the next human turn.

    const flush = () => {
      if (!pending) return;
      const text = renderReply(pending.parts);
      if (text) messages.push({ role: 'assistant', timestamp: pending.timestamp, text });
      pending = null;
    };

    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    let settled = false;
    stream.on('error', (err) => {
      if (settled) return;
      settled = true;
      onWarn(`skipping ${file}: ${err.message}`);
      resolve(null);
    });

    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', (line) => {
      // No prefilter here, unlike readSession: a listing that skips a line is
      // off by one in a count, an export that skips one has lost a message.
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return; // Truncated or partially written line — ignore it.
      }
      if (typeof entry !== 'object' || entry === null) return;

      const timestamp = parseTimestamp(entry.timestamp);

      if (entry.type === 'assistant' && !entry.isSidechain && !entry.isMeta) {
        const parts = assistantParts(entry);
        if (!parts.length) return;
        if (pending) pending.parts.push(...parts);
        else pending = { timestamp, parts };
        return;
      }

      if (isHumanTurn(entry)) {
        const text = humanText(entry);
        if (!text) return;
        flush(); // The reply being accumulated ended when this prompt arrived.
        messages.push({ role: 'user', timestamp, text });
      }
    });
    lines.on('close', () => {
      if (settled) return;
      settled = true;
      flush();
      resolve(messages);
    });
  });
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** What one assistant entry contributes to its reply: said text, and tool names. */
function assistantParts(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content.trim() ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push({ kind: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      parts.push({ kind: 'tool', name: block.name || 'unknown' });
    }
  }
  return parts;
}

/**
 * Assembles one reply. A tool loop can run dozens of calls between two
 * sentences, so each run of them collapses into a single line with counts —
 * enough to see that work happened and of what kind, without burying what was
 * said under forty lines of tool names.
 */
function renderReply(parts) {
  const lines = [];
  let tools = [];

  const flushTools = () => {
    if (!tools.length) return;
    const counts = new Map();
    for (const name of tools) counts.set(name, (counts.get(name) || 0) + 1);
    const listed = [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name));
    lines.push(`[${tools.length === 1 ? 'tool' : 'tools'}: ${listed.join(', ')}]`);
    tools = [];
  };

  for (const part of parts) {
    if (part.kind === 'tool') {
      tools.push(part.name);
      continue;
    }
    flushTools();
    lines.push(part.text);
  }
  flushTools();
  return lines.join('\n\n').trim();
}

/**
 * The typed text of one human turn. A prompt can carry harness blocks
 * alongside what was typed, so blocks are filtered individually — isHumanTurn
 * only promises that at least one of them is real.
 */
function humanText(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'image') parts.push('[image]');
    else if (block.type === 'text' && !isHarnessMarker(block.text)) parts.push(block.text);
  }
  return parts.join('\n\n').trim();
}

/**
 * True if `entry` is one human prompt. Most `user` entries are not: tool
 * results come back as role:user, subagent chatter is flagged isSidechain, and
 * the harness injects its own isMeta and bracketed control messages.
 */
export function isHumanTurn(entry) {
  if (!entry || entry.type !== 'user' || entry.isSidechain || entry.isMeta) return false;

  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return !isHarnessMarker(content);
  if (!Array.isArray(content)) return false;

  let sawPrompt = false;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_result') return false;
    if (block.type === 'image') sawPrompt = true;
    if (block.type === 'text' && !isHarnessMarker(block.text)) sawPrompt = true;
  }
  return sawPrompt;
}

/** True if `text` is harness-generated rather than typed. */
export function isHarnessMarker(text) {
  if (typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return HARNESS_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Fallback project name, used only when no entry carries a cwd. Project dir
 * names encode a path with '/' replaced by '-', which is lossy for names that
 * contain dashes, so the encoded form is kept rather than guessed apart.
 */
export function decodeProjectDir(dirName) {
  return dirName.replace(/^-+/, '') || dirName;
}
