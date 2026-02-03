import { defaultConfig, loadLocalConfig, saveLocalConfig, fetchServerConfig, saveServerConfig } from './config.js';
import { SimpleTracker } from './tracker.js';
import { detectCrossing } from './counter.js';
import { initVision, detectVehicles } from './vision.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');

const entriesEl = document.getElementById('entries');
const exitsEl = document.getElementById('exits');
const occupancyEl = document.getElementById('occupancy');
const occupancyNormalEl = document.getElementById('occupancyNormal');
const occupancyMREl = document.getElementById('occupancyMR');
const warningFull = document.getElementById('warningFull');
const warningMR = document.getElementById('warningMR');

const setEntryLineBtn = document.getElementById('setEntryLine');
const setExitLineBtn = document.getElementById('setExitLine');
const setRoiBtn = document.getElementById('setRoi');
const toggleCountingBtn = document.getElementById('toggleCounting');
const resetCountsBtn = document.getElementById('resetCounts');

const addPriorityBtn = document.getElementById('addPriority');
const removePriorityBtn = document.getElementById('removePriority');
const addMRBtn = document.getElementById('addMR');
const removeMRBtn = document.getElementById('removeMR');

const priorityInput = document.getElementById('priorityInput');
const priorityAddBtn = document.getElementById('priorityAdd');
const priorityList = document.getElementById('priorityList');
const logList = document.getElementById('log');

const resolutionSelect = document.getElementById('resolutionSelect');
const fpsSelect = document.getElementById('fpsSelect');
const cameraSelect = document.getElementById('cameraSelect');
const activateCameraBtn = document.getElementById('activateCamera');
const refreshCamerasBtn = document.getElementById('refreshCameras');

const tracker = new SimpleTracker();

let config = { ...defaultConfig };
let counting = false;
let drawingMode = null;
let drawingLine = null;
let roiDrawing = null;
let animationHandle = null;

const maxNormal = 112;
const maxMR = 4;

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

const setStatus = (text, isError = false) => {
  statusText.textContent = text;
  statusText.style.color = isError ? '#e23434' : '#2457ff';
};

const addLog = (entry) => {
  config.log = [entry, ...config.log].slice(0, 40);
};

const updateCountsUI = () => {
  entriesEl.textContent = config.counts.entries;
  exitsEl.textContent = config.counts.exits;

  const rawOccupancy = config.counts.entries - config.counts.exits - config.counts.priorityAdjustments;
  const occupancy = Math.max(0, rawOccupancy);
  const occupancyMR = Math.min(config.counts.mrCount, occupancy, maxMR);
  const occupancyNormal = Math.max(0, occupancy - occupancyMR);

  occupancyEl.textContent = occupancy;
  occupancyNormalEl.textContent = occupancyNormal;
  occupancyMREl.textContent = occupancyMR;

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
  renderPriorityList();
  renderLog();
};

const applyConfig = (loaded) => {
  config = { ...defaultConfig, ...loaded };
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

  const entryLine = normalizedLineToPixels(config.lines.entry);
  const exitLine = normalizedLineToPixels(config.lines.exit);
  const roi = normalizedRoiToPixels(config.roi);

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
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
  drawOverlay();
};

const stopCamera = () => {
  if (!video.srcObject) return;
  const tracks = video.srcObject.getTracks();
  tracks.forEach((track) => track.stop());
  video.srcObject = null;
};

