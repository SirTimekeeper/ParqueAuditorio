import { defaultConfig, loadLocalConfig, saveLocalConfig, fetchServerConfig, saveServerConfig } from './config.js';
import { SimpleTracker } from './tracker.js';
import { detectCrossing } from './counter.js';
import { initVision, detectVehicles, initPlateRecognition, recognizePlateFromCanvas } from './vision.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');
const remotePreview = document.getElementById('remotePreview');
const previewStatus = document.getElementById('previewStatus');
const videoWrapper = document.querySelector('.video-wrapper');

const entriesEl = document.getElementById('entries');
const exitsEl = document.getElementById('exits');
const occupancyEl = document.getElementById('occupancy');
const occupancyNormalEl = document.getElementById('occupancyNormal');
const occupancyMREl = document.getElementById('occupancyMR');
const remainingSlotsEl = document.getElementById('remainingSlots');
const warningFull = document.getElementById('warningFull');
const warningMR = document.getElementById('warningMR');
const deviceList = document.getElementById('deviceList');
const remoteDeviceList = document.getElementById('remoteDeviceList');
const entryLineStatus = document.getElementById('entryLineStatus');
const exitLineStatus = document.getElementById('exitLineStatus');

const setEntryLineBtn = document.getElementById('setEntryLine');
const setExitLineBtn = document.getElementById('setExitLine');
const setRoiBtn = document.getElementById('setRoi');
const startPreviewBtn = document.getElementById('startPreview');
const toggleCountingBtn = document.getElementById('toggleCounting');
const resetCountsBtn = document.getElementById('resetCounts');
const addEntryBtn = document.getElementById('addEntry');
const addExitBtn = document.getElementById('addExit');

const addPriorityBtn = document.getElementById('addPriority');
const removePriorityBtn = document.getElementById('removePriority');
const addMRBtn = document.getElementById('addMR');
const removeMRBtn = document.getElementById('removeMR');

const priorityInput = document.getElementById('priorityInput');
const priorityAddBtn = document.getElementById('priorityAdd');
const priorityList = document.getElementById('priorityList');
const logList = document.getElementById('log');
const lastPlateEl = document.getElementById('lastPlate');
const plateStatusEl = document.getElementById('plateStatus');

const resolutionSelect = document.getElementById('resolutionSelect');
const fpsSelect = document.getElementById('fpsSelect');
const cameraSelect = document.getElementById('cameraSelect');
const cameraStatus = document.getElementById('cameraStatus');
const refreshCamerasBtn = document.getElementById('refreshCameras');
const networkCameraUrlInput = document.getElementById('networkCameraUrl');
const setNetworkCameraBtn = document.getElementById('setNetworkCamera');

const tracker = new SimpleTracker();

