#!/bin/bash
set -e

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh CLI is not authenticated. Run 'gh auth login'."
  exit 1
fi

TAG_ARG="${1:-}"

if [ -n "$TAG_ARG" ]; then
  echo "Downloads for $TAG_ARG:"
  echo ""
  gh api "repos/{owner}/{repo}/releases/tags/$TAG_ARG" \
    --jq '.assets[] | "  \(.download_count)\t\(.name)"'
  exit 0
fi

echo "Downloads by release:"
echo ""

gh api 'repos/{owner}/{repo}/releases' --paginate \
  --jq '.[] | "\(.tag_name)\n" + ([.assets[] | "  \(.download_count)\t\(.name)"] | join("\n"))'

TOTAL=$(gh api 'repos/{owner}/{repo}/releases' --paginate \
  --jq '[.[] | .assets[] | .download_count] | add // 0')

echo ""
echo "Total downloads across all releases: $TOTAL"
