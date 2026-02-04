const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

const defaultConfig = {
  lines: {
    entry: null,
    exit: null
  },
  roi: null,
  deviceSettings: {},
  counts: {
    entries: 0,
    exits: 0,
    priorityAdjustments: 0,
    mrCount: 0
  },
  priorityVehicles: [],
  log: [],
  camera: {
    mode: 'auto',
    deviceId: null
  }
};

const readConfig = () => {
  try {
    if (!fs.existsSync(configPath)) {
      writeConfig(defaultConfig);
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return { ...defaultConfig, error: 'Falha ao ler config.json' };
  }
};

const writeConfig = (config) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
};

module.exports = {
  readConfig,
  writeConfig,
  defaultConfig
};
