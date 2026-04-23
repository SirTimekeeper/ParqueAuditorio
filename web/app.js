import { defaultConfig, loadLocalConfig, saveLocalConfig, fetchServerConfig, saveServerConfig } from './config.js';
import { SimpleTracker } from './tracker.js';
import { detectCrossing } from './counter.js';
import { initVision, detectVehicles, initPlateRecognition, recognizePlateFromCanvas } from './vision.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');
const remotePreview = document.getElementById('remotePreview');
const dualEntryPreview = document.getElementById('dualEntryPreview');
const dualExitPreview = document.getElementById('dualExitPreview');
const previewStatus = document.getElementById('previewStatus');
const videoWrapper = document.querySelector('.video-wrapper');

const entriesEl = document.getElementById('entries');
const exitsEl = document.getElementById('exits');
const entriesMetricEl = document.getElementById('entriesMetric');
const exitsMetricEl = document.getElementById('exitsMetric');
const occupancyEl = document.getElementById('occupancy');
const carEntriesEl = document.getElementById('carEntries');
const carExitsEl = document.getElementById('carExits');
const motorcycleEntriesEl = document.getElementById('motorcycleEntries');
const motorcycleExitsEl = document.getElementById('motorcycleExits');
const occupancyNormalEl = document.getElementById('occupancyNormal');
const occupancyMREl = document.getElementById('occupancyMR');
const remainingSlotsEl = document.getElementById('remainingSlots');
const warningFull = document.getElementById('warningFull');
const warningMR = document.getElementById('warningMR');
const deviceList = document.getElementById('deviceList');
const remoteDeviceList = document.getElementById('remoteDeviceList');
const parkDeviceStateList = document.getElementById('parkDeviceStateList');
const entryLineStatus = document.getElementById('entryLineStatus');
const exitLineStatus = document.getElementById('exitLineStatus');
const entryAreaStatus = document.getElementById('entryAreaStatus');
const exitAreaStatus = document.getElementById('exitAreaStatus');

const setEntryLineBtn = document.getElementById('setEntryLine');
const setExitLineBtn = document.getElementById('setExitLine');
const setRoiBtn = document.getElementById('setRoi');
const setEntryAreaBtn = document.getElementById('setEntryArea');
const setExitAreaBtn = document.getElementById('setExitArea');
const toggleFullscreenBtn = document.getElementById('toggleFullscreen');
const startPreviewBtn = document.getElementById('startPreview');
const toggleCountingBtn = document.getElementById('toggleCounting');
const resetCountsBtn = document.getElementById('resetCounts');
const manualEntriesInput = document.getElementById('manualEntriesInput');
const manualExitsInput = document.getElementById('manualExitsInput');
const manualRemainingSlotsInput = document.getElementById('manualRemainingSlotsInput');
const parkCapacityInput = document.getElementById('parkCapacityInput');
const applyRemainingSlotsBtn = document.getElementById('applyRemainingSlots');
const applyParkCapacityBtn = document.getElementById('applyParkCapacity');
const normalCapacityEl = document.getElementById('normalCapacity');

const addPriorityBtn = document.getElementById('addPriority');
const removePriorityBtn = document.getElementById('removePriority');
const addMRBtn = document.getElementById('addMR');
const removeMRBtn = document.getElementById('removeMR');

const priorityInput = document.getElementById('priorityInput');
const priorityAddBtn = document.getElementById('priorityAdd');
const priorityList = document.getElementById('priorityList');
const logList = document.getElementById('log');
const rtspLogList = document.getElementById('rtspLog');
const lastPlateEl = document.getElementById('lastPlate');
const plateStatusEl = document.getElementById('plateStatus');
const symbolDetectionEnabledInput = document.getElementById('symbolDetectionEnabled');
const symbolDetectionModeSelect = document.getElementById('symbolDetectionMode');
const symbolTemplateFileInput = document.getElementById('symbolTemplateFile');
const symbolTemplateNameInput = document.getElementById('symbolTemplateName');

const resolutionSelect = document.getElementById('resolutionSelect');
const fpsSelect = document.getElementById('fpsSelect');
const cameraSelect = document.getElementById('cameraSelect');
const cameraStatus = document.getElementById('cameraStatus');
const refreshCamerasBtn = document.getElementById('refreshCameras');
const networkCameraUrlInput = document.getElementById('networkCameraUrl');
const setNetworkCameraBtn = document.getElementById('setNetworkCamera');
const entryRtspUrlInput = document.getElementById('entryRtspUrl');
const exitRtspUrlInput = document.getElementById('exitRtspUrl');
const setDualRtspBtn = document.getElementById('setDualRtsp');
const dualPreviewChannelSelect = document.getElementById('dualPreviewChannel');
const fsCarEntriesEl = document.getElementById('fsCarEntries');
const fsCarExitsEl = document.getElementById('fsCarExits');
const fsOccupancyEl = document.getElementById('fsOccupancy');
const fsRemainingSlotsEl = document.getElementById('fsRemainingSlots');
const fsAddEntryBtn = document.getElementById('fsAddEntry');
const fsAddExitBtn = document.getElementById('fsAddExit');
const countsCardEl = document.querySelector('.counts-card');

const tracker = new SimpleTracker();
const dualTrackers = {
  entry: new SimpleTracker(),
  exit: new SimpleTracker()
};

