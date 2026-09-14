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
export function readSession({ file, dirName }, { onWarn = noop } = {}) {
  return new Promise((resolve) => {
    let size = 0;
    let mtime = null;
    try {
      const stats = fs.statSync(file);
      size = stats.size;
      mtime = stats.mtime;
    } catch (err) {
      onWarn(`skipping ${file}: ${err.message}`);
      return resolve(null);
    }

    const session = {
      file,
      sessionId: path.basename(file, '.jsonl'),
      project: null,
      turns: 0,
      size,
      date: mtime,
    };
    let lastTimestamp = null;

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
      if (!session.project && typeof entry.cwd === 'string' && entry.cwd) {
        session.project = path.basename(entry.cwd);
      }
      if (isHumanTurn(entry)) session.turns++;
    });
    lines.on('close', () => {
      if (settled) return;
      settled = true;
      // Timestamps inside the file beat mtime: copying or syncing a transcript
      // rewrites mtime but not the recorded conversation time.
      if (lastTimestamp) session.date = lastTimestamp;
      if (!session.project) session.project = decodeProjectDir(dirName);
      resolve(session);
    });
  });
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
