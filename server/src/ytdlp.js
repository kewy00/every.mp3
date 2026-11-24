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
const ENV_COOKIES_PATH = path.join(TEMP_ROOT, 'env-cookies.txt');
const JOB_TTL_MS = 15 * 60 * 1000; // 15 min cleanup

export const jobs = new Map();

const engineStatus = {
  ytdlpVersion: null,
  impersonateAvailable: false,
};

let cachedEnvCookiesSource = null;

function redactSecrets(text) {
  return String(text || '').replace(/(https?|socks5h?|socks4a?):\/\/([^/\s:@]+):([^/\s@]+)@/gi, '$1://***:***@');
}

function resolveCookiesFile() {
  const b64 = (process.env.YTDLP_COOKIES_B64 || '').trim();
  const raw = (process.env.YTDLP_COOKIES || '').trim();

  if (b64 || raw) {
    const sourceKey = b64 ? `b64:${b64}` : `raw:${raw}`;
    if (cachedEnvCookiesSource !== sourceKey || !fsSync.existsSync(ENV_COOKIES_PATH)) {
      try {
        let content = b64 ? Buffer.from(b64, 'base64').toString('utf8') : raw;
        if (!b64 && !content.includes('\n') && content.includes('\\n')) {
          content = content.replace(/\\n/g, '\n');
        }
        fsSync.mkdirSync(TEMP_ROOT, { recursive: true });
        fsSync.writeFileSync(ENV_COOKIES_PATH, content, { mode: 0o600 });
        cachedEnvCookiesSource = sourceKey;
      } catch (err) {
        console.error('[yt-dlp] Error escribiendo cookies desde variable de entorno:', err.message);
        return '';
      }
    }
    return ENV_COOKIES_PATH;
  }

  const cookiesFile = (process.env.YTDLP_COOKIES_FILE || '').trim();
  if (cookiesFile && fsSync.existsSync(cookiesFile)) {
    return cookiesFile;
  }
  if (fsSync.existsSync(DEFAULT_COOKIES_PATH)) {
    return DEFAULT_COOKIES_PATH;
  }
  return '';
}

function hasCookiesConfigured() {
  return Boolean(resolveCookiesFile() || (process.env.YTDLP_COOKIES_BROWSER || '').trim());
}

function getYouTubeFallbackClient() {
  return hasCookiesConfigured() ? 'tv,web_safari,mweb,web' : 'android,mweb,tv_simply,web_embedded';
}

function getYouTubeFallbackOptions(stderr) {
  const lower = String(stderr || '').toLowerCase();
  const hitWebpageOr429 = lower.includes('429') || lower.includes('unable to download webpage');
  return {
    playerClientOverride: (process.env.YTDLP_PLAYER_CLIENT || '').trim() || getYouTubeFallbackClient(),
    skipWebpage: hitWebpageOr429,
    impersonateOverride: engineStatus.impersonateAvailable ? 'chrome' : '',
  };
}

function shouldRetryYouTube(stderr, platformKey) {
  if (platformKey !== 'youtube') {
    return false;
  }
  const lower = String(stderr || '').toLowerCase();
  const permanent = [
    'private video',
    'this video has been removed',
    'video unavailable',
    'copyright claim',
    'members-only content',
  ];
  if (permanent.some((p) => lower.includes(p))) {
    return false;
  }
  const retryable = [
    'failed to extract any player response',
    'unable to download webpage',
    'http error 429',
    'sign in to confirm',
    'http error 403',
    'requested format is not available',
    'precondition check failed',
    'unable to extract',
    'the page needs to be reloaded',
  ];
  return retryable.some((r) => lower.includes(r));
}