const DEVICE_ID_KEY = 'parque-auditorio-device-id';
const VEHICLE_TICKET_COUNTER_KEY = 'parque-auditorio-vehicle-ticket-counter';
const getOrCreateDeviceId = () => {
  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const generated = crypto?.randomUUID?.() ?? `device-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

const localDeviceId = getOrCreateDeviceId();
const localDeviceLabel = navigator.userAgentData?.platform || navigator.platform || 'Dispositivo local';
const plateToVehicleTicket = new Map();
const activeVehicleTickets = [];

const getNextVehicleTicketNumber = () => {
  const stored = Number(localStorage.getItem(VEHICLE_TICKET_COUNTER_KEY));
  if (Number.isFinite(stored) && stored > 0) return Math.floor(stored);
  return 1;
};

const saveNextVehicleTicketNumber = (value) => {
  localStorage.setItem(VEHICLE_TICKET_COUNTER_KEY, String(value));
};

const issueVehicleTicket = () => {
  const nextNumber = getNextVehicleTicketNumber();
  saveNextVehicleTicketNumber(nextNumber + 1);
  return `V${String(nextNumber).padStart(5, '0')}`;
};

const rememberActiveVehicleTicket = (ticket) => {
  if (!ticket) return;
  if (!activeVehicleTickets.includes(ticket)) {
    activeVehicleTickets.push(ticket);
  }
};

const releaseActiveVehicleTicket = (ticket) => {
  if (!ticket) return;
  const index = activeVehicleTickets.indexOf(ticket);
  if (index >= 0) {
    activeVehicleTickets.splice(index, 1);
  }
};

const getNextActiveVehicleTicket = () => {
  if (!activeVehicleTickets.length) return null;
  return activeVehicleTickets[0] ?? null;
};

let config = { ...defaultConfig };
let counting = false;
const EXIT_EVENT_DEDUP_MS = 2200;
const EXIT_EVENT_DEDUP_DISTANCE_PX = 85;
const recentExitEvents = [];
let drawingMode = null;
let drawingLine = null;
let roiDrawing = null;
let animationHandle = null;
let snapshotInterval = null;
let activeRtspSessionId = null;
let dualRtspSessions = { entry: null, exit: null };
let rtspPreviewRetryTimer = null;
let rtspStatusPollTimer = null;
let rtspLastFrameAt = 0;
let rtspLastFrameProgressAt = 0;
let activePreviewMode = 'local';
let selectedRemoteDevice = null;
let lastOrientation = null;
let orientationChangeTimeout = null;
let plateReady = false;
let plateQueue = Promise.resolve();
const plateChecks = new Map();
const ocrIndicators = new Map();
const OCR_INDICATOR_TTL_MS = 2200;
const symbolIndicators = new Map();
const SYMBOL_INDICATOR_TTL_MS = 2200;
const symbolTemplateState = {
  image: null,
  width: 0,
  height: 0,
  grayPixels: null
};
const rtspLogEntries = [];
let audioContext = null;

const ensureAudioContext = () => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) {
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
};

const playEventSound = (type) => {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const frequencies = type === 'entry' ? [660, 880] : [420, 300];
  frequencies.forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startAt = now + index * 0.08;
    const endAt = startAt + 0.11;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt);
  });
};

const ensureCountDefaults = () => {
  config.counts.carEntries = config.counts.carEntries ?? 0;
  config.counts.carExits = config.counts.carExits ?? 0;
  config.counts.motorcycleEntries = config.counts.motorcycleEntries ?? 0;
  config.counts.motorcycleExits = config.counts.motorcycleExits ?? 0;
};

const ensureCapacityDefaults = () => {
  if (!config.capacity || typeof config.capacity !== 'object') {
    config.capacity = { normal: DEFAULT_NORMAL_CAPACITY };
  }
  const parsedNormal = Number.parseInt(config.capacity.normal, 10);
  config.capacity.normal = Number.isFinite(parsedNormal) && parsedNormal > 0 ? parsedNormal : DEFAULT_NORMAL_CAPACITY;
};

const classifyVehicleType = (track) => (track.className === 'motorcycle' ? 'motorcycle' : 'car');

const syncTypedCountsWithTotals = () => {
  ensureCountDefaults();
  const normalizePair = (totalKey, carKey, motoKey) => {
    const total = Math.max(0, config.counts[totalKey] ?? 0);
    let car = Math.max(0, config.counts[carKey] ?? 0);
    let moto = Math.max(0, config.counts[motoKey] ?? 0);
    const typedTotal = car + moto;
    if (typedTotal > total) {
      const overflow = typedTotal - total;
      const reduceCar = Math.min(car, overflow);
      car -= reduceCar;
      moto = Math.max(0, moto - (overflow - reduceCar));
    } else if (typedTotal < total) {
      car += total - typedTotal;
    }
    config.counts[carKey] = car;
    config.counts[motoKey] = moto;
  };

  normalizePair('entries', 'carEntries', 'motorcycleEntries');
  normalizePair('exits', 'carExits', 'motorcycleExits');
};

const DEFAULT_NORMAL_CAPACITY = 112;
const maxMR = 4;
const isLandscape = () =>
  window.matchMedia?.('(orientation: landscape)')?.matches ?? window.innerWidth > window.innerHeight;
lastOrientation = isLandscape();

const toCanvasPoint = (event) => {
  const rect = overlay.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (overlay.width / rect.width);
  const y = (event.clientY - rect.top) * (overlay.height / rect.height);
  return { x, y };
};

const toNormalized = (point) => ({
  x: point.x / overlay.width,
  y: point.y / overlay.height
});

const toPixel = (point) => ({
  x: point.x * overlay.width,
  y: point.y * overlay.height
});

const normalizedLineToPixels = (line) => {
  if (!line) return null;
  const start = toPixel({ x: line.x1, y: line.y1 });
  const end = toPixel({ x: line.x2, y: line.y2 });
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
};

const normalizedRoiToPixels = (roi) => {
  if (!roi) return null;
  return {
    x: roi.x * overlay.width,
    y: roi.y * overlay.height,
    width: roi.width * overlay.width,
    height: roi.height * overlay.height
  };
};

const normalizedAreaToPixels = (area) => {
  if (!area) return null;
  return {
    x: area.x * overlay.width,
    y: area.y * overlay.height,
    width: area.width * overlay.width,
    height: area.height * overlay.height
  };
};

const ensureDeviceSettings = (targetConfig) => {
  if (!targetConfig.deviceSettings) {
    targetConfig.deviceSettings = {};
  }
};

const getDeviceSettings = (deviceId) => {
  ensureDeviceSettings(config);
  return (
    config.deviceSettings[deviceId] ?? {
      lines: {
        entry: null,
        exit: null
      },
      roi: null,
      entryArea: null,
      exitArea: null
    }
  );
};

const setDeviceSettings = (deviceId, settings) => {
  ensureDeviceSettings(config);
  config.deviceSettings[deviceId] = settings;
  if (deviceId === localDeviceId) {
    config.lines = settings.lines;
    config.roi = settings.roi;
    config.entryArea = settings.entryArea;
    config.exitArea = settings.exitArea;
  }
};

const getActiveDeviceId = () => (activePreviewMode === 'remote' ? selectedRemoteDevice?.id : localDeviceId);

const setStatus = (text, isError = false) => {
  statusText.textContent = text;
  statusText.style.color = isError ? '#e23434' : '#2457ff';
};

const setPlateStatus = (text, plate = null) => {
  if (plateStatusEl) {
    plateStatusEl.textContent = text;
  }
  if (lastPlateEl && plate !== null) {
    lastPlateEl.textContent = plate || '-';
  }
};

const isVideoFullscreen = () =>
  document.fullscreenElement === videoWrapper || document.webkitFullscreenElement === videoWrapper;

const updateFullscreenButtonLabel = () => {
  if (!toggleFullscreenBtn) return;
  toggleFullscreenBtn.textContent = isVideoFullscreen() ? 'Sair de ecrã inteiro' : 'Ver em ecrã inteiro';
};

const normalizePlateValue = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const PLATE_PATTERNS = [
  /^[A-Z]{2}[0-9]{2}[A-Z]{2}$/,
  /^[0-9]{2}[A-Z]{2}[0-9]{2}$/,
  /^[0-9]{2}[0-9]{2}[A-Z]{2}$/,
  /^[A-Z]{2}[0-9]{4}$/
];

const getPlateScore = (value) => {
  if (!value) return -1;
  let score = 0;
  const length = value.length;
  if (length >= 6 && length <= 8) score += 3;
  if (length === 6) score += 2;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (PLATE_PATTERNS.some((pattern) => pattern.test(value))) score += 4;
  return score;
};

const extractPlateCandidate = (rawText) => {
  if (!rawText) return '';
  const chunks = (rawText.toUpperCase().match(/[A-Z0-9-]{5,12}/g) ?? [])
    .map((chunk) => normalizePlateValue(chunk))
    .filter((chunk) => chunk.length >= 5 && chunk.length <= 8);
  const normalized = normalizePlateValue(rawText);
  if (normalized.length >= 5 && normalized.length <= 8) {
    chunks.push(normalized);
  }
  if (!chunks.length) return '';
  return chunks.sort((a, b) => getPlateScore(b) - getPlateScore(a) || b.length - a.length)[0] || '';
};

const isPriorityPlate = (plate) => {
  const normalized = normalizePlateValue(plate);
  if (!normalized) return false;
  return config.priorityVehicles.some((item) => normalizePlateValue(item) === normalized);
};

const queuePlateTask = (task) => {
  plateQueue = plateQueue
    .then(task)
    .catch((error) => {
      console.warn('Falha no OCR de matrícula.', error);
      setPlateStatus('OCR indisponível');
    });
};

const upsertOcrIndicator = (key, region, label = 'OCR') => {
  if (!region) return;
  ocrIndicators.set(key, {
    ...region,
    label,
    expiresAt: Date.now() + OCR_INDICATOR_TTL_MS
  });
};

const removeOcrIndicator = (key) => {
  ocrIndicators.delete(key);
};

const pruneOcrIndicators = () => {
  const now = Date.now();
  ocrIndicators.forEach((indicator, key) => {
    if (indicator.expiresAt <= now) {
      ocrIndicators.delete(key);
    }
  });
};

const ensureSymbolDetectionDefaults = () => {
  if (!config.symbolDetection || typeof config.symbolDetection !== 'object') {
    config.symbolDetection = { ...defaultConfig.symbolDetection };
  }
  config.symbolDetection.enabled = Boolean(config.symbolDetection.enabled);
  config.symbolDetection.mode = config.symbolDetection.mode === 'exclude' ? 'exclude' : 'count';
  const parsedSimilarity = Number(config.symbolDetection.minSimilarity);
  config.symbolDetection.minSimilarity =
    Number.isFinite(parsedSimilarity) && parsedSimilarity > 0 && parsedSimilarity < 1 ? parsedSimilarity : 0.78;
  config.symbolDetection.templateName = String(config.symbolDetection.templateName ?? '');
  config.symbolDetection.templateDataUrl = String(config.symbolDetection.templateDataUrl ?? '');
};

const upsertSymbolIndicator = (key, region, recognized, similarity) => {
  if (!region) return;
  const percentage = Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : '--';
  symbolIndicators.set(key, {
    ...region,
    recognized: Boolean(recognized),
    label: recognized ? `Símbolo: sim (${percentage})` : `Símbolo: não (${percentage})`,
    expiresAt: Date.now() + SYMBOL_INDICATOR_TTL_MS
  });
};

const pruneSymbolIndicators = () => {
  const now = Date.now();
  symbolIndicators.forEach((indicator, key) => {
    if (indicator.expiresAt <= now) {
      symbolIndicators.delete(key);
    }
  });
};

const clearSymbolTemplateState = () => {
  symbolTemplateState.image = null;
  symbolTemplateState.width = 0;
  symbolTemplateState.height = 0;
  symbolTemplateState.grayPixels = null;
};

const loadSymbolTemplateFromDataUrl = async (dataUrl) => {
  if (!dataUrl) {
    clearSymbolTemplateState();
    return false;
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 72;
      const ratio = Math.max(image.width, image.height) || 1;
      const width = Math.max(12, Math.round((image.width / ratio) * maxSide));
      const height = Math.max(12, Math.round((image.height / ratio) * maxSide));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        clearSymbolTemplateState();
        resolve(false);
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const grayPixels = new Float32Array(width * height);
      for (let i = 0; i < grayPixels.length; i += 1) {
        const base = i * 4;
        grayPixels[i] = 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2];
      }
      symbolTemplateState.image = image;
      symbolTemplateState.width = width;
      symbolTemplateState.height = height;
      symbolTemplateState.grayPixels = grayPixels;
      resolve(true);
    };
    image.onerror = () => {
      clearSymbolTemplateState();
      resolve(false);
    };
    image.src = dataUrl;
  });
};

const detectSymbolOnTrack = (track, source = getCurrentVisionSource()) => {
  if (!config.symbolDetection?.enabled || !symbolTemplateState.grayPixels || !source) {
    return { checked: false, recognized: false, similarity: 0 };
  }
  const vehicleType = classifyVehicleType(track);
  if (vehicleType !== 'car') {
    return { checked: false, recognized: false, similarity: 0 };
  }
  const sourceWidth = source.videoWidth || source.naturalWidth || 0;
  const sourceHeight = source.videoHeight || source.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) {
    return { checked: false, recognized: false, similarity: 0 };
  }
  const cropX = Math.max(0, Math.floor(track.x));
  const cropY = Math.max(0, Math.floor(track.y));
  const cropWidth = Math.min(sourceWidth - cropX, Math.max(1, Math.floor(track.width)));
  const cropHeight = Math.min(sourceHeight - cropY, Math.max(1, Math.floor(track.height)));
  if (cropWidth <= 2 || cropHeight <= 2) {
    return { checked: false, recognized: false, similarity: 0 };
  }
  const canvas = document.createElement('canvas');
  canvas.width = symbolTemplateState.width;
  canvas.height = symbolTemplateState.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { checked: false, recognized: false, similarity: 0 };
  ctx.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let diff = 0;
  const pixels = symbolTemplateState.grayPixels;
  for (let i = 0; i < pixels.length; i += 1) {
    const base = i * 4;
    const gray = 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2];
    diff += Math.abs(gray - pixels[i]);
  }
  const avgDiff = diff / pixels.length;
  const similarity = Math.max(0, Math.min(1, 1 - avgDiff / 255));
  const recognized = similarity >= config.symbolDetection.minSimilarity;
  return { checked: true, recognized, similarity };
};

const getPlateCropRegion = (track, source = getCurrentVisionSource()) => {
  const sourceWidth = source?.videoWidth || source?.naturalWidth || 0;
  const sourceHeight = source?.videoHeight || source?.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) return null;
  const horizontalMargin = track.width * 0.08;
  const plateHeight = track.height * 0.45;
  const plateY = track.y + track.height * 0.45;
  const plateX = track.x + horizontalMargin;
  const plateWidth = Math.max(0, track.width - horizontalMargin * 2);
  const cropX = Math.max(0, Math.floor(plateX));
  const cropY = Math.max(0, Math.floor(plateY));
  const cropWidth = Math.min(sourceWidth - cropX, Math.floor(plateWidth));
  const cropHeight = Math.min(sourceHeight - cropY, Math.floor(plateHeight));
  if (cropWidth <= 0 || cropHeight <= 0) return null;
  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
};

const capturePlateCanvas = (track, source = getCurrentVisionSource()) => {
  const region = getPlateCropRegion(track, source);
  if (!region || !source) return null;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(region.width * scale));
  canvas.height = Math.max(1, Math.floor(region.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const contrast = Math.min(255, Math.max(0, (gray - 128) * 1.3 + 128));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

const createInvertedCanvas = (sourceCanvas) => {
  if (!sourceCanvas) return null;
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

const addLog = (entry) => {
  config.log = [entry, ...config.log].slice(0, 40);
};

const sanitizeRtspLogDetail = (detail) =>
  String(detail ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .trim()
    .slice(0, 220);

const addRtspLog = (type, detail = '') => {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    detail: sanitizeRtspLogDetail(detail)
  };
  rtspLogEntries.unshift(entry);
  if (rtspLogEntries.length > 50) rtspLogEntries.length = 50;
  renderRtspLog();
};

const setSelectedCamera = async (deviceId) => {
  config.camera = { mode: 'device', deviceId, networkUrl: '' };
  persistConfig();
  await startCamera();
};

const updateLineStatus = () => {
  const activeDeviceId = getActiveDeviceId();
  const activeSettings = activeDeviceId ? getDeviceSettings(activeDeviceId) : null;
  if (entryLineStatus) {
    entryLineStatus.textContent = activeSettings?.lines?.entry ? 'Configurada' : 'Não definida';
  }
  if (exitLineStatus) {
    exitLineStatus.textContent = activeSettings?.lines?.exit ? 'Configurada' : 'Não definida';
  }
  if (entryAreaStatus) {
    entryAreaStatus.textContent = activeSettings?.entryArea ? 'Configurada' : 'Não definida';
  }
  if (exitAreaStatus) {
    exitAreaStatus.textContent = activeSettings?.exitArea ? 'Configurada' : 'Não definida';
  }
};

const updateCountsUI = () => {
  ensureCapacityDefaults();
  syncTypedCountsWithTotals();
  const normalCapacity = config.capacity.normal;
  entriesEl.textContent = config.counts.entries;
  exitsEl.textContent = config.counts.exits;
  if (carEntriesEl) carEntriesEl.textContent = config.counts.carEntries;
  if (carExitsEl) carExitsEl.textContent = config.counts.carExits;
  if (fsCarEntriesEl) fsCarEntriesEl.textContent = config.counts.carEntries;
  if (fsCarExitsEl) fsCarExitsEl.textContent = config.counts.carExits;
  if (motorcycleEntriesEl) motorcycleEntriesEl.textContent = config.counts.motorcycleEntries;
  if (motorcycleExitsEl) motorcycleExitsEl.textContent = config.counts.motorcycleExits;
  if (manualEntriesInput) manualEntriesInput.value = String(config.counts.entries);
  if (manualExitsInput) manualExitsInput.value = String(config.counts.exits);

  const rawOccupancy = config.counts.carEntries - config.counts.carExits - config.counts.priorityAdjustments;
  const occupancy = Math.max(0, rawOccupancy);
  const occupancyMR = Math.min(config.counts.mrCount, occupancy, maxMR);
  const occupancyNormal = Math.max(0, occupancy - occupancyMR);
  const remainingSlots = Math.max(0, normalCapacity - occupancyNormal);

  occupancyEl.textContent = occupancy;
  if (fsOccupancyEl) fsOccupancyEl.textContent = occupancy;
  occupancyNormalEl.textContent = occupancyNormal;
  occupancyMREl.textContent = occupancyMR;
  if (remainingSlotsEl) remainingSlotsEl.textContent = remainingSlots;
  if (fsRemainingSlotsEl) fsRemainingSlotsEl.textContent = remainingSlots;
  if (manualRemainingSlotsInput) {
    manualRemainingSlotsInput.max = String(normalCapacity);
    manualRemainingSlotsInput.value = String(remainingSlots);
  }
  if (parkCapacityInput) parkCapacityInput.value = String(normalCapacity);
  if (normalCapacityEl) normalCapacityEl.textContent = String(normalCapacity);

  warningFull.classList.toggle('active', occupancyNormal >= normalCapacity);
  warningMR.classList.toggle('active', occupancyMR >= maxMR);

  if (countsCardEl) {
    const normalizedUsage = Math.max(0, Math.min(1, occupancyNormal / normalCapacity));
    const state =
      normalizedUsage >= 1
        ? 'full'
        : normalizedUsage >= 0.85
          ? 'critical'
          : normalizedUsage >= 0.65
            ? 'high'
            : normalizedUsage >= 0.35
              ? 'medium'
              : 'low';
    countsCardEl.dataset.occupancyState = state;
  }
};

const incrementEntriesManually = () => {
  config.counts.entries += 1;
  config.counts.carEntries += 1;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada manual', detail: '+1 (clique)' });
  persistConfig();
};

const incrementExitsManually = () => {
  const maxExits = Math.max(0, config.counts.entries - config.counts.priorityAdjustments);
  if (config.counts.exits >= maxExits) return;
  config.counts.exits += 1;
  config.counts.carExits += 1;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Saída manual', detail: '+1 (clique)' });
  persistConfig();
};

const bindManualMetric = (element, callback) => {
  if (!element) return;
  element.addEventListener('click', callback);
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    callback();
  });
};

const renderPriorityList = () => {
  priorityList.innerHTML = '';
  config.priorityVehicles.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `<span>${item}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remover';
    removeBtn.addEventListener('click', () => {
      config.priorityVehicles.splice(index, 1);
      persistConfig();
      renderPriorityList();
    });
    li.appendChild(removeBtn);
    priorityList.appendChild(li);
  });
};

