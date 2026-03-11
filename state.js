export const state = {
    ws: null,
    cameraStarted: false,
    peopleCount: 0,
    motionScore: 0,
    energyScore: 0,
    smoothedMotion: 0,
    smoothedEnergy: 0
  };
  
  export function smoothValue(prev, next, alpha = 0.12) {
    return prev + (next - prev) * alpha;
  }
