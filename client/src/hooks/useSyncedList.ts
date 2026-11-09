import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { useProfiles } from "../context/ProfileContext";
import { ProfileData, enqueue, localKey, readLocal, writeLocal } from "../profiles";

// Liste d'un profil (playlists ou « Ma liste ») : copie locale, envoi de chaque changement à la
// passerelle, remplacement par la version de la passerelle quand elle arrive.
//
// Les changements sont trouvés en comparant la liste à la précédente, élément par élément (par
// référence) : chaque fonction de modification n'a rien à faire de plus. Une liste reçue de la
// passerelle devient la référence avant d'être affichée, et n'est donc jamais renvoyée.
// Le composant qui s'en sert est remonté à chaque changement de profil (voir App.tsx).
export function useSyncedList<T>(
  kind: "playlists" | "wishlist",
  idOf: (item: T) => string,
): [T[], Dispatch<SetStateAction<T[]>>] {
  const { profileId, remote } = useProfiles();
  const key = localKey(kind, profileId);
  const [list, setList] = useState<T[]>(() => {
    const stored = readLocal<T[]>(key, []);
    return Array.isArray(stored) ? stored : [];
  });
  const sent = useRef<Map<string, T>>(new Map(list.map((t) => [idOf(t), t])));

  // Version de la passerelle
  const appliedSeq = useRef(0);
  useEffect(() => {
    if (!remote || remote.profileId !== profileId || remote.seq === appliedSeq.current) return;
    appliedSeq.current = remote.seq;
    const next = (remote.data[kind as keyof ProfileData] as unknown as T[]) || [];
    sent.current = new Map(next.map((t) => [idOf(t), t]));
    setList(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, profileId, kind]);

  // Copie locale et envoi des changements
  useEffect(() => {
    writeLocal(key, list);
    if (!profileId) return; // appareil sans profil : rien à envoyer
    const base = `/api/profiles/${profileId}/${kind}`;
    const next = new Map(list.map((t) => [idOf(t), t]));
    for (const [id, item] of next) {
      if (sent.current.get(id) !== item) enqueue({ profileId, method: "PUT", path: `${base}/${encodeURIComponent(id)}`, body: item });
    }
    for (const id of sent.current.keys()) {
      if (!next.has(id)) enqueue({ profileId, method: "DELETE", path: `${base}/${encodeURIComponent(id)}` });
    }
    sent.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return [list, setList];
}
