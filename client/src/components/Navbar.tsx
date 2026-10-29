import React from "react";
import { Search } from "lucide-react";
import { useServerStatus } from "../hooks/useServerStatus";
import { greeting } from "../utils/format";
import { Avatar, Pills, ThemeToggle } from "./ui";
import { HomeFilter } from "../views/HomeView";

interface NavbarProps {
  currentTab: string;
  setTab: (tab: string) => void;
  homeFilter: HomeFilter;
  setHomeFilter: (f: HomeFilter) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  hideOnMobile: boolean;
}

const HOME_TABS: { id: HomeFilter; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "films", label: "Films" },
  { id: "series", label: "Séries" },
  { id: "music", label: "Musique" },
];

// Barre supérieure du panneau principal
export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setTab,
  homeFilter,
  setHomeFilter,
  searchQuery,
  setSearchQuery,
  hideOnMobile,
}) => {
  const { serverName } = useServerStatus();

  return (
    <header
      className={`${hideOnMobile ? "hidden lg:flex" : "flex"} relative z-10 flex-wrap items-center gap-2.5 lg:gap-3 px-4 sm:px-6 lg:px-7 pb-4 lg:py-[18px] pt-[max(22px,env(safe-area-inset-top))]`}
    >
      {/* Mobile : avatar + salutation */}
      <button type="button" onClick={() => setTab("account")} aria-label="Compte" className="lg:hidden">
        <Avatar name={serverName} size={40} />
      </button>
      <div className="lg:hidden flex-1 min-w-0">
        <div className="text-[13px] text-muted">{greeting()}</div>
        <div className="text-lg font-semibold tracking-[-0.01em] truncate">{serverName}</div>
      </div>

      {/* Desktop : champ de recherche */}
      <div className="hidden lg:block relative flex-[1_1_260px] max-w-[380px]">
        <label className="sr-only" htmlFor="global-search">Rechercher</label>
        <Search className="absolute left-4 top-[13px] w-[18px] h-[18px] text-muted pointer-events-none" strokeWidth={2} />
        <input
          id="global-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => currentTab !== "search" && setTab("search")}
          placeholder="Films, séries, artistes, titres…"
          className="w-full h-11 pl-11 pr-4 rounded-full border border-line bg-surface2 text-[15px] placeholder:text-faint outline-none focus:border-line2"
        />
      </div>

      {currentTab === "home" && (
        <Pills
          label="Catégories"
          options={HOME_TABS}
          value={homeFilter}
          onChange={setHomeFilter}
          size="sm"
          className="order-3 w-full -mx-4 px-4 sm:-mx-6 sm:px-6 lg:order-none lg:w-auto lg:mx-0 lg:px-0 mt-2 lg:mt-0"
        />
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle className="bg-surface lg:bg-transparent lg:text-muted lg:hover:text-fg lg:hover:bg-surface2" />
        <button
          type="button"
          onClick={() => setTab("account")}
          className={`press hidden lg:flex items-center gap-2.5 h-11 pl-1 pr-3 rounded-full border border-line hover:bg-surface2 ${
            currentTab === "account" ? "bg-surface2" : ""
          }`}
        >
          <Avatar name={serverName} size={36} />
          <span className="text-sm font-medium max-w-[140px] truncate">{serverName}</span>
        </button>
      </div>
    </header>
  );
};
