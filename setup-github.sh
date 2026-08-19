#!/usr/bin/env bash
# 一键把项目推到你的 GitHub 并生成正确的部署按钮链接。
# 用法:./setup-github.sh <你的GitHub用户名> [仓库名,默认 mychat]
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-mychat}"

if [ -z "$USER_NAME" ]; then
  echo "用法: ./setup-github.sh <你的GitHub用户名> [仓库名,默认 mychat]"
  echo "例如: ./setup-github.sh elliott"
  exit 1
fi

cd "$(dirname "$0")"

# 安全兜底:绝不把真实密钥提交上去
if git ls-files --error-unmatch .dev.vars >/dev/null 2>&1; then
  echo "❌ .dev.vars 已被 git 跟踪,里面可能有真实密钥。请先执行:"
  echo "   git rm --cached .dev.vars"
  exit 1
fi

echo "▶ 把占位符替换成 $USER_NAME/$REPO …"
sed -i '' "s|YOUR_GITHUB_USERNAME/mychat|$USER_NAME/$REPO|g" README.md package.json

echo "▶ 初始化 git 仓库 …"
[ -d .git ] || git init -q
git add -A
git commit -q -m "MyChat: 私人 AI 试用台(Cloudflare Workers + OpenRouter)" || echo "  (没有新变更需要提交)"

echo "▶ 创建公开仓库并推送 …"
echo "  注意:一键部署按钮要求仓库公开。本项目不含任何密钥,公开是安全的。"
if command -v gh >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --push
else
  echo "  未检测到 gh 命令。请先到 https://github.com/new 手动创建公开仓库 '$REPO',然后执行:"
  echo "    git remote add origin https://github.com/$USER_NAME/$REPO.git"
  echo "    git branch -M main && git push -u origin main"
  exit 0
fi

echo ""
echo "✅ 完成!现在打开下面的地址,点 Deploy to Cloudflare 按钮即可一键部署:"
echo "   https://github.com/$USER_NAME/$REPO"
echo ""
echo "   或直接点这个部署链接:"
echo "   https://deploy.workers.cloudflare.com/?url=https://github.com/$USER_NAME/$REPO"
echo ""
echo "   部署过程中会提示你填写 OPENROUTER_API_KEY 和 MASTER_PASSWORD。"
