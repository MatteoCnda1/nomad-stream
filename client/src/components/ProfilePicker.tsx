import React, { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useProfiles } from "../context/ProfileContext";
import { PROFILE_COLORS, Profile } from "../profiles";
import { Logo } from "./ui";
import { initials } from "../utils/format";

export const ProfileAvatar: React.FC<{ profile: Pick<Profile, "name" | "color">; size?: number; className?: string }> = ({
  profile,
  size = 40,
  className = "",
}) => (
  <span
    aria-hidden="true"
    className={`rounded-full text-white grid place-items-center font-semibold flex-shrink-0 ${className}`}
    style={{ width: size, height: size, background: profile.color, fontSize: Math.round(size * 0.38) }}
  >
    {initials(profile.name)}
  </span>
);

type Editing = { id: string | null; name: string; color: string; plex?: boolean }; // id null : nouveau profil

// Écran « Qui écoute ? » : au premier lancement, et depuis Compte › Changer de profil
export const ProfilePicker: React.FC = () => {
  const { profiles, profileId, select, create, update, remove, closePicker } = useProfiles();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(profiles.length === 0 ? newProfile(0) : null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function newProfile(count: number): Editing {
    return { id: null, name: "", color: PROFILE_COLORS[count % PROFILE_COLORS.length] };
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La passerelle ne répond pas");
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    run(async () => {
      if (editing.id) {
        const was = profiles.find((p) => p.id === editing.id)?.plexLinked;
        await update(editing.id, {
          name: editing.name.trim(),
          color: editing.color,
          ...(editing.plex !== undefined && editing.plex !== was && { plex: editing.plex }),
        });
        setEditing(null);
      } else {
        const p = await create(editing.name.trim(), editing.color);
        setEditing(null);
        select(p.id); // nouveau profil : on y entre directement
      }
    });
  };

  const canClose = !!profileId && profiles.some((p) => p.id === profileId);

  return (
    <div className="fixed inset-0 z-[60] bg-bg overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-[max(32px,env(safe-area-inset-top))]">
        {canClose && (
          <button
            type="button"
            onClick={closePicker}
            aria-label="Fermer"
            className="press absolute right-4 top-[max(16px,env(safe-area-inset-top))] w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        <Logo size={30} />
        <h1 className="mt-8 text-[28px] sm:text-[34px] font-bold tracking-[-0.03em] text-center">
          {editing && !editing.id && profiles.length === 0
            ? "Créez votre profil"
            : managing
            ? "Gérer les profils"
            : "Qui écoute ?"}
        </h1>
        <p className="mt-2 text-[15px] text-muted text-center max-w-[420px]">
          {profiles.length === 0
            ? "Vos playlists et « Ma liste » seront gardées sur la passerelle et retrouvées sur tous vos appareils."
            : "Chaque profil a ses playlists et sa liste, sur tous les appareils."}
        </p>

        {editing ? (
          <form onSubmit={save} className="mt-8 w-full max-w-[360px] flex flex-col items-center gap-5">
            <ProfileAvatar profile={{ name: editing.name || "?", color: editing.color }} size={96} />
            <label className="w-full">
              <span className="sr-only">Nom du profil</span>
              <input
                autoFocus
                value={editing.name}
                maxLength={40}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Prénom"
                className="w-full h-12 px-4 rounded-2xl border border-line bg-card text-center text-[16px] outline-none focus:border-accent"
              />
            </label>
            <div role="radiogroup" aria-label="Couleur" className="flex flex-wrap justify-center gap-2.5">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={editing.color === c}
                  aria-label={`Couleur ${c}`}
                  onClick={() => setEditing({ ...editing, color: c })}
                  className="press w-9 h-9 rounded-full grid place-items-center text-white"
                  style={{ background: c }}
                >
                  {editing.color === c && <Check className="w-4 h-4" strokeWidth={3} />}
                </button>
              ))}
            </div>
            {editing.id && (
              <label className="w-full flex items-start gap-3 p-3.5 rounded-2xl bg-card cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editing.plex}
                  onChange={(e) => setEditing({ ...editing, plex: e.target.checked })}
                  className="mt-0.5 w-5 h-5 accent-[rgb(var(--accent))] flex-shrink-0"
                />
                <span className="text-left">
                  <span className="block text-[15px] font-medium">Progression partagée avec Plex</span>
                  <span className="block mt-0.5 text-[13px] text-muted">
                    « Reprendre » et « Continuer la lecture » suivent le compte Plex (applis Plex de la TV comprises).
                    Un seul profil à la fois ; les autres ont leur propre progression.
                  </span>
                </span>
              </label>
            )}
            {error && <p className="text-sm text-accent-text text-center">{error}</p>}
            <div className="flex gap-2.5">
              {profiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="press px-5 h-11 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-card"
                >
                  Annuler
                </button>
              )}
              <button
                type="submit"
                disabled={busy || !editing.name.trim()}
                className="press px-6 h-11 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing.id ? "Enregistrer" : "Créer le profil"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <ul className="mt-9 flex flex-wrap justify-center gap-5 sm:gap-7 max-w-[720px]">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() =>
                      managing
                        ? setEditing({ id: p.id, name: p.name, color: p.color, plex: !!p.plexLinked })
                        : select(p.id)
                    }
                    className="press group flex flex-col items-center gap-2.5 w-[104px] sm:w-[120px]"
                    aria-label={managing ? `Modifier ${p.name}` : `Choisir ${p.name}`}
                  >
                    <span className="relative">
                      <ProfileAvatar
                        profile={p}
                        size={96}
                        className={`ring-offset-4 ring-offset-bg transition ${
                          p.id === profileId ? "ring-2 ring-fg" : "group-hover:ring-2 group-hover:ring-line2"
                        }`}
                      />
                      {managing && (
                        <span className="absolute inset-0 rounded-full bg-black/45 grid place-items-center text-white">
                          <Pencil className="w-6 h-6" strokeWidth={1.9} />
                        </span>
                      )}
                    </span>
                    <span className="text-[15px] font-medium truncate max-w-full">{p.name}</span>
                  </button>
                  {managing && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(p)}
                      className="press mt-1 mx-auto flex items-center gap-1 text-xs text-muted hover:text-accent-text"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Supprimer
                    </button>
                  )}
                </li>
              ))}
              {!managing && profiles.length < 12 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setEditing(newProfile(profiles.length))}
                    className="press group flex flex-col items-center gap-2.5 w-[104px] sm:w-[120px]"
                  >
                    <span className="w-24 h-24 rounded-full border-2 border-dashed border-line2 grid place-items-center text-muted group-hover:text-fg group-hover:border-fg transition">
                      <Plus className="w-8 h-8" strokeWidth={1.7} />
                    </span>
                    <span className="text-[15px] font-medium text-muted">Ajouter</span>
                  </button>
                </li>
              )}
            </ul>
            {error && <p className="mt-4 text-sm text-accent-text text-center">{error}</p>}
            {profiles.length > 0 && (
              <button
                type="button"
                onClick={() => setManaging((m) => !m)}
                className="press mt-10 px-5 h-10 rounded-full border border-line2 text-sm font-semibold text-muted hover:text-fg"
              >
                {managing ? "Terminé" : "Gérer les profils"}
              </button>
            )}
          </>
        )}
      </div>

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-profile-title"
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div className="w-full max-w-sm rounded-3xl bg-surface p-6 border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-profile-title" className="text-lg font-bold">Supprimer « {confirmDelete.name} » ?</h2>
            <p className="mt-2 text-sm text-muted">
              Ses playlists et sa liste disparaîtront de tous les appareils. (La passerelle en garde une copie de secours.)
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="press px-4 h-10 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await remove(confirmDelete.id);
                    setConfirmDelete(null);
                  })
                }
                className="press px-5 h-10 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
