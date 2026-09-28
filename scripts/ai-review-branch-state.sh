#!/usr/bin/env bash
set -euo pipefail

if [[ "$GITHUB_REF_NAME" == "main" ]]; then
  echo active
  exit 0
fi

# Reason: squash merges lose commit ancestry but retain the commit's PR association.
MERGED_PR_COUNT=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" \
  --jq '[.[] | select(.merged_at != null and .base.ref == "main")] | length')
if (( MERGED_PR_COUNT > 0 )); then
  echo merged
  exit 0
fi

COMPARE_STATUS=$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...main" --jq '.status')
if [[ "$COMPARE_STATUS" == "ahead" || "$COMPARE_STATUS" == "identical" ]]; then
  echo merged
else
  echo active
fi
