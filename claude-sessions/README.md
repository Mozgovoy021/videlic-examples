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
./cli.js            # table
./cli.js --json     # same data as JSON
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
