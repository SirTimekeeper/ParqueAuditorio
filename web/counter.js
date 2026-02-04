export const computeSide = (line, point) => {
  const { x1, y1, x2, y2 } = line;
  return (point.x - x1) * (y2 - y1) - (point.y - y1) * (x2 - x1);
};

export const movementVector = (history, sampleSize = 5) => {
  const length = history.length;
  if (length < 2) return { dx: 0, dy: 0 };
  const startIndex = Math.max(0, length - sampleSize);
  const start = history[startIndex];
  const end = history[length - 1];
  return { dx: end.x - start.x, dy: end.y - start.y };
};

const lastNonZeroSide = (line, history, index) => {
  for (let i = index; i >= 0; i -= 1) {
    const side = computeSide(line, history[i]);
    if (side !== 0) return side;
  }
  return 0;
};

export const shouldIgnoreByDirection = (history, line, movementThreshold = 12, parallelThreshold = 0.12) => {
  const { dx, dy } = movementVector(history);
  const movementSq = dx * dx + dy * dy;
  if (movementSq < movementThreshold * movementThreshold) return false;
  const lx = line.x2 - line.x1;
  const ly = line.y2 - line.y1;
  const lineSq = lx * lx + ly * ly;
  if (lineSq === 0) return false;
  const cross = dx * ly - dy * lx;
  const crossSq = cross * cross;
  return crossSq <= parallelThreshold * parallelThreshold * movementSq * lineSq;
};

export const detectCrossing = ({ line, track, lineKey }) => {
  if (!line || track.counted?.[lineKey]) return false;
  const history = track.history;
  if (history.length < 2) return false;
  const curr = history[history.length - 1];
  const currSide = computeSide(line, curr);
  const prevSide = lastNonZeroSide(line, history, history.length - 2);
  if (prevSide === 0 || currSide === 0) return false;
  const crossed = prevSide * currSide < 0;
  if (!crossed) return false;
  if (shouldIgnoreByDirection(history, line)) return false;
  return true;
};
