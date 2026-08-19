#!/usr/bin/env bash
# Sync this repository's latest code into the clone Cloudflare created when you
# used the one-click deploy button. Pushing there triggers a rebuild and deploy.
#
# Background: the Deploy to Cloudflare button clones your repo into a new
# repository (adding a suffix when the name is taken) and rewrites `name` in
# wrangler.jsonc and package.json to that new repository's name. That `name`
# decides which Worker you deploy to and what its URL is, and your secrets are
# attached to that Worker — so the name must be preserved. Overwriting it
# blindly would deploy a brand-new Worker under a different URL with no secrets.
#
# This script merges rather than force-pushes, so the target's history is intact.
#
# Usage: ./sync-deploy.sh [deploy-repo-name, defaults to mychat-deploy]
set -euo pipefail

DEPLOY_REPO="${1:-mychat-deploy}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

OWNER=$(gh api user --jq .login)
if ! gh repo view "$OWNER/$DEPLOY_REPO" >/dev/null 2>&1; then
  echo "❌ Cannot find repository $OWNER/$DEPLOY_REPO"
  echo "   If your deploy repo has a different name, pass it in:"
  echo "   ./sync-deploy.sh my-repo"
  exit 1
fi

if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
  echo "❌ This repository has uncommitted changes. Commit them first."
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "▶ Cloning $OWNER/$DEPLOY_REPO …"
git clone -q "https://github.com/$OWNER/$DEPLOY_REPO.git" "$WORK/deploy"
cd "$WORK/deploy"

# Record the Worker name it currently uses; the URL depends on it
KEEP_NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' wrangler.jsonc | head -1)
echo "▶ Preserving Worker name: $KEEP_NAME"

echo "▶ Fetching and merging the latest code …"
git remote add src "$SRC_DIR"
git fetch -q src main
# The two histories share no common ancestor (the clone started fresh), so the
# merge has to allow unrelated histories. Conflicts resolve in favour of the
# source repo; the name is restored immediately afterwards.
git merge -q --allow-unrelated-histories -X theirs --no-edit src/main \
  || { echo "❌ Merge failed. Resolve it by hand in: $WORK/deploy"; trap - EXIT; exit 1; }

sed -i '' "s|\"name\": \"mychat\"|\"name\": \"$KEEP_NAME\"|" wrangler.jsonc package.json
if [ -n "$(git status --porcelain)" ]; then
  git commit -q -am "Preserve Worker name $KEEP_NAME"
fi

echo "▶ Pushing …"
git push -q origin HEAD:main

echo ""
echo "✅ Synced. Cloudflare will rebuild automatically."
echo "   Progress: Cloudflare dashboard → Workers & Pages → $KEEP_NAME → Deployments"
