import React, { useState } from 'react';
import { Download, Loader2, Check, ShieldCheck, Music, Film } from 'lucide-react';
import { thumbnailProxyUrl } from '../lib/api';
import { SFX } from '../lib/sfx';

const AUDIO_QUALITIES = [
  { id: '320k', label: 'MP3 · 320k' },
  { id: 'FLAC', label: 'FLAC' },
  { id: 'WAV', label: 'WAV' },
];

const VIDEO_QUALITIES = [
  { id: '4K', label: '4K UHD' },
  { id: '1080p', label: '1080p HD' },
  { id: '720p', label: '720p' },
];

export default function ActiveMediaCard({
  media,
  mode,
  quality,
  onModeChange,
  onQualityChange,
  onToggleTrack,
  onToggleAllTracks,
  onDownload,
  downloadState,
}) {
  const [imgError, setImgError] = useState(false);

  if (!media) return null;

  const qualities = mode === 'audio' ? AUDIO_QUALITIES : VIDEO_QUALITIES;
  const isWorking = downloadState.status === 'downloading';
  const isDone = downloadState.status === 'done';

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };

  const selectedCount = media.isPlaylist
    ? (media.tracks || []).filter((t) => t.checked).length
    : 1;

  const thumbSrc = media.thumbnail && !imgError ? thumbnailProxyUrl(media.thumbnail) : '';

  return (
    <div
      onMouseMove={handleMouseMove}
      className="glass-surface glass-interactive rounded-[28px] p-5 sm:p-6 animate-card-enter"
    >
      <div className="relative z-10">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Artwork */}
          <div
            className="relative w-full sm:w-36 h-44 sm:h-36 rounded-[20px] shrink-0 overflow-hidden shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, #1b1b24 0%, #3d1624 55%, #FF3D6E 100%)',
            }}
          >
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={media.title}
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {mode === 'audio' ? (
                  <Music className="w-10 h-10 text-white/75" />
                ) : (
                  <Film className="w-10 h-10 text-white/75" />
                )}
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-white/10" />
            <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-md text-[10px] font-semibold tracking-wider text-white border border-white/15 uppercase">
              {media.platformKey === 'generic' ? 'MEDIA' : media.platformKey}
            </div>
            {media.duration && (
              <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-md text-[11px] font-medium text-white tabular-nums">
                {media.duration}
              </div>
            )}
          </div>

          {/* Info & Controls */}
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#FF3D6E]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF3D6E]" />
                  {media.platform}
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold tracking-tight leading-snug truncate" title={media.title}>
                {media.title}
              </h3>
              <p className="text-xs sm:text-sm text-muted truncate mt-0.5">{media.author}</p>
            </div>

            {/* Format & Quality */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <div className="seg-track">
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => {
                    SFX.tick();
                    onModeChange('audio');
                  }}
                  className={`relative z-10 px-3.5 py-1.5 text-xs font-medium rounded-[10px] cursor-pointer transition-all ${
                    mode === 'audio'
                      ? 'bg-white/15 dark:bg-white/15 shadow-sm'
                      : 'text-muted hover:text-soft'
                  }`}
                >
                  Audio
                </button>
                {!media.audioOnly && (
                  <button
                    type="button"
                    disabled={isWorking}
                    onClick={() => {
                      SFX.tick();
                      onModeChange('video');
                    }}
                    className={`relative z-10 px-3.5 py-1.5 text-xs font-medium rounded-[10px] cursor-pointer transition-all ${
                      mode === 'video'
                        ? 'bg-white/15 dark:bg-white/15 shadow-sm'
                        : 'text-muted hover:text-soft'
                    }`}
                  >
                    Vídeo
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {qualities.map((q) => {
                  const active = quality === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      disabled={isWorking}
                      onClick={() => {
                        SFX.tick();
                        onQualityChange(q.id);
                      }}
                      className={`tactile px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                        active
                          ? 'bg-[#FF3D6E]/18 text-[#FF3D6E] border border-[#FF3D6E]/45 shadow-[0_0_16px_rgba(255,61,110,0.18)]'
                          : 'glass-pill text-muted hover:text-soft'
                      }`}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Playlist Track Picker */}
        {media.isPlaylist && Array.isArray(media.tracks) && media.tracks.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between text-xs text-muted mb-2.5">
              <span>
                Pistas seleccionadas ({selectedCount}/{media.tracks.length})
              </span>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => {
                  SFX.tick();
                  onToggleAllTracks(selectedCount < media.tracks.length);
                }}
                className="text-[#FF3D6E] hover:underline cursor-pointer"
              >
                {selectedCount < media.tracks.length ? 'Seleccionar todas' : 'Deseleccionar todas'}
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto pr-1 space-y-1.5">
              {media.tracks.map((t, idx) => (
                <label
                  key={t.id || idx}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl glass-pill cursor-pointer hover:border-[#FF3D6E]/40"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      disabled={isWorking}
                      checked={Boolean(t.checked)}
                      onChange={() => {
                        SFX.tick();
                        onToggleTrack(idx);
                      }}
                      className="accent-[#FF3D6E] w-3.5 h-3.5 rounded cursor-pointer"
                    />
                    <span className="text-xs font-medium truncate">{t.title}</span>
                    {t.artist && <span className="text-[11px] text-muted truncate">· {t.artist}</span>}
                  </div>
                  <span className="text-[11px] text-muted tabular-nums shrink-0">{t.duration}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Download Footer & Live Progress */}
        <div className="mt-5 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {isWorking || isDone ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="text-soft font-medium truncate">{downloadState.phase}</span>
                  <span className="font-mono tabular-nums text-[#FF3D6E] font-semibold shrink-0">
                    {downloadState.progress}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden relative">
                  <div
                    className={`${isWorking ? 'progress-shimmer' : ''} relative h-full rounded-full transition-all duration-200`}
                    style={{
                      width: `${Math.max(4, downloadState.progress)}%`,
                      background: 'linear-gradient(90deg, #FF3D6E, #FF6B92)',
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted">
                <ShieldCheck className="w-4 h-4 text-[#FF3D6E] shrink-0" />
                <span className="truncate">Metadatos y carátula incrustados automáticamente</span>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isWorking || (media.isPlaylist && selectedCount === 0)}
            onClick={onDownload}
            className="btn-pink rounded-[16px] px-6 py-3 text-sm font-semibold flex items-center justify-center gap-2 shrink-0 cursor-pointer"
          >
            {isWorking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Descargando...</span>
              </>
            ) : isDone ? (
              <>
                <Check className="w-4 h-4" />
                <span>Completado</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {media.isPlaylist
                    ? `Descargar (${selectedCount})`
                    : `Descargar ${mode === 'audio' ? (quality === '320k' ? 'MP3' : quality) : 'MP4'}`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
