const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const bundledFfmpegPath = require('ffmpeg-static');
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
const MJPEG_BOUNDARY = 'frame';
const RTSP_FRAME_STALE_MS = 12_000;
const RTSP_MONITOR_INTERVAL_MS = 3_000;
const RTSP_RESTART_DELAY_MS = 1_500;
const MJPEG_CLIENT_BUFFER_LIMIT_BYTES = 256 * 1024;
const isWindows = process.platform === 'win32';
const configuredFfmpegPath = process.env.FFMPEG_PATH?.trim();
const ffmpegExecutable = configuredFfmpegPath || (isWindows ? 'ffmpeg' : (bundledFfmpegPath || 'ffmpeg'));
let ffmpegHelpTextCache = null;
const disabledTimeoutOptions = new Set();

const getFfmpegHelpText = () => {
  if (ffmpegHelpTextCache !== null) return ffmpegHelpTextCache;
  try {
    const result = spawnSync(ffmpegExecutable, ['-hide_banner', '-h', 'full'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8_000
    });
    ffmpegHelpTextCache = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
  } catch (error) {
    ffmpegHelpTextCache = '';
  }
  return ffmpegHelpTextCache;
};

const ffmpegSupportsOption = (optionName) => {
  const helpText = getFfmpegHelpText();
  if (!helpText) return false;
  return helpText.includes(optionName.toLowerCase());
};

const createRtspTimeoutArgs = () => {
  if (!disabledTimeoutOptions.has('-rw_timeout') && ffmpegSupportsOption('-rw_timeout')) {
    return ['-rw_timeout', '15000000'];
  }
  if (!disabledTimeoutOptions.has('-stimeout') && ffmpegSupportsOption('-stimeout')) {
    return ['-stimeout', '15000000'];
  }
  return [];
};

const createFpsSyncArgs = () => {
  if (ffmpegSupportsOption('-fps_mode')) {
    return ['-fps_mode', 'passthrough'];
  }
  return ['-vsync', '0'];
};

const createRtspSessionId = () => Math.random().toString(36).slice(2, 10);

const createRtspFfmpegArgs = (url) => [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-fflags',
  'nobuffer',
  '-flags',
  'low_delay',
  '-analyzeduration',
  '0',
  '-probesize',
  '32',
  '-rtsp_transport',
  'tcp',
  ...createRtspTimeoutArgs(),
  '-fflags',
  '+discardcorrupt',
  '-i',
  url,
  '-an',
  ...createFpsSyncArgs(),
  '-fflags',
  'nobuffer',
  '-flush_packets',
  '1',
  '-vf',
  'fps=20',
  '-q:v',
  '6',
  '-f',
  'image2pipe',
  '-vcodec',
  'mjpeg',
  'pipe:1'
];

const launchRtspFfmpeg = (sessionId) => {
  const session = rtspSessions.get(sessionId);
  if (!session || session.stopping) return;

  const ffmpeg = spawn(ffmpegExecutable, createRtspFfmpegArgs(session.url), { stdio: ['ignore', 'pipe', 'pipe'] });
  session.process = ffmpeg;
  session.restartTimer = null;
  session.lastStartAt = Date.now();
  session.lastError = null;
  session.buffer = Buffer.alloc(0);
  session.latestFrame = null;
  session.latestFrameAt = 0;

  ffmpeg.stdout.on('data', (chunk) => {
    const current = rtspSessions.get(sessionId);
    if (!current || current.stopping) return;
    current.buffer = Buffer.concat([current.buffer, chunk]);
    let start = current.buffer.indexOf(Buffer.from([0xff, 0xd8]));
    let end = current.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

    while (start !== -1 && end !== -1) {
      const frame = current.buffer.subarray(start, end + 2);
      current.latestFrame = frame;
      current.latestFrameAt = Date.now();
      streamFrameToClients(current.streamClients, frame);
      current.buffer = current.buffer.subarray(end + 2);
      start = current.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      end = current.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    }
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    const message = chunk.toString().trim();
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes('option rw_timeout not found')) {
      disabledTimeoutOptions.add('-rw_timeout');
    } else if (normalizedMessage.includes('option stimeout not found')) {
      disabledTimeoutOptions.add('-stimeout');
    }
    if (message) current.lastError = message;
  });

  ffmpeg.on('close', (code) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    if (code !== 0 && !current.lastError) {
      current.lastError = `ffmpeg terminou com código ${code}`;
    }
    if (current.stopping) return;
    current.restartTimer = setTimeout(() => launchRtspFfmpeg(sessionId), RTSP_RESTART_DELAY_MS);
  });

  ffmpeg.on('error', (error) => {
    const current = rtspSessions.get(sessionId);
    if (!current) return;
    current.lastError = error.message;
  });
};