const renderLog = () => {
  logList.innerHTML = '';
  config.log.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.textContent = `${entry.time} - ${entry.type} ${entry.detail ?? ''}`.trim();
    logList.appendChild(li);
  });
};

const renderRtspLog = () => {
  if (!rtspLogList) return;
  rtspLogList.innerHTML = '';
  if (!rtspLogEntries.length) {
    const li = document.createElement('li');
    li.textContent = 'Sem eventos RTSP.';
    rtspLogList.appendChild(li);
    return;
  }
  rtspLogEntries.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.time} - ${entry.type}${entry.detail ? `: ${entry.detail}` : ''}`;
    rtspLogList.appendChild(li);
  });
};

const persistConfig = () => {
  saveLocalConfig(config);
  saveServerConfig(config);
  updateCountsUI();
  updateLineStatus();
  renderPriorityList();
  renderLog();
};

const applyConfig = (loaded) => {
  const merged = { ...defaultConfig, ...loaded };
  if (!merged.deviceSettings) {
    merged.deviceSettings = {};
  }
  Object.keys(merged.deviceSettings).forEach((deviceId) => {
    const settings = merged.deviceSettings[deviceId] ?? {};
    merged.deviceSettings[deviceId] = {
      lines: settings.lines ?? { entry: null, exit: null },
      roi: settings.roi ?? null,
      entryArea: settings.entryArea ?? settings.passageArea ?? null,
      exitArea: settings.exitArea ?? settings.passageArea ?? null
    };
  });
  if (!merged.deviceSettings[localDeviceId] && (merged.lines || merged.roi || merged.entryArea || merged.exitArea || merged.passageArea)) {
    merged.deviceSettings[localDeviceId] = {
      lines: merged.lines ?? { entry: null, exit: null },
      roi: merged.roi ?? null,
      entryArea: merged.entryArea ?? merged.passageArea ?? null,
      exitArea: merged.exitArea ?? merged.passageArea ?? null
    };
  }
  if (!merged.deviceSettings[localDeviceId]) {
    merged.deviceSettings[localDeviceId] = {
      lines: { entry: null, exit: null },
      roi: null,
      entryArea: null,
      exitArea: null
    };
  }
  config = merged;
  if (!config.camera) {
    config.camera = { ...defaultConfig.camera };
  }
  config.camera.dualRtsp = {
    enabled: false,
    entryUrl: '',
    exitUrl: '',
    previewChannel: 'entry',
    ...(config.camera.dualRtsp ?? {})
  };
  if (!['entry', 'exit'].includes(config.camera.dualRtsp.previewChannel)) {
    config.camera.dualRtsp.previewChannel = 'entry';
  }
  if (entryRtspUrlInput) entryRtspUrlInput.value = config.camera.dualRtsp.entryUrl ?? '';
  if (exitRtspUrlInput) exitRtspUrlInput.value = config.camera.dualRtsp.exitUrl ?? '';
  if (dualPreviewChannelSelect) dualPreviewChannelSelect.value = config.camera.dualRtsp.previewChannel;
  ensureSymbolDetectionDefaults();
  if (symbolDetectionEnabledInput) symbolDetectionEnabledInput.checked = config.symbolDetection.enabled;
  if (symbolDetectionModeSelect) symbolDetectionModeSelect.value = config.symbolDetection.mode;
  if (symbolTemplateNameInput) symbolTemplateNameInput.value = config.symbolDetection.templateName || '';
  loadSymbolTemplateFromDataUrl(config.symbolDetection.templateDataUrl);
  ensureCountDefaults();
  ensureCapacityDefaults();
  persistConfig();
};

const loadConfig = async () => {
  const localConfig = loadLocalConfig();
  applyConfig(localConfig);
  const serverConfig = await fetchServerConfig();
  if (serverConfig) {
    applyConfig(serverConfig);
  }
};

const drawOverlay = (tracks = []) => {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  pruneOcrIndicators();
  pruneSymbolIndicators();

  const activeDeviceId = getActiveDeviceId();
  const activeSettings = activeDeviceId ? getDeviceSettings(activeDeviceId) : null;
  const entryLine = normalizedLineToPixels(activeSettings?.lines?.entry);
  const exitLine = normalizedLineToPixels(activeSettings?.lines?.exit);
  const roi = normalizedRoiToPixels(activeSettings?.roi);
  const entryArea = normalizedAreaToPixels(activeSettings?.entryArea);
  const exitArea = normalizedAreaToPixels(activeSettings?.exitArea);

  if (roi) {
    ctx.strokeStyle = 'rgba(36, 87, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
  }

  if (entryArea) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(entryArea.x, entryArea.y, entryArea.width, entryArea.height);
    ctx.strokeStyle = 'rgba(14, 116, 144, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(entryArea.x, entryArea.y, entryArea.width, entryArea.height);
  }

  if (exitArea) {
    ctx.fillStyle = 'rgba(248, 113, 113, 0.14)';
    ctx.fillRect(exitArea.x, exitArea.y, exitArea.width, exitArea.height);
    ctx.strokeStyle = 'rgba(185, 28, 28, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(exitArea.x, exitArea.y, exitArea.width, exitArea.height);
  }

  if (entryLine) {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(entryLine.x1, entryLine.y1);
    ctx.lineTo(entryLine.x2, entryLine.y2);
    ctx.stroke();
  }

  if (exitLine) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(exitLine.x1, exitLine.y1);
    ctx.lineTo(exitLine.x2, exitLine.y2);
    ctx.stroke();
  }

  tracks.forEach((track) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(track.x, track.y, track.width, track.height);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(track.x, track.y - 18, 70, 16);
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(`#${track.id}`, track.x + 4, track.y - 6);
  });

  ocrIndicators.forEach((indicator) => {
    const x = Math.max(0, indicator.x);
    const y = Math.max(0, indicator.y);
    const width = Math.max(1, indicator.width);
    const height = Math.max(1, indicator.height);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(x, Math.max(0, y - 18), Math.max(70, width), 16);
    ctx.fillStyle = '#fef3c7';
    ctx.font = '12px sans-serif';
    ctx.fillText(indicator.label || 'OCR', x + 4, Math.max(12, y - 6));
  });

  symbolIndicators.forEach((indicator) => {
    const x = Math.max(0, indicator.x);
    const y = Math.max(0, indicator.y);
    const width = Math.max(1, indicator.width);
    const boxHeight = 16;
    const labelY = Math.min(Math.max(18, y + 18), overlay.height - 4);
    ctx.fillStyle = indicator.recognized ? 'rgba(22, 163, 74, 0.85)' : 'rgba(220, 38, 38, 0.85)';
    ctx.fillRect(x, labelY - boxHeight, Math.max(130, width * 0.6), boxHeight);
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(indicator.label, x + 4, labelY - 4);
  });

  if (drawingMode === 'entry' && drawingLine) {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(drawingLine.start.x, drawingLine.start.y);
    ctx.lineTo(drawingLine.end.x, drawingLine.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (drawingMode === 'exit' && drawingLine) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(drawingLine.start.x, drawingLine.start.y);
    ctx.lineTo(drawingLine.end.x, drawingLine.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if ((drawingMode === 'roi' || drawingMode === 'entryArea' || drawingMode === 'exitArea') && roiDrawing) {
    ctx.strokeStyle =
      drawingMode === 'entryArea'
        ? 'rgba(14, 116, 144, 0.95)'
        : drawingMode === 'exitArea'
          ? 'rgba(185, 28, 28, 0.95)'
          : 'rgba(36, 87, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(roiDrawing.x, roiDrawing.y, roiDrawing.width, roiDrawing.height);
    ctx.setLineDash([]);
  }
};

const configureCanvas = () => {
  if (activePreviewMode === 'remote' && remotePreview?.naturalWidth) {
    overlay.width = remotePreview.naturalWidth;
    overlay.height = remotePreview.naturalHeight || 480;
  } else {
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
  }
  if (videoWrapper && overlay.width && overlay.height) {
    const targetHeight = Math.round((videoWrapper.clientWidth * overlay.height) / overlay.width);
    if (targetHeight) {
      videoWrapper.style.height = `${targetHeight}px`;
    }
  }
  drawOverlay();
};

const hasLocalFeed = () => {
  if (config.camera?.mode === 'dual-rtsp') {
    return Boolean(dualRtspSessions.entry && dualRtspSessions.exit);
  }
  if (video.srcObject) return true;
  return Boolean(config.camera?.mode === 'rtsp' && activeRtspSessionId);
};

const isDualRtspMode = () => config.camera?.mode === 'dual-rtsp' && Boolean(config.camera?.dualRtsp?.enabled);

const clearRtspStatusPoll = () => {
  if (!rtspStatusPollTimer) return;
  clearInterval(rtspStatusPollTimer);
  rtspStatusPollTimer = null;
};

const updateRtspStatusFromServer = async () => {
  if (!activeRtspSessionId) {
    clearRtspStatusPoll();
    return;
  }
  try {
    const response = await fetch(`/api/rtsp/${activeRtspSessionId}/status`);
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload?.ok) return;

    const lastFrameAt = Number(payload.lastFrameAt) || 0;
    const now = Date.now();
    if (lastFrameAt && lastFrameAt !== rtspLastFrameAt) {
      rtspLastFrameAt = lastFrameAt;
      rtspLastFrameProgressAt = now;
    }

    if (!rtspLastFrameProgressAt && lastFrameAt) {
      rtspLastFrameProgressAt = now;
    }

    if (payload.lastError) {
      const detail = String(payload.lastError).slice(0, 180);
      setRtspPreviewMessage(`RTSP sem frames: ${detail}`, true);
      addRtspLog('Erro do stream', detail);
    }

    const stalledForMs = now - (rtspLastFrameProgressAt || now);
    if (lastFrameAt && stalledForMs > 7000) {
      setRtspPreviewMessage('Stream RTSP sem atualização. A reconectar...', true);
      addRtspLog('Reconexão', 'Sem frames recentes. A tentar recuperar stream.');
      scheduleRtspPreviewRetry(true);
      rtspLastFrameProgressAt = now;
    }
  } catch (error) {
    // Ignora falhas pontuais de polling para não interromper a pré-visualização.
  }
};

const stopRtspFeed = async () => {
  clearRtspPreviewRetry();
  clearRtspStatusPoll();
  rtspLastFrameAt = 0;
  rtspLastFrameProgressAt = 0;
  if (activeRtspSessionId) {
    addRtspLog('Sessão encerrada', activeRtspSessionId);
    try {
      await fetch(`/api/rtsp/${activeRtspSessionId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Falha ao terminar sessão RTSP.', error);
      addRtspLog('Erro ao encerrar', error?.message || 'Falha ao fechar sessão RTSP');
    }
  }
  activeRtspSessionId = null;
  if (remotePreview) remotePreview.removeAttribute('src');
};

const stopDualRtspFeeds = async () => {
  const sessionIds = Object.values(dualRtspSessions).filter(Boolean);
  dualRtspSessions = { entry: null, exit: null };
  if (dualEntryPreview) dualEntryPreview.removeAttribute('src');
  if (dualExitPreview) dualExitPreview.removeAttribute('src');
  for (const sessionId of sessionIds) {
    try {
      await fetch(`/api/rtsp/${sessionId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Falha ao terminar sessão RTSP dual.', error);
    }
  }
};

const stopCamera = () => {
  if (video.srcObject) {
    const tracks = video.srcObject.getTracks();
    tracks.forEach((track) => track.stop());
    video.srcObject = null;
  }
  if (video.src) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  if (remotePreview) {
    clearRtspPreviewRetry();
    remotePreview.removeAttribute('src');
    remotePreview.style.display = 'none';
  }
  if (previewStatus) {
    previewStatus.style.color = '';
  }
  video.style.display = 'block';
  stopRtspFeed();
  stopDualRtspFeeds();
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
};

const getCameraConstraints = () => {
  const targetSize = Number(resolutionSelect.value);
  const landscape = isLandscape();
  const width = landscape ? targetSize : Math.round(targetSize * 0.75);
  const height = landscape ? Math.round(targetSize * 0.75) : targetSize;
  const videoConstraints = {
    width: { ideal: width },
    height: { ideal: height }
  };
  const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null };
  if (cameraConfig.mode === 'device' && cameraConfig.deviceId) {
    videoConstraints.deviceId = { exact: cameraConfig.deviceId };
  } else if (cameraConfig.mode === 'user' || cameraConfig.mode === 'environment') {
    videoConstraints.facingMode = { ideal: cameraConfig.mode };
  }
  return {
    video: videoConstraints,
    audio: false
  };
};

const buildCameraOption = (value, label) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
};

const getActiveCameraId = () => {
  const track = video.srcObject?.getVideoTracks?.()[0];
  return track?.getSettings?.().deviceId ?? null;
};

const renderDeviceList = (devices = []) => {
  if (!deviceList) return;
  deviceList.innerHTML = '';
  if (!devices.length) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.textContent = 'Nenhum dispositivo detetado.';
    deviceList.appendChild(li);
    return;
  }

  const activeCameraId = getActiveCameraId();
  const labels = {
    videoinput: 'Câmara',
    audioinput: 'Microfone',
    audiooutput: 'Saída áudio'
  };

  devices.forEach((device, index) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    const title = document.createElement('span');
    const label = device.label || `${labels[device.kind] ?? 'Dispositivo'} ${index + 1}`;
    title.textContent = label;
    const meta = document.createElement('div');
    meta.className = 'device-meta';
    const kind = document.createElement('span');
    kind.textContent = labels[device.kind] ?? device.kind;
    meta.appendChild(kind);
    li.appendChild(title);
    li.appendChild(meta);
    if (device.kind === 'videoinput' && device.deviceId) {
      if (device.deviceId === activeCameraId) {
        const badge = document.createElement('span');
        badge.className = 'device-badge';
        badge.textContent = 'Em uso';
        meta.appendChild(badge);
      }
      const actions = document.createElement('div');
      actions.className = 'device-actions';
      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'Selecionar câmara';
      selectBtn.addEventListener('click', () => setSelectedCamera(device.deviceId));
      actions.appendChild(selectBtn);
      li.appendChild(actions);
    }
    deviceList.appendChild(li);
  });
};

