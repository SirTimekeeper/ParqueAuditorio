const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { readConfig, writeConfig, defaultConfig } = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const webDir = path.join(rootDir, 'web');
const staticDir = process.env.NODE_ENV === 'production' && fs.existsSync(distDir) ? distDir : webDir;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(staticDir));

const devices = new Map();
const rtspSessions = new Map();
const RTSP_SESSION_TTL_MS = 60_000;

const createRtspSessionId = () => Math.random().toString(36).slice(2, 10);

const stopRtspSession = (sessionId) => {
  const session = rtspSessions.get(sessionId);
  if (!session) return;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  if (session.process && !session.process.killed) {
    session.process.kill('SIGTERM');
  }
  rtspSessions.delete(sessionId);
};

const scheduleRtspCleanup = (sessionId) => {
  const session = rtspSessions.get(sessionId);
  if (!session) return;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    stopRtspSession(sessionId);
  }, RTSP_SESSION_TTL_MS);
};

const startRtspSession = (url) => {
  const sessionId = createRtspSessionId();
  const ffmpegArgs = [
    '-rtsp_transport',
    'tcp',
    '-i',
    url,
    '-an',
    '-vf',
    'fps=8',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1'
  ];
  const ffmpegExecutable = ffmpegPath || 'ffmpeg';
  const ffmpeg = spawn(ffmpegExecutable, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const session = {
    id: sessionId,
    url,
    process: ffmpeg,
    latestFrame: null,
    latestFrameAt: 0,
    lastError: null,
    buffer: Buffer.alloc(0),
    cleanupTimer: null
  };
  rtspSessions.set(sessionId, session);
  scheduleRtspCleanup(sessionId);

  ffmpeg.stdout.on('data', (chunk) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    current.buffer = Buffer.concat([current.buffer, chunk]);
    let start = current.buffer.indexOf(Buffer.from([0xff, 0xd8]));
    let end = current.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

    while (start !== -1 && end !== -1) {
      const frame = current.buffer.subarray(start, end + 2);
      current.latestFrame = frame;
      current.latestFrameAt = Date.now();
      current.buffer = current.buffer.subarray(end + 2);
      start = current.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      end = current.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    }
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    current.lastError = chunk.toString();
  });

  ffmpeg.on('close', (code) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    if (code !== 0 && !current.lastError) {
      current.lastError = `ffmpeg terminou com código ${code}`;
    }
  });

  ffmpeg.on('error', (error) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    current.lastError = error.message;
  });

  return sessionId;
};

const upsertDevice = (id, payload = {}) => {
  if (!id) return null;
  const now = Date.now();
  const current = devices.get(id) ?? { id };
  const updated = {
    ...current,
    ...payload,
    id,
    lastSeen: now
  };
  devices.set(id, updated);
  return updated;
};

const listDevices = () => Array.from(devices.values()).map((device) => ({
  id: device.id,
  label: device.label ?? 'Dispositivo',
  lastSeen: device.lastSeen,
  hasSnapshot: Boolean(device.snapshot)
}));

app.get('/api/config', (req, res) => {
  const config = readConfig();
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const payload = req.body || {};
  const config = {
    ...defaultConfig,
    ...payload,
    lines: {
      ...defaultConfig.lines,
      ...payload.lines
    },
    deviceSettings: {
      ...defaultConfig.deviceSettings,
      ...payload.deviceSettings
    },
    counts: {
      ...defaultConfig.counts,
      ...payload.counts
    }
  };
  writeConfig(config);
  res.json({ ok: true });
});

app.get('/api/devices', (req, res) => {
  res.json({ devices: listDevices() });
});

app.post('/api/devices/register', (req, res) => {
  const { id, label } = req.body || {};
  const device = upsertDevice(id, { label });
  if (!device) {
    res.status(400).json({ ok: false, error: 'device_id_missing' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/devices/heartbeat', (req, res) => {
  const { id } = req.body || {};
  const device = upsertDevice(id);
  if (!device) {
    res.status(400).json({ ok: false, error: 'device_id_missing' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/devices/:id/snapshot', (req, res) => {
  const { id } = req.params;
  const { image, width, height } = req.body || {};
  if (!image) {
    res.status(400).json({ ok: false, error: 'snapshot_missing' });
    return;
  }
  upsertDevice(id, { snapshot: image, width, height });
  res.json({ ok: true });
});

app.get('/api/devices/:id/snapshot', (req, res) => {
  const device = devices.get(req.params.id);
  if (!device || !device.snapshot) {
    res.status(404).json({ ok: false });
    return;
  }
  res.json({
    image: device.snapshot,
    width: device.width ?? null,
    height: device.height ?? null,
    lastSeen: device.lastSeen
  });
});

app.post('/api/rtsp/session', (req, res) => {
  const url = req.body?.url?.trim();
  if (!url || !url.startsWith('rtsp://')) {
    res.status(400).json({ ok: false, error: 'invalid_rtsp_url' });
    return;
  }
  const sessionId = startRtspSession(url);
  res.json({ ok: true, sessionId });
});

app.get('/api/rtsp/:id/frame.jpg', (req, res) => {
  const session = rtspSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ ok: false, error: 'session_not_found' });
    return;
  }
  scheduleRtspCleanup(req.params.id);
  if (!session.latestFrame) {
    res.status(503).json({ ok: false, error: session.lastError ?? 'frame_not_ready' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(session.latestFrame);
});

app.delete('/api/rtsp/:id', (req, res) => {
  stopRtspSession(req.params.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const getHttpsOptions = () => {
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;
  if (!keyPath || !certPath) return null;
  try {
    return {
      key: fs.readFileSync(path.resolve(keyPath)),
      cert: fs.readFileSync(path.resolve(certPath))
    };
  } catch (error) {
    console.error('Falha ao ler certificados HTTPS:', error.message);
    return null;
  }
};

const httpsOptions = getHttpsOptions();
const protocol = httpsOptions ? 'https' : 'http';
const server = httpsOptions ? https.createServer(httpsOptions, app) : http.createServer(app);

server.listen(port, () => {
  console.log(`Servidor a correr em ${protocol}://localhost:${port}`);
  if (!httpsOptions) {
    console.log('Para ativar HTTPS, defina HTTPS_KEY_PATH e HTTPS_CERT_PATH.');
  }
});
