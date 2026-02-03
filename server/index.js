const express = require('express');
const path = require('path');
const { readConfig, writeConfig, defaultConfig } = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const webDir = path.join(rootDir, 'web');
const staticDir = process.env.NODE_ENV === 'production' && require('fs').existsSync(distDir) ? distDir : webDir;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(staticDir));

const devices = new Map();

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

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor a correr em http://localhost:${port}`);
});
