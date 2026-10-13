#!/usr/bin/env bash
# CI helper for publish.yml: put the .vsix attached to this tag's GitHub Release
# into the working directory, so the stores get exactly the released file.
# Fails (rather than publishing something else) when the run isn't on a release
# tag, the tag doesn't match package.json, the version is a pre-release, or the
# release doesn't carry exactly the expected .vsix with the sha256 that
# release.yml recorded when it built it (EXPECTED_SHA256).
set -euo pipefail

die() { echo "::error::$*" >&2; exit 1; }

[ "${GITHUB_REF_TYPE:-}" = tag ] || die "publish.yml must run on a release tag, not '${GITHUB_REF_NAME:-?}'"
[[ ${EXPECTED_SHA256:-} =~ ^[0-9a-f]{64}$ ]] || die "EXPECTED_SHA256 must be the 64-hex sha256 of the released .vsix"
tag=$GITHUB_REF_NAME
name=$(node -p 'require("./package.json").name')
version=$(node -p 'require("./package.json").version')
[ "$tag" = "v$version" ] || die "tag $tag does not match package.json version $version"
# The Marketplace rejects semver pre-release versions outright, and ovsx ignores
# --pre-release for a prepackaged .vsix (it would publish an RC as stable).
case $version in *-*) die "pre-release version $version can't be published to the stores" ;; esac

[ -z "$(compgen -G '*.vsix' || true)" ] || die "a .vsix already exists in the checkout"
gh release download "$tag" --repo "$GITHUB_REPOSITORY" --pattern "$name-$version.vsix"
[ "$(compgen -G '*.vsix')" = "$name-$version.vsix" ] || die "expected exactly $name-$version.vsix"
actual=$(sha256sum "$name-$version.vsix" | cut -d' ' -f1)
[ "$actual" = "$EXPECTED_SHA256" ] ||
  die "$name-$version.vsix has sha256 $actual, not the released $EXPECTED_SHA256 — refusing to publish"
echo "Publishing the released $name-$version.vsix (sha256 $actual)"
