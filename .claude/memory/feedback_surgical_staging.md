---
name: feedback-surgical-staging
description: When files needed for a commit already have unrelated pending edits from other in-progress work, stage only the intended change via git hash-object/update-index rather than committing the whole file
metadata:
  type: feedback
---

This repo tends to have multiple features in flight at once with uncommitted changes sitting
in the working tree (e.g. an outline-panel/grammar-bundling feature was mid-flight,
untracked/uncommitted, while a large command-data ingestion task was done in the same
session). When a file I need to touch (`package.json`, `cspell.json`, `CLAUDE.md`,
`CHANGELOG.md`, etc.) already has unrelated pending edits mixed in, `git add <file>` would
bundle that unrelated work into my commit.

**Why:** [[feedback_git_commits]] already says "do not batch unrelated changes into one
commit" — this is the concrete technique for honoring that when the _same file_ has both my
change and someone else's uncommitted change tangled together, not just when changes are in
different files.

**How to apply:**

1. Get the last-committed version: `git show HEAD:<path> > /tmp/base.<ext>`.
2. Apply _only_ my intended edit to that temp copy (not the real working-tree file, which
   must stay untouched so the other pending work isn't disturbed on disk).
3. Stage the result without touching the working tree:
   `git hash-object -w /tmp/base.<ext>` then
   `git update-index --cacheinfo 100644 <hash> <path>`.
4. `git diff --cached <path>` to confirm the staged diff contains only my change before
   committing.

For a file that isn't tracked in git at all yet (entirely new, from other pending work) and
I only need to add a small piece to it (e.g. one new grammar rule in a TextMate grammar JSON
file), there's no HEAD baseline to reconstruct from — in that case just leave it uncommitted
entirely, apply the change to the working-tree file so it's functional/testable, and tell the
user it'll be committed together whenever that other file's own work is first committed.

For simple array-appends (e.g. adding new words to `cspell.json`'s `words` list), a plain
text-based insert onto the HEAD copy is enough — no need for a full JSON.parse/stringify
round-trip, which would also strip existing comments (cspell.json has `//` comments, so it's
JSONC, not strict JSON).
