#!/bin/bash
# lane.sh <lane> <codex|claude2> [base-branch]
# One builder per lane in its own git worktree (.agent-logs/wt/<lane>, branch lane/<lane>),
# briefed from .agent-logs/briefs/_common.md + <lane>.md, logging to .agent-logs/<lane>.log.
# Everything under .agent-logs/ is git-ignored. Remove with: git worktree remove .agent-logs/wt/<lane>
set -e
L=$1; R=$2; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; BASE=${3:-$(git -C "$ROOT" branch --show-current)}
WT="$ROOT/.agent-logs/wt/$L"
cd "$ROOT"
[ -d "$WT" ] || { git worktree add -q "$WT" -b "lane/$L" "$BASE"; cp -Rc node_modules "$WT/node_modules"; }
{ sed "s/<LANE>/$L/g" .agent-logs/briefs/_common.md; echo; cat ".agent-logs/briefs/$L.md"; } > "$WT/.lane-brief.md"
cd "$WT"
if [ "$R" = codex ]; then
  TIER=$(codex debug models 2>/dev/null | grep -q ultrafast && echo ultrafast || echo priority)
  nohup codex exec -C . -s workspace-write -c service_tier=$TIER "$(cat .lane-brief.md)" < /dev/null > "$ROOT/.agent-logs/$L.log" 2>&1 &
else
  nohup "$HOME/.claude/tools/claude2.sh" -p "$(cat .lane-brief.md)" --permission-mode acceptEdits \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep" < /dev/null > "$ROOT/.agent-logs/$L.log" 2>&1 &
fi
echo "launched $L ($R) pid $! in $WT"
