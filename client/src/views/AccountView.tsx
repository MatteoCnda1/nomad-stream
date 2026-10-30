import React, { useEffect, useState } from "react";
import { Car, Heart, Smartphone, Monitor, Trash2, Check, Server } from "lucide-react";
import { useServerStatus } from "../hooks/useServerStatus";
import { useTheme, ThemeMode } from "../context/ThemeContext";
import { useWishlist } from "../context/WishlistContext";
import { clearApiCache } from "../api";
import { clearPrefetched, prefetchUsage } from "../audioPrefetch";
import { Avatar, Sk, ThemeToggle } from "../components/ui";
import { useInstall } from "../hooks/useInstall";
import { IOSInstallSteps } from "../components/InstallPrompt";
import { EqualizerPanel } from "../components/EqualizerPanel";

interface AccountViewProps {
  onNavigate: (tab: string) => void;
}

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
  { id: "system", label: "Système" },
];

const Card: React.FC<{ className?: string; labelledBy: string; children: React.ReactNode }> = ({
  className = "",
  labelledBy,
  children,
}) => (
  <section aria-labelledby={labelledBy} className={`rounded-3xl bg-card p-5 sm:p-7 ${className}`}>
    {children}
  </section>
);

const Row: React.FC<{ title: string; hint?: string; children?: React.ReactNode; last?: boolean }> = ({
  title,
  hint,
  children,
  last,
}) => (
  <div className={`py-3.5 flex flex-wrap items-center justify-between gap-4 ${last ? "" : "border-b border-line"}`}>
    <div>
      <div className="text-[15px] font-medium">{title}</div>
      {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
    </div>
    {children}
  </div>
);

export const AccountView: React.FC<AccountViewProps> = ({ onNavigate }) => {
  const { serverName, isOnline, plexUrl, version, loaded } = useServerStatus();
  const { mode, setMode } = useTheme();
  const install = useInstall();
  const { entries } = useWishlist();
  const [cacheCleared, setCacheCleared] = useState(false);
  // Musique préchargée pendant l'écoute (#56) : place occupée sur cet appareil
  const [prefetched, setPrefetched] = useState<{ tracks: number; bytes: number } | null>(null);
  useEffect(() => {
    if (window.isSecureContext && "caches" in window) prefetchUsage().then(setPrefetched);
  }, []);
  const handleClearPrefetched = async () => {
    await clearPrefetched();
    setPrefetched({ tracks: 0, bytes: 0 });
  };

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const hasMediaSession = "mediaSession" in navigator;
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  const countOf = (types: string[]) => entries.filter((e) => types.includes(e.item.type)).length;

  const handleClearCache = () => {
    clearApiCache();
    setCacheCleared(true);
    window.setTimeout(() => setCacheCleared(false), 2500);
  };

  return (
    <div className="pt-[max(18px,env(safe-area-inset-top))] lg:pt-1 max-w-[1160px]">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-[22px]">
        <Avatar name={serverName} size={92} />
        <div className="flex-1 min-w-0">
          <h1 className="text-[34px] tracking-[-0.03em] font-bold truncate">{serverName}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[15px] text-muted">
            <span>Plex Media Server</span>
            {version && (
              <>
                <span aria-hidden="true">·</span>
                <span>Version {version}</span>
              </>
            )}
          </div>
        </div>
        <ThemeToggle className="hidden sm:grid border border-line2 hover:bg-card" />
      </div>

      {!loaded ? (
        <div className="mt-8 grid grid-cols-12 gap-4" aria-busy="true" aria-label="Chargement du compte">
          <Sk className="col-span-12 xl:col-span-7 h-[270px] rounded-3xl" />
          <Sk className="col-span-12 xl:col-span-5 h-[270px] rounded-3xl" />
          <Sk className="col-span-12 xl:col-span-7 h-[300px] rounded-3xl" />
          <Sk className="col-span-12 xl:col-span-5 h-[300px] rounded-3xl" />
        </div>
      ) : (
        <div className="anim-in mt-8 grid grid-cols-12 gap-4">
          {/* Serveur */}
          <Card labelledBy="srv-h" className="col-span-12 xl:col-span-7 relative overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute -right-20 -top-20 w-[280px] h-[280px] rounded-full"
              style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
            />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <h2 id="srv-h" className="text-[15px] font-medium text-muted">Serveur</h2>
                <span className="inline-flex items-center gap-1.5 px-3 py-[5px] rounded-full bg-panel text-[13px] font-medium">
                  <span className={`w-[7px] h-[7px] rounded-full ${isOnline ? "bg-ok" : "bg-accent"}`} />
                  {isOnline ? "En ligne" : "Hors ligne"}
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-3.5">
                <Server className="w-8 h-8 text-accent-text flex-shrink-0" strokeWidth={1.7} />
                <span className="text-[34px] sm:text-[40px] font-bold tracking-[-0.035em] truncate">{serverName}</span>
              </div>
              <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
                <div className="px-4 py-3.5 rounded-2xl bg-panel min-w-0">
                  <div className="text-[13px] text-muted">Adresse Plex</div>
                  <div className="mt-1 text-base font-semibold truncate">{plexUrl || "—"}</div>
                </div>
                <div className="px-4 py-3.5 rounded-2xl bg-panel min-w-0">
                  <div className="text-[13px] text-muted">Accès depuis</div>
                  <div className="mt-1 text-base font-semibold truncate">{window.location.host}</div>
                </div>
                <div className="px-4 py-3.5 rounded-2xl bg-panel min-w-0">
                  <div className="text-[13px] text-muted">Version</div>
                  <div className="mt-1 text-base font-semibold truncate">{version || "—"}</div>
                </div>
              </div>
              <div className="mt-[22px] flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onNavigate("car")}
                  className="press h-[46px] px-[22px] rounded-full bg-accent hover:bg-accent-hover text-white inline-flex items-center gap-2 font-semibold"
                >
                  <Car className="w-[18px] h-[18px]" strokeWidth={1.9} />
                  Mode voiture
                </button>
                <button
                  type="button"
                  onClick={handleClearCache}
                  className="press h-[46px] px-5 rounded-full border border-line2 hover:bg-panel inline-flex items-center gap-2 font-medium"
                >
                  {cacheCleared ? <Check className="w-[18px] h-[18px] text-ok" strokeWidth={2.2} /> : <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.9} />}
                  {cacheCleared ? "Cache vidé" : "Vider le cache"}
                </button>
              </div>
            </div>
          </Card>

          {/* Ma liste */}
          <Card labelledBy="list-h" className="col-span-12 xl:col-span-5">
            <div className="flex items-center justify-between">
              <h2 id="list-h" className="text-lg font-semibold">Ma liste</h2>
              <span className="text-sm text-muted">
                {entries.length} {entries.length > 1 ? "éléments" : "élément"}
              </span>
            </div>
            <div className="mt-[22px] grid grid-cols-2 gap-3">
              {[
                ["Films", countOf(["movie"])],
                ["Séries", countOf(["show", "episode"])],
                ["Albums & artistes", countOf(["album", "artist"])],
                ["Titres", countOf(["track"])],
              ].map(([label, n]) => (
                <div key={label} className="px-4 py-3.5 rounded-2xl bg-panel">
                  <div className="text-[13px] text-muted">{label}</div>
                  <div className="mt-1 text-2xl font-bold tracking-[-0.02em] tabular-nums">{n}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onNavigate("wishlist")}
              className="press mt-[22px] h-[46px] px-5 rounded-full border border-line2 hover:bg-panel inline-flex items-center gap-2 font-medium"
            >
              <Heart className="w-[18px] h-[18px]" strokeWidth={1.9} />
              Ouvrir ma liste
            </button>
          </Card>

          {/* Préférences */}
          <Card labelledBy="pref-h" className="col-span-12 xl:col-span-7">
            <h2 id="pref-h" className="text-lg font-semibold">Préférences</h2>
            <div className="mt-2">
              {(install.canPrompt || install.ios) && (
                <Row title="Application" hint="Plein écran, depuis l'écran d'accueil">
                  {install.canPrompt ? (
                    <button
                      type="button"
                      onClick={() => install.prompt()}
                      className="press h-10 px-4 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold"
                    >
                      Installer
                    </button>
                  ) : (
                    <IOSInstallSteps />
                  )}
                </Row>
              )}
              {prefetched && (
                <Row
                  title="Musique préchargée"
                  hint={
                    prefetched.tracks === 0
                      ? "Les titres à venir se téléchargent pendant l'écoute, pour ne pas couper quand le réseau faiblit"
                      : `${prefetched.tracks} ${prefetched.tracks > 1 ? "titres" : "titre"} · ${Math.round(prefetched.bytes / 1e6)} Mo sur cet appareil (250 Mo au plus)`
                  }
                >
                  <button
                    type="button"
                    onClick={handleClearPrefetched}
                    disabled={prefetched.tracks === 0}
                    aria-label="Vider la musique préchargée"
                    className="press h-10 px-4 rounded-full border border-line2 text-sm font-semibold hover:bg-surface2 disabled:opacity-40"
                  >
                    Vider
                  </button>
                </Row>
              )}
              <Row title="Thème" hint="Enregistré sur cet appareil" last>
                <div role="radiogroup" aria-label="Thème" className="flex p-1 rounded-[14px] bg-panel">
                  {THEME_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={mode === o.id}
                      onClick={() => setMode(o.id)}
                      className={`press h-9 px-3.5 rounded-[10px] text-sm font-medium ${
                        mode === o.id ? "bg-accent text-white" : "text-muted hover:text-fg"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </Row>
            </div>
          </Card>

          {/* Cet appareil */}
          <Card labelledBy="dev-h" className="col-span-12 xl:col-span-5">
            <h2 id="dev-h" className="text-lg font-semibold">Cet appareil</h2>
            <div className="mt-3.5 flex items-center gap-3.5 p-3 rounded-2xl bg-panel">
              <span className="w-11 h-11 rounded-xl bg-accent-soft text-accent-text grid place-items-center">
                {isMobile ? <Smartphone className="w-5 h-5" strokeWidth={1.8} /> : <Monitor className="w-5 h-5" strokeWidth={1.8} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold">{isStandalone ? "Application installée" : "Navigateur web"}</div>
                <div className="text-[13px] text-muted">
                  {isStandalone ? "Mode plein écran (PWA)" : "Ajoutez Nomad à l'écran d'accueil pour le plein écran"}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-3.5 p-3">
              <span className="w-11 h-11 rounded-xl bg-panel text-muted grid place-items-center">
                <Car className="w-5 h-5" strokeWidth={1.8} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold">CarPlay & Android Auto</div>
                <div className={`text-[13px] ${hasMediaSession ? "text-ok" : "text-muted"}`}>
                  {hasMediaSession ? "Commandes au volant disponibles" : "Non pris en charge par ce navigateur"}
                </div>
              </div>
            </div>
          </Card>

          {/* Égaliseur de la musique */}
          <Card labelledBy="eq-h" className="col-span-12 xl:col-span-7">
            <EqualizerPanel />
          </Card>
        </div>
      )}
    </div>
  );
};