const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'Sem atividade';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'Agora mesmo';
  if (seconds < 60) return `Há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Há ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `Há ${hours}h`;
};

const isDeviceOnline = (lastSeen) => {
  if (!lastSeen) return false;
  return Date.now() - lastSeen <= 20_000;
};

const renderParkDeviceStates = (devices = []) => {
  if (!parkDeviceStateList) return;
  parkDeviceStateList.innerHTML = '';
  if (!devices.length) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.textContent = 'Sem dispositivos ligados.';
    parkDeviceStateList.appendChild(li);
    return;
  }

  devices.forEach((device) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    const title = document.createElement('span');
    const label = device.id === localDeviceId ? `${device.label ?? 'Dispositivo'} (este)` : device.label ?? 'Dispositivo';
    title.textContent = label;
    li.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'device-meta';

    const stateBadge = document.createElement('span');
    stateBadge.className = `readonly-state ${isDeviceOnline(device.lastSeen) ? 'online' : 'offline'}`;
    stateBadge.textContent = isDeviceOnline(device.lastSeen) ? 'Online' : 'Offline';
    meta.appendChild(stateBadge);

    const activity = document.createElement('span');
    activity.textContent = formatLastSeen(device.lastSeen);
    meta.appendChild(activity);

    const occupancy = document.createElement('span');
    const occupancyValue = Number.isFinite(device.state?.occupancy) ? device.state.occupancy : '—';
    occupancy.textContent = `Ocupação: ${occupancyValue}`;
    meta.appendChild(occupancy);

    const countState = document.createElement('span');
    countState.textContent = `Contagem: ${device.state?.counting ? 'ativa' : 'parada'}`;
    meta.appendChild(countState);

    li.appendChild(meta);
    parkDeviceStateList.appendChild(li);
  });
};

const renderRemoteDevices = (devices = []) => {
  if (!remoteDeviceList) return;
  remoteDeviceList.innerHTML = '';
  if (!devices.length) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.textContent = 'Nenhuma câmara online.';
    remoteDeviceList.appendChild(li);
    return;
  }

  devices.forEach((device) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    const title = document.createElement('span');
    const label = device.id === localDeviceId ? `${device.label ?? 'Dispositivo'} (este)` : device.label ?? 'Dispositivo';
    title.textContent = label;
    li.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'device-meta';
    const status = document.createElement('span');
    status.textContent = formatLastSeen(device.lastSeen);
    meta.appendChild(status);
    if (device.hasSnapshot) {
      const badge = document.createElement('span');
      badge.className = 'device-badge';
      badge.textContent = 'Imagem pronta';
      meta.appendChild(badge);
    }
    if (activePreviewMode === 'remote' && selectedRemoteDevice?.id === device.id) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'device-badge';
      activeBadge.textContent = 'A configurar';
      meta.appendChild(activeBadge);
    }
    li.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'device-actions';
    const selectBtn = document.createElement('button');
    selectBtn.textContent = device.id === localDeviceId ? 'Usar local' : 'Configurar';
    selectBtn.addEventListener('click', () => {
      if (device.id === localDeviceId) {
        showLocalPreview();
      } else {
        showRemotePreview(device);
      }
    });
    actions.appendChild(selectBtn);
    li.appendChild(actions);
    remoteDeviceList.appendChild(li);
  });
};

const fetchRemoteDevices = async () => {
  try {
    const response = await fetch('/api/devices');
    if (!response.ok) return;
    const payload = await response.json();
    const devices = payload.devices ?? [];
    renderRemoteDevices(devices);
    renderParkDeviceStates(devices);
  } catch (error) {
    console.warn('Falha ao carregar dispositivos remotos.', error);
  }
};

const getLocalParkState = () => ({
  counting,
  occupancy: Number(config.counts?.occupancy ?? 0),
  entries: Number(config.counts?.entries ?? 0),
  exits: Number(config.counts?.exits ?? 0),
  updatedAt: Date.now()
});

const updateCameraSelect = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const availableIds = cameras.map((camera) => camera.deviceId);

  cameraSelect.innerHTML = '';
  [
    { value: 'auto', label: 'Automática' },
    { value: 'user', label: 'Frontal' },
    { value: 'environment', label: 'Traseira' },
    { value: 'network', label: 'Endereço de rede (HTTP)' },
    { value: 'rtsp', label: 'RTSP' },
    { value: 'dual-rtsp', label: '2x RTSP (entrada + saída)' }
  ].forEach((item) => cameraSelect.appendChild(buildCameraOption(item.value, item.label)));

  cameras.forEach((camera, index) => {
    const label = camera.label || `Câmara ${index + 1}`;
    cameraSelect.appendChild(buildCameraOption(`device:${camera.deviceId}`, label));
  });

  const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null };
  let targetValue = 'auto';
  if (cameraConfig.mode === 'device' && cameraConfig.deviceId && availableIds.includes(cameraConfig.deviceId)) {
    targetValue = `device:${cameraConfig.deviceId}`;
  } else if (cameraConfig.mode === 'user' || cameraConfig.mode === 'environment' || cameraConfig.mode === 'network' || cameraConfig.mode === 'rtsp' || cameraConfig.mode === 'dual-rtsp') {
    targetValue = cameraConfig.mode;
  }
  cameraSelect.value = targetValue;
  if (cameraSelect.value !== targetValue) {
    cameraSelect.value = 'auto';
  }

  if (cameraStatus) {
    const selectedOption = cameraSelect.options[cameraSelect.selectedIndex];
    cameraStatus.textContent = selectedOption ? selectedOption.textContent : 'Automática';
  }

  if (cameraConfig.mode === 'device' && cameraConfig.deviceId && !availableIds.includes(cameraConfig.deviceId)) {
    config.camera = { mode: 'auto', deviceId: null, networkUrl: '' };
    persistConfig();
  }

  renderDeviceList(devices);
};

const refreshCameraSelectSafely = async () => {
  try {
    await updateCameraSelect();
  } catch (error) {
    console.warn('Não foi possível atualizar a lista de câmaras neste contexto.', error);
  }
};

const registerDevice = async () => {
  try {
    await fetch('/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: localDeviceId, label: localDeviceLabel, state: getLocalParkState() })
    });
  } catch (error) {
    console.warn('Falha ao registar dispositivo.', error);
  }
};

const sendHeartbeat = async () => {
  try {
    await fetch('/api/devices/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: localDeviceId, state: getLocalParkState() })
    });
  } catch (error) {
    console.warn('Falha ao atualizar presença.', error);
  }
};

const snapshotCanvas = document.createElement('canvas');
const snapshotContext = snapshotCanvas.getContext('2d');

const getSnapshotSource = () => {
  if (video.style.display !== 'none' && (video.videoWidth || video.videoHeight)) {
    return {
      element: video,
      width: video.videoWidth,
      height: video.videoHeight
    };
  }

  if (remotePreview.style.display !== 'none' && (remotePreview.naturalWidth || remotePreview.naturalHeight)) {
    return {
      element: remotePreview,
      width: remotePreview.naturalWidth,
      height: remotePreview.naturalHeight
    };
  }

  return null;
};

const sendSnapshot = async () => {
  const source = getSnapshotSource();
  if (!source) return;
  snapshotCanvas.width = source.width;
  snapshotCanvas.height = source.height;
  snapshotContext.drawImage(source.element, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  const image = snapshotCanvas.toDataURL('image/jpeg', 0.7);
  try {
    await fetch(`/api/devices/${localDeviceId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, width: snapshotCanvas.width, height: snapshotCanvas.height })
    });
  } catch (error) {
    console.warn('Falha ao enviar imagem.', error);
  }
};

