import { addLog, getState, setMetrics, subscribe } from "./state.js";
import { MarkerDetector } from "./marker.js";
import { House3DScene } from "./house3d.js";

const els = {
  startCameraBtn: document.getElementById("startCameraBtn"),
  connectWsBtn: document.getElementById("connectWsBtn"),
  systemStatus: document.getElementById("systemStatus"),

  peopleCountValue: document.getElementById("peopleCountValue"),
  energyScoreValue: document.getElementById("energyScoreValue"),

  electricityValue: document.getElementById("electricityValue"),
  heatValue: document.getElementById("heatValue"),
  hydroValue: document.getElementById("hydroValue"),
  windValue: document.getElementById("windValue"),
  storageValue: document.getElementById("storageValue"),

  electricityFill: document.getElementById("electricityFill"),
  heatFill: document.getElementById("heatFill"),
  hydroFill: document.getElementById("hydroFill"),
  windFill: document.getElementById("windFill"),
  storageFill: document.getElementById("storageFill"),

  houseStage: document.getElementById("houseStage"),
  house3dMount: document.getElementById("house3dMount"),
  houseAura: document.getElementById("houseAura"),
  energyPulse: document.getElementById("energyPulse"),
  goalOverlay: document.getElementById("goalOverlay"),
  overallPowerValue: document.getElementById("overallPowerValue"),
  motionResponseValue: document.getElementById("motionResponseValue"),
  pointsValue: document.getElementById("pointsValue"),

  logBox: document.getElementById("logBox"),
  cameraFeed: document.getElementById("cameraFeed"),
  motionSampler: document.getElementById("motionSampler"),
};

let detector = null;
let ws = null;
let lastWsSentAt = 0;
let previousGoalState = false;
let goalLocked = false;
let cameraStarting = false;
let goalLogged = false;
let frozenDisplayState = null;
let lastRenderedLogText = "";

const houseScene = new House3DScene(els.house3dMount);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function setMeter(element, value) {
  element.style.width = `${clamp(value) * 100}%`;
}

function boostedOutputsFromMetrics(state) {
  const peopleCount = Math.max(0, state.peopleCount || 0);
  const motionBase = clamp(state.motionScore);
  const energyBase = clamp(state.energyScore);

  const motionDeadZone = 0.022;
  const energyDeadZone = 0.02;

  const motionActive = clamp((motionBase - motionDeadZone) / (1 - motionDeadZone));
  const energyActive = clamp((energyBase - energyDeadZone) / (1 - energyDeadZone));

  const motionCurve = Math.pow(motionActive, 0.72);
  const energyCurve = Math.pow(energyActive, 0.69);

  const peopleBoost =
    peopleCount <= 0 ? 1 : 1 + Math.min(peopleCount - 1, 4) * 0.14;

  const boostedMotion = clamp(motionCurve * 2.05 * peopleBoost);
  const boostedEnergy = clamp(energyCurve * 2.12 * peopleBoost);

  const balancedBase = clamp(boostedEnergy * 0.8 + boostedMotion * 0.2);

  return {
    electricity: clamp(balancedBase * 1.01),
    heat: clamp(balancedBase),
    hydro: clamp(balancedBase),
    wind: clamp(balancedBase),
    storage: clamp(balancedBase * 1.03),
  };
}

function hasReachedGoal(outputs) {
  return (
    outputs.electricity >= 0.999 &&
    outputs.heat >= 0.999 &&
    outputs.hydro >= 0.999 &&
    outputs.wind >= 0.999 &&
    outputs.storage >= 0.999
  );
}

function buildLockedGoalState(state) {
  return {
    ...state,
    electricity: 1,
    heat: 1,
    hydro: 1,
    wind: 1,
    storage: 1,
    goalReached: true,
    points: Math.max(state.points ?? 0, 100),
    motionScore: state.motionScore ?? 0,
    energyScore: state.energyScore ?? 0,
  };
}

function getDisplayState(state) {
  if (goalLocked && frozenDisplayState) {
    return {
      ...frozenDisplayState,
      cameraReady: state.cameraReady,
      wsConnected: state.wsConnected,
      logs: state.logs,
    };
  }

  const boosted = boostedOutputsFromMetrics(state);

  if (!goalLocked && hasReachedGoal(boosted)) {
    goalLocked = true;
    frozenDisplayState = buildLockedGoalState(state);
    return {
      ...frozenDisplayState,
      logs: state.logs,
      cameraReady: state.cameraReady,
      wsConnected: state.wsConnected,
    };
  }

  return {
    ...state,
    electricity: boosted.electricity,
    heat: boosted.heat,
    hydro: boosted.hydro,
    wind: boosted.wind,
    storage: boosted.storage,
    goalReached: false,
    points: state.points ?? 0,
  };
}

