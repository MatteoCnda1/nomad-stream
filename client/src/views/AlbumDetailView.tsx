import React, { useEffect, useState } from "react";
import { AlbumDetail } from "../types";
import { fetchAlbumDetail } from "../api";
import { useAudio } from "../context/AudioContext";
import { useWishlist } from "../context/WishlistContext";
import { usePlaylist } from "../context/PlaylistContext";
import { Heart, Shuffle, ListPlus, Plus } from "lucide-react";
import { Sk } from "../components/ui";
import {
  BigPlayButton,
  CollectionArt,
  CollectionHeader,
  MetaDot,
  TrackListHeader,
  TrackRow,
} from "../components/Collection";

interface AlbumDetailViewProps {
  albumId: string;
  onBack: () => void;
}

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({ albumId, onBack }) => {
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { playTrack, addToQueue, currentTrack } = useAudio();
  const { isSaved, toggle } = useWishlist();
  const { openPlaylistModal, showToast } = usePlaylist();

  useEffect(() => {
    fetchAlbumDetail(albumId)
      .then((data) => {
        setDetail(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [albumId]);

  if (loading || !detail) {
    return (
      <div aria-busy="true" aria-label="Chargement de l'album" className="pt-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-7">
          <Sk className="w-[176px] h-[176px] rounded-3xl" />
          <div className="flex-1">
            <Sk className="h-4 w-24 rounded-md" />
            <Sk className="mt-3 h-14 w-2/3 rounded-xl" />
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3">
          {Array.from({ length: 8 }, (_, i) => <Sk key={i} className="h-12 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const { album, tracks } = detail;
  const totalMinutes = Math.round(tracks.reduce((sum, t) => sum + t.duration, 0) / 60000);
  const saved = isSaved(album.id);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, 0);
    }
  };

  const handleShuffle = () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    if (shuffled.length > 0) playTrack(shuffled[0], shuffled, 0);
  };

  const handleAddAlbumToQueue = () => {
    if (tracks.length === 0) return;
    addToQueue(tracks);
    showToast(`${tracks.length} titres de l'album ajoutés à la file d'attente`);
  };

  const handleAddAlbumToPlaylist = () => {
    if (tracks.length === 0) return;
    openPlaylistModal(tracks);
  };

  return (
    <div className="anim-in">
      <CollectionHeader
        onBack={onBack}
        backLabel="Musique"
        art={<CollectionArt src={album.thumb} />}
        eyebrow="Album"
        title={album.title}
        meta={
          <>
            <span className="text-fg font-medium">{album.parentTitle || "Artiste inconnu"}</span>
            {album.year && <><MetaDot /><span>{album.year}</span></>}
            <MetaDot />
            <span>{tracks.length} {tracks.length > 1 ? "titres" : "titre"}</span>
            {totalMinutes > 0 && <><MetaDot /><span>{totalMinutes} min</span></>}
          </>
        }
      />

      <div className="flex items-center gap-2.5 sm:gap-3">
        <BigPlayButton onClick={handlePlayAll} label="Écouter l'album" disabled={tracks.length === 0} />
        <button
          type="button"
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          aria-label="Lecture aléatoire"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <Shuffle className="w-5 h-5" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={handleAddAlbumToQueue}
          disabled={tracks.length === 0}
          aria-label="Ajouter l'album à la file d'attente"
          title="Ajouter l'album à la file d'attente"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <ListPlus className="w-5 h-5" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={handleAddAlbumToPlaylist}
          disabled={tracks.length === 0}
          aria-label="Ajouter l'album à une playlist"
          title="Ajouter l'album à une playlist"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <Plus className="w-5 h-5" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => toggle(album)}
          aria-pressed={saved}
          aria-label={saved ? "Retirer l'album de ma liste" : "Ajouter l'album à ma liste"}
          className={`press w-11 h-11 rounded-full grid place-items-center hover:bg-card ${saved ? "text-accent" : "text-muted hover:text-fg"}`}
        >
          <Heart className={`w-5 h-5 ${saved ? "fill-current" : ""}`} strokeWidth={1.9} />
        </button>
      </div>

      <div className="mt-6">
        <TrackListHeader />
        <div className="mt-2 flex flex-col gap-0.5">
          {tracks.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              index={idx}
              isCurrent={currentTrack?.id === track.id}
              saved={isSaved(track.id)}
              onPlay={() => playTrack(track, tracks, idx)}
              onToggleSaved={() => toggle(track)}
              subtitle={track.originalTitle || track.grandparentTitle || album.parentTitle}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