const startSnapshotLoop = () => {
  if (snapshotInterval) clearInterval(snapshotInterval);
  snapshotInterval = setInterval(sendSnapshot, 3000);
  sendSnapshot();
};

const setControlsDisabled = (disabled) => {
  setEntryLineBtn.disabled = disabled;
  setExitLineBtn.disabled = disabled;
  setRoiBtn.disabled = disabled;
  if (setEntryAreaBtn) setEntryAreaBtn.disabled = disabled;
  if (setExitAreaBtn) setExitAreaBtn.disabled = disabled;
  startPreviewBtn.disabled = disabled;
  toggleCountingBtn.disabled = disabled;
  cameraSelect.disabled = disabled;
  resolutionSelect.disabled = disabled;
  fpsSelect.disabled = disabled;
  if (refreshCamerasBtn) refreshCamerasBtn.disabled = disabled;
};

const updatePreviewStatus = () => {
  if (!previewStatus) return;
  if (activePreviewMode === 'remote' && selectedRemoteDevice) {
    previewStatus.textContent = `A configurar: ${selectedRemoteDevice.label ?? 'Dispositivo remoto'}`;
  } else {
    previewStatus.textContent = 'A configurar: este dispositivo';
  }
};

const setRtspPreviewMessage = (text, isError = false) => {
  if (!previewStatus) return;
  previewStatus.textContent = text;
  previewStatus.style.color = isError ? '#e23434' : '';
};

const clearRtspPreviewRetry = () => {
  if (!rtspPreviewRetryTimer) return;
  clearTimeout(rtspPreviewRetryTimer);
  rtspPreviewRetryTimer = null;
};

const scheduleRtspPreviewRetry = (force = false) => {
  if (!activeRtspSessionId || rtspPreviewRetryTimer) return;
  rtspPreviewRetryTimer = setTimeout(() => {
    rtspPreviewRetryTimer = null;
    if (!activeRtspSessionId) return;
    if (force) remotePreview.removeAttribute('src');
    remotePreview.src = `/api/rtsp/${activeRtspSessionId}/stream.mjpg?t=${Date.now()}`;
  }, 1500);
};

const showLocalPreview = () => {
  activePreviewMode = 'local';
  selectedRemoteDevice = null;
  clearRtspPreviewRetry();
  remotePreview.onload = null;
  remotePreview.onerror = null;
  remotePreview.removeAttribute('src');
  remotePreview.style.display = 'none';
  video.style.display = 'block';
  updatePreviewStatus();
  setControlsDisabled(false);
  updateLineStatus();
  configureCanvas();
};

const showRemotePreview = (device) => {
  activePreviewMode = 'remote';
  selectedRemoteDevice = device;
  stopCamera();
  remotePreview.style.display = 'block';
  video.style.display = 'none';
  setControlsDisabled(true);
  setEntryLineBtn.disabled = false;
  setExitLineBtn.disabled = false;
  setRoiBtn.disabled = false;
  if (setEntryAreaBtn) setEntryAreaBtn.disabled = false;
  if (setExitAreaBtn) setExitAreaBtn.disabled = false;
  updatePreviewStatus();
  updateLineStatus();
  const streamUrl = `/api/devices/${device.id}/stream.mjpg?t=${Date.now()}`;
  remotePreview.onload = () => {
    configureCanvas();
    updatePreviewStatus();
  };
  remotePreview.onerror = () => {
    setStatus('Falha ao abrir stream remoto. Verifique ligação do dispositivo.', true);
  };
  remotePreview.src = streamUrl;
};