function getCommonYtDlpArgs(
  platformKey = 'generic',
  { playerClientOverride = '', skipWebpage = false, impersonateOverride = '' } = {}
) {
  const args = [
    '--js-runtimes',
    'node',
    '--remote-components',
    'ejs:github',
    '--socket-timeout',
    '30',
    '--retries',
    '3',
  ];

  if (process.env.YTDLP_FORCE_IPV4 !== 'false') {
    args.push('--force-ipv4');
  }

  const impersonate = (impersonateOverride || process.env.YTDLP_IMPERSONATE || '').trim();
  if (impersonate) {
    args.push('--impersonate', impersonate);
  }

  const proxy = (process.env.YTDLP_PROXY || '').trim();
  if (proxy) {
    args.push('--proxy', proxy);
  }

  const cookiesFile = resolveCookiesFile();
  const cookiesBrowser = (process.env.YTDLP_COOKIES_BROWSER || '').trim();

  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  } else if (cookiesBrowser) {
    args.push('--cookies-from-browser', cookiesBrowser);
  }

  if (platformKey === 'youtube') {
    const ytArgs = [];
    const playerClient = (playerClientOverride || process.env.YTDLP_PLAYER_CLIENT || '').trim();
    const poToken = (process.env.YTDLP_PO_TOKEN || '').trim();
    const visitorData = (process.env.YTDLP_VISITOR_DATA || '').trim();

    if (playerClient) ytArgs.push(`player_client=${playerClient}`);
    if (skipWebpage) ytArgs.push('player_skip=webpage,configs');
    if (poToken) ytArgs.push(`po_token=${poToken}`);
    if (visitorData) ytArgs.push(`visitor_data=${visitorData}`);

    if (ytArgs.length > 0) {
      args.push('--extractor-args', `youtube:${ytArgs.join(';')}`);
    }
  }

  const extraExtractorArgs = (process.env.YTDLP_EXTRACTOR_ARGS || '').trim();
  if (extraExtractorArgs) {
    args.push('--extractor-args', extraExtractorArgs);
  }

  return args;
}

function extractWarningHint(stderr) {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('WARNING:'));
  const interesting = lines.find((l) =>
    /HTTP Error|SSL|EOF|timed out|ProxyError|Unable to download|Sign in|bot|403|429|400|RemoteDisconnected/i.test(l)
  );
  if (!interesting) return '';
  return redactSecrets(interesting.replace(/^WARNING:\s*(\[[^\]]+\]\s*)?/, '')).slice(0, 180);
}

function formatYtDlpError(stderr, platformKey) {
  const safeStderr = redactSecrets(stderr);
  const cleanErr = safeStderr.split('\n').find((l) => l.includes('ERROR:')) || safeStderr.trim();
  const msg = cleanErr.replace(/^ERROR:\s*/, '');
  const lower = msg.toLowerCase();
  const fullLower = safeStderr.toLowerCase();

  if (
    platformKey === 'instagram' &&
    (lower.includes('cookies') || lower.includes('login required') || lower.includes('rate-limit'))
  ) {
    return 'Instagram está pidiendo inicio de sesión o limitando peticiones. Configura YTDLP_COOKIES_B64 en las variables de entorno del servidor (o server/cookies.txt en local) para desbloquear Instagram.';
  }

  if (platformKey === 'youtube') {
    if (fullLower.includes('http error 429') || fullLower.includes('too many requests')) {
      return 'YouTube está bloqueando/limitando la IP compartida de este servidor en la nube (HTTP 429: Too Many Requests). Para solucionarlo en Render/Railway, configura YTDLP_COOKIES_B64 (cookies exportadas de YouTube) o YTDLP_PROXY (proxy HTTP/SOCKS5) en las variables de entorno del servidor.';
    }
    if (lower.includes('sign in to confirm') || lower.includes('not a bot')) {
      return 'YouTube bloqueó la IP de este servidor en la nube (verificación anti-bot). Configura YTDLP_COOKIES_B64 (cookies exportadas de YouTube) o YTDLP_PROXY en las variables de entorno de tu servidor.';
    }
    if (lower.includes('failed to extract any player response')) {
      const hint = extractWarningHint(safeStderr);
      const detail = hint ? ` Detalle: ${hint}.` : '';
      return `YouTube no devolvió respuesta del reproductor.${detail} En servidores Docker (Render/Railway) suele deberse a un bloqueo de IP de YouTube o a un binario antiguo de yt-dlp: redespliega con el Dockerfile actualizado y, si persiste, añade YTDLP_COOKIES_B64 o YTDLP_PROXY en las variables de entorno.`;
    }
  }

  return msg || 'No se pudo procesar este enlace.';
}