const DEVICE_ID_KEY = 'parque-auditorio-device-id';
const getOrCreateDeviceId = () => {
  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const generated = crypto?.randomUUID?.() ?? `device-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

const localDeviceId = getOrCreateDeviceId();
const localDeviceLabel = navigator.userAgentData?.platform || navigator.platform || 'Dispositivo local';

let config = { ...defaultConfig };
let counting = false;
let drawingMode = null;
let drawingLine = null;
let roiDrawing = null;
let animationHandle = null;
let snapshotInterval = null;
let remoteSnapshotInterval = null;
let activePreviewMode = 'local';
let selectedRemoteDevice = null;
let lastOrientation = null;
let orientationChangeTimeout = null;
let plateReady = false;
let plateQueue = Promise.resolve();
const plateChecks = new Map();

const maxNormal = 112;
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
      roi: null
    }
  );
};

const setDeviceSettings = (deviceId, settings) => {
  ensureDeviceSettings(config);
  config.deviceSettings[deviceId] = settings;
  if (deviceId === localDeviceId) {
    config.lines = settings.lines;
    config.roi = settings.roi;
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

const normalizePlateValue = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const extractPlateCandidate = (rawText) => {
  if (!rawText) return '';
  const matches = rawText.toUpperCase().match(/[A-Z0-9]{5,8}/g) ?? [];
  if (matches.length) {
    return matches.sort((a, b) => b.length - a.length)[0];
  }
  const normalized = normalizePlateValue(rawText);
  if (normalized.length >= 5 && normalized.length <= 8) return normalized;
  return '';
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

const capturePlateCanvas = (track) => {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = 2;
  const plateHeight = track.height * 0.35;
  const plateY = track.y + track.height * 0.55;
  const plateX = track.x;
  const plateWidth = track.width;
  const cropX = Math.max(0, Math.floor(plateX));
  const cropY = Math.max(0, Math.floor(plateY));
  const cropWidth = Math.min(video.videoWidth - cropX, Math.floor(plateWidth));
  const cropHeight = Math.min(video.videoHeight - cropY, Math.floor(plateHeight));
  if (cropWidth <= 0 || cropHeight <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cropWidth * scale));
  canvas.height = Math.max(1, Math.floor(cropHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
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

const addLog = (entry) => {
  config.log = [entry, ...config.log].slice(0, 40);
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
};

const updateCountsUI = () => {
  entriesEl.textContent = config.counts.entries;
  exitsEl.textContent = config.counts.exits;

  const rawOccupancy = config.counts.entries - config.counts.exits - config.counts.priorityAdjustments;
  const occupancy = Math.max(0, rawOccupancy);
  const occupancyMR = Math.min(config.counts.mrCount, occupancy, maxMR);
  const occupancyNormal = Math.max(0, occupancy - occupancyMR);
  const remainingSlots = Math.max(0, maxNormal - occupancyNormal);

  occupancyEl.textContent = occupancy;
  occupancyNormalEl.textContent = occupancyNormal;
  occupancyMREl.textContent = occupancyMR;
  if (remainingSlotsEl) remainingSlotsEl.textContent = remainingSlots;

  warningFull.classList.toggle('active', occupancyNormal >= maxNormal);
  warningMR.classList.toggle('active', occupancyMR >= maxMR);
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
  if (!merged.deviceSettings[localDeviceId] && (merged.lines || merged.roi)) {
    merged.deviceSettings[localDeviceId] = {
      lines: merged.lines ?? { entry: null, exit: null },
      roi: merged.roi ?? null
    };
  }
  if (!merged.deviceSettings[localDeviceId]) {
    merged.deviceSettings[localDeviceId] = {
      lines: { entry: null, exit: null },
      roi: null
    };
  }
  config = merged;
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

  const activeDeviceId = getActiveDeviceId();
  const activeSettings = activeDeviceId ? getDeviceSettings(activeDeviceId) : null;
  const entryLine = normalizedLineToPixels(activeSettings?.lines?.entry);
  const exitLine = normalizedLineToPixels(activeSettings?.lines?.exit);
  const roi = normalizedRoiToPixels(activeSettings?.roi);

  if (roi) {
    ctx.strokeStyle = 'rgba(36, 87, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
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

  if (drawingMode === 'roi' && roiDrawing) {
    ctx.strokeStyle = 'rgba(36, 87, 255, 0.8)';
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
    renderRemoteDevices(payload.devices ?? []);
  } catch (error) {
    console.warn('Falha ao carregar dispositivos remotos.', error);
  }
};

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
    { value: 'network', label: 'Endereço de rede' }
  ].forEach((item) => cameraSelect.appendChild(buildCameraOption(item.value, item.label)));

  cameras.forEach((camera, index) => {
    const label = camera.label || `Câmara ${index + 1}`;
    cameraSelect.appendChild(buildCameraOption(`device:${camera.deviceId}`, label));
  });

  const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null };
  let targetValue = 'auto';
  if (cameraConfig.mode === 'device' && cameraConfig.deviceId && availableIds.includes(cameraConfig.deviceId)) {
    targetValue = `device:${cameraConfig.deviceId}`;
  } else if (cameraConfig.mode === 'user' || cameraConfig.mode === 'environment' || cameraConfig.mode === 'network') {
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

const registerDevice = async () => {
  try {
    await fetch('/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: localDeviceId, label: localDeviceLabel })
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
      body: JSON.stringify({ id: localDeviceId })
    });
  } catch (error) {
    console.warn('Falha ao atualizar presença.', error);
  }
};

const snapshotCanvas = document.createElement('canvas');
const snapshotContext = snapshotCanvas.getContext('2d');

const sendSnapshot = async () => {
  if (!video.srcObject || !video.videoWidth) return;
  snapshotCanvas.width = video.videoWidth;
  snapshotCanvas.height = video.videoHeight;
  snapshotContext.drawImage(video, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
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

const showLocalPreview = () => {
  activePreviewMode = 'local';
  selectedRemoteDevice = null;
  if (remoteSnapshotInterval) {
    clearInterval(remoteSnapshotInterval);
    remoteSnapshotInterval = null;
  }
  remotePreview.style.display = 'none';
  video.style.display = 'block';
  updatePreviewStatus();
  setControlsDisabled(false);
  updateLineStatus();
  configureCanvas();
};

const fetchRemoteSnapshot = async (deviceId) => {
  try {
    const response = await fetch(`/api/devices/${deviceId}/snapshot`);
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.image) {
      remotePreview.src = payload.image;
    }
  } catch (error) {
    console.warn('Falha ao obter imagem remota.', error);
  }
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
  updatePreviewStatus();
  updateLineStatus();
  fetchRemoteSnapshot(device.id);
  if (remoteSnapshotInterval) clearInterval(remoteSnapshotInterval);
  remoteSnapshotInterval = setInterval(() => fetchRemoteSnapshot(device.id), 3000);
};

const startCamera = async () => {
  try {
    if (activePreviewMode !== 'local') {
      showLocalPreview();
    }
    stopCamera();
    const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null, networkUrl: '' };

    if (cameraConfig.mode === 'network' && cameraConfig.networkUrl) {
      video.srcObject = null;
      video.src = cameraConfig.networkUrl;
      video.crossOrigin = 'anonymous';
      await video.play();
      configureCanvas();
      await updateCameraSelect();
      setStatus('Câmara de rede pronta');
      renderDeviceList(await navigator.mediaDevices.enumerateDevices());
      return;
    }

    video.removeAttribute('src');
    const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
    video.srcObject = stream;
    await video.play();
    configureCanvas();
    await updateCameraSelect();
    setStatus('Câmara pronta');
    renderDeviceList(await navigator.mediaDevices.enumerateDevices());
    startSnapshotLoop();
  } catch (error) {
    setStatus('Erro ao aceder à câmara', true);
    alert('Não foi possível aceder à câmara. Verifique permissões, URL da câmara de rede ou use HTTPS/localhost.');
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

const handlePlateCheck = (track, direction) => {
  if (!plateReady) {
    setPlateStatus('OCR indisponível');
    return;
  }
  const key = `${track.id}-${direction}`;
  if (plateChecks.has(key)) return;
  plateChecks.set(key, { status: 'pending' });
  const cropCanvas = capturePlateCanvas(track);
  if (!cropCanvas) {
    setPlateStatus('Recorte indisponível');
    plateChecks.set(key, { status: 'no-crop' });
    return;
  }
  setPlateStatus('A reconhecer...', '...');
  queuePlateTask(async () => {
    const rawText = await recognizePlateFromCanvas(cropCanvas);
    const plate = extractPlateCandidate(rawText);
    if (!plate) {
      setPlateStatus('Matrícula não detetada', '-');
      plateChecks.set(key, { status: 'miss' });
      return;
    }
    const isPriority = isPriorityPlate(plate);
    setPlateStatus(isPriority ? 'Prioritária' : 'Detetada', plate);
    addLog({
      time: new Date().toLocaleTimeString(),
      type: 'Matrícula detetada',
      detail: `${plate} (${direction})`
    });
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
  const detections = await detectVehicles(video, { minScore: 0.55 });
  const frame = Date.now();
  const filtered = detections.filter(withinRoi).map((det) => ({ ...det, frame }));
  const tracks = tracker.update(filtered);

  const localSettings = getDeviceSettings(localDeviceId);
  const entryLine = normalizedLineToPixels(localSettings.lines.entry);
  const exitLine = normalizedLineToPixels(localSettings.lines.exit);

  tracks.forEach((track) => {
    if (entryLine && detectCrossing({ line: entryLine, track, lineKey: 'entry' })) {
      track.counted.entry = true;
      config.counts.entries += 1;
      addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada', detail: `#${track.id}` });
      handlePlateCheck(track, 'entrada');
    }
    if (exitLine && detectCrossing({ line: exitLine, track, lineKey: 'exit' })) {
      track.counted.exit = true;
      config.counts.exits += 1;
      addLog({ time: new Date().toLocaleTimeString(), type: 'Saída', detail: `#${track.id}` });
      handlePlateCheck(track, 'saida');
    }
  });

  drawOverlay(tracks);
  persistConfig();
};

