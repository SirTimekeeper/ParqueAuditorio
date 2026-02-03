export const computeSide = (line, point) => {
  const { x1, y1, x2, y2 } = line;
  return (point.x - x1) * (y2 - y1) - (point.y - y1) * (x2 - x1);
};

export const movementVector = (history, sampleSize = 5) => {
  const slice = history.slice(-sampleSize);
  if (slice.length < 2) return { dx: 0, dy: 0 };
  const start = slice[0];
  const end = slice[slice.length - 1];
  return { dx: end.x - start.x, dy: end.y - start.y };
};

export const shouldIgnoreByDirection = (history, threshold = 12) => {
  const { dx } = movementVector(history);
  return dx > threshold;
};

export const detectCrossing = ({ line, track, lineKey }) => {
  if (!line || track.counted?.[lineKey]) return false;
  const history = track.history;
  if (history.length < 2) return false;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const prevSide = computeSide(line, prev);
  const currSide = computeSide(line, curr);
  const crossed = prevSide === 0 ? false : prevSide * currSide < 0;
  if (!crossed) return false;
  if (shouldIgnoreByDirection(history)) return false;
  return true;
};
