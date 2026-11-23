#!/usr/bin/env bash
set -euo pipefail

: "${BASE_BRANCH:?Set BASE_BRANCH to the resolved integration branch}"
: "${GH_REPO:?Set GH_REPO to the repository}"

git add -- ui/src/locales
if git diff --cached --quiet; then
	echo 'No translation changes to publish.'
	exit 0
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git switch -c crowdin-download
git commit -m 'chore(i18n): sync translations from Crowdin'
download_head=$(git rev-parse HEAD)

# Merge the download into the existing branch while the checkout is clean.
# Conflicts and concurrent remote updates fail before any history is replaced.
remote_ref=$(git ls-remote --heads origin refs/heads/l10n_crowdin)
publish=true
if [ -n "$remote_ref" ]; then
	git fetch origin refs/heads/l10n_crowdin
	remote_head=$(git rev-parse FETCH_HEAD)
	git switch -c l10n_crowdin FETCH_HEAD
	git merge --no-edit -m 'chore(i18n): merge downloaded translations' "$download_head"
	if git diff --quiet "$remote_head" HEAD; then
		echo 'Localization branch content unchanged.'
		publish=false
	fi
else
	git switch -c l10n_crowdin "$download_head"
fi
if [ "$publish" = true ]; then
	git push origin HEAD:refs/heads/l10n_crowdin
fi

pulls="repos/${GH_REPO}/pulls"
existing=$(gh api --method GET "$pulls" -f state=open \
	-f "head=${GH_REPO%%/*}:l10n_crowdin" --jq '.[0].number // empty')
if [ -n "$existing" ]; then
	gh api --method PATCH "${pulls}/${existing}" -f "base=${BASE_BRANCH}" --silent
	pr=$existing
else
	pr=$(gh api --method POST "$pulls" -f "base=${BASE_BRANCH}" -f head=l10n_crowdin \
		-f 'title=chore(i18n): sync translations from Crowdin' \
		-f 'body=Automated sync from Crowdin. Review wording, then merge.' --jq .number)
fi
gh api --method GET "${pulls}/${pr}" --jq '{url: .html_url, head: .head.ref, base: .base.ref}'
printf '%s' '{"labels":["translations","crowdin"]}' |
	gh api --method POST "repos/${GH_REPO}/issues/${pr}/labels" --input - --silent
