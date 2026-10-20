#!/bin/bash
# merge.sh <lane> — merge lane/<lane> into main in repo/, union-resolve simple conflicts, report what's left
ROOT="/Users/Digital Next/Projects/Infini Shoot Game"; L=$1
cd "$ROOT/repo"
if [ -n "$(git diff --name-only --diff-filter=U)" ]; then echo "UNRESOLVED merge in progress"; exit 3; fi
git fetch -q origin; git merge -q --ff-only origin/main 2>/dev/null
git merge --no-ff -q "lane/$L" -m "Merge lane/$L (v2.0 overnight build)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" >/dev/null 2>&1
C=$(git diff --name-only --diff-filter=U)
if [ -n "$C" ]; then echo "CONFLICTS:"; echo "$C"; exit 2; fi
echo "merged clean"
