const CLOUD_API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const LOCAL_API_BASE = (import.meta.env.VITE_LOCAL_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile === true) return true;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent || ''
  );
}

export function isYouTubeUrl(rawUrl = '') {
  const u = String(rawUrl || '').toLowerCase();
  return u.includes('youtube.com') || u.includes('youtu.be');
}

export function isSpotifyUrl(rawUrl = '') {
  return String(rawUrl || '').toLowerCase().includes('spotify.com');
}

export function requiresLocalEngine(rawUrl = '', searchQuery = '') {
  return Boolean(searchQuery) || isYouTubeUrl(rawUrl);
}

function getLocalBase() {
  // When running frontend locally via Vite dev proxy (no VITE_API_URL), relative /api hits localhost:3001
  return CLOUD_API_BASE ? LOCAL_API_BASE : '';
}

function getCloudBase() {
  return CLOUD_API_BASE;
}

export function apiUrl(path, source = 'cloud') {
  const base = source === 'local' ? getLocalBase() : getCloudBase();
  return `${base}${path}`;
}

export function thumbnailProxyUrl(rawUrl, source = 'cloud') {
  if (!rawUrl) return '';
  return apiUrl(`/api/thumbnail?url=${encodeURIComponent(rawUrl)}`, source);
}

async function pingBase(base, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLocalEngineHealth() {
  if (isMobileDevice()) return false;
  return pingBase(getLocalBase(), 2000);
}

export async function checkEnginesStatus() {
  const mobile = isMobileDevice();
  if (!CLOUD_API_BASE) {
    const online = await pingBase('', 3500);
    return { cloudOnline: online, localOnline: !mobile && online, isMobile: mobile };
  }

  const [cloudOnline, localOnline] = await Promise.all([
    pingBase(CLOUD_API_BASE, 5000),
    mobile ? Promise.resolve(false) : pingBase(LOCAL_API_BASE, 2000),
  ]);

  return { cloudOnline, localOnline, isMobile: mobile };
}

export async function checkEngineHealth() {
  const status = await checkEnginesStatus();
  return status.cloudOnline || status.localOnline;
}

function assertLocalEngineAvailable(isSpotify = false) {
  const label = isSpotify ? 'Spotify (descarga vía YouTube)' : 'YouTube';
  if (isMobileDevice()) {
    throw new Error(
      `${label} solo está disponible desde PC en modo local. En móvil puedes descargar sin problemas desde TikTok, SoundCloud e Instagram.`
    );
  }
}

async function ensureLocalOnline(isSpotify = false) {
  assertLocalEngineAvailable(isSpotify);
  const ok = await checkLocalEngineHealth();
  if (!ok) {
    const label = isSpotify ? 'descargar de Spotify' : 'descargar de YouTube';
    throw new Error(
      `Para ${label} en PC necesitas tener el motor local encendido en ${LOCAL_API_BASE} (ejecuta "npm run dev:server" en tu PC). TikTok, SoundCloud e Instagram siguen funcionando a través del servidor.`
    );
  }
}

export async function inspectMediaUrl(url) {
  const isYT = isYouTubeUrl(url);
  const isSP = isSpotifyUrl(url);

  let source = 'cloud';
  if (isYT) {
    await ensureLocalOnline(false);
    source = 'local';
  } else if (isSP) {
    // Spotify audio download uses YouTube under the hood, so require local engine on PC
    await ensureLocalOnline(true);
    source = 'local';
  }

  let res;
  try {
    res = await fetch(apiUrl('/api/inspect', source), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    if (source === 'local') {
      throw new Error(
        `No se pudo conectar con el motor local (${LOCAL_API_BASE}). Ejecuta "npm run dev:server" en tu PC.`
      );
    }
    throw new Error('No se pudo conectar con el servidor de descargas.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo analizar este enlace.');
  }
  return { ...data, engineSource: source };
}

export function startDownloadStream(payload, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const needsLocal =
        payload.engineSource === 'local' || requiresLocalEngine(payload.url, payload.searchQuery);
      const source = needsLocal ? 'local' : 'cloud';

      if (source === 'local') {
        await ensureLocalOnline(Boolean(payload.searchQuery));
      }

      const { engineSource: _ignored, ...bodyPayload } = payload;

      const res = await fetch(apiUrl('/api/download', source), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        return reject(new Error(data.error || 'No se pudo iniciar la descarga.'));
      }

      const jobId = data.jobId;
      const es = new EventSource(apiUrl(`/api/progress/${jobId}`, source));

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onProgress?.(msg);
          if (msg.status === 'done') {
            es.close();
            resolve({
              jobId,
              fileUrl: apiUrl(`/api/file/${jobId}`, source),
              fileName: msg.fileName,
              fileSize: msg.fileSize,
            });
          } else if (msg.status === 'error') {
            es.close();
            reject(new Error(msg.error || 'Error en la descarga.'));
          }
        } catch {
          // ignore malformed chunk
        }
      };

      es.onerror = () => {
        es.close();
        reject(
          new Error(
            source === 'local'
              ? 'Se perdió la conexión con el motor local de tu PC.'
              : 'Se perdió la conexión con el servidor de descargas.'
          )
        );
      };
    } catch (err) {
      reject(err);
    }
  });
}

export function triggerBrowserDownload(fileUrl, fileName) {
  const a = document.createElement('a');
  a.href = fileUrl;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function formatBytes(bytes) {
  if (!bytes || Number.isNaN(Number(bytes))) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