const startCamera = async () => {
  const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null, networkUrl: '' };
  try {
    if (activePreviewMode !== 'local') {
      showLocalPreview();
    }
    stopCamera();

    if (cameraConfig.mode === 'dual-rtsp' && cameraConfig.dualRtsp?.enabled) {
      const entryUrl = cameraConfig.dualRtsp.entryUrl?.trim();
      const exitUrl = cameraConfig.dualRtsp.exitUrl?.trim();
      if (!entryUrl || !exitUrl) {
        throw new Error('dual_rtsp_missing_urls');
      }
      const [entryResponse, exitResponse] = await Promise.all([
        fetch('/api/rtsp/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: entryUrl })
        }),
        fetch('/api/rtsp/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: exitUrl })
        })
      ]);
      if (!entryResponse.ok || !exitResponse.ok) {
        throw new Error('dual_rtsp_session_error');
      }
      const entryPayload = await entryResponse.json();
      const exitPayload = await exitResponse.json();
      dualRtspSessions = { entry: entryPayload.sessionId, exit: exitPayload.sessionId };
      if (dualEntryPreview) dualEntryPreview.src = `/api/rtsp/${dualRtspSessions.entry}/stream.mjpg?t=${Date.now()}`;
      if (dualExitPreview) dualExitPreview.src = `/api/rtsp/${dualRtspSessions.exit}/stream.mjpg?t=${Date.now()}`;
      const previewChannel = cameraConfig.dualRtsp.previewChannel === 'exit' ? 'exit' : 'entry';
      remotePreview.src = `/api/rtsp/${dualRtspSessions[previewChannel]}/stream.mjpg?t=${Date.now()}`;
      video.style.display = 'none';
      remotePreview.style.display = 'block';
      setStatus('2 câmaras RTSP ativas (entrada/saída)');
      configureCanvas();
      await refreshCameraSelectSafely();
      startSnapshotLoop();
      return;
    }

    if (cameraConfig.mode === 'rtsp' && cameraConfig.networkUrl) {
      addRtspLog('Pedido de ligação', cameraConfig.networkUrl);
      const response = await fetch('/api/rtsp/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cameraConfig.networkUrl })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ? `rtsp_session_error:${payload.error}` : 'rtsp_session_error');
      }
      const payload = await response.json();
      activeRtspSessionId = payload.sessionId;
      addRtspLog('Sessão iniciada', activeRtspSessionId);
      rtspLastFrameAt = 0;
      rtspLastFrameProgressAt = Date.now();
      video.srcObject = null;
      video.removeAttribute('src');
      video.style.display = 'none';
      remotePreview.style.display = 'block';
      setRtspPreviewMessage('A ligar ao stream RTSP...');
      const streamUrl = `/api/rtsp/${activeRtspSessionId}/stream.mjpg?t=${Date.now()}`;
      remotePreview.onerror = () => {
        setRtspPreviewMessage('Falha ao receber stream RTSP. Verifique ligação de rede/credenciais.', true);
        addRtspLog('Falha no preview', 'Erro ao carregar stream MJPEG.');
        scheduleRtspPreviewRetry();
      };
      remotePreview.onload = () => {
        clearRtspPreviewRetry();
        addRtspLog('Preview ativo', 'Frames RTSP recebidos com sucesso.');
        updatePreviewStatus();
      };
      remotePreview.src = streamUrl;
      clearRtspStatusPoll();
      rtspStatusPollTimer = setInterval(updateRtspStatusFromServer, 3500);
      configureCanvas();
      await refreshCameraSelectSafely();
      startSnapshotLoop();
      setStatus('Câmara RTSP pronta');
      return;
    }

    if (cameraConfig.mode === 'network' && cameraConfig.networkUrl) {
      video.srcObject = null;
      video.src = cameraConfig.networkUrl;
      video.crossOrigin = 'anonymous';
      remotePreview.style.display = 'none';
      video.style.display = 'block';
      await video.play();
      configureCanvas();
      await refreshCameraSelectSafely();
      startSnapshotLoop();
      setStatus('Câmara de rede pronta');
      if (navigator.mediaDevices?.enumerateDevices) {
        renderDeviceList(await navigator.mediaDevices.enumerateDevices());
      }
      return;
    }

    video.removeAttribute('src');
    remotePreview.style.display = 'none';
    video.style.display = 'block';
    const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
    video.srcObject = stream;
    await video.play();
    configureCanvas();
    await refreshCameraSelectSafely();
    setStatus('Câmara pronta');
    if (navigator.mediaDevices?.enumerateDevices) {
      renderDeviceList(await navigator.mediaDevices.enumerateDevices());
    }
    startSnapshotLoop();
  } catch (error) {
    const code = error?.message || '';
    const rtspMode = cameraConfig.mode === 'rtsp';
    const networkMode = cameraConfig.mode === 'network';
    if (rtspMode && (code === 'invalid_rtsp_url' || code.startsWith('rtsp_session_error:invalid_rtsp_url'))) {
      addRtspLog('URL inválido', cameraConfig.networkUrl || 'URL RTSP vazio');
      setStatus('URL RTSP inválido. Use formato rtsp:// ou rtsps://utilizador:senha@ip:554/h264_stream', true);
      alert('URL RTSP inválido. Exemplo EZVIZ: rtsp://utilizador:senha@IP:554/h264_stream');
      return;
    }
    if (rtspMode || networkMode) {
      if (rtspMode) addRtspLog('Falha na ligação', code || 'Erro desconhecido');
      setStatus('Falha ao ligar à câmara de rede. Verifique IP/credenciais/caminho RTSP.', true);
      alert('Falha ao ligar à câmara de rede. Verifique IP, credenciais e caminho RTSP (ex: /h264_stream).');
      return;
    }
    if (cameraConfig.mode === 'dual-rtsp') {
      setStatus('Falha ao ligar às duas câmaras RTSP. Verifique os dois URLs.', true);
      return;
    }
    setStatus('Erro ao aceder à câmara local', true);
    alert('Não foi possível aceder à câmara local. Verifique permissões do navegador e use HTTPS/localhost.');
    throw error;
  }
};

const withinRoi = (det) => {
  const localSettings = getDeviceSettings(localDeviceId);
  if (!localSettings.roi) return true;
  const roi = normalizedRoiToPixels(localSettings.roi);
  if (!roi) return true;
  return det.cx >= roi.x && det.cx <= roi.x + roi.width && det.cy >= roi.y && det.cy <= roi.y + roi.height;
};

const withinEntryArea = (track) => {
  const localSettings = getDeviceSettings(localDeviceId);
  if (!localSettings.entryArea) return true;
  const area = normalizedAreaToPixels(localSettings.entryArea);
  if (!area) return true;
  return track.cx >= area.x && track.cx <= area.x + area.width && track.cy >= area.y && track.cy <= area.y + area.height;
};

const withinExitArea = (track) => {
  const localSettings = getDeviceSettings(localDeviceId);
  if (!localSettings.exitArea) return true;
  const area = normalizedAreaToPixels(localSettings.exitArea);
  if (!area) return true;
  return track.cx >= area.x && track.cx <= area.x + area.width && track.cy >= area.y && track.cy <= area.y + area.height;
};

const enteredArea = (track, areaNormalized) => {
  if (!areaNormalized || !track.history?.length) return false;
  const area = normalizedAreaToPixels(areaNormalized);
  if (!area) return false;
  const isInside = (point) =>
    point.x >= area.x &&
    point.x <= area.x + area.width &&
    point.y >= area.y &&
    point.y <= area.y + area.height;
  const current = track.history[track.history.length - 1];
  if (!current) return false;

  const wasEverInside = track.history.slice(0, -1).some((point) => isInside(point));
  if (!wasEverInside && isInside(current)) {
    return true;
  }

  const previous = track.history[track.history.length - 2];
  if (!previous) return false;
  return !isInside(previous) && isInside(current);
};

const pruneOldExitEvents = (nowMs) => {
  while (recentExitEvents.length && nowMs - recentExitEvents[0].time > EXIT_EVENT_DEDUP_MS) {
    recentExitEvents.shift();
  }
};

const shouldSkipDuplicateExit = (track, nowMs) => {
  pruneOldExitEvents(nowMs);
  return recentExitEvents.some((event) => {
    const distance = Math.hypot(track.cx - event.cx, track.cy - event.cy);
    return distance <= EXIT_EVENT_DEDUP_DISTANCE_PX;
  });
};

const registerExitEvent = (track, nowMs) => {
  recentExitEvents.push({ cx: track.cx, cy: track.cy, time: nowMs });
  pruneOldExitEvents(nowMs);
};

const handlePlateCheck = (track, direction, fallbackTicket = null, source = getCurrentVisionSource()) => {
  if (!plateReady) {
    setPlateStatus('OCR indisponível');
    return;
  }
  const key = `${track.id}-${direction}`;
  if (plateChecks.has(key)) return;
  plateChecks.set(key, { status: 'pending' });
  const cropRegion = getPlateCropRegion(track, source);
  upsertOcrIndicator(key, cropRegion, 'OCR: a captar');
  const cropCanvas = capturePlateCanvas(track, source);
  if (!cropCanvas) {
    setPlateStatus('Recorte indisponível');
    plateChecks.set(key, { status: 'no-crop' });
    removeOcrIndicator(key);
    return;
  }
  setPlateStatus('A reconhecer...', '...');
  upsertOcrIndicator(key, cropRegion, 'OCR: a reconhecer');
  queuePlateTask(async () => {
    let rawText = await recognizePlateFromCanvas(cropCanvas);
    let plate = extractPlateCandidate(rawText);
    if (!plate) {
      const invertedCanvas = createInvertedCanvas(cropCanvas);
      if (invertedCanvas) {
        const invertedText = await recognizePlateFromCanvas(invertedCanvas);
        rawText = `${rawText}\n${invertedText}`.trim();
        plate = extractPlateCandidate(rawText);
      }
    }
    if (!plate) {
      setPlateStatus('Matrícula não detetada', '-');
      plateChecks.set(key, { status: 'miss' });
      upsertOcrIndicator(key, cropRegion, 'OCR: sem leitura');
      return;
    }
    const isPriority = isPriorityPlate(plate);
    setPlateStatus(isPriority ? 'Prioritária' : 'Detetada', plate);
    upsertOcrIndicator(key, cropRegion, `OCR: ${plate}`);
    addLog({
      time: new Date().toLocaleTimeString(),
      type: 'Matrícula detetada',
      detail: `${plate} (${direction})`
    });
    if (direction === 'entrada') {
      const ticketToRemember = fallbackTicket || track.vehicleTicket || issueVehicleTicket();
      track.vehicleTicket = ticketToRemember;
      plateToVehicleTicket.set(plate, ticketToRemember);
    } else if (direction === 'saida') {
      const rememberedTicket = plateToVehicleTicket.get(plate) || fallbackTicket || track.vehicleTicket || getNextActiveVehicleTicket();
      if (rememberedTicket) {
        releaseActiveVehicleTicket(rememberedTicket);
        plateToVehicleTicket.delete(plate);
        addLog({
          time: new Date().toLocaleTimeString(),
          type: 'Saída associada',
          detail: `${rememberedTicket} · ${plate}`
        });
      }
    }
    if (isPriority) {
      if (direction === 'entrada') {
        config.counts.priorityAdjustments += 1;
        addLog({ time: new Date().toLocaleTimeString(), type: 'Prioritária detetada', detail: plate });
      } else if (direction === 'saida') {
        config.counts.priorityAdjustments = Math.max(0, config.counts.priorityAdjustments - 1);
        addLog({ time: new Date().toLocaleTimeString(), type: 'Prioritária saída', detail: plate });
      }
    }
    plateChecks.set(key, { status: 'done', plate, isPriority });
    persistConfig();
  });
};

