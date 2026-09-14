# claude-sessions

A zero-dependency Node CLI that lists your Claude Code sessions, one line per session.

```
$ ./cli.js
DATE              PROJECT            TURNS     SIZE
2026-09-14 16:07  videlic-examples       1   111 KB
2026-09-14 12:11  videlic               25   1.9 MB
2026-09-08 13:02  hookupers-backend     25   2.0 MB
2026-09-07 17:26  testrepo               1  13.3 KB
```

Sessions are sorted newest first.

## Usage

```
./cli.js                          # table
./cli.js --json                   # same data as JSON
./cli.js --since 7d               # only recent sessions
./cli.js --export videlic         # one project, one text file
./cli.js --help
```

`--json` emits raw values — ISO timestamps and byte counts — plus the full
project path, session id, and transcript path:

```json
[
  {
    "date": "2026-09-14T13:07:06.965Z",
    "project": "videlic-examples",
    "projectPath": "/Users/admin/videlic-examples",
    "turns": 1,
    "bytes": 113664,
    "sessionId": "2929c325-e66e-4d71-8fc5-0d6562d4662c",
    "file": "/Users/admin/.claude/projects/-Users-admin-videlic-examples/2929c325-....jsonl"
  }
]
```

Requires Node 18+. No install step and no dependencies.

## Filtering by date

`--since` keeps sessions started at or after a cutoff. It applies to the
table, to `--json`, and to `--export`.

```
./cli.js --since 7d                     # relative: 12h, 7d, 2w
./cli.js --since 2026-09-14             # bare date: midnight local time
./cli.js --since 2026-09-14T12:00:00Z   # ISO timestamp
```

A bare date is read as local midnight rather than UTC, so `--since` with
today's date keeps everything the table shows for today.

## Exporting a project

`--export <project>` writes every session of one project into a single text
file — the whole history of a project in one place, in the order it happened
(oldest first, the reverse of the listing).

```
$ ./cli.js --export videlic-examples
claude-sessions: wrote 7 sessions to videlic-examples-sessions.txt
```

The default filename is `<project>-sessions.txt`; `--out` overrides it, and
`--out -` writes to stdout instead. `--export` combines with `--since` to
export a date range, and cannot be combined with `--json`.

`<project>` is a name from the `PROJECT` column. If that name occurs in more
than one directory the CLI refuses to guess and lists the candidates, which
you then pass as a full path:

```
$ ./cli.js --export app
claude-sessions: 'app' matches several projects, pass a full path:
  /a/app
  /b/app
```

The file holds a project header, then one block per session:

```
========================================================================
Project:  /Users/admin/videlic-examples
Sessions: 7
Turns:    7
========================================================================

========================================================================
Session 981cf3aa-99da-4898-9812-bec15a52a164
2026-09-14 15:43  1 turns  13.5 KB
========================================================================

--- user 2026-09-14 15:43 ---
Build a small zero-dependency Node CLI in this repo that reads Claude Code
transcripts from ~/.claude/projects [...]

--- assistant 2026-09-14 15:43 ---
I'll start by looking at the repo and the transcript format.

--- tool 2026-09-14 15:43 ---
Bash
```

What each session contributes is the conversation: user prompts and assistant
replies. Tool calls appear as a bare name, because what the agent reached for
is part of the story while the arguments and output are bulk that would bury
it. Thinking blocks, tool results, and subagent traffic are left out
entirely — the same entries `turns` already excludes.

Transcripts are only read in full for the project being exported; listing
still just counts.

## How it reads transcripts

Claude Code stores transcripts under `~/.claude/projects`:

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl   <- a session
~/.claude/projects/<encoded-cwd>/<session-id>/...     <- subagent + workflow logs
```

Only the top-level `.jsonl` files are sessions. The nested directories hold
subagent and workflow transcripts — on a machine with 58 sessions there were
2388 `.jsonl` files in total, so counting those would inflate the listing
roughly 40x. They are ignored.

Each transcript is a JSON-lines file, streamed rather than read whole, since
individual sessions reach tens of megabytes. Unparseable lines (a transcript
being written to right now ends in a partial line) are skipped.

**project** comes from the `cwd` field recorded inside the transcript. The
directory name is *not* used, because the encoding replaces path separators
with `-` and so collides with dashes already in the path — the directory
`-private-tmp-claude-502--Users-admin-videlic-...-scratchpad-testrepo` cannot
be inverted back to its real path. The decoded directory name is only a
fallback for transcripts with no `cwd` at all.

**turns** counts user prompts. Claude Code writes several other things as
user-role entries, all of which are excluded:

| Excluded entry | Why |
| --- | --- |
| `tool_result` content blocks | tool output, not something you typed |
| `[Request interrupted by user]` | a marker written when you hit escape |
| `isMeta` / `isCompactSummary` | injected context and compaction summaries |
| `isSidechain` | subagent traffic |

**date** is the timestamp of the first transcript entry, falling back to the
file's modification time for an empty transcript.

## Configuration

`CLAUDE_PROJECTS_DIR` overrides the transcript directory. Handy for pointing
the CLI at a fixture directory when testing.
