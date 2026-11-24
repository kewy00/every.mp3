import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { inspectUrl, createDownloadJob, jobs, initYtDlp, getEngineDiagnostics } from './ytdlp.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

// Allow HTTPS web apps (e.g. Netlify) to connect to a local PC engine (127.0.0.1 / localhost)
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : true,
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'every.mp3-engine',
    timestamp: Date.now(),
    ...getEngineDiagnostics(),
  });
});

// Inspect any URL (YouTube, Spotify, SoundCloud, TikTok, Instagram, etc.)
app.post('/api/inspect', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Debes enviar una URL válida.' });
  }
  try {
    const data = await inspectUrl(url);
    res.json(data);
  } catch (err) {
    res.status(422).json({ error: err.message || 'No se pudo analizar el enlace.' });
  }
});

// Start a download job
app.post('/api/download', async (req, res) => {
  const { url, searchQuery, mode, quality, title } = req.body || {};
  if (!url && !searchQuery) {
    return res.status(400).json({ error: 'Falta la URL o búsqueda para descargar.' });
  }
  try {
    const job = await createDownloadJob({ url, searchQuery, mode, quality, title });
    res.json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo iniciar la descarga.' });
  }
});

// Real-time SSE progress stream
app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Descarga no encontrada o expirada.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Send immediate snapshot
  send({
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    speed: job.speed,
    fileName: job.fileName,
    fileSize: job.fileSize,
    error: job.error,
  });

  if (job.status === 'done' || job.status === 'error') {
    return res.end();
  }

  const onUpdate = (payload) => {
    send(payload);
    if (payload.status === 'done' || payload.status === 'error') {
      job.emitter.off('update', onUpdate);
      res.end();
    }
  };

  job.emitter.on('update', onUpdate);
  req.on('close', () => {
    job.emitter.off('update', onUpdate);
  });
});

// Stream completed file to the user's browser (PC or Mobile)
app.get('/api/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'Archivo no disponible o expirado.' });
  }

  res.download(job.filePath, job.fileName || 'every-mp3-file');
});

// Lightweight thumbnail proxy (avoids Instagram/TikTok hotlink blocks)
app.get('/api/thumbnail', async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
    return res.status(400).end();
  }
  try {
    const imgRes = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!imgRes.ok) return res.status(404).end();
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).end();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`every.mp3 engine running on http://localhost:${PORT}`);
  initYtDlp().catch((err) => {
    console.warn('[yt-dlp] error en inicialización:', err?.message || err);
  });
});
