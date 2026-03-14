const listeners = new Set();

const state = {
  cameraReady: false,
  wsConnected: false,
  peopleCount: 0,
  motionScore: 0,
  energyScore: 0,
  electricity: 0,
  heat: 0,
  hydro: 0,
  wind: 0,
  storage: 0,
  points: 0,
  goalReached: false,
  logs: [],
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function boostedCurve(value, exponent = 0.71, boost = 1.1) {
  return clamp(Math.pow(clamp(value), exponent) * boost);
}

function endWeightedFill(value) {
  const v = clamp(value);
  if (v < 0.8) return v;
  return 0.8 + Math.pow((v - 0.8) / 0.2, 1.36) * 0.2;
}

function deriveOutputs() {
  const motion = clamp(state.motionScore);
  const energy = clamp(state.energyScore);

  const intensityBase = boostedCurve(motion * 1.64 + energy * 0.56, 0.71, 1.12);
  const intensity = endWeightedFill(intensityBase);

  state.electricity = clamp(
    endWeightedFill(boostedCurve(intensity * 1.12 + energy * 0.41, 0.73, 1.06)),
  );
  state.heat = clamp(
    endWeightedFill(boostedCurve(intensity * 0.99 + energy * 0.38, 0.77, 1.02)),
  );
  state.hydro = clamp(
    endWeightedFill(boostedCurve(intensity * 0.89 + energy * 0.44, 0.79, 1.02)),
  );
  state.wind = clamp(
    endWeightedFill(boostedCurve(intensity * 1.02, 0.71, 1.04)),
  );
  state.storage = clamp(
    endWeightedFill(
      boostedCurve(
        state.electricity * 0.32 +
          state.heat * 0.16 +
          state.hydro * 0.24 +
          state.wind * 0.18 +
          energy * 0.2,
        0.8,
        1.02,
      ),
    ),
  );

  const allFilled =
    state.electricity >= 0.98 &&
    state.heat >= 0.98 &&
    state.hydro >= 0.98 &&
    state.wind >= 0.98 &&
    state.storage >= 0.98;

  if (allFilled && !state.goalReached) {
    state.goalReached = true;
    state.points += 100;
    state.logs = [`[GOAL] House fully powered! +100 points`, ...state.logs].slice(0, 50);
  } else if (!allFilled) {
    state.goalReached = false;
  }
}

function notify() {
  deriveOutputs();
  for (const listener of listeners) {
    listener({ ...state });
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function getState() {
  return { ...state };
}

export function setMetrics(partial) {
  if (typeof partial.peopleCount === "number") {
    state.peopleCount = Math.max(0, partial.peopleCount);
  }

  if (typeof partial.motionScore === "number") {
    state.motionScore = clamp(partial.motionScore);
  }

  if (typeof partial.energyScore === "number") {
    state.energyScore = clamp(partial.energyScore);
  }

  if (typeof partial.cameraReady === "boolean") {
    state.cameraReady = partial.cameraReady;
  }

  if (typeof partial.wsConnected === "boolean") {
    state.wsConnected = partial.wsConnected;
  }

  notify();
}

export function addLog(message) {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  state.logs = [`[${timestamp}] ${message}`, ...state.logs].slice(0, 50);
  notify();
}
