#!/bin/sh
# `pnpm install` runs this through `prepare`. It copies the shipped hooks under
# the git directory and points core.hooksPath at the copy, never at the
# tracked folder: checking out an untrusted ref must not change, or add, the
# hook scripts that run. The pre-push lint still loads the checkout's oxlint
# config and plugin, and skips itself when they differ from origin/main.
# It never fails, so CI and image builds pass untouched.
HOOKS="pre-push commit-msg"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
source_dir=$(cd "$(dirname "$0")" && pwd) || exit 0
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd) || exit 0
target="$common_dir/managed-hooks"

mkdir -p "$target" || exit 0
for hook in $HOOKS; do
  cp "$source_dir/$hook" "$target/$hook" && chmod 755 "$target/$hook" || exit 0
done
git config core.hooksPath "$target" || exit 0
