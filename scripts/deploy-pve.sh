#!/usr/bin/env bash
# Déploie la passerelle sur le LXC « nomad » (CT 105 sur pve) : client compilé + serveur.
# Usage, depuis n'importe où : ./scripts/deploy-pve.sh
# Prérequis : accès SSH root à pve (le LXC est joint par rebond, via son IP sur le LAN).
# NB : le redémarrage interrompt les lectures et préparations hors connexion en cours
#      (elles reprennent toutes seules à la requête suivante).
set -euo pipefail

HOST="${NOMAD_HOST:-192.168.1.147}"
JUMP="${NOMAD_JUMP:-pve}"
cd "$(dirname "$0")/.."

(cd client && npm run build)

tar -czf - --exclude=node_modules --exclude=.cache server client/dist | ssh -J "$JUMP" "root@$HOST" '
  set -e
  rm -rf /opt/nomad-stream/client/dist
  tar -xzf - -C /opt/nomad-stream
  cd /opt/nomad-stream/server && npm ci --omit=dev --no-audit --no-fund --loglevel=error
  chown -R nomad:nomad /opt/nomad-stream
  systemctl restart nomad-stream
  sleep 2
  systemctl is-active nomad-stream
'
echo "Déployé : https://nomad.tail4df302.ts.net"
