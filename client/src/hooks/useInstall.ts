import { useEffect, useState } from "react";

// Installation de la PWA (#9). Chrome et Edge (Android, ordinateur) proposent leur propre invite
// (événement beforeinstallprompt) ; iOS n'en a pas : il faut expliquer Partager › « Sur l'écran
// d'accueil ». L'événement peut arriver avant le premier rendu : il est capté dès le chargement.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // l'appli choisit le moment de l'invite
  deferred = e as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPhone, iPod, et iPad (qui se présente comme un Mac tactile depuis iPadOS 13)
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  const installed = isStandalone();
  return {
    installed,
    // Invite du navigateur disponible
    canPrompt: !installed && !!deferred,
    // iOS : installation à la main, à expliquer
    ios: !installed && isIOS(),
    prompt: async () => {
      const event = deferred;
      if (!event) return false;
      deferred = null;
      await event.prompt();
      const { outcome } = await event.userChoice;
      notify();
      return outcome === "accepted";
    },
  };
}
