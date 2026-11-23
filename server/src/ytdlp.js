import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolveSpotify } from './spotify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COOKIES_PATH = path.resolve(__dirname, '..', 'cookies.txt');
const TEMP_ROOT = path.join(os.tmpdir(), 'every-mp3-jobs');
const JOB_TTL_MS = 15 * 60 * 1000; // 15 min cleanup

export const jobs = new Map();

function getCommonYtDlpArgs() {
  const args = ['--no-warnings', '--js-runtimes', 'node'];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE || (fsSync.existsSync(DEFAULT_COOKIES_PATH) ? DEFAULT_COOKIES_PATH : '');
  const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER || '';

  if (cookiesFile && fsSync.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
  } else if (cookiesBrowser) {
    args.push('--cookies-from-browser', cookiesBrowser);
  }
  return args;
}

function formatYtDlpError(stderr, platformKey) {
  const cleanErr = stderr.split('\n').find((l) => l.includes('ERROR:')) || stderr.trim();
  const msg = cleanErr.replace(/^ERROR:\s*/, '');
  if (
    platformKey === 'instagram' &&
    (msg.toLowerCase().includes('cookies') ||
      msg.toLowerCase().includes('login required') ||
      msg.toLowerCase().includes('rate-limit'))
  ) {
    return 'Instagram está pidiendo inicio de sesión o limitando peticiones. Añade tu archivo cookies.txt en server/cookies.txt (o YTDLP_COOKIES_BROWSER=chrome en server/.env) para desbloquear Instagram.';
  }
  return msg || 'No se pudo procesar este enlace.';
}

export function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return { key: 'youtube', label: 'YouTube' };
  if (u.includes('spotify.com')) return { key: 'spotify', label: 'Spotify' };
  if (u.includes('soundcloud.com')) return { key: 'soundcloud', label: 'SoundCloud' };
  if (u.includes('tiktok.com')) return { key: 'tiktok', label: 'TikTok' };
  if (u.includes('instagram.com')) return { key: 'instagram', label: 'Instagram' };
  return { key: 'generic', label: 'Web Media' };
}

