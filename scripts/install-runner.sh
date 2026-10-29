#!/usr/bin/env bash
# Installe le runner GitHub Actions sur le LXC « nomad » puis active le déploiement continu.
# Usage, depuis ta machine : ./scripts/install-runner.sh   (relançable sans risque)
# Prérequis : mêmes accès que deploy-pve.sh (SSH root via pve) + gh connecté au compte du repo.
set -euo pipefail

HOST="${NOMAD_HOST:-192.168.1.147}"
JUMP="${NOMAD_JUMP:-pve}"
REPO="${NOMAD_REPO:-MatteoCnda1/nomad-stream}"
cd "$(dirname "$0")/.."

# Jeton d'enregistrement à usage unique, valable 1 h
TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)

tar -czf - -C scripts lxc | ssh -J "$JUMP" "root@$HOST" "
  set -e
  d=\$(mktemp -d); trap 'rm -rf \$d' EXIT
  tar -xzf - -C \$d
  RUNNER_TOKEN='$TOKEN' REPO_URL='https://github.com/$REPO' bash \$d/lxc/setup-runner.sh
"

gh variable set DEPLOY_ENABLED --body true -R "$REPO"
echo "✔ Déploiement continu actif : chaque PR fusionnée est déployée automatiquement."
echo "  Premier déploiement de main dès maintenant : gh workflow run ci.yml --ref main -R $REPO"
