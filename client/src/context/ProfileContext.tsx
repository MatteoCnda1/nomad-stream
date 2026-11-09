// Profil choisi sur cet appareil (#40) et données reçues de la passerelle. Les playlists et
// « Ma liste » (PlaylistContext, WishlistContext) se rechargent quand le profil change : l'appli
// les monte sous une clé propre au profil.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Profile,
  ProfileData,
  cacheProfiles,
  cachedProfiles,
  createProfile,
  currentProfileId,
  deleteProfile,
  dropQueued,
  fetchProfileData,
  fetchProfiles,
  flushQueue,
  importLegacyData,
  localKey,
  pendingFor,
  setCurrentProfileId,
  subscribeQueue,
  updateProfile,
} from "../profiles";
import { clearApiCache } from "../api";

type Status = "loading" | "ready" | "unreachable";

interface ProfileContextType {
  status: Status;
  profiles: Profile[];
  profileId: string | null; // null : appareil sans profil (passerelle injoignable jusqu'ici)
  current: Profile | null;
  remote: { seq: number; profileId: string; data: ProfileData } | null; // dernières données reçues
  pending: boolean; // changements pas encore envoyés
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  select: (id: string) => void;
  create: (name: string, color: string) => Promise<Profile>;
  update: (id: string, fields: Partial<Pick<Profile, "name" | "color" | "plex">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => void;
}

const ProfileContext = createContext<ProfileContextType | null>(null);
const LOAD_TIMEOUT_MS = 5000;

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(cachedProfiles);
  const [profileId, setProfileId] = useState<string | null>(currentProfileId);
  const [status, setStatus] = useState<Status>("loading");
  const [remote, setRemote] = useState<ProfileContextType["remote"]>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(() => !!profileId && pendingFor(profileId));
  const seq = useRef(0);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;

  const keepProfiles = (list: Profile[]) => {
    setProfiles(list);
    cacheProfiles(list);
  };

  // Liste des profils : le choix n'est demandé que si la passerelle répond
  useEffect(() => {
    let done = false;
    const timer = window.setTimeout(() => !done && setStatus((s) => (s === "loading" ? "unreachable" : s)), LOAD_TIMEOUT_MS);
    fetchProfiles()
      .then((list) => {
        keepProfiles(list);
        setStatus("ready");
        // Profil supprimé depuis un autre appareil
        const id = profileIdRef.current;
        if (id && !list.some((p) => p.id === id)) {
          setCurrentProfileId(null);
          setProfileId(null);
        }
      })
      .catch(() => setStatus("unreachable"))
      .finally(() => {
        done = true;
        window.clearTimeout(timer);
      });
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => subscribeQueue(() => setPending(!!profileIdRef.current && pendingFor(profileIdRef.current))), []);
  useEffect(() => setPending(!!profileId && pendingFor(profileId)), [profileId]);

  // Données à jour : les changements en attente partent d'abord ; s'il en reste (réseau coupé),
  // la copie locale est plus récente que celle de la passerelle et on la garde
  const pulling = useRef(false);
  const refresh = useCallback(async () => {
    const id = profileIdRef.current;
    if (!id || pulling.current) return;
    pulling.current = true;
    try {
      const imported = await importLegacyData(id);
      if (imported) console.log(`${imported} playlist(s) et élément(s) de « Ma liste » versés dans le profil`);
      await flushQueue();
      if (pendingFor(id)) return;
      const data = await fetchProfileData(id);
      if (pendingFor(id) || profileIdRef.current !== id) return; // changé pendant la requête
      if (data.repaired) console.log(`🩹 ${data.repaired} élément(s) réparé(s) par la passerelle`);
      setRemote({ seq: ++seq.current, profileId: id, data });
    } catch (error) {
      console.warn("Synchronisation du profil impossible :", (error as Error).message);
    } finally {
      pulling.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [profileId, refresh]);

  const select = (id: string) => {
    setCurrentProfileId(id);
    clearApiCache(); // réponses gardées en mémoire : positions de reprise de l'ancien profil
    setRemote(null);
    setProfileId(id);
    setPickerOpen(false);
  };

  const create = async (name: string, color: string) => {
    const profile = await createProfile(name, color);
    keepProfiles([...profiles, profile]);
    return profile;
  };

  const update = async (id: string, fields: Partial<Pick<Profile, "name" | "color" | "plex">>) => {
    await updateProfile(id, fields);
    // Lien avec Plex : il change aussi pour les autres profils
    keepProfiles(await fetchProfiles());
    if (fields.plex !== undefined) clearApiCache();
  };

  const remove = async (id: string) => {
    await deleteProfile(id);
    dropQueued(id);
    for (const kind of ["playlists", "wishlist", "music-downloads"] as const) localStorage.removeItem(localKey(kind, id));
    keepProfiles(profiles.filter((p) => p.id !== id));
    if (profileIdRef.current === id) {
      setCurrentProfileId(null);
      setProfileId(null);
      setPickerOpen(true);
    }
  };

  const current = profiles.find((p) => p.id === profileId) ?? null;

  return (
    <ProfileContext.Provider
      value={{
        status,
        profiles,
        profileId,
        current,
        remote,
        pending,
        pickerOpen,
        openPicker: () => setPickerOpen(true),
        closePicker: () => setPickerOpen(false),
        select,
        create,
        update,
        remove,
        refresh: () => void refresh(),
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfiles() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfiles must be used within a ProfileProvider");
  return ctx;
}
