import React from "react";
import { Play, Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { avatarColor, initials } from "../utils/format";

// Logo : losange rouge + triangle de lecture
export const Logo: React.FC<{ size?: number; withText?: boolean }> = ({ size = 28, withText = true }) => (
  <span className="flex items-center gap-2.5">
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="5" y="5" width="18" height="18" rx="4.5" transform="rotate(45 14 14)" fill="#e5131d" />
      <path d="M11.6 9.8v8.4l6.6-4.2z" fill="#fff" />
    </svg>
    {withText && <span className="text-[22px] font-bold tracking-[-0.03em]">nomad</span>}
  </span>
);

// Bloc squelette animé
export const Sk: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = "", style }) => (
  <div className={`sk ${className}`} style={style} />
);

export const SectionHeader: React.FC<{
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}> = ({ title, actionLabel = "Tout afficher", onAction, className = "mb-4" }) => (
  <div className={`flex items-baseline justify-between gap-4 ${className}`}>
    <h2 className="text-xl lg:text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
    {onAction && (
      <button
        type="button"
        onClick={onAction}
        className="text-sm font-medium text-muted hover:text-fg transition-colors"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const PlayGlyph: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <Play className={`${className} fill-current`} strokeWidth={0} aria-hidden="true" />
);

// Affiche 2/3 avec titre en surimpression et pastille lecture rouge
export const PosterCard: React.FC<{
  img: string | null;
  title: string;
  meta?: string;
  onClick: () => void;
  badge?: React.ReactNode;
  progress?: number;
}> = ({ img, title, meta, onClick, badge, progress }) => (
  <button type="button" onClick={onClick} className="lift block w-full text-left">
    <div className="zoom relative aspect-[2/3] rounded-[18px] bg-card">
      {img && (
        <img src={img} alt="" loading="lazy" decoding="async" className="z w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-55% to-black/85" />
      {badge && <div className="absolute top-3 right-3">{badge}</div>}
      <div className="absolute left-3.5 right-3.5 bottom-3.5 text-white flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] lg:text-base font-bold leading-tight line-clamp-2">{title}</div>
          {meta && <div className="mt-1 text-xs text-white/75 truncate">{meta}</div>}
        </div>
        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-accent grid place-items-center">
          <PlayGlyph className="w-3.5 h-3.5 text-white ml-0.5" />
        </span>
      </div>
      {progress != null && progress > 0 && (
        <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25">
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  </button>
);

// Tuile musique carrée avec bouton lecture au survol
export const MusicTile: React.FC<{
  img: string | null;
  title: string;
  sub?: string;
  round?: boolean;
  onClick: () => void;
}> = ({ img, title, sub, round, onClick }) => (
  <button type="button" onClick={onClick} className="tile block w-full text-left p-2.5 rounded-2xl">
    <div className="relative">
      <img
        src={img || "/icon.svg"}
        alt=""
        loading="lazy"
        decoding="async"
        className={`w-full aspect-square object-cover bg-card shadow-[0_10px_24px_-12px_rgba(0,0,0,.5)] ${
          round ? "rounded-full" : "rounded-xl"
        }`}
      />
      <span className="fab absolute right-2.5 bottom-2.5 w-[46px] h-[46px] rounded-full bg-accent grid place-items-center shadow-[0_10px_24px_-6px_rgba(229,19,29,.6)]">
        <PlayGlyph className="w-[18px] h-[18px] text-white ml-0.5" />
      </span>
    </div>
    <div className="mt-3 text-[15px] font-semibold truncate">{title || "Sans titre"}</div>
    {sub && <div className="mt-0.5 text-[13px] leading-snug text-muted line-clamp-2">{sub}</div>}
  </button>
);

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Changer de thème"
      className={`press w-11 h-11 rounded-full grid place-items-center ${className}`}
    >
      {isDark ? <Sun className="w-[19px] h-[19px]" strokeWidth={1.8} /> : <Moon className="w-[18px] h-[18px]" strokeWidth={1.8} />}
    </button>
  );
};

export const Avatar: React.FC<{ name: string; size?: number; className?: string }> = ({
  name,
  size = 36,
  className = "",
}) => (
  <span
    className={`rounded-full text-white grid place-items-center font-semibold flex-shrink-0 ${className}`}
    style={{ width: size, height: size, background: avatarColor(name), fontSize: Math.round(size * 0.38) }}
    aria-hidden="true"
  >
    {initials(name)}
  </span>
);

// Pastilles de filtre (onglets)
export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
  size = "md",
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-2 overflow-x-auto no-scrollbar ${className}`}>
      {options.map((o) => {
        const sel = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={sel}
            onClick={() => onChange(o.id)}
            className={`press inline-flex items-center gap-2 rounded-full font-medium whitespace-nowrap ${
              size === "sm" ? "h-[38px] px-4 text-sm" : "h-10 px-[18px] text-sm"
            } ${sel ? "bg-accent text-white" : "bg-card text-fg hover:bg-surface3"}`}
          >
            {o.label}
            {o.count != null && <span className={`text-xs ${sel ? "" : "opacity-75"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