const loop = async () => {
  const fps = Number(fpsSelect.value);
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
    if (!video.srcObject) {
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
  if (drawingMode === 'roi' && roiDrawing) {
    const normalizedStart = toNormalized({ x: roiDrawing.x, y: roiDrawing.y });
    const normalizedEnd = toNormalized({ x: roiDrawing.x + roiDrawing.width, y: roiDrawing.y + roiDrawing.height });
    const x = Math.min(normalizedStart.x, normalizedEnd.x);
    const y = Math.min(normalizedStart.y, normalizedEnd.y);
    const width = Math.abs(normalizedEnd.x - normalizedStart.x);
    const height = Math.abs(normalizedEnd.y - normalizedStart.y);
    if (activeSettings) {
      activeSettings.roi = { x, y, width, height };
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
  if (drawingMode === 'roi') {
    roiDrawing = { x: start.x, y: start.y, width: 0, height: 0 };
  } else {
    drawingLine = { start, end: start };
  }
});

overlay.addEventListener('pointermove', (event) => {
  if (!drawingMode || activePointerId !== event.pointerId) return;
  event.preventDefault();
  const point = toCanvasPoint(event);
  if (drawingMode === 'roi' && roiDrawing) {
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
  config.counts.priorityAdjustments = 0;
  config.counts.mrCount = 0;
  config.log = [];
  setPlateStatus('Aguardando deteção', '-');
  persistConfig();
});

addEntryBtn.addEventListener('click', () => {
  config.counts.entries += 1;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada manual', detail: '+1' });
  persistConfig();
});

addExitBtn.addEventListener('click', () => {
  const maxExits = Math.max(0, config.counts.entries - config.counts.priorityAdjustments);
  if (config.counts.exits >= maxExits) return;
  config.counts.exits += 1;
  addLog({ time: new Date().toLocaleTimeString(), type: 'Saída manual', detail: '+1' });
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

resolutionSelect.addEventListener('change', async () => {
  if (video.srcObject) {
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
  } else if (value === 'network') {
    config.camera = { mode: 'network', deviceId: null, networkUrl: previousUrl };
  } else {
    config.camera = { mode: 'auto', deviceId: null, networkUrl: '' };
  }
  persistConfig();
  if (cameraStatus) {
    const selectedOption = cameraSelect.options[cameraSelect.selectedIndex];
    cameraStatus.textContent = selectedOption ? selectedOption.textContent : 'Automática';
  }
  if (value === 'network' && !config.camera.networkUrl) {
    setStatus('Defina o endereço da câmara de rede.', true);
    return;
  }
  if (video.srcObject || value !== 'auto') {
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
    config.camera = { mode: 'network', deviceId: null, networkUrl: url };
    cameraSelect.value = 'network';
    if (cameraStatus) {
      cameraStatus.textContent = 'Endereço de rede';
    }
    persistConfig();
    await startCamera();
  });
}


const handleViewportChange = () => {
  configureCanvas();
  const currentOrientation = isLandscape();
  if (currentOrientation === lastOrientation) return;
  lastOrientation = currentOrientation;
  if (!video.srcObject || activePreviewMode !== 'local') return;
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
  if (networkCameraUrlInput) {
    networkCameraUrlInput.value = config.camera?.networkUrl ?? '';
  }
  updateCountsUI();
  updateLineStatus();
  updateCameraSelect();
  fetchRemoteDevices();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', updateCameraSelect);
}

registerDevice();
setInterval(sendHeartbeat, 10000);
setInterval(fetchRemoteDevices, 5000);
