import { addLog, getState, setMetrics, subscribe } from "./state.js";
import { MotionDetector } from "./pose.js";

const els = {
  startCameraBtn: document.getElementById("startCameraBtn"),
  connectWsBtn: document.getElementById("connectWsBtn"),
  systemStatus: document.getElementById("systemStatus"),

  peopleCountValue: document.getElementById("peopleCountValue"),
  motionScoreValue: document.getElementById("motionScoreValue"),
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
  houseAura: document.getElementById("houseAura"),
  energyPulse: document.getElementById("energyPulse"),
  goalOverlay: document.getElementById("goalOverlay"),
  windowLeft: document.getElementById("windowLeft"),
  windowRight: document.getElementById("windowRight"),
  batteryFill: document.getElementById("batteryFill"),
  houseBrightnessValue: document.getElementById("houseBrightnessValue"),
  gridChargeValue: document.getElementById("gridChargeValue"),
  motionResponseValue: document.getElementById("motionResponseValue"),
  pointsValue: document.getElementById("pointsValue"),
  powerLineOne: document.getElementById("powerLineOne"),
  powerLineTwo: document.getElementById("powerLineTwo"),
  powerLineThree: document.getElementById("powerLineThree"),
  chimneySmoke: document.getElementById("chimneySmoke"),
  sprinklerGroup: document.getElementById("sprinklerGroup"),
  windFlow: document.getElementById("windFlow"),

  logBox: document.getElementById("logBox"),
  cameraFeed: document.getElementById("cameraFeed"),
  motionSampler: document.getElementById("motionSampler"),
};

let detector = null;
let ws = null;
let lastWsSentAt = 0;
let previousGoalState = false;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function setMeter(element, value) {
  element.style.width = `${clamp(value) * 100}%`;
}

function updateBattery(storage) {
  const maxHeight = 106;
  const minHeight = 8;
  const height = minHeight + clamp(storage) * (maxHeight - minHeight);
  const y = 340 - height;

  els.batteryFill.setAttribute("height", `${height}`);
  els.batteryFill.setAttribute("y", `${y}`);
}

function updateHouseVisuals(state) {
  const brightness = clamp(state.electricity);
  const storage = clamp(state.storage);
  const motion = clamp(state.motionScore);
  const energy = clamp(state.energyScore);
  const hydro = clamp(state.hydro);
  const wind = clamp(state.wind);
  const heat = clamp(state.heat);
  const goal = Boolean(state.goalReached);

  const warmWindowAlpha = 0.18 + brightness * 0.82;
  const auraOpacity = goal ? 0.98 : 0.14 + brightness * 0.72;
  const auraScale = goal ? 1.14 : 0.94 + brightness * 0.18;
  const pulseOpacity = goal ? 0.62 : 0.08 + energy * 0.28;
  const pulseScale = goal ? 1.16 : 0.82 + motion * 0.3;

  let windowFill;
  let windowFilter;

  if (goal) {
    windowFill = "rgba(255, 226, 118, 0.96)";
    windowFilter =
      "drop-shadow(0 0 16px rgba(255,220,120,0.95)) drop-shadow(0 0 30px rgba(255,200,90,0.8)) drop-shadow(0 0 44px rgba(255,185,70,0.42))";
  } else {
    windowFill = `rgba(146, 214, 255, ${warmWindowAlpha})`;
    const glow = 10 + brightness * 24;
    windowFilter = `drop-shadow(0 0 ${glow}px rgba(129, 208, 255, 0.95))`;
  }

  els.windowLeft.style.fill = windowFill;
  els.windowRight.style.fill = windowFill;
  els.windowLeft.style.filter = windowFilter;
  els.windowRight.style.filter = windowFilter;

  els.houseAura.style.opacity = `${auraOpacity}`;
  els.houseAura.style.transform = `scale(${auraScale})`;

  els.energyPulse.style.opacity = `${pulseOpacity}`;
  els.energyPulse.style.transform = `scale(${pulseScale})`;

  const dashSpeed = goal ? 1.2 : 4.2 - motion * 2.8;
  const lineOpacity = goal ? 1 : 0.32 + energy * 0.62;

  els.powerLineOne.style.animationDuration = `${dashSpeed}s`;
  els.powerLineTwo.style.animationDuration = `${dashSpeed * 0.92}s`;
  els.powerLineThree.style.animationDuration = `${dashSpeed * 1.08}s`;

  els.powerLineOne.style.opacity = `${lineOpacity}`;
  els.powerLineTwo.style.opacity = `${lineOpacity * 0.92}`;
  els.powerLineThree.style.opacity = `${lineOpacity * 0.88}`;

  els.windFlow.style.opacity = wind > 0.72 || goal ? "1" : "0";
  els.sprinklerGroup.style.opacity = hydro > 0.72 || goal ? "1" : "0";
  els.chimneySmoke.style.opacity = heat > 0.72 || goal ? "1" : "0";

  els.goalOverlay.classList.toggle("active", goal);

  els.houseBrightnessValue.textContent = formatPercent(brightness);
  els.gridChargeValue.textContent = formatPercent(storage);
  els.motionResponseValue.textContent =
    goal
      ? "maxed"
      : motion < 0.1
        ? "gentle"
        : motion < 0.35
          ? "active"
          : motion < 0.65
            ? "strong"
            : "surging";

  els.pointsValue.textContent = `${state.points}`;
  updateBattery(storage);

  if (goal && !previousGoalState) {
    addLog("Goal reached: the entire house is fully powered.");
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
  els.peopleCountValue.textContent = `${state.peopleCount}`;
  els.motionScoreValue.textContent = state.motionScore.toFixed(3);
  els.energyScoreValue.textContent = state.energyScore.toFixed(3);

  els.electricityValue.textContent = formatPercent(state.electricity);
  els.heatValue.textContent = formatPercent(state.heat);
  els.hydroValue.textContent = formatPercent(state.hydro);
  els.windValue.textContent = formatPercent(state.wind);
  els.storageValue.textContent = formatPercent(state.storage);

  setMeter(els.electricityFill, state.electricity);
  setMeter(els.heatFill, state.heat);
  setMeter(els.hydroFill, state.hydro);
  setMeter(els.windFill, state.wind);
  setMeter(els.storageFill, state.storage);

  updateHouseVisuals(state);
  updateStatus(state);
  els.logBox.textContent = state.logs.join("\n");
}

function maybeSendWs(state) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const now = performance.now();
  if (now - lastWsSentAt < 150) return;
  lastWsSentAt = now;

  ws.send(
    JSON.stringify({
      type: "energy_input",
      people: state.peopleCount,
      motion: Number(state.motionScore.toFixed(4)),
      energy: Number(state.energyScore.toFixed(4)),
      electricity: Number(state.electricity.toFixed(4)),
      heat: Number(state.heat.toFixed(4)),
      hydro: Number(state.hydro.toFixed(4)),
      wind: Number(state.wind.toFixed(4)),
      storage: Number(state.storage.toFixed(4)),
      points: state.points,
      goalReached: state.goalReached,
    }),
  );
}

async function startCamera() {
  if (!detector) {
    detector = new MotionDetector({
      video: els.cameraFeed,
      canvas: els.motionSampler,
      onMetrics: (metrics) => setMetrics(metrics),
      onStatus: (message) => addLog(message),
    });
  }

  try {
    await detector.start();
    setMetrics({ cameraReady: true });
    addLog("Motion detector ready.");
  } catch (error) {
    console.error(error);
    addLog(`Camera failed: ${error.message}`);
  }
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
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
addLog("UI ready.");
