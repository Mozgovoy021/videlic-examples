# videlic-examples
Small real projects written with a coding agent

## claude-sessions

Lists the Claude Code transcripts in `~/.claude/projects`, one line per session:
date, project name, turns, file size. No dependencies, Node 18+.

```bash
node bin/claude-sessions.js
node bin/claude-sessions.js --json
node bin/claude-sessions.js --dir /path/to/projects
```

```
2026-09-12  videlic             16   5.3 MB
2026-09-08  hookupers-backend   22   2.0 MB
```

A *turn* is one human prompt. Tool results, subagent sidechains and system
records are not counted. The project name comes from the `cwd` recorded in the
transcript, falling back to the encoded directory name.
