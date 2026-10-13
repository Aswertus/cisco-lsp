#!/usr/bin/env bash
# Print the git tree that a release of <rev> would publish: <rev>'s tree minus
# every path check.sh forbids, using <rev>'s own .publicignore. Verifies the
# result with check.sh before printing it. Writes only git objects.
#
#   scripts/public/build-tree.sh [<rev>]     # default: main
set -euo pipefail

src=${1:-main}
root=$(git rev-parse --show-toplevel)
check=$root/scripts/public/check.sh

export PUBLICIGNORE
PUBLICIGNORE=$(mktemp)
idx=$(mktemp)
trap 'rm -f "$PUBLICIGNORE" "$idx"' EXIT
git show "$src:.publicignore" > "$PUBLICIGNORE" || { echo "build-tree: $src has no .publicignore" >&2; exit 1; }

GIT_INDEX_FILE=$idx git read-tree "$src"
GIT_INDEX_FILE=$idx git ls-files | "$check" --filter | GIT_INDEX_FILE=$idx git update-index --force-remove --stdin
tree=$(GIT_INDEX_FILE=$idx git write-tree)

"$check" "$tree" >&2 || { echo "build-tree: stripped tree still contains forbidden paths" >&2; exit 1; }
echo "$tree"
