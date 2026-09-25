@AGENTS.md

## 本目录的规矩 (会话分组 / 抗压缩)
- 这是本项目唯一工作目录; Claude Code 会话一律从这里启动 (`ag one-ring`), 不要从 `~` 起 —— 会话是按启动目录分组的。
- `STATE.md` = 易失状态 (当前 run / 端点 / PID / blocker / 下一步)。开工先读, 收工必写。
- `.claude/checkpoints/` = PreCompact 钩子在压缩前落盘的命令与输出; 需要确切 run 目录或 PID 时去那里翻。

## 名字
本项目现名 **OpenPapr**;`one-ring`(目录名) 与 `A4Papr`/CheatsheetMaker(早期名) 指的都是它。早期项目记忆在 `~/.claude/projects/-Users-aiden-Desktop-Flow-one-ring/memory/`。