function formatDuration(sec) {
  if (!sec || Number.isNaN(Number(sec))) return '00:00';
  const s = Math.round(Number(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function sanitizeFilename(name) {
  return (name || 'every-mp3-download')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function runYtDlpJson(url, platformKey) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--playlist-end',
      '50',
      '--skip-download',
      ...getCommonYtDlpArgs(),
    ];

    // SoundCloud flat-playlist omits titles, durations, and thumbnails;
    // fetch full entries for SoundCloud playlists so metadata is accurate.
    if (platformKey !== 'soundcloud') {
      args.push('--flat-playlist');
    }

    args.push(url);

    const proc = spawn('yt-dlp', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`No se pudo ejecutar yt-dlp: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(formatYtDlpError(stderr, platformKey)));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Respuesta inesperada de yt-dlp al analizar el enlace.'));
      }
    });
  });
}

export async function inspectUrl(rawUrl) {
  const url = rawUrl.trim();
  const platform = detectPlatform(url);

  if (platform.key === 'spotify') {
    return await resolveSpotify(url);
  }

  const info = await runYtDlpJson(url, platform.key);
  const isPlaylist = info._type === 'playlist' && Array.isArray(info.entries) && info.entries.length > 1;
  const audioOnly = platform.key === 'soundcloud';

  if (isPlaylist) {
    const tracks = info.entries
      .filter(Boolean)
      .slice(0, 50)
      .map((entry, idx) => ({
        id: entry.id || `pl-${idx}`,
        title: entry.title || entry.track || `Pista ${idx + 1}`,
        artist: entry.uploader || entry.artist || entry.channel || info.uploader || platform.label,
        duration: formatDuration(entry.duration),
        thumbnail: entry.thumbnail || entry.thumbnails?.[entry.thumbnails.length - 1]?.url || '',
        url: entry.webpage_url || (entry.url?.startsWith('http') ? entry.url : url),
        checked: true,
      }));

    const playlistThumb =
      info.thumbnail ||
      info.thumbnails?.[info.thumbnails.length - 1]?.url ||
      tracks.find((t) => t.thumbnail)?.thumbnail ||
      '';

    return {
      url,
      platform: `${platform.label} Playlist`,
      platformKey: platform.key,
      title: info.title || `Playlist de ${platform.label}`,
      author: `${tracks.length} elementos${info.uploader ? ` · ${info.uploader}` : ''}`,
      duration: `${tracks.length} pistas`,
      thumbnail: playlistThumb,
      defaultMode: audioOnly ? 'audio' : 'video',
      audioOnly,
      isPlaylist: true,
      tracks,
    };
  }

  // Single item (or 1-entry playlist wrapper)
  const item = info._type === 'playlist' && info.entries?.[0] ? info.entries[0] : info;
  const isReel = platform.key === 'instagram' && url.includes('/reel/');

  return {
    url: item.webpage_url || url,
    platform: isReel ? 'Instagram Reel' : platform.label,
    platformKey: platform.key,
    title: item.title || 'Contenido multimedia',
    author: item.uploader || item.channel || item.creator || platform.label,
    duration: formatDuration(item.duration),
    thumbnail: item.thumbnail || item.thumbnails?.[item.thumbnails.length - 1]?.url || '',
    defaultMode: audioOnly ? 'audio' : 'video',
    audioOnly,
    isPlaylist: false,
  };
}

export async function createDownloadJob({ url, searchQuery, mode = 'audio', quality = '320k', title = '' }) {
  await fs.mkdir(TEMP_ROOT, { recursive: true });
  const jobId = crypto.randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const emitter = new EventEmitter();
  const job = {
    id: jobId,
    dir: jobDir,
    status: 'starting',
    progress: 0,
    phase: 'Conectando...',
    speed: '',
    filePath: null,
    fileName: null,
    fileSize: null,
    error: null,
    emitter,
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  const emitUpdate = () => {
    emitter.emit('update', {
      id: job.id,
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      speed: job.speed,
      fileName: job.fileName,
      fileSize: job.fileSize,
      error: job.error,
    });
  };

  // Schedule auto-cleanup
  setTimeout(async () => {
    jobs.delete(jobId);
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, JOB_TTL_MS);

  const target = searchQuery ? `ytsearch1:${searchQuery}` : url;
  const platformKey = searchQuery ? 'youtube' : detectPlatform(url || '').key;
  const safeBase = title ? sanitizeFilename(title) : '%(title).100s';
  const outputTemplate = path.join(jobDir, `${safeBase}.%(ext)s`);

  const args = [
    '--newline',
    '--no-playlist',
    ...getCommonYtDlpArgs(),
    '-o',
    outputTemplate,
  ];

  if (mode === 'audio') {
    args.push('-x', '--add-metadata');
    if (quality === 'FLAC') {
      args.push('--audio-format', 'flac', '--embed-thumbnail');
    } else if (quality === 'WAV') {
      args.push('--audio-format', 'wav');
    } else {
      args.push('--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail');
    }
  } else {
    let formatStr = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best';
    if (quality === '4K') {
      formatStr = 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best';
    } else if (quality === '720p') {
      formatStr = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best';
    }
    args.push('-f', formatStr, '--merge-output-format', 'mp4', '--add-metadata');
  }

  args.push(target);

  job.status = 'downloading';
  job.phase = searchQuery ? 'Buscando audio en alta calidad...' : 'Extrayendo flujo de alta calidad...';
  emitUpdate();

  const proc = spawn('yt-dlp', args, { windowsHide: true });
  let stderrBuf = '';

  const parseLine = (line) => {
    const pctMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (pctMatch) {
      const pct = Math.min(95, Math.round(parseFloat(pctMatch[1]) * 0.92));
      const speedMatch = line.match(/at\s+([^\s]+\/s)/);
      job.progress = Math.max(job.progress, pct);
      job.speed = speedMatch ? speedMatch[1] : job.speed;
      job.phase = job.speed ? `Descargando (${job.speed})...` : 'Descargando...';
      emitUpdate();
      return;
    }

    if (line.includes('[ExtractAudio]') || line.includes('[Merger]') || line.includes('[EmbedThumbnail]') || line.includes('[Metadata]')) {
      job.progress = Math.max(job.progress, 96);
      job.phase = 'Procesando formato, carátula y metadatos...';
      emitUpdate();
    }
  };

  proc.stdout.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach(parseLine);
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    text.split(/\r?\n/).filter(Boolean).forEach(parseLine);
  });

  proc.on('error', (err) => {
    job.status = 'error';
    job.error = `Error al iniciar yt-dlp: ${err.message}`;
    emitUpdate();
  });

  proc.on('close', async (code) => {
    if (code !== 0) {
      job.status = 'error';
      job.error = formatYtDlpError(stderrBuf, platformKey);
      emitUpdate();
      return;
    }

    try {
      const files = await fs.readdir(jobDir);
      const validFiles = files.filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.webp') && !f.endsWith('.jpg'));
      const chosen = validFiles[0] || files[0];
      if (!chosen) {
        throw new Error('No se encontró el archivo resultante.');
      }
      const fullPath = path.join(jobDir, chosen);
      const stat = await fs.stat(fullPath);

      job.filePath = fullPath;
      job.fileName = chosen;
      job.fileSize = stat.size;
      job.progress = 100;
      job.status = 'done';
      job.phase = 'Listo · Descargando en tu dispositivo';
      emitUpdate();
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      emitUpdate();
    }
  });

  return job;
}
