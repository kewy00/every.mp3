import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  Sun,
  Moon,
  User,
  ArrowRight,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import PlatformIcon, { detectPlatformKey } from './components/PlatformIcon';
import ActiveMediaCard from './components/ActiveMediaCard';
import HistoryStack from './components/HistoryStack';
import ProfileModal from './components/ProfileModal';
import { SFX } from './lib/sfx';
import {
  checkEnginesStatus,
  isMobileDevice,
  inspectMediaUrl,
  startDownloadStream,
  triggerBrowserDownload,
  formatBytes,
} from './lib/api';
import {
  subscribeAuth,
  loginWithGoogle,
  logoutGoogle,
  loadUserPreferences,
  saveUserPreferences,
  subscribeUserHistory,
  addUserHistoryItem,
  deleteUserHistoryItem,
  clearUserHistory,
} from './lib/firebase';

const LOCAL_HISTORY_KEY = 'every_mp3_history_v1';
const LOCAL_PREFS_KEY = 'every_mp3_prefs_v1';

function readLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function readLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function App() {
  const initialPrefs = readLocalPrefs();

  const [theme, setTheme] = useState(initialPrefs.theme || 'dark');
  const [sfxEnabled, setSfxEnabled] = useState(
    initialPrefs.sfxEnabled !== undefined ? initialPrefs.sfxEnabled : true
  );
  const [defaultFormat, setDefaultFormat] = useState(initialPrefs.defaultFormat || 'audio:320k');

  const [isMobile] = useState(() => isMobileDevice());
  const [engineOnline, setEngineOnline] = useState(true);
  const [island, setIsland] = useState({
    status: 'idle',
    text: 'Listo · Pega un enlace para empezar',
  });

  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeMedia, setActiveMedia] = useState(null);
  const [mode, setMode] = useState('audio');
  const [quality, setQuality] = useState('320k');
  const [downloadState, setDownloadState] = useState({
    status: 'idle',
    progress: 0,
    phase: '',
  });

  const [history, setHistory] = useState(readLocalHistory);
  const [filter, setFilter] = useState('all');

  const [user, setUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [toast, setToast] = useState({ visible: false, text: '' });
  const toastTimerRef = useRef(null);

  const showToast = (text) => {
    setToast({ visible: true, text });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 2600);
  };

  // Sync theme to <html>
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    html.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Sync SFX engine
  useEffect(() => {
    SFX.setEnabled(sfxEnabled);
  }, [sfxEnabled]);

  // Persist prefs locally & to Firestore when signed in
  const persistPrefs = (next) => {
    const merged = {
      theme: next.theme ?? theme,
      sfxEnabled: next.sfxEnabled ?? sfxEnabled,
      defaultFormat: next.defaultFormat ?? defaultFormat,
    };
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(merged));
    if (user?.uid) {
      saveUserPreferences(user.uid, merged).catch(() => {});
    }
  };

  // Check cloud & local engine health on mount
  useEffect(() => {
    checkEnginesStatus().then(({ cloudOnline, localOnline, isMobile: mobile }) => {
      const anyOnline = cloudOnline || localOnline;
      setEngineOnline(anyOnline);
      if (!anyOnline) {
        setIsland({ status: 'error', text: 'Motor de descargas desconectado' });
      } else if (mobile) {
        setIsland({ status: 'idle', text: 'Listo · TikTok, SoundCloud e Instagram' });
      } else if (cloudOnline && localOnline) {
        setIsland({ status: 'idle', text: 'Listo · Servidor + YouTube local activos' });
      } else if (localOnline) {
        setIsland({ status: 'idle', text: 'Listo · Motor local (PC) activo' });
      } else {
        setIsland({ status: 'idle', text: 'Listo · Servidor activo (YouTube en PC local)' });
      }
    });
  }, []);

  // Subscribe to Firebase Auth & Firestore
  useEffect(() => {
    let unsubHistory = null;
    const unsubAuth = subscribeAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (unsubHistory) {
        unsubHistory();
        unsubHistory = null;
      }

      if (firebaseUser) {
        try {
          const prefs = await loadUserPreferences(firebaseUser.uid);
          if (prefs) {
            if (prefs.theme) setTheme(prefs.theme);
            if (typeof prefs.sfxEnabled === 'boolean') setSfxEnabled(prefs.sfxEnabled);
            if (prefs.defaultFormat) setDefaultFormat(prefs.defaultFormat);
          }
        } catch {
          // ignore
        }

        unsubHistory = subscribeUserHistory(firebaseUser.uid, (cloudItems) => {
          setHistory(cloudItems);
        });
      } else {
        setHistory(readLocalHistory());
      }
    });

    return () => {
      unsubAuth();
      if (unsubHistory) unsubHistory();
    };
  }, []);

  const handleAnalyze = async (forcedUrl = null) => {
    const targetUrl = (forcedUrl ?? url).trim();
    if (!targetUrl) {
      SFX.error();
      showToast('Pega un enlace primero');
      return;
    }

    if (forcedUrl !== null) setUrl(targetUrl);
    SFX.tap();
    setErrorMsg('');
    setAnalyzing(true);
    setActiveMedia(null);
    setDownloadState({ status: 'idle', progress: 0, phase: '' });
    setIsland({ status: 'working', text: 'Analizando enlace...' });

    try {
      const data = await inspectMediaUrl(targetUrl);
      setActiveMedia(data);

      // Apply preferred format if compatible
      const [prefMode, prefQual] = defaultFormat.split(':');
      if (data.audioOnly) {
        setMode('audio');
        setQuality(prefMode === 'audio' && prefQual ? prefQual : '320k');
      } else {
        const nextMode = prefMode === 'audio' || prefMode === 'video' ? prefMode : data.defaultMode;
        setMode(nextMode);
        setQuality(
          nextMode === prefMode && prefQual
            ? prefQual
            : nextMode === 'audio'
            ? '320k'
            : '1080p'
        );
      }

      SFX.reveal();
      setIsland({ status: 'done', text: `${data.platform} detectado · Listo para descargar` });
    } catch (err) {
      SFX.error();
      setErrorMsg(err.message || 'No se pudo analizar este enlace.');
      setIsland({ status: 'error', text: 'Error al analizar el enlace' });
    } finally {
      setAnalyzing(false);
    }
  };

  const pushHistory = async (entry) => {
    if (user?.uid) {
      try {
        await addUserHistoryItem(user.uid, entry);
      } catch {
        // fallback local
      }
    } else {
      const next = [{ ...entry, id: `local-${Date.now()}` }, ...history].slice(0, 50);
      setHistory(next);
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
    }
  };

  const handleDownload = async () => {
    if (!activeMedia || downloadState.status === 'downloading') return;
    SFX.start();
    setErrorMsg('');

    const fmtLabel =
      mode === 'audio' ? (quality === '320k' ? 'MP3 · 320k' : quality) : `MP4 · ${quality}`;

    try {
      if (activeMedia.isPlaylist && Array.isArray(activeMedia.tracks)) {
        const selected = activeMedia.tracks.filter((t) => t.checked);
        if (selected.length === 0) return;

        for (let i = 0; i < selected.length; i++) {
          const track = selected[i];
          const prefix = `[${i + 1}/${selected.length}] `;
          setIsland({ status: 'working', text: `${prefix}${track.title.slice(0, 26)}` });

          const finished = await startDownloadStream(
            {
              url: track.url || '',
              searchQuery: track.searchQuery || '',
              mode,
              quality,
              title: track.artist ? `${track.artist} - ${track.title}` : track.title,
              engineSource: activeMedia.engineSource,
            },
            (evt) => {
              const overall = Math.round(((i + (evt.progress || 0) / 100) / selected.length) * 100);
              setDownloadState({
                status: 'downloading',
                progress: overall,
                phase: `${prefix}${evt.phase || 'Descargando...'}`,
              });
            }
          );

          triggerBrowserDownload(finished.fileUrl, finished.fileName);

          await pushHistory({
            title: track.title,
            author: `${track.artist || activeMedia.platform} · ${activeMedia.platform}`,
            platform: activeMedia.platform,
            url: track.url || activeMedia.url,
            type: mode,
            format: fmtLabel,
            size: formatBytes(finished.fileSize),
            thumbnail: track.thumbnail || activeMedia.thumbnail || '',
          });
        }

        setDownloadState({
          status: 'done',
          progress: 100,
          phase: `${selected.length} archivos descargados`,
        });
        SFX.complete();
        setIsland({ status: 'done', text: 'Playlist descargada · Guardada en historial' });
        showToast(`${selected.length} descargas completadas`);
        return;
      }

      // Single media download
      setDownloadState({
        status: 'downloading',
        progress: 4,
        phase: 'Iniciando motor de descarga...',
      });
      setIsland({ status: 'working', text: `Descargando · ${activeMedia.title.slice(0, 26)}` });

      const finished = await startDownloadStream(
        {
          url: activeMedia.url,
          searchQuery: activeMedia.searchQuery || '',
          mode,
          quality,
          title: activeMedia.title,
          engineSource: activeMedia.engineSource,
        },
        (evt) => {
          setDownloadState({
            status: 'downloading',
            progress: evt.progress || 0,
            phase: evt.phase || 'Descargando...',
          });
        }
      );

      triggerBrowserDownload(finished.fileUrl, finished.fileName);

      setDownloadState({
        status: 'done',
        progress: 100,
        phase: 'Listo · Descarga iniciada en tu dispositivo',
      });
      SFX.complete();
      setIsland({ status: 'done', text: 'Descarga completada · Guardada en historial' });
      showToast(`"${activeMedia.title}" descargado`);

      await pushHistory({
        title: activeMedia.title,
        author: `${activeMedia.author} · ${activeMedia.platform}`,
        platform: activeMedia.platform,
        url: activeMedia.url,
        type: mode,
        format: fmtLabel,
        size: formatBytes(finished.fileSize),
        thumbnail: activeMedia.thumbnail || '',
      });
    } catch (err) {
      SFX.error();
      setDownloadState({ status: 'idle', progress: 0, phase: '' });
      setErrorMsg(err.message || 'Error al descargar el archivo.');
      setIsland({ status: 'error', text: 'Error durante la descarga' });
    }
  };

  const handleToggleTrack = (idx) => {
    setActiveMedia((prev) => {
      if (!prev?.tracks) return prev;
      const tracks = prev.tracks.map((t, i) => (i === idx ? { ...t, checked: !t.checked } : t));
      return { ...prev, tracks };
    });
  };

  const handleToggleAllTracks = (checked) => {
    setActiveMedia((prev) => {
      if (!prev?.tracks) return prev;
      return { ...prev, tracks: prev.tracks.map((t) => ({ ...t, checked })) };
    });
  };

  const handleRemoveHistoryItem = async (id) => {
    if (user?.uid) {
      await deleteUserHistoryItem(user.uid, id).catch(() => {});
    } else {
      const next = history.filter((item) => item.id !== id);
      setHistory(next);
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
    }
  };

  const handleClearHistory = async () => {
    if (user?.uid) {
      await clearUserHistory(user.uid).catch(() => {});
    } else {
      setHistory([]);
      localStorage.setItem(LOCAL_HISTORY_KEY, '[]');
    }
    showToast('Historial limpiado');
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    try {
      await loginWithGoogle();
      SFX.complete();
      showToast('Sesión iniciada con Google');
    } catch (err) {
      SFX.error();
      showToast(err.message || 'No se pudo iniciar sesión');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogout = async () => {
    SFX.remove();
    await logoutGoogle();
    showToast('Sesión cerrada');
  };

  const platformKey = detectPlatformKey(url);

  return (
    <>
      {/* Ambient Monochrome + #FF3D6E Lighting */}
      <div className="ambient-canvas">
        <div className="orb orb-pink" />
        <div className="orb orb-mono-1" />
        <div className="orb orb-mono-2" />
      </div>
      <div className="noise-overlay" />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Floating Apple Glass Header */}
        <header className="sticky top-0 z-30 px-4 sm:px-8 pt-4 pb-2">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            {/* Brand */}
            <button
              type="button"
              onClick={() => {
                SFX.tap();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="glass-pill tactile flex items-center gap-2.5 px-3.5 py-2 rounded-full cursor-pointer"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="pulse-ring absolute inline-flex h-full w-full rounded-full bg-[#FF3D6E] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF3D6E]" />
              </span>
              <span className="font-semibold tracking-tight text-sm">
                every<span className="text-[#FF3D6E]">.mp3</span>
              </span>
            </button>

            {/* Dynamic Island */}
            <div className="glass-pill hidden sm:flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-medium">
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  island.status === 'working'
                    ? 'bg-[#FF3D6E] pulse-ring'
                    : island.status === 'error'
                    ? 'bg-amber-400'
                    : engineOnline
                    ? 'bg-emerald-400'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-soft">{island.text}</span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              {/* Audio SFX Toggle — ICON ONLY */}
              <button
                type="button"
                onClick={() => {
                  const next = !sfxEnabled;
                  setSfxEnabled(next);
                  SFX.setEnabled(next);
                  if (next) SFX.tap();
                  persistPrefs({ sfxEnabled: next });
                }}
                className="glass-pill tactile p-2 rounded-full cursor-pointer"
                title={sfxEnabled ? 'Silenciar efectos de sonido' : 'Activar efectos de sonido'}
                aria-label="Alternar efectos de sonido"
              >
                {sfxEnabled ? (
                  <Volume2 className="w-4 h-4 text-[#FF3D6E]" />
                ) : (
                  <VolumeX className="w-4 h-4 text-muted" />
                )}
              </button>

              {/* Theme Toggle */}
              <button
                type="button"
                onClick={() => {
                  SFX.tick();
                  const next = theme === 'dark' ? 'light' : 'dark';
                  setTheme(next);
                  persistPrefs({ theme: next });
                }}
                className="glass-pill tactile p-2 rounded-full cursor-pointer"
                title="Cambiar modo Claro / Oscuro"
                aria-label="Cambiar tema"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-soft" />
                ) : (
                  <Moon className="w-4 h-4 text-soft" />
                )}
              </button>

              {/* Profile Button */}
              <button
                type="button"
                onClick={() => {
                  SFX.tap();
                  setProfileOpen(true);
                }}
                className="glass-pill tactile flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
                title="Cuenta y preferencias"
              >
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Perfil'}
                    className="w-6 h-6 rounded-full object-cover border border-white/20"
                  />
                ) : (
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                      user
                        ? 'bg-gradient-to-br from-[#FF5580] to-[#B81D48] text-white'
                        : 'bg-gradient-to-br from-white/20 to-white/5 border border-white/15'
                    }`}
                  >
                    {user ? (
                      (user.displayName || user.email || 'U')[0].toUpperCase()
                    ) : (
                      <User className="w-3.5 h-3.5 text-soft" />
                    )}
                  </span>
                )}
                <span className="text-soft hidden sm:inline">
                  {user ? (user.displayName || 'Perfil').split(' ')[0] : 'Entrar'}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-24">
          {/* Hero */}
          <section className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-[11px] font-medium text-muted mb-4 tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF3D6E]" />
              {isMobile
                ? 'TikTok · SoundCloud · Instagram'
                : 'YouTube (PC local) · Spotify · SoundCloud · TikTok · Instagram'}
            </div>
            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.1] mb-3">
              Descarga cualquier medio,
              <br />
              <span className="text-muted font-normal">sin fricción.</span>
            </h1>
          </section>

          {/* Central URL Bar */}
          <section className="mb-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAnalyze();
              }}
              className="url-bar-wrap glass-surface rounded-[24px] p-2 flex items-center gap-2"
            >
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 glass-pill">
                <PlatformIcon platformKey={platformKey} />
              </div>

              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => {
                  document.body.classList.add('is-focused');
                  SFX.tick();
                }}
                onBlur={() => document.body.classList.remove('is-focused')}
                autoComplete="off"
                spellCheck="false"
                placeholder={
                  isMobile
                    ? 'Pega un enlace de TikTok, Instagram o SoundCloud...'
                    : 'Pega un enlace de YouTube, Spotify, TikTok, Instagram o SoundCloud...'
                }
                className="flex-1 bg-transparent outline-none text-sm sm:text-base placeholder:text-[rgba(145,145,155,0.65)] min-w-0 py-2.5"
              />

              {url && (
                <button
                  type="button"
                  onClick={() => {
                    SFX.remove();
                    setUrl('');
                    setActiveMedia(null);
                    setErrorMsg('');
                    setIsland({ status: 'idle', text: 'Listo · Pega un enlace para empezar' });
                  }}
                  className="tactile p-2 rounded-xl text-muted hover:text-[#FF3D6E] cursor-pointer"
                  title="Limpiar"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              <button
                type="submit"
                disabled={analyzing}
                className="btn-pink rounded-[16px] px-5 py-3 text-sm font-medium flex items-center gap-2 shrink-0 cursor-pointer"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">Analizando</span>
                  </>
                ) : (
                  <>
                    <span>Analizar</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {errorMsg && (
              <div className="mt-3 glass-surface rounded-2xl px-4 py-3 flex items-center gap-2.5 text-xs text-[#FF3D6E] animate-card-enter">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </section>

          {/* Active Card / Loading Skeleton */}
          <section className="mb-10">
            {analyzing ? (
              <div className="glass-surface rounded-[28px] p-5 sm:p-6 animate-card-enter">
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-2xl bg-white/10 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-3">
                    <div className="h-3 w-24 rounded-full bg-[#FF3D6E]/30 animate-pulse" />
                    <div className="h-5 w-3/4 rounded-full bg-white/15 animate-pulse" />
                    <div className="h-3.5 w-1/2 rounded-full bg-white/10 animate-pulse" />
                  </div>
                </div>
              </div>
            ) : (
              <ActiveMediaCard
                media={activeMedia}
                mode={mode}
                quality={quality}
                onModeChange={(nextMode) => {
                  setMode(nextMode);
                  setQuality(nextMode === 'audio' ? '320k' : '1080p');
                }}
                onQualityChange={setQuality}
                onToggleTrack={handleToggleTrack}
                onToggleAllTracks={handleToggleAllTracks}
                onDownload={handleDownload}
                downloadState={downloadState}
              />
            )}
          </section>

          {/* Stacked History Below */}
          <HistoryStack
            items={history}
            filter={filter}
            onFilterChange={setFilter}
            onClearAll={handleClearHistory}
            onRemoveItem={handleRemoveHistoryItem}
            onRedownload={(link) => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              handleAnalyze(link);
            }}
          />
        </main>
      </div>

      {/* Profile & Google Auth Modal */}
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onLogin={handleGoogleLogin}
        onLogout={handleGoogleLogout}
        defaultFormat={defaultFormat}
        onDefaultFormatChange={(val) => {
          setDefaultFormat(val);
          persistPrefs({ defaultFormat: val });
          showToast('Preferencia guardada');
        }}
        historyCount={history.length}
        authLoading={authLoading}
      />

      {/* Toast */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 ${
          toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="glass-surface rounded-full px-4 py-2.5 flex items-center gap-2.5 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-[#FF3D6E]" />
          <span>{toast.text}</span>
        </div>
      </div>
    </>
  );
}
