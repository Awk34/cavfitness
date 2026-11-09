---
trigger: always_on
---

# Commit Message Rules

Only consider staged changes when generating commit messages. Do not use unstaged changes or context from the working tree.
If there are no staged changes but there are unstaged changes generate the commit message using the unstaged changes.
