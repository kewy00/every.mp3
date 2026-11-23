const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function thumbnailProxyUrl(rawUrl) {
  if (!rawUrl) return '';
  return apiUrl(`/api/thumbnail?url=${encodeURIComponent(rawUrl)}`);
}

export async function checkEngineHealth() {
  try {
    const res = await fetch(apiUrl('/api/health'));
    return res.ok;
  } catch {
    return false;
  }
}

export async function inspectMediaUrl(url) {
  const res = await fetch(apiUrl('/api/inspect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo analizar este enlace.');
  }
  return data;
}

export function startDownloadStream(payload, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(apiUrl('/api/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        return reject(new Error(data.error || 'No se pudo iniciar la descarga.'));
      }

      const jobId = data.jobId;
      const es = new EventSource(apiUrl(`/api/progress/${jobId}`));

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onProgress?.(msg);
          if (msg.status === 'done') {
            es.close();
            resolve({
              jobId,
              fileUrl: apiUrl(`/api/file/${jobId}`),
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
        reject(new Error('Se perdió la conexión con el motor de descargas.'));
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
