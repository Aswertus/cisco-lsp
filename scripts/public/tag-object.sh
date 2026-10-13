#!/usr/bin/env bash
# Write the annotated release tag object for release.sh --tag and print its id.
#
#   scripts/public/tag-object.sh <commit> <expected tree> <vX.Y.Z> <tagger name> <tagger email>
#
# Refuses unless <commit>'s tree is exactly <expected tree> (the tree release.sh
# builds from private main), so only the merged release content gets tagged.
# Built directly with mktag instead of `git tag`: the local refs/tags/ namespace
# holds the private history's tags, which must neither clash nor go public.
# test/public-guard.test.js covers the tree gate and runs the result through
# the pre-push guard.
set -euo pipefail
die() { echo "tag-object: $*" >&2; exit 1; }
commit=$(git rev-parse --verify --quiet "${1:?commit}^{commit}") || die "not a commit: $1"
expected=${2:?expected tree} tag=${3:?tag} name=${4:?tagger name} email=${5:?tagger email}
[ "$(git rev-parse "$commit^{tree}")" = "$(git rev-parse --verify --quiet "$expected^{tree}" || echo none)" ] ||
  die "$commit does not carry the expected release tree $expected"
printf 'object %s\ntype commit\ntag %s\ntagger %s <%s> %s +0000\n\nrelease: %s\n' \
  "$commit" "$tag" "$name" "$email" "$(date +%s)" "$tag" | git mktag
