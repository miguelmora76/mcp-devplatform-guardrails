#!/bin/sh
# Pre-commit hook: scans the staged changes for secrets with gitleaks and blocks the
# commit if it finds any. It is NOT installed automatically. To install it yourself:
#
#   ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit
#
# Needs gitleaks on the PATH (https://github.com/gitleaks/gitleaks#installing). If it is
# missing the commit is blocked, so a skipped scan can never go unnoticed.

set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "pre-commit: gitleaks is not installed, so staged changes cannot be scanned." >&2
  echo "Install it (for example: brew install gitleaks) and commit again." >&2
  exit 1
fi

root=$(git rev-parse --show-toplevel)
exec gitleaks git --pre-commit --staged --redact --verbose --config "$root/.gitleaks.toml" "$root"
