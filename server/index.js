const express = require('express');
const path = require('path');
const { readConfig, writeConfig, defaultConfig } = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const webDir = path.join(rootDir, 'web');
const staticDir = process.env.NODE_ENV === 'production' && require('fs').existsSync(distDir) ? distDir : webDir;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(staticDir));

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
    counts: {
      ...defaultConfig.counts,
      ...payload.counts
    }
  };
  writeConfig(config);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor a correr em http://localhost:${port}`);
});
