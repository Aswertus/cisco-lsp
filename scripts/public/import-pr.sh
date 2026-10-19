#!/usr/bin/env bash
# Bring a pull request from the public repo into the private dev branch.
#
#   scripts/public/import-pr.sh <N>                # fetch PR N from public, cherry-pick it onto the current branch
#   scripts/public/import-pr.sh <N> --close vX.Y.Z # after the release that shipped it: comment on and close PR N
#
# Public main only ever receives squashed release commits, so a contribution
# cannot be merged there: it is cherry-picked onto the dev branch (keeping the
# contributor as author, `-x` records the public commit it came from), reviewed
# and released like any other change. release.sh credits the author on the
# release commit (Co-authored-by) because the squash would otherwise hide them.
# If the cherry-pick conflicts, apply the PR onto the dev-vX.Y.Z tag it was
# written against and merge that branch forward instead.
set -euo pipefail

PUBLIC_REPO=Aswertus/cisco-lsp
n=${1:?usage: import-pr.sh <N> [--close vX.Y.Z]}
[[ $n =~ ^[0-9]+$ ]] || { echo "import-pr: <N> must be a pull request number" >&2; exit 1; }
die() { echo "import-pr: $*" >&2; exit 1; }

if [ "${2:-}" = --close ]; then
  tag=${3:?usage: import-pr.sh <N> --close vX.Y.Z}
  gh pr close "$n" -R "$PUBLIC_REPO" \
    --comment "Merged into the development repository and released in $tag — thank you! (Public main only carries release commits, so the pull request itself is closed rather than merged; you are credited on the release commit.)"
  exit 0
fi
[ $# -eq 1 ] || die "unknown option: $2"

root=$(git rev-parse --show-toplevel)
cd "$root"
[ -z "$(git status --porcelain)" ] || die "working tree not clean — commit or stash first"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" != main ] && [ "$branch" != HEAD ] || die "check out the dev branch (claude_dev) first — never cherry-pick onto main"
git remote get-url public >/dev/null 2>&1 || die "remote 'public' is missing (release.sh adds it)"

# --no-tags: public vX.Y.Z tags must not land in the private refs/tags/ namespace.
git fetch --quiet --no-tags public main
git fetch --quiet --no-tags public "refs/pull/$n/head" || die "pull request #$n not found on $PUBLIC_REPO"
head=$(git rev-parse FETCH_HEAD)
base=$(git merge-base refs/remotes/public/main "$head") || die "PR #$n shares no history with public main"
count=$(git rev-list --count "$base..$head")
[ "$count" -gt 0 ] || die "PR #$n has no commits beyond public main"

echo "import-pr: cherry-picking $count commit(s) of PR #$n onto $branch:"
git log --format='  %h %an — %s' "$base..$head"
if ! git cherry-pick -x "$base..$head"; then
  echo "import-pr: conflict — resolve and \`git cherry-pick --continue\`, or \`git cherry-pick --abort\` and apply the PR onto the dev-vX.Y.Z tag it was written against, then merge that branch into $branch." >&2
  exit 1
fi
echo "import-pr: done — review, test, release; then: $0 $n --close vX.Y.Z"
