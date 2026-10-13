#!/usr/bin/env bash
# Fail if a commit, tree or commit range contains a path that must never be
# public: the built-in NEVER list below plus .publicignore.
#
#   scripts/public/check.sh <rev>              # every path in <rev>'s tree
#   scripts/public/check.sh <base>..<head>     # every path touched by those commits
#   scripts/public/check.sh --filter           # stdin: paths → stdout: forbidden ones
#
# The .publicignore copy is read from the PUBLICIGNORE env var if set (CI uses
# the base branch's copy, release.sh the released revision's), else from the
# repo root. Matching runs in an empty scratch repo so no .gitignore on disk
# can un-ignore anything, and ignores case (macOS/Windows clients commit
# "Claude.md" as happily as "CLAUDE.md"). Any error exits non-zero.
set -euo pipefail

# Owner's hard requirement — cannot be weakened by editing .publicignore.
NEVER='_testing/
_manuals/
*.cisco
*-confg
*running-config*
*startup-config*
CLAUDE.md
CLAUDE.local.md
AGENTS.md
.claude/
.agent/
.agents/
.kiro/'

target=${1:?usage: check.sh <rev> | <base>..<head> | --filter}
root=$(git rev-parse --show-toplevel)
patterns_file=${PUBLICIGNORE:-$root/.publicignore}
[ -s "$patterns_file" ] || { echo "public-check: pattern file '$patterns_file' missing or empty" >&2; exit 2; }
# A "!pattern" line would re-include files — including ones on the NEVER list.
if grep -qE '^[[:space:]]*!' "$patterns_file"; then
  echo "public-check: '$patterns_file' contains a negation (!) line — not allowed" >&2
  exit 2
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git -C "$scratch" init -q
{ printf '%s\n' "$NEVER"; cat "$patterns_file"; } > "$scratch/patterns"

# stdin paths → stdout forbidden paths. check-ignore exits 0 = matches,
# 1 = none, anything else = error, which must fail, never pass.
forbidden() {
  local rc=0
  sed '/^$/d' | git -C "$scratch" -c core.ignorecase=true -c core.excludesFile="$scratch/patterns" \
    check-ignore --no-index --stdin || rc=$?
  [ "$rc" -le 1 ] || { echo "public-check: git check-ignore failed (exit $rc)" >&2; return 2; }
}

if [ "$target" = --filter ]; then
  forbidden
  exit
fi

if [[ $target == *..* ]]; then
  # -m: list merge commits' paths against every parent, so a file that only
  # ever existed in a merge resolution is still seen.
  paths=$(git log -m --format= --name-only --no-renames "$target" | sort -u)
  trees=$(git log -m --format=%T "$target" | sort -u)
else
  paths=$(git ls-tree -r --name-only "$target")
  trees=$target
fi

# Submodules (gitlinks) would point the public repo at other repositories.
for t in $trees; do
  if git ls-tree -r "$t" | grep -q '^160000 '; then
    echo "public-check: $target contains a submodule (gitlink) — not allowed" >&2
    exit 1
  fi
done

bad=$(printf '%s\n' "$paths" | forbidden)
if [ -n "$bad" ]; then
  echo "public-check: FORBIDDEN paths in $target:" >&2
  sed 's/^/  /' <<<"$bad" >&2
  exit 1
fi
echo "public-check: OK ($target, $(printf '%s\n' "$paths" | sed '/^$/d' | wc -l) paths)"
