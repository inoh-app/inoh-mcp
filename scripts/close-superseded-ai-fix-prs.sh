#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "$RUNNER_TEMP/previous-ai-fix-prs.txt" ]]; then
  exit 0
fi

while IFS= read -r pr_number; do
  if [[ -z "$pr_number" ]]; then
    continue
  fi
  state=$(gh pr view "$pr_number" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
  if [[ "$state" == OPEN ]]; then
    gh pr close "$pr_number" --repo "$GITHUB_REPOSITORY" --delete-branch
    echo "Closed superseded AI fix PR #$pr_number" >> "$GITHUB_STEP_SUMMARY"
  fi
done < "$RUNNER_TEMP/previous-ai-fix-prs.txt"
