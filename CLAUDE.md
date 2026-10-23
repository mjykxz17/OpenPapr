@AGENTS.md

## Rules for this directory (session grouping / surviving compaction)
- This is the project's only working directory. Always start Claude Code sessions from here (`ag OpenPapr`), never from `~` — sessions are grouped by the directory they start in.
- `STATE.md` = volatile state (current run / endpoints / PIDs / blockers / next steps). Read it before starting work; always update it when finishing.
- `.claude/checkpoints/` = commands and output the PreCompact hook saves before compaction. Look there when you need an exact run directory or PID.

## Names
The project is now called **OpenPapr**. `one-ring` (old directory name, renamed to OpenPapr on 2026-10-23) and `A4Papr`/CheatsheetMaker (earlier names) all refer to it. Earlier project memory lives in `~/.claude/projects/-Users-aiden-Desktop-Flow-OpenPapr/memory/`.
