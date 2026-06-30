---
name: feedback-git-commits
description: Commit changes to claude_dev branch regularly after each meaningful change
metadata:
  type: feedback
---

Commit changes to the `claude_dev` branch regularly — after each meaningful change (new feature, modified file, config tweak), not just at the end of a session.

**Why:** User wants a clear git history to track changes and be able to roll back if something breaks.

**How to apply:** After creating or modifying any project file, stage and commit it to `claude_dev` before moving on. Use descriptive commit messages. Do not batch unrelated changes into one commit. Never push without explicit user approval.
