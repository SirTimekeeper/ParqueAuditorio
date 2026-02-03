const STORAGE_KEY = 'parque-auditorio-config';

export const defaultConfig = {
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

export const loadLocalConfig = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...defaultConfig };
  try {
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch (error) {
    return { ...defaultConfig };
  }
};

export const saveLocalConfig = (config) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

export const fetchServerConfig = async () => {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
};

export const saveServerConfig = async (config) => {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  } catch (error) {
    console.warn('Não foi possível guardar no servidor.', error);
  }
};
