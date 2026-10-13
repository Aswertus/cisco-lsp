#!/usr/bin/env bash
# Publish a release from the private dev repo to the public repo.
#
#   scripts/public/release.sh vX.Y.Z              # build commit, push release/vX.Y.Z, open PR
#   scripts/public/release.sh vX.Y.Z --bootstrap  # first release only: push straight to public main
#   scripts/public/release.sh vX.Y.Z --tag        # after the PR is merged: tag public main
#
# The release commit is ONE commit on top of public main whose tree is the
# private `main` tree minus everything check.sh forbids — no private history,
# commit messages or excluded files ever leave this machine. Commits and tags
# carry the GitHub noreply identity, never a personal address.
set -euo pipefail

PUBLIC_REPO=Aswertus/cisco-lsp
PUBLIC_URL=https://github.com/$PUBLIC_REPO.git
IDENTITY_NAME=Aswertus
IDENTITY_EMAIL=1096961+Aswertus@users.noreply.github.com
tag=${1:?usage: release.sh vX.Y.Z [--bootstrap|--tag]}
mode=${2:---pr}
src=main
root=$(git rev-parse --show-toplevel)
cd "$root"
check=$root/scripts/public/check.sh
hook=$(git rev-parse --git-common-dir)/hooks/pre-push

die() { echo "release: $*" >&2; exit 1; }

case $mode in --pr | --bootstrap | --tag) ;; *) die "unknown mode '$mode'" ;; esac
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "tag must look like vX.Y.Z"
cmp -s "$hook" scripts/git-hooks/pre-push ||
  die "pre-push guard missing or outdated — run: cp scripts/git-hooks/pre-push '$hook'"
[ -z "$(git config core.hooksPath || true)" ] || die "core.hooksPath is set; it would bypass $hook — unset it"

export GIT_AUTHOR_NAME=$IDENTITY_NAME GIT_AUTHOR_EMAIL=$IDENTITY_EMAIL
export GIT_COMMITTER_NAME=$IDENTITY_NAME GIT_COMMITTER_EMAIL=$IDENTITY_EMAIL

git remote get-url public >/dev/null 2>&1 || git remote add public "$PUBLIC_URL"
[ "$(git remote get-url public)" = "$PUBLIC_URL" ] || die "remote 'public' does not point at $PUBLIC_URL"
git fetch --quiet origin
git fetch --quiet --prune public
have_main=$(git rev-parse --verify --quiet refs/remotes/public/main || true)

if [ "$mode" = --tag ]; then
  [ -n "$have_main" ] || die "public main does not exist"
  [ "$(git rev-parse public/main^{tree})" = "$(git rev-parse "public/release/$tag^{tree}" 2>/dev/null || echo none)" ] ||
    [ "$(git log -1 --format=%s public/main)" = "release: $tag" ] ||
    die "public main is not the merged release/$tag (merge the PR first)"
  git tag -a "$tag" -m "release: $tag" public/main
  git push public "refs/tags/$tag"
  git push public --delete "release/$tag" 2>/dev/null || true
  echo "release: tagged $tag on public main — release.yml builds the GitHub Release, publish.yml the stores."
  exit 0
fi

[ "$(git rev-parse "$src")" = "$(git rev-parse "origin/$src")" ] ||
  die "local $src differs from origin/$src — push/pull the private repo first"
version=$(git show "$src:package.json" | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')
[ "v$version" = "$tag" ] || die "$src's package.json says $version, not ${tag#v}"

tree=$("$root/scripts/public/build-tree.sh" "$src") || die "could not build the public tree"
node "$root/scripts/public/audit.js" "$tree" || die "content audit failed"

if [ "$mode" = --bootstrap ]; then
  [ -z "$have_main" ] || die "--bootstrap is only for an empty public repo"
  commit=$(git commit-tree "$tree" -m "release: $tag")
  git show --stat --format='%H %s' "$commit" | tail -3
  git push public "$commit:refs/heads/main"
  echo "release: public main bootstrapped at $tag — now run: $0 $tag --tag"
  exit 0
fi

[ -n "$have_main" ] || die "public main does not exist — first release needs --bootstrap"
[ "$tree" != "$(git rev-parse public/main^{tree})" ] || die "nothing to release: public main already has this tree"
commit=$(git commit-tree "$tree" -p public/main -m "release: $tag")

echo "release: changes going public in $tag:"
git diff --stat public/main "$commit"
git push public "$commit:refs/heads/release/$tag"
gh pr create -R "$PUBLIC_REPO" --base main --head "release/$tag" --title "release: $tag" \
  --body "Release $tag. One squashed commit built from the private dev repo by \`scripts/public/release.sh\`; see CHANGELOG.md for what changed. After merging, run \`scripts/public/release.sh $tag --tag\`."
