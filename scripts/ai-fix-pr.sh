#!/usr/bin/env bash
set -euo pipefail

FIX_BRANCH="ai-fix/main-${GITHUB_SHA:0:12}-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
gh auth setup-git
git fetch origin "$GITHUB_REF_NAME"
SOURCE_TIP=$(git rev-parse FETCH_HEAD)
if ! git merge-base --is-ancestor "$GITHUB_SHA" FETCH_HEAD; then
  echo "Source branch was rewritten; review fixes cannot be proposed safely" | tee -a "$GITHUB_STEP_SUMMARY"
  exit 1
fi
git switch -c "$FIX_BRANCH"
git add -u
git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -m "Apply AI review fixes for ${GITHUB_SHA:0:12}"
git push origin "$FIX_BRANCH"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT
{
  echo "AI review fixes for [${GITHUB_SHA:0:12}](https://github.com/$GITHUB_REPOSITORY/commit/$GITHUB_SHA)."
  echo "AI review base: $AI_REVIEW_BASE"
  echo
  echo "The review job validated these edits against that commit. If the target branch advanced, review the merge result and resolve any conflicts before merging."
  if [[ "$SOURCE_TIP" != "$GITHUB_SHA" ]]; then
    echo
    echo "The target branch had advanced to ${SOURCE_TIP:0:12} before this PR was opened."
  fi
  echo
  echo "### Review"
  echo
  cat "$RUNNER_TEMP/ai-review-findings.txt"
} > "$BODY_FILE"

PR_URL=$(gh pr create --repo "$GITHUB_REPOSITORY" --base "$GITHUB_REF_NAME" --head "$FIX_BRANCH" \
  --title "Apply AI review fixes for ${GITHUB_SHA:0:12}" --body-file "$BODY_FILE")
./scripts/close-superseded-ai-fix-prs.sh
echo "AI review opened fix PR: $PR_URL" | tee -a "$GITHUB_STEP_SUMMARY"
exit 1
