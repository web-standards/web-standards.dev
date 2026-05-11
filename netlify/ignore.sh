#!/usr/bin/env bash
# Netlify ignore script.
# Exit 0 -> skip build, non-zero -> proceed with build.
#
# Skip the build only when every changed file belongs to a news entry
# directory (src/news/YYYY/MM/slug/*) whose index.yml still has
# `draft: true`.

set -euo pipefail

BASE="${CACHED_COMMIT_REF:-}"
HEAD="${COMMIT_REF:-HEAD}"

# No cached commit means a fresh deploy; always build.
if [ -z "$BASE" ]; then
	echo "No cached commit ref, proceeding with build."
	exit 1
fi

# List changed files; if the diff fails (e.g. shallow clone missing BASE),
# play it safe and build.
if ! CHANGED=$(git diff --name-only "$BASE" "$HEAD" 2>/dev/null); then
	echo "Could not compute diff against $BASE, proceeding with build."
	exit 1
fi

if [ -z "$CHANGED" ]; then
	echo "No changes detected, proceeding with build."
	exit 1
fi

echo "Changed files:"
echo "$CHANGED"

while IFS= read -r file; do
	# Only files inside a news entry directory are eligible.
	case "$file" in
		src/news/*/*/*/*)
			entry_dir="${file%/*}"
			;;
		*)
			echo "Non-draft change: $file"
			exit 1
			;;
	esac

	# The entry's index.yml in HEAD must still have `draft: true`.
	if ! git show "$HEAD:$entry_dir/index.yml" 2>/dev/null | grep -q '^draft: true'; then
		echo "Published news change: $file"
		exit 1
	fi
done <<< "$CHANGED"

echo "All changes are drafts, skipping build."
exit 0