const stopRtspSession = (sessionId) => {
  const session = rtspSessions.get(sessionId);
  if (!session) return;
  session.stopping = true;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  if (session.monitorTimer) clearInterval(session.monitorTimer);
  if (session.restartTimer) clearTimeout(session.restartTimer);
  if (session.streamClients?.size) {
    session.streamClients.forEach((client) => {
      if (!client.writableEnded) client.end();
    });
  }
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
  const session = {
    id: sessionId,
    url,
    process: null,
    latestFrame: null,
    latestFrameAt: 0,
    lastError: null,
    buffer: Buffer.alloc(0),
    streamClients: new Set(),
    cleanupTimer: null,
    monitorTimer: null,
    restartTimer: null,
    lastStartAt: 0,
    stopping: false
  };
  rtspSessions.set(sessionId, session);
  scheduleRtspCleanup(sessionId);
  launchRtspFfmpeg(sessionId);
  session.monitorTimer = setInterval(() => {
    const current = rtspSessions.get(sessionId);
    if (!current || current.stopping || current.restartTimer) return;
    const now = Date.now();
    if (!current.latestFrameAt && now - current.lastStartAt < RTSP_FRAME_STALE_MS) return;
    if (current.latestFrameAt && now - current.latestFrameAt < RTSP_FRAME_STALE_MS) return;
    current.lastError = current.lastError || 'stream_stalled';
    if (current.process && !current.process.killed) {
      current.process.kill('SIGTERM');
    } else {
      current.restartTimer = setTimeout(() => launchRtspFfmpeg(sessionId), RTSP_RESTART_DELAY_MS);
    }
  }, RTSP_MONITOR_INTERVAL_MS);

  return sessionId;
};

const upsertDevice = (id, payload = {}) => {
  if (!id) return null;
  const now = Date.now();
  const current = devices.get(id) ?? { id, streamClients: new Set() };
  const updated = {
    ...current,
    ...payload,
    id,
    lastSeen: now
  };
  devices.set(id, updated);
  return updated;
};

const writeMjpegFrame = (client, frame) => {
  const payloadHeader = `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
  client.write(payloadHeader);
  client.write(frame);
  client.write('\r\n');
};

const streamFrameToClients = (clients, frame) => {
  if (!clients?.size || !frame) return;
  clients.forEach((client) => {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      return;
    }
    if (client.writableLength > MJPEG_CLIENT_BUFFER_LIMIT_BYTES) {
      return;
    }
    writeMjpegFrame(client, frame);
  });
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
  const device = upsertDevice(id, { snapshot: image, width, height });
  if (device?.streamClients?.size) {
    const frameData = image.startsWith('data:image/jpeg;base64,') ? image.slice('data:image/jpeg;base64,'.length) : null;
    if (frameData) {
      const frame = Buffer.from(frameData, 'base64');
      streamFrameToClients(device.streamClients, frame);
    }
  }
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

app.get('/api/devices/:id/stream.mjpg', (req, res) => {
  const device = devices.get(req.params.id);
  if (!device) {
    res.status(404).json({ ok: false, error: 'device_not_found' });
    return;
  }
  if (!device.streamClients) {
    device.streamClients = new Set();
  }

  res.status(200);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`);
  res.flushHeaders?.();
  device.streamClients.add(res);

  if (device.snapshot?.startsWith('data:image/jpeg;base64,')) {
    const frameData = device.snapshot.slice('data:image/jpeg;base64,'.length);
    writeMjpegFrame(res, Buffer.from(frameData, 'base64'));
  }

  req.on('close', () => {
    const current = devices.get(req.params.id);
    current?.streamClients?.delete(res);
  });
});

app.post('/api/rtsp/session', (req, res) => {
  const url = req.body?.url?.trim();
  const normalizedUrl = url?.toLowerCase?.() ?? '';
  const isRtspUrl = normalizedUrl.startsWith('rtsp://') || normalizedUrl.startsWith('rtsps://');
  if (!url || !isRtspUrl) {
    res.status(400).json({ ok: false, error: 'invalid_rtsp_url' });
    return;
  }
  const sessionId = startRtspSession(url);
  res.json({ ok: true, sessionId });
});

app.get('/api/rtsp/:id/status', (req, res) => {
  const session = rtspSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ ok: false, error: 'session_not_found' });
    return;
  }
  scheduleRtspCleanup(req.params.id);
  res.json({
    ok: true,
    activeUrl: session.url,
    lastError: session.lastError,
    hasFrame: Boolean(session.latestFrame),
    lastFrameAt: session.latestFrameAt || null
  });
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

app.get('/api/rtsp/:id/stream.mjpg', (req, res) => {
  const session = rtspSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ ok: false, error: 'session_not_found' });
    return;
  }
  scheduleRtspCleanup(req.params.id);
  res.status(200);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`);
  res.flushHeaders?.();
  session.streamClients.add(res);

  if (session.latestFrame) {
    const firstFrame = session.latestFrame;
    res.write(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${firstFrame.length}\r\n\r\n`);
    res.write(firstFrame);
    res.write('\r\n');
  }

  req.on('close', () => {
    const current = rtspSessions.get(req.params.id);
    if (!current) return;
    current.streamClients.delete(res);
    scheduleRtspCleanup(req.params.id);
  });
});

app.delete('/api/rtsp/:id', (req, res) => {
  stopRtspSession(req.params.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const getHttpsOptions = () => {
  const keyPath = path.resolve('cert/local.key');
  const certPath = path.resolve('cert/local.crt');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) return null;

  try {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (error) {
    console.error('Falha ao ler certificados HTTPS em cert/:', error.message);
    return null;
  }
};

const httpsOptions = getHttpsOptions();
const protocol = httpsOptions ? 'https' : 'http';
const server = httpsOptions ? https.createServer(httpsOptions, app) : http.createServer(app);

server.listen(port, () => {
  console.log(`Servidor a correr em ${protocol}://localhost:${port}`);
  console.log(`FFmpeg em uso: ${ffmpegExecutable}`);
  if (!httpsOptions) {
    console.log('Para ativar HTTPS, coloque cert/local.key e cert/local.crt.');
  }
});
