import React from "react";
import { Home, Search, Music, Heart, Download, Car, User } from "lucide-react";

interface BottomNavProps {
  currentTab: string;
  setTab: (tab: string) => void;
}

// Dock flottant en pilule (mobile & tablette) — toujours sombre, quel que soit le thème
export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, setTab }) => {
  const tabs = [
    { id: "home", label: "Accueil", icon: Home },
    { id: "search", label: "Rechercher", icon: Search },
    { id: "music", label: "Musique", icon: Music },
    { id: "wishlist", label: "Ma liste", icon: Heart },
    { id: "downloads", label: "Téléchargements", icon: Download },
    { id: "car", label: "Mode voiture", icon: Car },
    { id: "account", label: "Compte", icon: User },
  ];

  return (
    <nav
      aria-label="Navigation"
      className="lg:hidden fixed left-1/2 -translate-x-1/2 z-40 flex gap-1 p-1.5 rounded-full bg-[#151518] shadow-[0_16px_34px_-12px_rgba(0,0,0,.55)]"
      style={{ bottom: "max(18px, env(safe-area-inset-bottom))" }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        // Films et séries sont accessibles depuis l'accueil
        const isActive =
          currentTab === tab.id || (tab.id === "home" && (currentTab === "movies" || currentTab === "shows"));
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={`press h-[46px] rounded-full grid place-items-center ${
              isActive ? "w-[52px] bg-[#e5131d] text-white" : "w-[46px] bg-[#232328] text-[#c9c9cf] hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5" strokeWidth={1.9} />
          </button>
        );
      })}
    </nav>
  );
};
