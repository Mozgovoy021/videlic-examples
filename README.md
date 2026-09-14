# videlic-examples
Small real projects written with a coding agent

## claude-sessions

Lists Claude Code sessions from `~/.claude/projects`, one line per session:
last-activity date, project name, number of turns, file size.

```
$ node bin/claude-sessions.mjs
2026-09-08 14:13  hookupers-backend   25 turns     2.0 MB
2026-09-11 22:53  videlic             71 turns     8.9 MB
2026-09-14 16:26  videlic-examples     1 turn    189.9 KB
```

Zero dependencies — Node stdlib only. Sorted oldest first, so the most recent
session sits next to your prompt.

```
--json           Output the same data as a JSON array
--since <when>   Only sessions active on or after <when>
--dir <path>     Directory holding project folders (default: ~/.claude/projects)
-h, --help       Show this help
```

### Usage

```sh
node bin/claude-sessions.mjs                      # every session
node bin/claude-sessions.mjs --since 7d           # last week
node bin/claude-sessions.mjs --since today        # today only
node bin/claude-sessions.mjs --json               # machine-readable
node bin/claude-sessions.mjs --dir ./fixtures     # somewhere other than ~/.claude/projects
node bin/claude-sessions.mjs --help
```

Flags combine, and take either `--flag value` or `--flag=value`:

```sh
# busiest sessions of the last fortnight
node bin/claude-sessions.mjs --json --since 2w | jq -r 'sort_by(-.turns)[:5][] | "\(.turns)\t\(.project)"'
```

No install step and nothing to build — it needs only Node (any version with ESM
support, i.e. 14+). Chmod'd executable, so `./bin/claude-sessions.mjs` works too.

### --json

Same sessions, same order, with machine-readable forms of the columns: a
full-precision timestamp instead of the rounded local minute, and raw bytes
instead of `1.4 KB`. `sessionId` and `file` are included too, since JSON output
is for piping and a session you can't then open isn't much use.

```
$ node bin/claude-sessions.mjs --json --since 7d
[
  {
    "date": "2026-09-12T15:04:11.300Z",
    "project": "videlic",
    "turns": 16,
    "bytes": 5566231,
    "sessionId": "d795b194-8f4a-4533-aea0-4a5b979701d1",
    "file": "/Users/you/.claude/projects/-Users-you-videlic/d795b194-....jsonl"
  }
]
```

Output is always a valid JSON array, including when nothing matches (`[]`), so
it's safe to pipe into `jq` unconditionally.

### --since

Accepts four forms:

| Form | Example |
| --- | --- |
| Calendar date | `--since 2026-09-01` |
| ISO timestamp | `--since 2026-09-01T11:00:00Z` |
| Relative age | `--since 30m`, `12h`, `7d`, `2w` |
| Shorthand | `--since today`, `--since yesterday` |

A bare date means **local** midnight, not UTC. This matters: a session at
21:00 on Aug 31 local time is stored as `2026-09-01T04:00Z`, so reading the
cutoff as UTC would list a row displaying `2026-08-31` under
`--since 2026-09-01`. The filter always agrees with the date you see.

Both flags take `--flag value` or `--flag=value`. An unparseable `--since`
exits 2 rather than silently filtering nothing.

### Layout

```
bin/claude-sessions.mjs   CLI surface: flags, filtering, formatting, exit codes
lib/transcripts.mjs       Reading and parsing transcripts
```

`lib/transcripts.mjs` knows the on-disk layout and the JSONL entry shapes and
nothing about display, so it's usable on its own:

```js
import { listSessions } from './lib/transcripts.mjs';

const sessions = await listSessions();          // defaults to ~/.claude/projects
// → [{ file, sessionId, project, turns, size, date }, ...]
```

Non-fatal problems (an unreadable project folder, a file that vanished
mid-read) go to an optional `onWarn` callback rather than straight to stderr,
so the caller decides where they land; by default they're dropped. An
unreadable root directory throws with `err.code` intact. `listSessions` returns
sessions unsorted — the CLI is what sorts and filters.

The pure predicates are exported too, for testing or reuse:
`isHumanTurn(entry)`, `isHarnessMarker(text)`, `findTranscripts(dir)`.

### What counts as a turn

One turn is one human prompt, which is narrower than it sounds: in a transcript
roughly 95% of `role: user` entries were never typed by a person. Excluded are
tool results, subagent traffic (`isSidechain`), harness-injected messages
(`isMeta`), background `<task-notification>` blocks, `<system-reminder>`
blocks, and `[Request interrupted]` markers. Slash commands *are* counted — you
typed those.

For scale, on the transcript set this was built against, background task
notifications alone were ~19% of the remaining user text. Counting lines, or
even all user messages, overstates turns by an order of magnitude.

### Other details

- Only `<dir>/<project>/<session>.jsonl` is read. Nested directories hold
  subagent and workflow logs (2330 files vs 65 real sessions here), not sessions.
- Dates come from the last timestamp recorded *inside* the file, falling back to
  mtime — copying or syncing a transcript rewrites mtime but not the
  conversation.
- Project names come from the `cwd` recorded in the transcript. The directory
  name is only a fallback, since it encodes a path with `/` replaced by `-` and
  is lossy for names containing dashes.
- Truncated trailing lines (a session being written right now) are skipped
  rather than fatal.
