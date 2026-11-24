#!/bin/sh
# `pnpm install` runs this through `prepare`. It copies the shipped hooks under
# the git directory and points core.hooksPath at the copy, never at the
# tracked folder: checking out an untrusted ref must not change, or add, the
# hook scripts that run. Every other client hook gets a pass-through to the
# git directory's own hooks, so setting core.hooksPath disables none of them.
# A hooks path someone else set is left alone, with a warning.
# The pre-push lint still loads the checkout's oxlint config and plugin, and
# skips itself when they differ from origin/main.
# It never fails, so CI and image builds pass untouched.
SHIPPED="pre-push commit-msg"
PASS_THROUGH="applypatch-msg pre-applypatch post-applypatch pre-commit pre-merge-commit prepare-commit-msg post-commit pre-rebase post-checkout post-merge post-rewrite pre-auto-gc sendemail-validate reference-transaction post-index-change"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
source_dir=$(cd "$(dirname "$0")" && pwd) || exit 0
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd) || exit 0
target="$common_dir/managed-hooks"

current=$(git config core.hooksPath 2>/dev/null || true)
if [ -n "$current" ] && [ "$current" != "$target" ]; then
  echo "prepare: core.hooksPath is already $current; the repo hooks were not installed. Unset it and rerun pnpm install to use them." >&2
  exit 0
fi

mkdir -p "$target" || exit 0
for hook in $SHIPPED; do
  cp "$source_dir/$hook" "$target/$hook" && chmod 755 "$target/$hook" || exit 0
done
for hook in $PASS_THROUGH; do
  cat >"$target/$hook" <<HOOK || exit 0
#!/bin/sh
# core.hooksPath replaces the git directory's hooks; a local one still runs.
local_hook="\$(git rev-parse --git-common-dir)/hooks/$hook"
if [ -x "\$local_hook" ]; then
  exec "\$local_hook" "\$@"
fi
HOOK
  chmod 755 "$target/$hook" || exit 0
done
git config core.hooksPath "$target" || exit 0
