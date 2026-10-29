#!/usr/bin/env bash
# Prépare le LXC « nomad » pour le déploiement continu. Lancé en root sur le LXC par
# scripts/install-runner.sh (depuis ta machine). Idempotent : relançable sans risque.
set -euo pipefail
: "${RUNNER_TOKEN:?jeton requis (registration token du runner)}" "${REPO_URL:?URL du repo requise}"

RUNNER_VERSION=2.338.2
RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
RUNNER_DIR=/opt/actions-runner
HERE=$(dirname "$(realpath "$0")")

# 1. Secrets hors du code : PLEX_TOKEN lu par systemd depuis un fichier root uniquement.
#    Premier passage : on reprend le token par défaut du code actuellement déployé
#    (celui que la prod utilise), avant que la nouvelle version ne l'exige.
if [[ ! -f /etc/nomad-stream.env ]]; then
  token=$(sed -nE 's/^const PLEX_TOKEN = process\.env\.PLEX_TOKEN \|\| "([^"]+)";.*/\1/p' /opt/nomad-stream/server/index.js || true)
  if [[ -z $token ]]; then
    echo "✖ /etc/nomad-stream.env absent et aucun token dans le code déployé. Crée-le à la main :" >&2
    echo "  (umask 077; printf 'PLEX_TOKEN=...\\n' > /etc/nomad-stream.env)" >&2
    exit 1
  fi
  (umask 077 && printf '# Secrets de la passerelle, lus par systemd (root uniquement)\nPLEX_TOKEN=%s\n' "$token" > /etc/nomad-stream.env)
  echo "✔ PLEX_TOKEN déplacé dans /etc/nomad-stream.env"
fi
mkdir -p /etc/systemd/system/nomad-stream.service.d
printf '[Service]\nEnvironmentFile=/etc/nomad-stream.env\n' > /etc/systemd/system/nomad-stream.service.d/secrets.conf
systemctl daemon-reload

# 2. Paquets nécessaires (sudo absent de l'image Debian du LXC)
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sudo rsync curl ca-certificates >/dev/null

# 3. Utilisateur dédié, et script de déploiement comme seule commande root autorisée
id ghrunner &>/dev/null || useradd --system --create-home --home-dir "$RUNNER_DIR" --shell /bin/bash ghrunner
install -m 755 -o root -g root "$HERE/nomad-deploy" /usr/local/bin/nomad-deploy
echo 'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/nomad-deploy' > /etc/sudoers.d/nomad-deploy.tmp
chmod 440 /etc/sudoers.d/nomad-deploy.tmp
visudo -cf /etc/sudoers.d/nomad-deploy.tmp >/dev/null
mv /etc/sudoers.d/nomad-deploy.tmp /etc/sudoers.d/nomad-deploy
echo "✔ nomad-deploy installé (sudo limité à cette commande)"

# 4. Runner GitHub Actions, archive vérifiée par empreinte SHA-256
if [[ ! -x $RUNNER_DIR/config.sh ]]; then
  archive=$(mktemp)
  curl -fsSL -o "$archive" \
    "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
  echo "$RUNNER_SHA256  $archive" | sha256sum -c --quiet
  tar -xzf "$archive" -C "$RUNNER_DIR"
  rm -f "$archive"
  # Le script officiel ne connaît pas toujours les noms de paquets de Debian 13 : repli manuel
  "$RUNNER_DIR/bin/installdependencies.sh" >/dev/null 2>&1 ||
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends libicu76 libssl3t64 zlib1g libkrb5-3 >/dev/null
  chown -R ghrunner:ghrunner "$RUNNER_DIR"
  echo "✔ Runner $RUNNER_VERSION installé"
fi

if [[ ! -f $RUNNER_DIR/.runner ]]; then
  runuser -u ghrunner -- "$RUNNER_DIR/config.sh" --unattended --replace \
    --url "$REPO_URL" --token "$RUNNER_TOKEN" --name nomad-lxc --labels nomad --work _work
fi

cd "$RUNNER_DIR"
if ! ls /etc/systemd/system/actions.runner.*.service &>/dev/null; then
  ./svc.sh install ghrunner >/dev/null
fi
./svc.sh start >/dev/null
systemctl is-active --quiet "$(basename /etc/systemd/system/actions.runner.*.service)"
echo "✔ Runner « nomad-lxc » enregistré et démarré"
