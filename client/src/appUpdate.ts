// Nouvelle version de l'appli déployée sur la passerelle : l'appli ouverte (ou installée, et
// rouverte depuis la mémoire du téléphone) tourne encore sur l'ancienne. On compare son script
// principal à celui que sert la passerelle (/api/version), et on propose d'actualiser.
import { useEffect, useState } from "react";

const CHECK_EVERY_MS = 10 * 60 * 1000;

// Script principal de cette page (/assets/index-<empreinte>.js) ; null en développement (Vite)
export function runningVersion(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!script) return null;
  const match = /\/assets\/index-[\w-]+\.js/.exec(new URL(script.src, location.href).pathname);
  return match ? match[0] : null;
}

export async function servedVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const { version } = await res.json();
    return typeof version === "string" ? version : null;
  } catch {
    return null; // hors connexion
  }
}

// Recharge sur la nouvelle version (service worker remis à jour au passage)
export async function applyUpdate() {
  try {
    await (await navigator.serviceWorker?.getRegistration())?.update();
  } catch {
    // Ignore : la page se recharge quand même
  }
  location.reload();
}

// Version disponible plus récente que celle qui tourne, ou null
export function useAppUpdate(): string | null {
  const [available, setAvailable] = useState<string | null>(null);
  useEffect(() => {
    const running = runningVersion();
    if (!running) return;
    let busy = false;
    const check = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      const served = await servedVersion();
      busy = false;
      if (served && served !== running) setAvailable(served);
    };
    void check();
    const onVisible = () => document.visibilityState === "visible" && void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, []);
  return available;
}
