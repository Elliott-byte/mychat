#!/usr/bin/env bash
# 把本仓库的最新代码同步到「一键部署」时 Cloudflare 克隆出的那个仓库。
# 推送完成后 Workers Builds 会自动重新构建并部署。
#
# 背景:点 Deploy to Cloudflare 按钮时,Cloudflare 会克隆一份新仓库,
# 并把 wrangler.jsonc / package.json 里的 name 改成新仓库名(原名已被占用)。
# 这个 name 决定 Worker 名字和访问网址,而你填的密钥绑在那个 Worker 上,
# 所以同步时必须保留它 —— 否则会部署出一个全新的 Worker,网址变了、密钥也要重填。
#
# 本脚本采用合并(merge)方式,不会重写目标仓库历史。
#
# 用法:./sync-deploy.sh [部署仓库名,默认 mychat-deploy]
set -euo pipefail

DEPLOY_REPO="${1:-mychat-deploy}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

OWNER=$(gh api user --jq .login)
if ! gh repo view "$OWNER/$DEPLOY_REPO" >/dev/null 2>&1; then
  echo "❌ 找不到仓库 $OWNER/$DEPLOY_REPO"
  echo "   部署仓库若是别的名字,作为参数传入,例如:./sync-deploy.sh my-repo"
  exit 1
fi

if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
  echo "❌ 源仓库有未提交改动,请先 commit。"
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "▶ 克隆部署仓库 $OWNER/$DEPLOY_REPO …"
git clone -q "https://github.com/$OWNER/$DEPLOY_REPO.git" "$WORK/deploy"
cd "$WORK/deploy"

# 记下它当前的 Worker 名(决定网址,同步后必须保持不变)
KEEP_NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' wrangler.jsonc | head -1)
echo "▶ 保留 Worker 名:$KEEP_NAME"

echo "▶ 拉取源仓库最新代码并合并 …"
git remote add src "$SRC_DIR"
git fetch -q src main
# 两边历史无共同祖先(克隆时是全新提交),需要允许合并无关历史;
# 冲突一律以源仓库为准,name 随后单独改回。
git merge -q --allow-unrelated-histories -X theirs --no-edit src/main \
  || { echo "❌ 合并失败,请手动处理:$WORK/deploy"; trap - EXIT; exit 1; }

# 把 name 改回部署仓库自己的名字
sed -i '' "s|\"name\": \"mychat\"|\"name\": \"$KEEP_NAME\"|" wrangler.jsonc package.json
if [ -n "$(git status --porcelain)" ]; then
  git commit -q -am "保留 Worker 名 $KEEP_NAME"
fi

echo "▶ 推送 …"
git push -q origin HEAD:main

echo ""
echo "✅ 已同步。Cloudflare 会自动触发重新构建。"
echo "   构建进度:Cloudflare 控制台 → Workers & Pages → $KEEP_NAME → Deployments"