function updateHouseVisuals(state) {
  const brightness = clamp(state.electricity);
  const motion = clamp(state.motionScore);
  const energy = clamp(state.energyScore);
  const goal = Boolean(state.goalReached);

  const overallPower =
    (
      clamp(state.electricity) +
      clamp(state.heat) +
      clamp(state.hydro) +
      clamp(state.wind) +
      clamp(state.storage)
    ) / 5;

  const auraOpacity = goal ? 0.88 : 0.18 + brightness * 0.76;
  const auraScale = goal ? 1.08 : 0.96 + brightness * 0.2;
  const pulseOpacity = goal ? 0.38 : 0.12 + energy * 0.34;
  const pulseScale = goal ? 1.05 : 0.86 + motion * 0.34;

  els.houseAura.style.opacity = `${auraOpacity}`;
  els.houseAura.style.transform = `scale(${auraScale})`;

  els.energyPulse.style.opacity = `${pulseOpacity}`;
  els.energyPulse.style.transform = `scale(${pulseScale})`;

  els.goalOverlay.classList.toggle("active", goal);

  els.overallPowerValue.textContent = formatPercent(overallPower);
  els.motionResponseValue.textContent = goal
    ? "maxed"
    : motion < 0.04
      ? "gentle"
      : motion < 0.1
        ? "active"
        : motion < 0.2
          ? "strong"
          : "surging";

  els.pointsValue.textContent = `${state.points}`;

  houseScene.update(state);

  if (goal && !goalLogged) {
    addLog("[GOAL] House fully powered! +100 points");
    goalLogged = true;
  }

  previousGoalState = goal;
}

function updateStatus(state) {
  const isLive = state.cameraReady;
  els.systemStatus.textContent = isLive
    ? state.wsConnected
      ? "Camera + WS live"
      : "Camera live"
    : "Idle";

  els.systemStatus.className = `status-pill ${isLive ? "live" : "offline"}`;
}

function render(state) {
  const displayState = getDisplayState(state);

  els.peopleCountValue.textContent = `${goalLocked ? 1 : state.peopleCount}`;
  els.energyScoreValue.textContent = (goalLocked ? displayState.energyScore : state.energyScore).toFixed(2);

  els.electricityValue.textContent = formatPercent(displayState.electricity);
  els.heatValue.textContent = formatPercent(displayState.heat);
  els.hydroValue.textContent = formatPercent(displayState.hydro);
  els.windValue.textContent = formatPercent(displayState.wind);
  els.storageValue.textContent = formatPercent(displayState.storage);

  setMeter(els.electricityFill, displayState.electricity);
  setMeter(els.heatFill, displayState.heat);
  setMeter(els.hydroFill, displayState.hydro);
  setMeter(els.windFill, displayState.wind);
  setMeter(els.storageFill, displayState.storage);

  updateHouseVisuals(displayState);
  updateStatus(state);

  const nextLogText = state.logs.join("\n");
  if (nextLogText !== lastRenderedLogText) {
    els.logBox.textContent = nextLogText;
    lastRenderedLogText = nextLogText;
  }
}

function maybeSendWs(state) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const now = performance.now();
  if (now - lastWsSentAt < (goalLocked ? 500 : 150)) return;
  lastWsSentAt = now;

  const displayState = getDisplayState(state);

  ws.send(
    JSON.stringify({
      type: "energy_input",
      people: goalLocked ? 1 : state.peopleCount,
      motion: Number(displayState.motionScore.toFixed(4)),
      energy: Number(displayState.energyScore.toFixed(4)),
      electricity: Number(displayState.electricity.toFixed(4)),
      heat: Number(displayState.heat.toFixed(4)),
      hydro: Number(displayState.hydro.toFixed(4)),
      wind: Number(displayState.wind.toFixed(4)),
      storage: Number(displayState.storage.toFixed(4)),
      points: displayState.points,
      goalReached: displayState.goalReached,
    }),
  );
}

async function startCamera() {
  if (cameraStarting) return;
  if (detector && getState().cameraReady) return;

  cameraStarting = true;
  els.startCameraBtn.disabled = true;

  if (!detector) {
    detector = new MarkerDetector({
      video: els.cameraFeed,
      canvas: els.motionSampler,
      onMetrics: (metrics) => {
        if (goalLocked) return;
        setMetrics(metrics);
      },
      onStatus: (message) => addLog(message),
    });
  }

  try {
    await detector.start();
    setMetrics({ cameraReady: true });
    addLog("Camera started.");
  } catch (error) {
    console.error(error);
    addLog(`Camera failed: ${error.message}`);
  } finally {
    cameraStarting = false;
    els.startCameraBtn.disabled = false;
  }
}

function connectWs() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    ws = new WebSocket("ws://127.0.0.1:8765");

    ws.addEventListener("open", () => {
      setMetrics({ wsConnected: true });
      addLog("WebSocket connected.");
    });

    ws.addEventListener("close", () => {
      setMetrics({ wsConnected: false });
      addLog("WebSocket disconnected.");
    });

    ws.addEventListener("error", () => {
      setMetrics({ wsConnected: false });
      addLog("WebSocket error.");
    });

    ws.addEventListener("message", (event) => {
      addLog(`WS: ${event.data}`);
    });
  } catch (error) {
    console.error(error);
    addLog(`WS failed: ${error.message}`);
  }
}

els.startCameraBtn.addEventListener("click", startCamera);
els.connectWsBtn.addEventListener("click", connectWs);

subscribe((state) => {
  render(state);
  maybeSendWs(state);
});

render(getState());
addLog("3D house viewer ready.");
