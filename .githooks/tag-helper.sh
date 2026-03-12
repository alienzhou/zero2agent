#!/bin/bash

# Zero2Agent Tag Helper
# 用法: .githooks/tag-helper.sh <tag-name>
# 示例: .githooks/tag-helper.sh S01-E001-react-basic

TAG_NAME=$1

if [ -z "$TAG_NAME" ]; then
  echo ""
  echo "╔════════════════════════════════════════════════════════════════════╗"
  echo "║  ❌ 请提供 Tag 名称                                                 ║"
  echo "╠════════════════════════════════════════════════════════════════════╣"
  echo "║  用法: .githooks/tag-helper.sh <tag-name>                          ║"
  echo "║  示例: .githooks/tag-helper.sh S01-E001-react-basic                ║"
  echo "╚════════════════════════════════════════════════════════════════════╝"
  exit 1
fi

# 检查 Tag 格式：S01-E001-slug
if [[ ! "$TAG_NAME" =~ ^S[0-9]{2}-E[0-9]{3}-[a-z0-9-]+$ ]]; then
  echo ""
  echo "╔════════════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  Tag 格式不正确！                                               ║"
  echo "╠════════════════════════════════════════════════════════════════════╣"
  echo "║  当前: $TAG_NAME"
  echo "║  期望: S01-E001-<slug>                                             ║"
  echo "║                                                                    ║"
  echo "║  规则:                                                             ║"
  echo "║    - S01: Stage 编号（2位）                                        ║"
  echo "║    - E001: 迭代编号（3位）                                         ║"
  echo "║    - slug: 2-4 个单词，kebab-case                                  ║"
  echo "║                                                                    ║"
  echo "║  示例:                                                             ║"
  echo "║    S01-E001-react-basic                                            ║"
  echo "║    S01-E002-context-mgmt                                           ║"
  echo "╚════════════════════════════════════════════════════════════════════╝"
  exit 1
fi

# 格式正确，创建 Tag
git tag "$TAG_NAME"

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  ✅ Tag 创建成功！                                                   ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║  Tag: $TAG_NAME"
echo "║                                                                    ║"
echo "║  下一步:                                                           ║"
echo "║    git push origin $TAG_NAME"
echo "║                                                                    ║"
echo "║  或推送所有 Tags:                                                   ║"
echo "║    git push origin --tags                                          ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