function execYtDlpSimple(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function detectImpersonateSupport() {
  const imp = await execYtDlpSimple(['--list-impersonate-targets'], 15000);
  if (imp.code === 0 && imp.stdout) {
    const lines = imp.stdout.split(/\r?\n/);
    engineStatus.impersonateAvailable = lines.some((l) => /chrome/i.test(l) && !/unavailable/i.test(l));
    console.log(`[yt-dlp] impersonate chrome disponible: ${engineStatus.impersonateAvailable}`);
  }
}

export async function initYtDlp() {
  const ver = await execYtDlpSimple(['--version'], 15000);
  if (ver.code === 0 && ver.stdout) {
    engineStatus.ytdlpVersion = ver.stdout;
    console.log(`[yt-dlp] versión detectada: ${ver.stdout}`);
  } else {
    console.warn(`[yt-dlp] no se pudo detectar la versión: ${ver.stderr || 'error desconocido'}`);
  }

  await detectImpersonateSupport();

  if (process.env.YTDLP_AUTO_UPDATE !== 'false') {
    const upd = await execYtDlpSimple(['-U'], 45000);
    if (upd.code === 0) {
      const refreshed = await execYtDlpSimple(['--version'], 15000);
      if (refreshed.code === 0 && refreshed.stdout) {
        engineStatus.ytdlpVersion = refreshed.stdout;
      }
      await detectImpersonateSupport();
      console.log(`[yt-dlp] comprobación de actualización completada (${engineStatus.ytdlpVersion || 'desconocida'})`);
    } else if (upd.stderr || upd.stdout) {
      console.warn(`[yt-dlp] auto-actualización omitida: ${redactSecrets(upd.stderr || upd.stdout).split('\n')[0]}`);
    }
  }
}

export function getEngineDiagnostics() {
  return {
    ytdlpVersion: engineStatus.ytdlpVersion,
    impersonateAvailable: engineStatus.impersonateAvailable,
    cookiesConfigured: hasCookiesConfigured(),
    proxyConfigured: Boolean((process.env.YTDLP_PROXY || '').trim()),
    playerClient: (process.env.YTDLP_PLAYER_CLIENT || '').trim() || 'default',
  };
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

function runYtDlpJsonOnce(url, platformKey, ytOpts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--playlist-end',
      '50',
      '--skip-download',
      ...getCommonYtDlpArgs(platformKey, ytOpts),
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
      reject({ stderr: err.message, spawnError: true });
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject({ stderr, code });
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject({ stderr: 'Respuesta inesperada de yt-dlp al analizar el enlace.', parseError: true });
      }
    });
  });
}

async function runYtDlpJson(url, platformKey) {
  try {
    return await runYtDlpJsonOnce(url, platformKey);
  } catch (firstErr) {
    if (firstErr?.spawnError) {
      throw new Error(`No se pudo ejecutar yt-dlp: ${firstErr.stderr}`);
    }
    if (!firstErr?.parseError && shouldRetryYouTube(firstErr?.stderr, platformKey)) {
      const fallbackOpts = getYouTubeFallbackOptions(firstErr?.stderr);
      console.warn(
        `[yt-dlp] inspect falló, reintentando con client=${fallbackOpts.playerClientOverride}, skipWebpage=${fallbackOpts.skipWebpage}, impersonate=${fallbackOpts.impersonateOverride || 'none'}...`
      );
      try {
        return await runYtDlpJsonOnce(url, platformKey, fallbackOpts);
      } catch (secondErr) {
        console.error(`[yt-dlp] inspect error (${platformKey}):\n${redactSecrets(secondErr?.stderr || firstErr?.stderr)}`);
        throw new Error(formatYtDlpError(secondErr?.stderr || firstErr?.stderr, platformKey));
      }
    }
    console.error(`[yt-dlp] inspect error (${platformKey}):\n${redactSecrets(firstErr?.stderr)}`);
    throw new Error(formatYtDlpError(firstErr?.stderr || '', platformKey));
  }
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

  const buildArgs = (ytOpts = {}) => {
    const args = [
      '--newline',
      '--no-playlist',
      ...getCommonYtDlpArgs(platformKey, ytOpts),
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
    return args;
  };

  job.status = 'downloading';
  job.phase = searchQuery ? 'Buscando audio en alta calidad...' : 'Extrayendo flujo de alta calidad...';
  emitUpdate();

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

  const startAttempt = (ytOpts = {}, isRetry = false) => {
    const proc = spawn('yt-dlp', buildArgs(ytOpts), { windowsHide: true });
    let stderrBuf = '';

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
        if (!isRetry && shouldRetryYouTube(stderrBuf, platformKey)) {
          const fallbackOpts = getYouTubeFallbackOptions(stderrBuf);
          console.warn(
            `[yt-dlp] download falló, reintentando con client=${fallbackOpts.playerClientOverride}, skipWebpage=${fallbackOpts.skipWebpage}, impersonate=${fallbackOpts.impersonateOverride || 'none'}...`
          );
          try {
            const leftover = await fs.readdir(jobDir);
            await Promise.all(leftover.map((f) => fs.rm(path.join(jobDir, f), { force: true })));
          } catch {
            // ignore cleanup error
          }
          job.progress = 0;
          job.speed = '';
          job.phase = 'Reintentando con cliente alternativo de YouTube...';
          emitUpdate();
          startAttempt(fallbackOpts, true);
          return;
        }

        console.error(`[yt-dlp] download error (${platformKey}):\n${redactSecrets(stderrBuf)}`);
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
  };

  startAttempt();

  return job;
}
