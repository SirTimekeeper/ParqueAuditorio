export class SimpleTracker {
  constructor({ maxDistance = 60, maxAge = 10 } = {}) {
    this.maxDistance = maxDistance;
    this.maxAge = maxAge;
    this.tracks = new Map();
    this.nextId = 1;
  }

  update(detections) {
    const updatedTracks = new Map();
    const usedDetections = new Set();

    for (const [id, track] of this.tracks.entries()) {
      let bestMatch = null;
      let bestDistance = Infinity;
      detections.forEach((det, index) => {
        if (usedDetections.has(index)) return;
        const distance = Math.hypot(det.cx - track.cx, det.cy - track.cy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = { det, index };
        }
      });

      if (bestMatch && bestDistance <= this.maxDistance) {
        const { det, index } = bestMatch;
        usedDetections.add(index);
        const history = track.history.slice(-8);
        history.push({ x: det.cx, y: det.cy, frame: det.frame });
        updatedTracks.set(id, {
          ...track,
          ...det,
          history,
          age: 0
        });
      } else {
        const age = track.age + 1;
        if (age <= this.maxAge) {
          updatedTracks.set(id, { ...track, age });
        }
      }
    }

    detections.forEach((det, index) => {
      if (usedDetections.has(index)) return;
      updatedTracks.set(this.nextId, {
        id: this.nextId,
        ...det,
        history: [{ x: det.cx, y: det.cy, frame: det.frame }],
        age: 0,
        counted: {
          entry: false,
          exit: false
        }
      });
      this.nextId += 1;
    });

    this.tracks = updatedTracks;
    return Array.from(this.tracks.values());
  }
}
