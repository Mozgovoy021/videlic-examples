# claude-sessions

List your Claude Code sessions, one line each. Zero dependencies — just Node 18+.

```
$ claude-sessions
2026-09-14 16:11  videlic-examples     16 turns   208.6 KB
2026-09-12 13:52  videlic             453 turns     5.3 MB
2026-09-08 13:02  hookupers-backend   172 turns     2.0 MB
2026-09-07 17:26  testrepo              2 turns    13.3 KB
```

Columns: session start date, project name, number of turns, transcript size.
Newest first.

## Usage

```sh
node bin/claude-sessions.js            # or: npm link && claude-sessions
node bin/claude-sessions.js --json
node bin/claude-sessions.js --dir /path/to/projects
node bin/claude-sessions.js --help
```

`--json` prints the same rows as an array, plus the identifiers a script needs:

```json
[
  {
    "sessionId": "b6e3357d-3ad6-4f85-912c-484bb27f2ddf",
    "date": "2026-09-14T13:11:02.418Z",
    "project": "videlic-examples",
    "projectPath": "/Users/admin/videlic-examples",
    "turns": 16,
    "bytes": 213601,
    "path": "/Users/admin/.claude/projects/-Users-admin-videlic-examples/b6e3357d-....jsonl"
  }
]
```

So you can, for example, find your ten biggest transcripts:

```sh
claude-sessions --json | jq -r 'sort_by(-.bytes)[:10][] | "\(.bytes)\t\(.project)"'
```

## What it reads

Claude Code writes one JSONL transcript per session:

```
~/.claude/projects/<mangled-project-path>/<session-uuid>.jsonl
```

Each line is a record — messages, but also queue operations, titles, file
snapshots and hook results. This tool streams each file and keeps four things.

**Date** is the earliest timestamp in the transcript, i.e. when the session
started. A transcript with no timestamped records falls back to the file mtime.

**Project name** is the basename of the session's `cwd`, taking the shallowest
`cwd` seen because a session's `cwd` follows it into subdirectories. The
directory name is only a fallback: it is a lossy encoding of the path (`/` and
`-` both become `-`), so it can't be decoded reliably.

**Turns** is one conversational message: a prompt you typed, or one assistant
reply. Two details make this less obvious than counting records:

- An assistant reply is split across several records — thinking, text, and one
  per tool call — which all share a `requestId`, so they're grouped back into
  one turn.
- The `user` role carries much more than what you typed: tool results,
  compaction summaries, task notifications, interruption markers, injected
  system reminders and the expansion of slash commands. Across the transcripts
  this was developed against, a fifth of all user records are one of those, so
  they're filtered out rather than counted as prompts.

Records marked `isSidechain` belong to a subagent rather than the conversation,
and nested transcripts (`<session-uuid>/subagents/**.jsonl`) are subagent and
workflow logs rather than sessions, so both are left out.

**Size** is the transcript's size on disk, formatted in binary units.

Unparsable lines are skipped — the last line of an active session may be
half-written. Unreadable files and directories are reported on stderr and
skipped, so one bad transcript can't break the listing.

## Development

```sh
npm test
```

The tests build synthetic transcript trees in a temp directory, so they don't
depend on what happens to be in `~/.claude/projects`.