const processFrame = async () => {
  if (!counting) return;
  const nowMs = Date.now();
  const localSettings = getDeviceSettings(localDeviceId);
  const entryLine = normalizedLineToPixels(localSettings.lines.entry);
  const exitLine = normalizedLineToPixels(localSettings.lines.exit);

  const processDirectionalTracks = (tracks, direction, source) => {
    tracks.forEach((track) => {
      if (direction === 'entry') {
        const crossedEntryLine =
          entryLine && withinEntryArea(track) && detectCrossing({ line: entryLine, track, lineKey: 'entry' });
        const enteredEntryArea = localSettings.entryArea && enteredArea(track, localSettings.entryArea);
        if ((crossedEntryLine || enteredEntryArea) && !track.counted?.entry) {
          track.counted.entry = true;
          const symbolKey = `${track.id}-entry`;
          const symbolResult = detectSymbolOnTrack(track, source);
          upsertSymbolIndicator(symbolKey, track, symbolResult.recognized, symbolResult.similarity);
          if (symbolResult.checked && symbolResult.recognized && config.symbolDetection.mode === 'exclude') {
            addLog({
              time: new Date().toLocaleTimeString(),
              type: 'Entrada excluída por símbolo',
              detail: `#${track.id}`
            });
            return;
          }
          const vehicleTicket = track.vehicleTicket || issueVehicleTicket();
          track.vehicleTicket = vehicleTicket;
          rememberActiveVehicleTicket(vehicleTicket);
          config.counts.entries += 1;
          if (classifyVehicleType(track) === 'motorcycle') {
            config.counts.motorcycleEntries += 1;
          } else {
            config.counts.carEntries += 1;
          }
          addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada', detail: `${vehicleTicket} · #${track.id}` });
          playEventSound('entry');
          handlePlateCheck(track, 'entrada', vehicleTicket, source);
        }
      } else {
        const crossedExitLine =
          exitLine && withinExitArea(track) && detectCrossing({ line: exitLine, track, lineKey: 'exit' });
        const enteredExitArea = localSettings.exitArea && enteredArea(track, localSettings.exitArea);
        const duplicateExit = shouldSkipDuplicateExit(track, nowMs);
        if ((crossedExitLine || enteredExitArea) && !track.counted?.exit && !duplicateExit) {
          track.counted.exit = true;
          const symbolKey = `${track.id}-exit`;
          const symbolResult = detectSymbolOnTrack(track, source);
          upsertSymbolIndicator(symbolKey, track, symbolResult.recognized, symbolResult.similarity);
          if (symbolResult.checked && symbolResult.recognized && config.symbolDetection.mode === 'exclude') {
            registerExitEvent(track, nowMs);
            addLog({
              time: new Date().toLocaleTimeString(),
              type: 'Saída excluída por símbolo',
              detail: `#${track.id}`
            });
            return;
          }
          const vehicleTicket = track.vehicleTicket || getNextActiveVehicleTicket() || issueVehicleTicket();
          track.vehicleTicket = vehicleTicket;
          releaseActiveVehicleTicket(vehicleTicket);
          config.counts.exits += 1;
          if (classifyVehicleType(track) === 'motorcycle') {
            config.counts.motorcycleExits += 1;
          } else {
            config.counts.carExits += 1;
          }
          registerExitEvent(track, nowMs);
          addLog({ time: new Date().toLocaleTimeString(), type: 'Saída', detail: `${vehicleTicket} · #${track.id}` });
          playEventSound('exit');
          handlePlateCheck(track, 'saida', vehicleTicket, source);
        }
      }
    });
  };

  if (isDualRtspMode()) {
    const frame = Date.now();
    const entrySource = dualEntryPreview;
    const exitSource = dualExitPreview;
    if (!entrySource?.naturalWidth || !exitSource?.naturalWidth) return;
    const [entryDetections, exitDetections] = await Promise.all([
      detectVehicles(entrySource, { minScore: 0.55 }),
      detectVehicles(exitSource, { minScore: 0.55 })
    ]);
    const entryTracks = dualTrackers.entry.update(entryDetections.filter(withinRoi).map((det) => ({ ...det, frame })));
    const exitTracks = dualTrackers.exit.update(exitDetections.filter(withinRoi).map((det) => ({ ...det, frame })));
    processDirectionalTracks(entryTracks, 'entry', entrySource);
    processDirectionalTracks(exitTracks, 'exit', exitSource);
    drawOverlay(config.camera.dualRtsp.previewChannel === 'exit' ? exitTracks : entryTracks);
  } else {
    const source = getCurrentVisionSource();
    if (!source) return;
    const detections = await detectVehicles(source, { minScore: 0.55 });
    const frame = Date.now();
    const filtered = detections.filter(withinRoi).map((det) => ({ ...det, frame }));
    const tracks = tracker.update(filtered);
    processDirectionalTracks(tracks, 'entry', source);
    processDirectionalTracks(tracks, 'exit', source);
    drawOverlay(tracks);
  }
  persistConfig();
};

const getCurrentVisionSource = () => {
  if (config.camera?.mode === 'rtsp') return remotePreview;
  if (config.camera?.mode === 'dual-rtsp') return config.camera?.dualRtsp?.previewChannel === 'exit' ? dualExitPreview : dualEntryPreview;
  return video;
};

const loop = async () => {
  const fps = Math.max(1, Number(fpsSelect.value) || 15);
  const interval = 1000 / fps;
  await processFrame();
  animationHandle = setTimeout(loop, interval);
};

const stopLoop = () => {
  if (animationHandle) {
    clearTimeout(animationHandle);
    animationHandle = null;
  }
};

const toggleCounting = async () => {
  if (activePreviewMode === 'remote') {
    setStatus('Contagem disponível apenas no dispositivo local.', true);
    return;
  }
  if (counting) {
    counting = false;
    toggleCountingBtn.textContent = 'Iniciar Contagem';
    stopLoop();
    return;
  }

  try {
    if (!hasLocalFeed()) {
      await startCamera();
    }
    await initVision();
    try {
      await initPlateRecognition();
      plateReady = true;
      setPlateStatus('OCR pronto');
    } catch (error) {
      console.warn('OCR indisponível.', error);
      plateReady = false;
      setPlateStatus('OCR indisponível');
    }
    counting = true;
    ensureAudioContext();
    toggleCountingBtn.textContent = 'Parar';
    loop();
  } catch (error) {
    console.error(error);
  }
};

const clearDrawing = () => {
  drawingMode = null;
  drawingLine = null;
  roiDrawing = null;
  overlay.style.pointerEvents = 'none';
  overlay.style.touchAction = 'auto';
  drawOverlay();
};

const setupDrawing = (mode) => {
  drawingMode = mode;
  drawingLine = null;
  roiDrawing = null;
  overlay.style.pointerEvents = 'auto';
  overlay.style.touchAction = 'none';
};

let activePointerId = null;

const finalizeDrawing = () => {
  if (!drawingMode) return;
  const activeDeviceId = getActiveDeviceId();
  const activeSettings = activeDeviceId ? getDeviceSettings(activeDeviceId) : null;
  if ((drawingMode === 'roi' || drawingMode === 'entryArea' || drawingMode === 'exitArea') && roiDrawing) {
    const normalizedStart = toNormalized({ x: roiDrawing.x, y: roiDrawing.y });
    const normalizedEnd = toNormalized({ x: roiDrawing.x + roiDrawing.width, y: roiDrawing.y + roiDrawing.height });
    const x = Math.min(normalizedStart.x, normalizedEnd.x);
    const y = Math.min(normalizedStart.y, normalizedEnd.y);
    const width = Math.abs(normalizedEnd.x - normalizedStart.x);
    const height = Math.abs(normalizedEnd.y - normalizedStart.y);
    if (activeSettings) {
      if (drawingMode === 'roi') {
        activeSettings.roi = { x, y, width, height };
      } else if (drawingMode === 'entryArea') {
        activeSettings.entryArea = { x, y, width, height };
      } else {
        activeSettings.exitArea = { x, y, width, height };
      }
    }
  }
  if ((drawingMode === 'entry' || drawingMode === 'exit') && drawingLine) {
    const start = toNormalized(drawingLine.start);
    const end = toNormalized(drawingLine.end);
    const line = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    if (activeSettings) {
      if (drawingMode === 'entry') {
        activeSettings.lines.entry = line;
      } else {
        activeSettings.lines.exit = line;
      }
    }
  }
  if (activeDeviceId && activeSettings) {
    setDeviceSettings(activeDeviceId, activeSettings);
  }
  persistConfig();
  clearDrawing();
};

overlay.addEventListener('pointerdown', (event) => {
  if (!drawingMode) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  overlay.setPointerCapture(activePointerId);
  const start = toCanvasPoint(event);
  if (drawingMode === 'roi' || drawingMode === 'entryArea' || drawingMode === 'exitArea') {
    roiDrawing = { x: start.x, y: start.y, width: 0, height: 0 };
  } else {
    drawingLine = { start, end: start };
  }
});

overlay.addEventListener('pointermove', (event) => {
  if (!drawingMode || activePointerId !== event.pointerId) return;
  event.preventDefault();
  const point = toCanvasPoint(event);
  if ((drawingMode === 'roi' || drawingMode === 'entryArea' || drawingMode === 'exitArea') && roiDrawing) {
    roiDrawing.width = point.x - roiDrawing.x;
    roiDrawing.height = point.y - roiDrawing.y;
  }
  if ((drawingMode === 'entry' || drawingMode === 'exit') && drawingLine) {
    drawingLine.end = point;
  }
  drawOverlay();
});

const releasePointer = (event) => {
  if (activePointerId !== event.pointerId) return;
  event.preventDefault();
  overlay.releasePointerCapture(activePointerId);
  activePointerId = null;
  finalizeDrawing();
};

overlay.addEventListener('pointerup', releasePointer);
overlay.addEventListener('pointercancel', releasePointer);

setEntryLineBtn.addEventListener('click', () => setupDrawing('entry'));
setExitLineBtn.addEventListener('click', () => setupDrawing('exit'));
setRoiBtn.addEventListener('click', () => setupDrawing('roi'));
if (setEntryAreaBtn) {
  setEntryAreaBtn.addEventListener('click', () => setupDrawing('entryArea'));
}
if (setExitAreaBtn) {
  setExitAreaBtn.addEventListener('click', () => setupDrawing('exitArea'));
}

if (toggleFullscreenBtn) {
  toggleFullscreenBtn.addEventListener('click', async () => {
    try {
      if (isVideoFullscreen()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } else if (videoWrapper.requestFullscreen) {
        await videoWrapper.requestFullscreen();
      } else if (videoWrapper.webkitRequestFullscreen) {
        videoWrapper.webkitRequestFullscreen();
      }
    } catch (error) {
      console.warn('Não foi possível alternar para ecrã inteiro.', error);
    } finally {
      updateFullscreenButtonLabel();
    }
  });
}

toggleCountingBtn.addEventListener('click', toggleCounting);

if (startPreviewBtn) {
  startPreviewBtn.addEventListener('click', async () => {
    try {
      await startCamera();
    } catch (error) {
      console.error(error);
    }
  });
}

resetCountsBtn.addEventListener('click', () => {
  config.counts.entries = 0;
  config.counts.exits = 0;
  config.counts.carEntries = 0;
  config.counts.carExits = 0;
  config.counts.motorcycleEntries = 0;
  config.counts.motorcycleExits = 0;
  config.counts.priorityAdjustments = 0;
  config.counts.mrCount = 0;
  config.log = [];
  setPlateStatus('Aguardando deteção', '-');
  persistConfig();
});

manualEntriesInput?.addEventListener('change', () => {
  const value = Number.parseInt(manualEntriesInput.value, 10);
  config.counts.entries = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (config.counts.exits > config.counts.entries) {
    config.counts.exits = config.counts.entries;
    if (manualExitsInput) manualExitsInput.value = String(config.counts.exits);
  }
  addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada manual', detail: String(config.counts.entries) });
  persistConfig();
});

manualExitsInput?.addEventListener('change', () => {
  const value = Number.parseInt(manualExitsInput.value, 10);
  const requestedExits = Number.isFinite(value) ? Math.max(0, value) : 0;
  const maxExits = Math.max(0, config.counts.entries - config.counts.priorityAdjustments);
  config.counts.exits = Math.min(requestedExits, maxExits);
  manualExitsInput.value = String(config.counts.exits);
  addLog({ time: new Date().toLocaleTimeString(), type: 'Saída manual', detail: String(config.counts.exits) });
  persistConfig();
});

