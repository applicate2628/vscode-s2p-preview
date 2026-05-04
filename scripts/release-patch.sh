#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "Cannot release from a detached HEAD." >&2
  exit 1
fi

if ! origin="$(git remote get-url origin 2>/dev/null)"; then
  echo "No git remote named 'origin' is configured." >&2
  exit 1
fi

dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  echo "Working tree is not clean:"
  printf '%s\n' "$dirty"
  echo "Commit or stash changes before running release:patch." >&2
  exit 1
fi

package_name="$(node -p "require('./package.json').name")"
old_version="$(node -p "require('./package.json').version")"

echo "Release target: ${package_name} ${old_version} -> patch bump"
echo "Push target: ${origin} (${branch})"

npm version patch --no-git-tag-version

new_version="$(node -p "require('./package.json').version")"
if [[ "$new_version" == "$old_version" ]]; then
  echo "npm version did not change package.json version." >&2
  exit 1
fi

if [[ -f README.md ]]; then
  PACKAGE_NAME="$package_name" NEW_VERSION="$new_version" node <<'NODE'
const fs = require("node:fs");

const packageName = process.env.PACKAGE_NAME;
const newVersion = process.env.NEW_VERSION;
const readmePath = "README.md";
const text = fs.readFileSync(readmePath, "utf8");
const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(`${escapedName}-\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?\\.vsix`, "g");
const updated = text.replace(pattern, `${packageName}-${newVersion}.vsix`);

if (updated !== text) {
  fs.writeFileSync(readmePath, updated);
}
NODE
fi

npm test
npm run package
npm audit
git diff --check

git add package.json package-lock.json README.md
if [[ -z "$(git diff --cached --name-only)" ]]; then
  echo "No version bump changes were staged." >&2
  exit 1
fi

git commit -m "Bump version to ${new_version}"
git push -u origin "$branch"

echo "Released ${package_name} ${new_version} to ${origin} (${branch})."