const getCameraConstraints = () => {
  const width = Number(resolutionSelect.value);
  const videoConstraints = {
    width: { ideal: width },
    height: { ideal: Math.round(width * 0.75) }
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

const updateCameraSelect = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const availableIds = cameras.map((camera) => camera.deviceId);

  cameraSelect.innerHTML = '';
  [
    { value: 'auto', label: 'Automática' },
    { value: 'user', label: 'Frontal' },
    { value: 'environment', label: 'Traseira' }
  ].forEach((item) => cameraSelect.appendChild(buildCameraOption(item.value, item.label)));

  if (cameras.length === 0) {
    const emptyOption = buildCameraOption('none', 'Sem câmaras detectadas');
    emptyOption.disabled = true;
    cameraSelect.appendChild(emptyOption);
  } else {
    cameras.forEach((camera, index) => {
      const label = camera.label || `Câmara ${index + 1}`;
      cameraSelect.appendChild(buildCameraOption(`device:${camera.deviceId}`, label));
    });
  }

  const cameraConfig = config.camera ?? { mode: 'auto', deviceId: null };
  let targetValue = 'auto';
  if (cameraConfig.mode === 'device' && cameraConfig.deviceId && availableIds.includes(cameraConfig.deviceId)) {
    targetValue = `device:${cameraConfig.deviceId}`;
  } else if (cameraConfig.mode === 'user' || cameraConfig.mode === 'environment') {
    targetValue = cameraConfig.mode;
  }
  cameraSelect.value = targetValue;
  if (cameraSelect.value !== targetValue) {
    cameraSelect.value = 'auto';
  }

  if (cameraConfig.mode === 'device' && cameraConfig.deviceId && !availableIds.includes(cameraConfig.deviceId)) {
    config.camera = { mode: 'auto', deviceId: null };
    persistConfig();
  }
};

const startCamera = async () => {
  try {
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
    video.srcObject = stream;
    await video.play();
    configureCanvas();
    await updateCameraSelect();
    setStatus('Câmara pronta');
  } catch (error) {
    setStatus('Erro ao aceder à câmara', true);
    alert('Não foi possível aceder à câmara. Verifique permissões ou use HTTPS/localhost.');
    throw error;
  }
};

const withinRoi = (det) => {
  if (!config.roi) return true;
  const roi = normalizedRoiToPixels(config.roi);
  if (!roi) return true;
  return det.cx >= roi.x && det.cx <= roi.x + roi.width && det.cy >= roi.y && det.cy <= roi.y + roi.height;
};

const processFrame = async () => {
  if (!counting) return;
  const detections = await detectVehicles(video, { minScore: 0.55 });
  const frame = Date.now();
  const filtered = detections.filter(withinRoi).map((det) => ({ ...det, frame }));
  const tracks = tracker.update(filtered);

  const entryLine = normalizedLineToPixels(config.lines.entry);
  const exitLine = normalizedLineToPixels(config.lines.exit);

  tracks.forEach((track) => {
    if (entryLine && detectCrossing({ line: entryLine, track, lineKey: 'entry' })) {
      track.counted.entry = true;
      config.counts.entries += 1;
      addLog({ time: new Date().toLocaleTimeString(), type: 'Entrada', detail: `#${track.id}` });
    }
    if (exitLine && detectCrossing({ line: exitLine, track, lineKey: 'exit' })) {
      track.counted.exit = true;
      config.counts.exits += 1;
      addLog({ time: new Date().toLocaleTimeString(), type: 'Saída', detail: `#${track.id}` });
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
  drawOverlay();
};

const setupDrawing = (mode) => {
  drawingMode = mode;
  drawingLine = null;
  roiDrawing = null;
  overlay.style.pointerEvents = 'auto';
};

overlay.addEventListener('mousedown', (event) => {
  if (!drawingMode) return;
  const start = toCanvasPoint(event);
  if (drawingMode === 'roi') {
    roiDrawing = { x: start.x, y: start.y, width: 0, height: 0 };
  } else {
    drawingLine = { start, end: start };
  }
});

overlay.addEventListener('mousemove', (event) => {
  if (!drawingMode) return;
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

overlay.addEventListener('mouseup', () => {
  if (!drawingMode) return;
  if (drawingMode === 'roi' && roiDrawing) {
    const normalizedStart = toNormalized({ x: roiDrawing.x, y: roiDrawing.y });
    const normalizedEnd = toNormalized({ x: roiDrawing.x + roiDrawing.width, y: roiDrawing.y + roiDrawing.height });
    const x = Math.min(normalizedStart.x, normalizedEnd.x);
    const y = Math.min(normalizedStart.y, normalizedEnd.y);
    const width = Math.abs(normalizedEnd.x - normalizedStart.x);
    const height = Math.abs(normalizedEnd.y - normalizedStart.y);
    config.roi = { x, y, width, height };
  }
  if ((drawingMode === 'entry' || drawingMode === 'exit') && drawingLine) {
    const start = toNormalized(drawingLine.start);
    const end = toNormalized(drawingLine.end);
    const line = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    if (drawingMode === 'entry') {
      config.lines.entry = line;
    } else {
      config.lines.exit = line;
    }
  }
  persistConfig();
  clearDrawing();
});

setEntryLineBtn.addEventListener('click', () => setupDrawing('entry'));
setExitLineBtn.addEventListener('click', () => setupDrawing('exit'));
setRoiBtn.addEventListener('click', () => setupDrawing('roi'));

toggleCountingBtn.addEventListener('click', toggleCounting);

resetCountsBtn.addEventListener('click', () => {
  config.counts.entries = 0;
  config.counts.exits = 0;
  config.counts.priorityAdjustments = 0;
  config.counts.mrCount = 0;
  config.log = [];
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
  if (value.startsWith('device:')) {
    config.camera = { mode: 'device', deviceId: value.replace('device:', '') };
  } else if (value === 'user' || value === 'environment') {
    config.camera = { mode: value, deviceId: null };
  } else {
    config.camera = { mode: 'auto', deviceId: null };
  }
  persistConfig();
  if (video.srcObject || value !== 'auto') {
    await startCamera();
  }
});

activateCameraBtn.addEventListener('click', async () => {
  await startCamera();
});

refreshCamerasBtn.addEventListener('click', async () => {
  await updateCameraSelect();
});

window.addEventListener('resize', configureCanvas);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      console.warn('Service worker não foi registado.');
    });
  });
}

loadConfig().then(() => {
  updateCountsUI();
  updateCameraSelect();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', updateCameraSelect);
}
