# 🚀 Projet Nomad Stream (Plex PWA Tailscale & CarPlay) - Contexte Complet

> **Date** : 28 Octobre 2026  
> **Auteur** : Antigravity x Matteo  
> **Emplacement du projet** : `/home/matteo/Projets/nomad-stream`  
> **Statut** : ✅ **Opérationnel, Ultra-Optimisé & Déployé en service permanent (systemd)**

---

## 🎯 Objectif du Projet

Créer une application **PWA (Progressive Web App)** connectée à **Plex Media Server** via **Tailscale** :
1. **Éviter le paywall Plex mobile** : Contourner l'obligation du Plex Pass sur mobile en exploitant l'API REST locale et le proxying direct.
2. **Expérience PWA plein écran** : Installable en 1 clic sur l'écran d'accueil iOS/Android via Safari/Chrome.
3. **Multi-médias** : Films, Séries, Musique avec scrobbling et reprise de lecture temps réel.
4. **Intégration CarPlay & Android Auto** : Utilisation de `navigator.mediaSession` pour les métadonnées et commandes volant.
5. **Mode Voiture ("Car Mode")** : Vue simplifiée avec gros boutons tactiles.

---

## 🖥️ Accès & Infrastructure

* **Adresse principale (depuis le 28/10/2026)** : **`https://nomad.tail4df302.ts.net`**, accessible uniquement depuis le tailnet. HTTPS obligatoire pour le mode hors connexion.
  * Passerelle : **LXC 105 `nomad`** sur `pve` (Debian 13, iGPU `/dev/dri/renderD128`, médias montés en lecture seule sur `/media`, cache sur `/mnt/media/nomad-cache` → `/var/cache/nomad`).
  * Service : `systemctl status nomad-stream` dans le LXC (utilisateur `nomad`, `/opt/nomad-stream`). Il écoute sur `127.0.0.1:3000` et `tailscale serve` le publie en HTTPS.
  * Déploiement : `./scripts/deploy-pve.sh` (compile le client, copie, redémarre). Accès SSH : `ssh -J pve root@192.168.1.147`.
* **Ancienne passerelle (laptop `msi`)** : `http://100.77.169.75:3000`. **Désactivée le 28/10/2026** (service utilisateur `nomad-stream` arrêté et retiré du démarrage). Pour la relancer ponctuellement en développement : `systemctl --user start nomad-stream`.
* **Serveur Plex Media (LXC 101 `plex`)** : `http://192.168.1.81:32400`. `pve` (`192.168.1.118`) est le routeur de sous-réseau Tailscale du LAN.

### Versionnage, CI et déploiement continu