bindManualMetric(entriesMetricEl, incrementEntriesManually);
bindManualMetric(exitsMetricEl, incrementExitsManually);
fsAddEntryBtn?.addEventListener('click', incrementEntriesManually);
fsAddExitBtn?.addEventListener('click', incrementExitsManually);

applyRemainingSlotsBtn?.addEventListener('click', () => {
  const normalCapacity = config.capacity?.normal ?? DEFAULT_NORMAL_CAPACITY;
  const value = Number.parseInt(manualRemainingSlotsInput?.value ?? '', 10);
  const requestedRemainingSlots = Number.isFinite(value) ? value : normalCapacity;
  const remainingSlots = Math.max(0, Math.min(normalCapacity, requestedRemainingSlots));
  const targetOccupancyNormal = normalCapacity - remainingSlots;
  const targetOccupancyMR = Math.min(config.counts.mrCount, maxMR);
  const targetOccupancy = targetOccupancyNormal + targetOccupancyMR;
  const requiredEntries = config.counts.exits + config.counts.priorityAdjustments + targetOccupancy;

  config.counts.entries = Math.max(0, requiredEntries);
  config.counts.carEntries = config.counts.entries;
  config.counts.motorcycleEntries = 0;

  addLog({
    time: new Date().toLocaleTimeString(),
    type: 'Lugares vazios',
    detail: String(remainingSlots)
  });
  persistConfig();
});

applyParkCapacityBtn?.addEventListener('click', () => {
  const value = Number.parseInt(parkCapacityInput?.value ?? '', 10);
  const capacity = Number.isFinite(value) ? Math.max(1, value) : DEFAULT_NORMAL_CAPACITY;
  config.capacity.normal = capacity;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Capacidade', detail: String(capacity) });
  persistConfig();
});

addPriorityBtn.addEventListener('click', () => {
  config.counts.priorityAdjustments += 1;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Prioritária', detail: '+1' });
  persistConfig();
});

removePriorityBtn.addEventListener('click', () => {
  config.counts.priorityAdjustments = Math.max(0, config.counts.priorityAdjustments - 1);
  addLog({ time: new Date().toLocaleTimeString(), type: 'Prioritária', detail: '-1' });
  persistConfig();
});

addMRBtn.addEventListener('click', () => {
  config.counts.mrCount = Math.min(maxMR, config.counts.mrCount + 1);
  addLog({ time: new Date().toLocaleTimeString(), type: 'MR', detail: '+1' });
  persistConfig();
});

removeMRBtn.addEventListener('click', () => {
  config.counts.mrCount = Math.max(0, config.counts.mrCount - 1);
  addLog({ time: new Date().toLocaleTimeString(), type: 'MR', detail: '-1' });
  persistConfig();
});

priorityAddBtn.addEventListener('click', () => {
  const value = priorityInput.value.trim();
  if (!value) return;
  config.priorityVehicles.push(value);
  priorityInput.value = '';
  persistConfig();
});

symbolDetectionEnabledInput?.addEventListener('change', () => {
  ensureSymbolDetectionDefaults();
  config.symbolDetection.enabled = Boolean(symbolDetectionEnabledInput.checked);
  addLog({
    time: new Date().toLocaleTimeString(),
    type: 'Deteção de símbolo',
    detail: config.symbolDetection.enabled ? 'ativada' : 'desativada'
  });
  persistConfig();
});

symbolDetectionModeSelect?.addEventListener('change', () => {
  ensureSymbolDetectionDefaults();
  config.symbolDetection.mode = symbolDetectionModeSelect.value === 'exclude' ? 'exclude' : 'count';
  addLog({
    time: new Date().toLocaleTimeString(),
    type: 'Modo símbolo',
    detail: config.symbolDetection.mode === 'exclude' ? 'excluir' : 'contar'
  });
  persistConfig();
});

symbolTemplateFileInput?.addEventListener('change', async () => {
  const file = symbolTemplateFileInput.files?.[0];
  if (!file) return;
  const isBmp = file.type === 'image/bmp' || file.name.toLowerCase().endsWith('.bmp');
  if (!isBmp) {
    addLog({ time: new Date().toLocaleTimeString(), type: 'Símbolo', detail: 'Ficheiro inválido (use BMP).' });
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result ?? '');
    const ok = await loadSymbolTemplateFromDataUrl(dataUrl);
    if (!ok) {
      addLog({ time: new Date().toLocaleTimeString(), type: 'Símbolo', detail: 'Falha a ler BMP.' });
      return;
    }
    ensureSymbolDetectionDefaults();
    config.symbolDetection.templateName = file.name;
    config.symbolDetection.templateDataUrl = dataUrl;
    if (symbolTemplateNameInput) symbolTemplateNameInput.value = file.name;
    addLog({ time: new Date().toLocaleTimeString(), type: 'Símbolo carregado', detail: file.name });
    persistConfig();
  };
  reader.readAsDataURL(file);
});

resolutionSelect.addEventListener('change', async () => {
  if (hasLocalFeed()) {
    await startCamera();
  }
});

cameraSelect.addEventListener('change', async () => {
  const value = cameraSelect.value;
  const previousUrl = config.camera?.networkUrl ?? '';
  if (value.startsWith('device:')) {
    config.camera = { mode: 'device', deviceId: value.replace('device:', ''), networkUrl: '' };
  } else if (value === 'user' || value === 'environment') {
    config.camera = { mode: value, deviceId: null, networkUrl: '' };
  } else if (value === 'network' || value === 'rtsp') {
    config.camera = { mode: value, deviceId: null, networkUrl: previousUrl };
  } else if (value === 'dual-rtsp') {
    config.camera = {
      mode: 'dual-rtsp',
      deviceId: null,
      networkUrl: '',
      dualRtsp: {
        enabled: true,
        entryUrl: entryRtspUrlInput?.value?.trim() ?? config.camera?.dualRtsp?.entryUrl ?? '',
        exitUrl: exitRtspUrlInput?.value?.trim() ?? config.camera?.dualRtsp?.exitUrl ?? '',
        previewChannel: dualPreviewChannelSelect?.value === 'exit' ? 'exit' : 'entry'
      }
    };
  } else {
    config.camera = { mode: 'auto', deviceId: null, networkUrl: '' };
  }
  persistConfig();
  if (cameraStatus) {
    const selectedOption = cameraSelect.options[cameraSelect.selectedIndex];
    cameraStatus.textContent = selectedOption ? selectedOption.textContent : 'Automática';
  }
  if ((value === 'network' || value === 'rtsp') && !config.camera.networkUrl) {
    setStatus('Defina o endereço da câmara de rede/RTSP.', true);
    return;
  }
  if (value === 'dual-rtsp' && (!config.camera.dualRtsp?.entryUrl || !config.camera.dualRtsp?.exitUrl)) {
    setStatus('Defina os dois URLs RTSP (entrada e saída).', true);
    return;
  }
  if (hasLocalFeed() || value !== 'auto') {
    await startCamera();
  }
});

if (refreshCamerasBtn) {
  refreshCamerasBtn.addEventListener('click', async () => {
    await updateCameraSelect();
  });
}


if (setNetworkCameraBtn) {
  setNetworkCameraBtn.addEventListener('click', async () => {
    const url = networkCameraUrlInput?.value?.trim() ?? '';
    if (!url) {
      setStatus('Insira um endereço de rede válido.', true);
      return;
    }
    const isRtsp = url.toLowerCase().startsWith('rtsp://');
    config.camera = { mode: isRtsp ? 'rtsp' : 'network', deviceId: null, networkUrl: url };
    cameraSelect.value = isRtsp ? 'rtsp' : 'network';
    if (cameraStatus) {
      cameraStatus.textContent = isRtsp ? 'RTSP' : 'Endereço de rede (HTTP)';
    }
    persistConfig();
    await startCamera();
  });
}

if (setDualRtspBtn) {
  setDualRtspBtn.addEventListener('click', async () => {
    const entryUrl = entryRtspUrlInput?.value?.trim() ?? '';
    const exitUrl = exitRtspUrlInput?.value?.trim() ?? '';
    if (!entryUrl || !exitUrl) {
      setStatus('Preencha os dois URLs RTSP: entrada e saída.', true);
      return;
    }
    config.camera = {
      mode: 'dual-rtsp',
      deviceId: null,
      networkUrl: '',
      dualRtsp: {
        enabled: true,
        entryUrl,
        exitUrl,
        previewChannel: dualPreviewChannelSelect?.value === 'exit' ? 'exit' : 'entry'
      }
    };
    if (cameraSelect) cameraSelect.value = 'dual-rtsp';
    if (cameraStatus) cameraStatus.textContent = '2x RTSP (entrada + saída)';
    persistConfig();
    await startCamera();
  });
}

dualPreviewChannelSelect?.addEventListener('change', () => {
  if (!config.camera?.dualRtsp) return;
  const channel = dualPreviewChannelSelect.value === 'exit' ? 'exit' : 'entry';
  config.camera.dualRtsp.previewChannel = channel;
  persistConfig();
  if (isDualRtspMode() && dualRtspSessions[channel]) {
    remotePreview.src = `/api/rtsp/${dualRtspSessions[channel]}/stream.mjpg?t=${Date.now()}`;
  }
});


const handleViewportChange = () => {
  configureCanvas();
  const currentOrientation = isLandscape();
  if (currentOrientation === lastOrientation) return;
  lastOrientation = currentOrientation;
  if (!hasLocalFeed() || activePreviewMode !== 'local') return;
  if (orientationChangeTimeout) clearTimeout(orientationChangeTimeout);
  orientationChangeTimeout = setTimeout(async () => {
    try {
      await startCamera();
    } catch (error) {
      console.warn('Falha ao atualizar a orientação da câmara.', error);
    }
  }, 150);
};

window.addEventListener('resize', handleViewportChange);
window.addEventListener('orientationchange', handleViewportChange);
if (screen.orientation?.addEventListener) {
  screen.orientation.addEventListener('change', handleViewportChange);
}

document.addEventListener('fullscreenchange', updateFullscreenButtonLabel);
document.addEventListener('webkitfullscreenchange', updateFullscreenButtonLabel);
if (remotePreview) {
  remotePreview.addEventListener('load', configureCanvas);
}

if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {
      console.warn('Service worker não foi registado.');
    });
  });
}

loadConfig().then(() => {
  renderRtspLog();
  if (networkCameraUrlInput) {
    networkCameraUrlInput.value = config.camera?.networkUrl ?? '';
  }
  updateCountsUI();
  updateLineStatus();
  updateFullscreenButtonLabel();
  updateCameraSelect();
  fetchRemoteDevices();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', updateCameraSelect);
}

registerDevice();
setInterval(sendHeartbeat, 10000);
setInterval(fetchRemoteDevices, 5000);
