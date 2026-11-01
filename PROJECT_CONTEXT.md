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

* **Adresse principale (depuis le 28/10/2026)** : **`https://nomad.tail4df302.ts.net`**, depuis le tailnet. HTTPS obligatoire pour le mode hors connexion. À la maison, aussi **`http://192.168.1.147:3000`** sans Tailscale (voulu, voir [Accès à Nomad](#-accès-à-nomad--qui-comment-et-comment-inviter-quelquun)).
  * Passerelle : **LXC 105 `nomad`** sur `pve` (Debian 13, iGPU `/dev/dri/renderD128`, médias montés en lecture seule sur `/media`, cache sur `/mnt/media/nomad-cache` → `/var/cache/nomad`).
  * Service : `systemctl status nomad-stream` dans le LXC (utilisateur `nomad`, `/opt/nomad-stream`). Il écoute sur `0.0.0.0:3000` (voulu, pour le réseau local : `HOST=0.0.0.0` dans `/etc/nomad-stream.env`, qui prime sur le `HOST=127.0.0.1` de l'unité systemd) et `tailscale serve` le publie en HTTPS sur le tailnet.
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

## 👥 Accès à Nomad : qui, comment, et comment inviter quelqu'un

> En place depuis le 1er novembre 2026. La politique d'accès du tailnet (ACL) se modifie dans la console Tailscale : https://login.tailscale.com/admin/acls/file. Elle contient des tests (un invité ne joint ni `pve`, ni Plex, ni le VPS) : Tailscale refuse d'enregistrer une modification qui les casse.

**Deux portes d'entrée, toutes deux voulues :**
* **Réseau local (maison)** : `http://192.168.1.147:3000`, sans Tailscale ni compte. Pas de HTTPS, donc pas de mode hors connexion par cette adresse. L'IP vient du DHCP de la box.
* **Tailscale (hors de la maison)** : `https://nomad.tail4df302.ts.net`.

**Ce que la politique Tailscale autorise :**

| Qui | Accès |
|---|---|
| Mes appareils (connectés avec mon compte, non tagués) | Tout : serveurs, LAN `192.168.1.0/24` via `pve`, VPS |
| `tag:homelab` (`pve`, `plex`, `nomad`) | Entre eux uniquement ; rien vers mes appareils ni vers le VPS |
| `tag:vps` (`rudylink-vps`) | Rien (autre projet, exposé sur Internet) |
| Invités : `tag:guest` et utilisateurs à qui `nomad` est partagé (`autogroup:shared`) | `nomad` en `tcp:443` uniquement |

### ✅ Inviter quelqu'un : partager la machine `nomad`

1. L'invité installe Tailscale (App Store, Play Store ou https://tailscale.com/download) et se connecte avec **son propre compte** (Google, Apple, Microsoft…, gratuit).
2. Console Tailscale → **Machines** → `nomad` → menu **⋯** → **Share…**, puis au choix :
   * onglet **Share by email** : son adresse, puis **Share** (lien à usage unique envoyé par e-mail) ;
   * onglet **Copy invite link** → **Copy share link**, à envoyer par message. Le lien vaut un mot de passe : laisser **Reusable link** décoché. Un lien non utilisé expire au bout de 30 jours.
3. L'invité ouvre le lien et accepte : `nomad` apparaît dans son Tailscale. La fenêtre **Share** de `nomad` affiche alors sa photo et son e-mail.
4. L'invité ouvre **`https://nomad.tail4df302.ts.net`** (le nom complet : `nomad` tout court ne marche pas depuis son tailnet) et l'installe sur l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »). Tailscale doit être activé sur son téléphone pour regarder hors de chez moi.

Pourquoi cette méthode : une personne à qui on partage une machine ne voit **que cette machine**. Les routes de sous-réseau (le LAN) ne sont jamais partagées, et `nomad` ne peut pas ouvrir de connexion vers ses appareils. La règle `autogroup:shared` → `nomad:443` limite en plus l'accès au seul HTTPS.

**Retirer l'accès** : Machines → `nomad` → **Share…** → menu sur la ligne de la personne → **Revoke invite**. Effet immédiat ; pour revenir, il faut une nouvelle invitation.

### ❌ À ne pas faire

* **Connecter l'appareil d'un invité avec mon compte** : il devient « mon appareil » et accède à tout (serveurs, LAN, VPS) tant qu'il n'est pas tagué.
* **Inviter quelqu'un comme utilisateur du tailnet** (page **Users** → **Invite users**) : il devient membre (`autogroup:member`) et a le même accès complet que moi.

### Cas de secours : appareil déjà connecté avec mon compte

C'est le cas de `ipad1410`. Tout de suite : Machines → l'appareil → **⋯** → **Edit ACL tags** → `tag:guest`. Il n'atteint alors plus que `nomad:443`. L'appareil n'est plus rattaché à mon compte et sa clé n'expire plus. À terme, préférer le partage : déconnecter l'appareil, puis suivre « Inviter quelqu'un ».

### Vérifier ce qui est réellement appliqué

Filtres actifs sur `nomad` (une ligne par règle ; un invité ne doit apparaître qu'avec `100.93.33.36` port 443) :

```bash
ssh pve 'pct exec 105 -- tailscale debug netmap' | jq -c '.PacketFilter[] | {Srcs, Dsts}'
```

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
   * **Recherche approximative** (`server/search.js`, `GET /api/search`) : index en mémoire de toute la bibliothèque (films, séries, artistes, albums, titres ; ~75 ms de construction pour 2 300 éléments, ~30 ms par recherche sur 18 000), reconstruit en arrière-plan toutes les 15 min (`NOMAD_SEARCH_TTL_MIN`). Tolère les fautes de frappe (distance de Damerau-Levenshtein bornée : « daft pank », « interstelar »), les accents et la ponctuation (« beyonce », « acdc », « spiderman »), les mots dans le désordre, le mot en cours de frappe ; un artiste renvoie aussi ses albums et ses titres, un film son titre original, son réalisateur et son année. Complété par la recherche de Plex (ajouts depuis la dernière indexation, films trouvés par un acteur) et repli sur celle-ci si l'index n'est pas prêt.

2. **Client React + Vite + Tailwind (`client/`)** :
   * `HomeView` : Hero banner, carrousel *Continuer la lecture* (On Deck), nouveautés films, séries et musique.
   * `MoviesView` & `ShowsView` & `ShowDetailView` : Navigation dans les catalogues, sélection des saisons/épisodes.
   * `MusicView` & `AlbumDetailView` : Gestion des artistes et pistes audio. Onglet Musique › Artistes : liste complète au défilement et barre de recherche réservée aux artistes (`/api/search?types=artist`, approximative). Titres : balayage au doigt vers la droite = ajouter à une playlist, vers la gauche = lire ensuite (`components/SwipeRow.tsx` ; menu « ⋮ » pour souris et clavier).
   * `CarModeView` : Interface épurée avec touches surdimensionnées pour l'écoute en conduite.
   * `VideoPlayer` : Lecteur vidéo avec gestion automatique Direct Play vs HLS, sélection dynamique des flux audio et sous-titres, double-tap +/-10s, synchronisation Plex.
   * `AudioPlayer` : Mini lecteur flottant et modal plein écran avec synchronisation `navigator.mediaSession` (CarPlay / commandes au volant).
   * **Lecture continue** (#24, `server/radio.js`, `GET /api/music/radio`) : sans répétition (réglage par défaut), la fin de la file enchaîne sur 20 titres proches du dernier (artistes que Plex dit similaires, même genre, même artiste, un peu de hasard ; jamais le même morceau ni deux fois le même artiste d'affilée), ajoutés dès que le dernier titre commence et marqués « Lecture continue » dans la file. Les titres ajoutés à la main passent devant. Répétition : désactivée → toute la file → ce titre.
   * **Mixes par genre** (#50, `server/genres.js`, `GET /api/music/genres` et `GET /api/music/genres/:id/mix`) : le genre d'un titre est son **dossier de genre** dans la bibliothèque (« Rap FR », « Reggae », « Techno »…), lu dans le chemin du fichier que Plex garde dans l'index de recherche (aucun appel de plus). Chez nous, Plex a une racine par dossier de genre (`/media/Music/Rap FR`, `/media/Music/Reggae`…) : la racine est le genre ; avec une racine unique, c'est le dossier de premier niveau. `NOMAD_MUSIC_GENRE_FOLDERS` renomme ou écarte les dossiers qui n'en sont pas (par défaut `Black Sabbath=Metal,Queen=Rock,Divers=`). Résultat le 30/10/2026 : 15 genres, 7 057 titres sur 7 074 (les genres de Plex ne couvraient que 44 % des albums, en 21 grandes familles). Un mix : 100 titres tirés au hasard, chaque morceau une fois, au plus ~2 par artiste, jamais deux fois le même artiste d'affilée (~10 ms). Côté appli : onglet Musique › Genres (tuiles en mosaïque, bouton Écouter), page du mix (`/musique/genre/:id` : nouveau tirage, enregistrer comme playlist ; le dernier tirage est gardé pendant la session), rangée « Mixes par genre » sur l'accueil et onglet Mixes du mode voiture.
   * **Préchargement de la musique** (#56, `client/src/audioPrefetch.ts`) : pendant l'écoute, le titre suivant de la file, le titre en cours puis celui d'après (ordre réel : aléatoire, répétition, lecture continue ; le suivant seulement en mode « économie de données ») sont téléchargés en entier, un à la fois, dans le cache `nomad-audio-v1` (sur le disque, jamais entièrement en mémoire ; 250 Mo au plus, les plus anciens partent ; titres de plus de 120 Mo laissés en flux). Le service worker les sert sous `/precharge/<partId>`, requêtes partielles comprises. Le téléchargement attend que le titre en cours, lu en flux, ait 30 s d'avance. Effets : le titre suivant démarre sans réseau ; si le flux du titre en cours cale ou tombe en erreur alors qu'il est déjà en cache, la lecture bascule sur la copie à la même position ; une copie effacée par le navigateur repasse au flux sans sauter le titre. Compte › Préférences affiche la place occupée et permet de la vider. Vérifié le 30/10/2026 dans Chrome (coupure réseau en plein titre puis titres suivants hors ligne) ; reste à éprouver sur iPhone en arrière-plan et avec CarPlay.
   * **Égaliseur** (`client/src/equalizer.ts`, Compte › Égaliseur) : 6 bandes comme Spotify (60 Hz, 150 Hz, 400 Hz, 1 kHz, 2,4 kHz, 15 kHz ; ±12 dB, plateau grave et aigu, cloches au milieu), 22 préréglages et « Personnalisé », courbe de réponse calculée (formules biquad RBJ, sans moteur audio). Le son passe par la Web Audio API seulement une fois l'égaliseur activé, et la chaîne n'est créée qu'à une lecture (un AudioContext ne démarre que sur un geste) : élément audio → gain par lecteur → 6 filtres → préampli (moitié de la plus forte hausse retirée) → limiteur (−1 dBFS) → sortie. Une fois branchée, la chaîne reste : désactivé, l'égaliseur repasse à plat. iOS 17+ : `navigator.audioSession.type = "playback"` (bouton silencieux ignoré). Sur iPhone, la Web Audio API peut s'arrêter écran verrouillé : le panneau le signale. Réglages dans `localStorage` (`nomad-eq`).
   * **Fondu enchaîné** (#59, `client/src/crossfade.ts`, Compte › Lecture) : deux lecteurs audio ; `audioRef` désigne celui du titre en cours (interface, écran verrouillé, suivi Plex), les événements de l'autre sont ignorés. Quelques secondes avant la fin (6 s par défaut, 0 à 12 ; désactivé par défaut sur iPhone/iPad), le titre suivant démarre sur l'autre lecteur à volume nul (depuis la copie préchargée quand elle existe), devient le titre en cours dès qu'il joue, et les volumes se croisent (puissance constante). Le fondu avance avec la lecture (`timeupdate` et images), pas sur des minuteurs que le navigateur ralentit en arrière-plan. Pas de fondu : répétition d'un titre, deux titres qui se suivent sur un album, titre de moins de 2 × durée + 5 s, fin de file. Pause, saut, retour, nouveau titre : le fondu s'arrête net. Niveaux par les gains Web Audio quand le lecteur est branché sur la chaîne de l'égaliseur (toujours le cas sur iPhone, où Safari ignore le volume des éléments), sinon par le volume de l'élément. Le second lecteur joue 0,1 s de silence au premier geste pour pouvoir démarrer seul (iPhone).
   * PWA Manifest & Service Worker avec icônes multi-résolutions.
   * **Installation (#9)** : écrans de démarrage iOS (`client/public/splash/`, 22 tailles × 2 orientations, régénérés par `scripts/make-splash.mjs`) et invite d'installation proposée une fois après 8 s (vraie invite du navigateur sur Android/Chrome, marche à suivre Partager › « Sur l'écran d'accueil » sur iOS ; refusée, elle revient au bout de 30 jours ; toujours dans Compte › Application).
   * **Accessibilité (#11)** : zoom au pincement autorisé (`touch-action: manipulation` contre le zoom au double appui, champs en 16 px sur écran tactile contre le zoom automatique d'iOS), audit axe-core sans violation sur les écrans principaux (contrastes, noms des boutons et des modales, titres h1).

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
| Accès restreint au tailnet | ↩️ | Le service écoutait sur `127.0.0.1` (LAN refusé, HTTPS tailnet seulement). Rouvert ensuite volontairement au réseau local : voir [Accès à Nomad](#-accès-à-nomad--qui-comment-et-comment-inviter-quelquun). |

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
- [ ] ~~Limiter l'écoute à l'IP Tailscale~~ : abandonné, l'écoute sur `0.0.0.0` est voulue pour que le réseau local accède à Nomad sans Tailscale. Les invités Tailscale, eux, sont limités à `nomad:443` par la politique du tailnet.
- Effet attendu : la vidéo ne traverse Internet **qu'une fois** (box → appareil), le laptop n'a plus besoin d'être allumé ni connecté, et la 4G montante n'est plus sur le trajet.
- Prérequis : débit montant de la box ≥ ~10 Mb/s par lecture simultanée (mesuré en phase 0).

**Phase 3 : accélération matérielle (fluidité et qualité)**
- [x] Vérifier la présence d'un iGPU sur `pve` (`lspci | grep -i vga`).
- Option A : Plex Pass + passage de l'iGPU (Intel Quick Sync) au LXC 101. Transcodage 10-20× plus rapide : palier 1080p utilisable, 4K HEVC fluide, sauts plus rapides.
- Option B (sans Plex Pass) : transcodage ffmpeg (VAAPI/QSV) dans la passerelle maison, avec un vrai **HLS multi-débits** (plusieurs variantes dans la playlist). Le lecteur change alors de qualité segment par segment, **sans coupure ni relance**. Développement plus conséquent (sauts, sous-titres, pistes).

**Phase 4 : hors connexion (la seule garantie sur un mauvais réseau)**
- [x] Section « Téléchargements » (déjà prévue dans la maquette) : versions MP4 720p ~2 Mb/s (≈ 0,9 Go/h) préparées à la maison (ffmpeg, ou « Optimiser » de Plex, à vérifier), téléchargées sur le Wi-Fi puis lues localement (Cache API / OPFS ; quotas de stockage des PWA iOS à vérifier).
- [ ] Bonus : préparer automatiquement la nuit les versions mobiles des éléments de « Ma liste » et « Reprendre la lecture », lues ensuite en direct sans transcodeur.
