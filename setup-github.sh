#!/usr/bin/env bash
# Push this project to your own GitHub account and print a working deploy link.
# Usage: ./setup-github.sh <your-github-username> [repo-name, defaults to mychat]
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-mychat}"

if [ -z "$USER_NAME" ]; then
  echo "Usage: ./setup-github.sh <your-github-username> [repo-name, defaults to mychat]"
  echo "Example: ./setup-github.sh elliott"
  exit 1
fi

cd "$(dirname "$0")"

# Safety net: never publish real secrets
if git ls-files --error-unmatch .dev.vars >/dev/null 2>&1; then
  echo "❌ .dev.vars is tracked by git and may contain real secrets. Run this first:"
  echo "   git rm --cached .dev.vars"
  exit 1
fi

echo "▶ Pointing repository links at $USER_NAME/$REPO …"
# Rewrite both the placeholder and the upstream author's name, so running this
# after forking also produces a correct deploy link.
for f in README.md README.zh-CN.md package.json; do
  [ -f "$f" ] || continue
  sed -i '' \
    -e "s|YOUR_GITHUB_USERNAME/mychat|$USER_NAME/$REPO|g" \
    -e "s|Elliott-byte/mychat|$USER_NAME/$REPO|g" "$f"
done

echo "▶ Initialising the git repository …"
[ -d .git ] || git init -q
git add -A
git commit -q -m "MyChat: a private AI playground (Cloudflare Workers + OpenRouter)" \
  || echo "  (nothing new to commit)"

# Actually verify the claim instead of just asserting it — this repo is about to
# become public, and a key in an un-ignored file would be published with it.
echo "▶ Scanning tracked files for anything key-shaped …"
SCAN_RE='sk-or-v1-[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{32,}'
# Exclude the placeholder template, and ignore all-x dummy values.
if git grep -InE "$SCAN_RE" -- . ':(exclude).dev.vars.example' | grep -qvE 'x{12,}'; then
  echo "❌ Found something that looks like an API key in a tracked file:"
  git grep -InE "$SCAN_RE" -- . ':(exclude).dev.vars.example' | grep -vE 'x{12,}' | head
  echo "   Remove it before publishing (and rotate it if it was ever committed)."
  exit 1
fi
echo "  ✅ nothing found"

echo "▶ Creating a public repository and pushing …"
echo "  Note: the deploy button requires a public repository."
if command -v gh >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --push
else
  echo "  gh not found. Create a public repository named '$REPO' at https://github.com/new,"
  echo "  then run:"
  echo "    git remote add origin https://github.com/$USER_NAME/$REPO.git"
  echo "    git branch -M main && git push -u origin main"
  exit 0
fi

echo ""
echo "✅ Done. Open the repository below and click Deploy to Cloudflare:"
echo "   https://github.com/$USER_NAME/$REPO"
echo ""
echo "   Or go straight to the deploy link:"
echo "   https://deploy.workers.cloudflare.com/?url=https://github.com/$USER_NAME/$REPO"
echo ""
echo "   You will be prompted for OPENROUTER_API_KEY and MASTER_PASSWORD during setup."
