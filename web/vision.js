const ALLOWED_CLASSES = ['car', 'truck', 'bus', 'motorcycle'];
let model = null;
let plateWorker = null;

export const initVision = async () => {
  if (!window.cocoSsd) {
    throw new Error('Modelo COCO-SSD não disponível.');
  }
  model = await window.cocoSsd.load();
  return model;
};

export const detectVehicles = async (video, options = {}) => {
  if (!model) return [];
  const predictions = await model.detect(video);
  const minScore = options.minScore ?? 0.5;
  return predictions
    .filter((pred) => ALLOWED_CLASSES.includes(pred.class) && pred.score >= minScore)
    .map((pred) => {
      const [x, y, width, height] = pred.bbox;
      return {
        className: pred.class,
        score: pred.score,
        x,
        y,
        width,
        height,
        cx: x + width / 2,
        cy: y + height / 2
      };
    });
};

export const initPlateRecognition = async () => {
  if (!window.Tesseract) {
    throw new Error('Tesseract.js não disponível.');
  }
  if (plateWorker) return plateWorker;
  plateWorker = await window.Tesseract.createWorker();
  await plateWorker.loadLanguage('eng');
  await plateWorker.initialize('eng');
  await plateWorker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: 7
  });
  return plateWorker;
};

export const recognizePlateFromCanvas = async (canvas) => {
  const worker = plateWorker ?? (await initPlateRecognition());
  const result = await worker.recognize(canvas);
  return result?.data?.text ?? '';
};
