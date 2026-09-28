#!/usr/bin/env bash
set -euo pipefail

if (( $# != 2 )); then
  echo "Usage: ai-review-scope.sh BEFORE_SHA AFTER_SHA" >&2
  exit 1
fi

REVIEW_BASE=$1
AFTER_SHA=$2
git cat-file -e "${REVIEW_BASE}^{commit}"
git cat-file -e "${AFTER_SHA}^{commit}"
if ! git merge-base --is-ancestor "$REVIEW_BASE" "$AFTER_SHA"; then
  echo "Push base is not an ancestor of the reviewed main commit" >&2
  exit 1
fi

PR_LIST=$(gh pr list --repo "$GITHUB_REPOSITORY" --base main --state open --limit 100 \
  --json number,headRefName,body,author)
: > "$RUNNER_TEMP/previous-ai-fix-prs.txt"
PR_COUNT=0
while IFS= read -r pr_number; do
  previous_base=$(jq -r --argjson number "$pr_number" \
    '.[] | select(.number == $number) | .body | capture("AI review base: (?<base>[0-9a-f]{40})").base' \
    <<< "$PR_LIST")
  if [[ ! "$previous_base" =~ ^[0-9a-f]{40}$ ]]; then
    echo "AI fix PR #$pr_number has no valid review base; keeping it open" >&2
    exit 1
  fi
  git cat-file -e "${previous_base}^{commit}"
  if ! git merge-base --is-ancestor "$previous_base" "$AFTER_SHA"; then
    echo "AI fix PR #$pr_number is not based on current main; keeping it open" >&2
    exit 1
  fi
  if git merge-base --is-ancestor "$previous_base" "$REVIEW_BASE"; then
    REVIEW_BASE=$previous_base
  elif ! git merge-base --is-ancestor "$REVIEW_BASE" "$previous_base"; then
    echo "AI fix PR #$pr_number has an unrelated review base; keeping it open" >&2
    exit 1
  fi
  printf '%s\n' "$pr_number" >> "$RUNNER_TEMP/previous-ai-fix-prs.txt"
  PR_COUNT=$((PR_COUNT + 1))
done < <(jq -r '.[] | select(.author.login == "app/github-actions" and (.headRefName | startswith("ai-fix/main-"))) | .number' <<< "$PR_LIST")

printf 'base=%s\n' "$REVIEW_BASE" >> "$GITHUB_OUTPUT"
if (( PR_COUNT > 0 )); then
  echo "Reviewing from $REVIEW_BASE to include unresolved changes from earlier AI fix PRs" >> "$GITHUB_STEP_SUMMARY"
fi