* **Repo privé** : https://github.com/MatteoCnda1/nomad-stream (issues = backlog).
* **CI** (`.github/workflows/ci.yml`) sur chaque PR : build client (`tsc` + `vite build`) et tests serveur (`npm test`) sous **Node 20** (version réelle du LXC, paquet Debian — et non 24) et Node 24.
* **Fusion automatique** : une PR verte est fusionnée sans intervention. Pour retenir une PR (à tester sur téléphone d'abord), l'ouvrir **en brouillon**. Le plan GitHub gratuit n'autorise pas la protection de branche sur un repo privé : ne pas fusionner une PR rouge à la main.
* **Déploiement continu** : après la fusion, le runner auto-hébergé du LXC (`nomad-lxc`, utilisateur `ghrunner`) installe la version testée via `sudo nomad-deploy` (seule commande root autorisée) : sauvegarde, installation, contrôle de santé, **retour automatique à la version précédente** si le service ne répond plus. Mise en place unique : `./scripts/install-runner.sh` (pose aussi `DEPLOY_ENABLED=true`). Redéployer `main` : `gh workflow run ci.yml --ref main`.
* **Secrets** : `PLEX_TOKEN` (et `ACCESS_CODE` si l'auth est activée) dans `/etc/nomad-stream.env` (root, 600), lu par systemd ; jamais dans le code.
* `./scripts/deploy-pve.sh` reste disponible pour tester une branche à la main ; le déploiement suivant de `main` l'écrase.

---

## ⚡ Architecture d'Optimisation des Performances (Audit & Résolution)

### 1. Problèmes initiaux identifiés sur mobile :
* **Poids des images brutes** : Les miniatures demandaient l'affiche originale Plex non compressée (600 Ko à 2 Mo chacune). L'accueil téléchargeait près de 30 Mo de JPEG lourds, saturant la bande passante 4G et le décodage iOS Safari.
* **Absence de compression** : Express servait le bundle JS monolithique (813 Ko) et les JSON d'API bruts sans compression Gzip/Brotli.
* **Pas de cache côté serveur ou client** : Chaque clic ou changement d'onglet déclenchait un appel réseau vers Plex (250-400 ms) et affichait un spinner de chargement.
* **Pas de cache disque pour les vignettes** : Chaque image était redemandée à Plex.

### 2. Solutions déployées et validées :
* **Vignettes WebP via Plex Photo Transcoder** :
  * Format WebP activé avec dimensions adaptées à chaque type d'affichage (300x450 pour les affiches, 480x270 pour les épisodes, 300x300 pour la musique, 960x540 pour le hero).
  * **Poids moyen par image : 15 à 25 Ko** (réduction de **96%** du volume réseau).
  * **Garde-fou anti-plantage** (`server/image-guard.js`) : le photo transcoder de Plex 1.43 plante (segfault, ~1 min 30 d'indisponibilité) sur les **JPEG en niveaux de gris** (vu le 29/10/2026 sur deux pochettes de musique, dont une ajoutée par spotdl, qui replantaient Plex à chaque ouverture de l'onglet Musique). Avant tout transcodage, la passerelle lit l'en-tête de l'image brute (256 Ko au plus) : un JPEG à 1 composante est servi brut, sans passer par Plex. Filet de sécurité pour les autres causes : une image en cours de transcodage quand Plex tombe est mise de côté. Les deux listes sont dans `NOMAD_CACHE_DIR/plex-crash-images.json`. 4 transcodages photo simultanés au plus (`NOMAD_IMAGE_CONCURRENCY`).
* **Double Cache Disque & ETag (304 Not Modified)** :
  * Les vignettes WebP générées sont stockées sur le disque NVMe local (`server/.cache/images/`).
  * Temps de réponse sur image en cache : **1,5 ms**.
  * Envoi d'un header `ETag` : les requêtes avec `If-None-Match` reçoivent immédiatement `304 Not Modified` avec **0 octet** téléchargé.
  * 114+ images ont été pré-chauffées en cache disque.
* **Cache Mémoire Serveur (TTL)** :
  * Réponses API Plex mises en cache avec TTL : Hubs (30s), Films (60s), Séries (60s), Musique (120s).
  * Temps de réponse d'API : **passé de 220 ms à 1,2 ms** (x150 plus rapide).
* **Cache Mémoire Client (SWR / 0 ms)** :
  * Cache mémoire dans `client/src/api.ts`.
  * La bascule d'onglets (Accueil ➔ Films ➔ Accueil) s'affiche **instantanément à 0 ms** sans spinner ni rechargement.
* **Compression HTTP Gzip & Code-Splitting** :
  * Middleware `compression` activé sur Express.
  * Découpage du bundle Vite en chunks : `vendor`, `hls`, `icons`, et code applicatif de seulement **13,8 Ko gzipped**.
  * Attributs `loading="lazy"` et `decoding="async"` sur tous les éléments `<img>`.
  * Service Worker PWA (`nomad-stream-v2`) avec stratégie Cache-First sur les assets statiques et Stale-While-Revalidate sur les affiches.

---

## 📦 Architecture Réalisée

1. **Serveur Backend Express (`server/`)** : `index.js` ne fait que la configuration et le montage ; `plex.js` (appels à Plex, mise en forme), `validate.js` (paramètres reçus), `memory-cache.js`, et une route par domaine dans `routes/` (`catalog`, `stream`, `images`, `transcode`, `playback`) :
   * Proxy transparent des flux avec support des requêtes `Range: bytes` pour le streaming direct (MP4/audio).
   * Passerelle de transcodage et remuxing universel HLS Plex (`/api/stream/hls/start.m3u8`, `/api/stream/hls/session/...`, `/api/stream/hls/stop`) pour la lecture universelle des MKV et formats audio avancés (DTS, TrueHD).
   * Proxy d'images WebP haute performance avec cache disque persistant et ETag.
   * Scrobbling de la progression (`POST /api/timeline`).

2. **Client React + Vite + Tailwind (`client/`)** :
   * `HomeView` : Hero banner, carrousel *Continuer la lecture* (On Deck), nouveautés films, séries et musique.
   * `MoviesView` & `ShowsView` & `ShowDetailView` : Navigation dans les catalogues, sélection des saisons/épisodes.
   * `MusicView` & `AlbumDetailView` : Gestion des artistes et pistes audio.
   * `CarModeView` : Interface épurée avec touches surdimensionnées pour l'écoute en conduite.
   * `VideoPlayer` : Lecteur vidéo avec gestion automatique Direct Play vs HLS, sélection dynamique des flux audio et sous-titres, double-tap +/-10s, synchronisation Plex.
   * `AudioPlayer` : Mini lecteur flottant et modal plein écran avec synchronisation `navigator.mediaSession` (CarPlay / commandes au volant).
   * PWA Manifest & Service Worker avec icônes multi-résolutions.

---

## 🎬 Fluidité du streaming : diagnostic & plan d'action

> Rédigé le 28 octobre 2026, après la refonte de la lecture vidéo (branche `feat/rubis-redesign`).
> Objectif : une lecture **fluide de bout en bout**, y compris en 4G.

### Ce qui est déjà en place

* Identité client « Plex Web / Chrome » + appel `decision` avant `start.m3u8` : Plex applique enfin les plafonds de débit et découpe en segments de 1-3 s (avant : flux d'origine à 34 Mb/s en segments de 10 s).
* Correction d'un bug majeur du proxy : le `Content-Length` d'une réponse gzip décompressée tronquait les playlists HLS à ~10 % (lecture interrompue au bout d'environ 10 min).
* Qualité **Auto** (original / 720p / 480p / 360p) avec baisse automatique en cas de coupures réseau ; reprise directe au bon instant (`offset`) ; identifiant Plex par appareil ; ping de session, arrêt garanti, délais et nouvelles tentatives côté proxy.
* Mesuré dans Chrome (laptop en partage de connexion 4G) : 1re image en **1,4 à 4 s** (contre 10 à 13 s avant), aucune coupure en conditions normales, baisse 720p → 480p → 360p sans arrêt de la lecture quand le débit tombe à 400 kb/s.

### Pourquoi ça charge encore parfois (causes, de la plus lourde à la plus légère)

1. **Topologie réseau (cause n° 1 actuellement).** La passerelle tourne sur le laptop `msi`, souvent en partage de connexion iPhone. Chaque octet de vidéo traverse alors la 4G **deux à trois fois** :
   * Plex (maison) → Internet → **4G descendante** → laptop ;
   * laptop → **4G montante** → appareil qui regarde. Le PC Windows passe en direct, l'iPhone passe par un **relais DERP Tailscale (Paris)**, car il héberge lui-même le partage.

   La 4G montante et les relais DERP sont les maillons les plus faibles et les plus instables.
2. **Tampon court.** hls.js garde 30 s d'avance (`maxBufferLength`) et Plex ne transcode que 60 s en avance (`TranscoderThrottleBuffer`). Un creux de 4G de plus de 30 s provoque une coupure, même si le débit moyen suffit.
3. **Adaptation réactive et non proactive.** La qualité baisse *après* une coupure (6 s d'attente ou 3 coupures par minute), ne remonte jamais en cours de lecture, et les paliers sont espacés (4 Mb/s → 1,5 Mb/s). Chaque changement relance une session Plex, avec 2 à 3 s d'attente.
4. **Transcodage logiciel (pas d'accélération matérielle).** Vitesses mesurées : 720p ≈ 2-2,5× le temps réel, 1080p ≈ 1,5×, 4K HEVC ≈ 1-1,5× quelle que soit la résolution de sortie. Deux lectures simultanées divisent ces marges par deux.
5. **Pas de visibilité.** On ne sait pas, coupure par coupure, si c'est le réseau ou le transcodeur qui a lâché.

### Ordres de grandeur

| Qualité | Débit moyen observé | Connexion stable nécessaire* | Données / heure |
|---|---|---|---|
| Originale (remux Blu-ray) | ~34 Mb/s | ≥ 45 Mb/s | ~15 Go |
| 720p (plafond 4 Mb/s) | ~3,5 Mb/s, avec des pics plus hauts | ≥ 5-6 Mb/s | ~1,6 Go |
| 480p (plafond 1,5 Mb/s) | ~1 Mb/s | ≥ 2 Mb/s | ~0,45 Go |
| 360p (plafond 0,75 Mb/s) | ~0,6 Mb/s | ≥ 1 Mb/s | ~0,3 Go |

\* Il s'agit du débit le plus faible du trajet (4G montante comprise tant que la passerelle est sur le laptop), pas du débit affiché par un test de vitesse.

### Réalisé le 28 octobre 2026 (soir)

| Étape | État | Détail |
|---|---|---|
| Passerelle à la maison (phase 2) | ✅ | LXC 105 `nomad`, Tailscale + `tailscale serve` (HTTPS). Connexion directe, sans relais. Débit montant de la fibre mesuré : **~410 Mb/s**. |
| Transcodage iGPU multi-débits (phase 3, option B) | ✅ | `server/transcoder.js` : ffmpeg VAAPI (HD Graphics 530), 4 qualités produites simultanément (1080p 6 Mb/s, 720p 3, 480p 1,2, 360p 0,6), segments de 4 s générés à la demande. Le lecteur (hls.js, ou Safari natif) change de qualité **segment par segment, sans coupure**. |
| Tampon agrandi (phase 1) | ✅ | hls.js garde 120 s d'avance (jusqu'à 180 s) ; la passerelle produit jusqu'à 300 s d'avance puis met ffmpeg en pause. |
| Mode hors connexion (phase 4) | ✅ | `server/offline.js` + page « Téléchargements » : MP4 720p (≈ 1,2 Go/h) ou 480p (≈ 0,5 Go/h) préparé par l'iGPU, stocké dans le navigateur (Cache API), lu sans réseau via le service worker (requêtes partielles prises en charge). |
| Accès restreint au tailnet | ✅ | Le service écoute sur `127.0.0.1` ; LAN refusé, HTTPS tailnet seulement. |

**Mesures (Chrome headless, laptop en 4G, via la passerelle `pve`)**

| Cas | Avant (Plex logiciel) | Maintenant (iGPU) |
|---|---|---|
| Remux H.264 1080p (*Ad Astra*), 1re image | 10-13 s, coupé après ~10 min | **2,5 s**, montée seule en 1080p, 0 coupure |
| HEVC 10 bits (*1917*) | 3,6 s en 720p | **3,0 s**, 1080p, 0 coupure |
| 4K HEVC repris à 1 h 06 (*Spider-Man*) | 7,9-13,7 s, saccades (conversion à 1-1,5×) | **3,7-5,4 s**, 0 coupure |
| Débit coupé à 400 kb/s en pleine lecture | relance de session à chaque palier | une seule session ; descente seule en 360p ; ~77 s sans coupure grâce au tampon |
| Épisode téléchargé, réseau coupé | — | 1re image en **1,0 s**, sauts OK |

Vitesse de l'iGPU pour 4 qualités simultanées : H.264 1080p 4,4× ; HEVC 10 bits (décodage CPU) 3,4× ; 4K HEVC 2,4× ; AV1 (décodage CPU) 2,8×. Sources HDR (30 épisodes sur 1 204 fichiers) : couleurs converties au CPU après réduction en 720p, 1,4-1,7×.

**Points à connaître**
* ffmpeg 7.1 plante avec `-copyts` + saut + décodage VAAPI : le transcodeur recale les horodatages avec `-output_ts_offset`. Forcer `-level` fait aussi planter l'encodeur de cet iGPU.
* Sous-titres, qualité « Originale » d'un MKV et repli en cas d'échec passent encore par le transcodeur de Plex (logiciel, plus lent).
* Un redémarrage du service interrompt les lectures et préparations hors connexion en cours ; elles reprennent seules à la requête suivante.
* Les téléchargements se poursuivent tant que l'appli est ouverte, et reprennent à la réouverture.
* Le laptop `msi` ne résout pas les noms MagicDNS (avertissement DNS de Tailscale) ; le téléphone et le PC Windows ne sont pas concernés.

**Pistes suivantes**
- [ ] Sous-titres texte (SRT/ASS) en piste WebVTT dans le flux iGPU, sans incrustation, pour ne plus passer par Plex.
- [ ] Palier 240p (~0,3 Mb/s) pour les réseaux très faibles.
- [x] Panneau « statistiques » dans le lecteur et journal des lectures côté serveur (phase 0, #5).
- [x] Désactiver l'ancienne passerelle du laptop.

### Plan d'action

**Phase 0 : mesurer avant d'agir (≈ 2 h)**
- [x] Panneau « statistiques » dans le lecteur (bouton « Statistiques de lecture » en haut à droite) : mode, qualité et résolution, débit du flux et mesuré, tampon, préparation/transfert des segments, avance du transcodeur iGPU ou vitesse Plex, 1re image, coupures et leur cause probable, images perdues.
- [x] Journal serveur par lecture : une ligne JSON par lecture dans `/var/cache/nomad/logs/playback.jsonl` (rotation à 5 Mo) + un résumé par lecture dans `journalctl -u nomad-stream` (ex. `▶ 1917 · abr 720p · 1re image 2,4 s · 0 coupure · 41 min vues`). Lecture : `ssh pve 'pct exec 105 -- tail -n 20 /var/cache/nomad/logs/playback.jsonl'`.
- [x] Mesurer le **débit montant de la box** depuis `pve` (speedtest), le débit 4G montant et descendant du téléphone, et vérifier connexion directe ou relais avec `tailscale ping <appareil>`.

**Phase 1 : réglages rapides, sans changer l'architecture (½ journée)**
- [x] Tampon client : `maxBufferLength` 30 → 90-120 s (desktop/Android) ; ne démarrer qu'avec ~6-8 s de tampon quand le débit mesuré est faible.
- [ ] *(Sans objet depuis le transcodeur iGPU, qui gère sa propre avance)* Plex › Paramètres › Transcodeur : `Transcoder default throttle buffer` 60 → 300-600 s, pour que Plex prenne plus d'avance.
- [x] *(Remplacé par le flux multi-débits iGPU : 4 paliers commutés sans coupure)* Paliers plus fins : ajouter un 720p à ~2,5 Mb/s et un 540p à ~1,5 Mb/s ; choix Auto basé sur un débit bas (20ᵉ centile) plutôt que médian.
- [x] *(Assurée par l'ABR de hls.js et de Safari sur le flux iGPU)* Adaptation **proactive** : baisser *avant* la coupure (tampon < 10 s et en baisse alors que le débit < débit du flux) ; remonter une seule fois après ~2 min stables (débit > 2× le palier supérieur et tampon > 60 s).

**Phase 2 : déplacer la passerelle à la maison (gain principal, ≈ 1 soirée)**
- [x] Créer un LXC Debian sur `pve` à côté de Plex (Node 24, service systemd, même code), avec `PLEX_URL` en LAN (gigabit).
- [x] Tailscale dans ce LXC (ou s'appuyer sur `pve`, déjà en connexion directe) ; idéalement rediriger le port UDP 41641 sur la box pour garantir des connexions directes sans relais DERP.
- [x] Limiter l'écoute à l'IP Tailscale (aujourd'hui `0.0.0.0` : l'appli est accessible à tout le réseau local, sans mot de passe).
- Effet attendu : la vidéo ne traverse Internet **qu'une fois** (box → appareil), le laptop n'a plus besoin d'être allumé ni connecté, et la 4G montante n'est plus sur le trajet.
- Prérequis : débit montant de la box ≥ ~10 Mb/s par lecture simultanée (mesuré en phase 0).

**Phase 3 : accélération matérielle (fluidité et qualité)**
- [x] Vérifier la présence d'un iGPU sur `pve` (`lspci | grep -i vga`).
- Option A : Plex Pass + passage de l'iGPU (Intel Quick Sync) au LXC 101. Transcodage 10-20× plus rapide : palier 1080p utilisable, 4K HEVC fluide, sauts plus rapides.
- Option B (sans Plex Pass) : transcodage ffmpeg (VAAPI/QSV) dans la passerelle maison, avec un vrai **HLS multi-débits** (plusieurs variantes dans la playlist). Le lecteur change alors de qualité segment par segment, **sans coupure ni relance**. Développement plus conséquent (sauts, sous-titres, pistes).

**Phase 4 : hors connexion (la seule garantie sur un mauvais réseau)**
- [x] Section « Téléchargements » (déjà prévue dans la maquette) : versions MP4 720p ~2 Mb/s (≈ 0,9 Go/h) préparées à la maison (ffmpeg, ou « Optimiser » de Plex, à vérifier), téléchargées sur le Wi-Fi puis lues localement (Cache API / OPFS ; quotas de stockage des PWA iOS à vérifier).
- [ ] Bonus : préparer automatiquement la nuit les versions mobiles des éléments de « Ma liste » et « Reprendre la lecture », lues ensuite en direct sans transcodeur.
