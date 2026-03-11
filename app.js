import { state, smoothValue } from "./state.js";

const video = document.getElementById("video");
const windCanvas = document.getElementById("windCanvas");
const windCtx = windCanvas.getContext("2d");

const startCameraBtn = document.getElementById("startCameraBtn");
const connectWsBtn = document.getElementById("connectWsBtn");

const statusEl = document.getElementById("status");
const peopleCountEl = document.getElementById("peopleCount");
const motionScoreEl = document.getElementById("motionScore");
const energyScoreEl = document.getElementById("energyScore");
const logBox = document.getElementById("logBox");

const WS_URL = "ws://127.0.0.1:8765";

let detector = null;
let detectorReady = false;
let currentPoses = [];
let trackedBodies = new Map();

let windTime = 0;
let lastWsSend = 0;
let lastPoseRun = 0;
let poseBusy = false;
let cameraStartedOnce = false;

let stableDisplayedCount = 0;
let candidateCount = 0;
let candidateSince = 0;
let lastSeenCountChange = 0;

// calibration
const POSE_INTERVAL_MS = 120;
const WS_INTERVAL_MS = 120;

// count stabilization
const COUNT_RAISE_HOLD_MS = 350;
const COUNT_DROP_HOLD_MS = 800;

// pose filtering
const MIN_POSE_SCORE = 0.22;
const MIN_VALID_KEYPOINTS = 5;
const MIN_KEYPOINT_SCORE = 0.2;
const TRACK_MATCH_DIST = 140;

// motion calibration
const MOTION_ALPHA = 0.20;
const ENERGY_ALPHA = 0.14;
const MOTION_THRESHOLD = 0.008;
const WRIST_WEIGHT = 0.45;
const ELBOW_WEIGHT = 0.25;
const SHOULDER_WEIGHT = 0.20;
const TORSO_WEIGHT = 0.10;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.textContent = `${line}\n${logBox.textContent}`.slice(0, 6000);
  console.log(msg);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  await video.play();

  state.cameraStarted = true;
  await initPoseDetector();

  setStatus("Camera started. More bodies + more arm motion = more wind.");
  log("Camera started.");
}

async function initPoseDetector() {
  if (detectorReady) return;

  try {
    if (window.tf?.setBackend) {
      await window.tf.setBackend("webgl");
      await window.tf.ready();
    }

    detector = await window.poseDetection.createDetector(
      window.poseDetection.SupportedModels.MoveNet,
      {
        modelType: window.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        enableTracking: true,
        trackerType: window.poseDetection.TrackerType.BoundingBox
      }
    );

    detectorReady = true;
    log("MoveNet multipose detector ready.");
  } catch (err) {
    console.error(err);
    setStatus(`Pose detector failed: ${err.message}`);
  }
}

function connectWS() {
  state.ws = new WebSocket(WS_URL);

  state.ws.onopen = () => {
    setStatus("Connected to local WS hub.");
    log("WS connected.");
    sendWsMessage({
      type: "ping",
      source: "browser",
      ts: Date.now()
    });
  };

  state.ws.onclose = () => {
    setStatus("WS disconnected.");
    log("WS disconnected.");
  };

  state.ws.onerror = () => {
    setStatus("WS error.");
    log("WS error.");
  };

  state.ws.onmessage = (event) => {
    const text = String(event.data);
    log(`WS recv: ${text.slice(0, 140)}`);
  };
}

function sendWsMessage(obj) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(obj));
}

function updateStatsUI() {
  peopleCountEl.textContent = String(state.peopleCount);
  motionScoreEl.textContent = state.motionScore.toFixed(3);
  energyScoreEl.textContent = state.energyScore.toFixed(3);
}

function keypointByName(pose, name) {
  return pose.keypoints?.find((k) => k.name === name) || null;
}

function kpValid(kp) {
  return kp && typeof kp.x === "number" && typeof kp.y === "number" && (kp.score ?? 0) >= MIN_KEYPOINT_SCORE;
}

function poseValid(pose) {
  const score = pose.score ?? 0;
  const validCount = (pose.keypoints || []).filter(kpValid).length;
  return score >= MIN_POSE_SCORE && validCount >= MIN_VALID_KEYPOINTS;
}

function poseCentroid(pose) {
  const good = (pose.keypoints || []).filter(kpValid);
  if (!good.length) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const k of good) {
    sx += k.x;
    sy += k.y;
  }
  return { x: sx / good.length, y: sy / good.length };
}

function matchAndTrackBodies(poses, now) {
  const nextTracked = new Map();
  const existing = Array.from(trackedBodies.values());
  const usedExisting = new Set();

  for (const pose of poses) {
    const c = poseCentroid(pose);

    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < existing.length; i++) {
      if (usedExisting.has(i)) continue;
      const prev = existing[i];
      const d = Math.hypot(prev.cx - c.x, prev.cy - c.y);
      if (d < bestDist) {
        bestDist = d;
        best = { idx: i, prev };
      }
    }

    let id;
    let prevPose = null;

    if (best && bestDist < TRACK_MATCH_DIST) {
      id = best.prev.id;
      prevPose = best.prev.pose;
      usedExisting.add(best.idx);
    } else {
      id = `body_${now}_${Math.random().toString(36).slice(2, 8)}`;
    }

    nextTracked.set(id, {
      id,
      cx: c.x,
      cy: c.y,
      pose,
      prevPose,
      lastSeen: now
    });
  }

  trackedBodies = nextTracked;
}

function keypointSpeed(prevPose, pose, name) {
  if (!prevPose || !pose) return 0;

  const a = keypointByName(prevPose, name);
  const b = keypointByName(pose, name);

  if (!kpValid(a) || !kpValid(b)) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function computeBodyMotion(tracked) {
  const { prevPose, pose } = tracked;
  if (!prevPose || !pose) return 0;

  const lw = keypointSpeed(prevPose, pose, "left_wrist");
  const rw = keypointSpeed(prevPose, pose, "right_wrist");
  const le = keypointSpeed(prevPose, pose, "left_elbow");
  const re = keypointSpeed(prevPose, pose, "right_elbow");
  const ls = keypointSpeed(prevPose, pose, "left_shoulder");
  const rs = keypointSpeed(prevPose, pose, "right_shoulder");

  const lh = keypointByName(pose, "left_hip");
  const rh = keypointByName(pose, "right_hip");
  const plh = keypointByName(prevPose, "left_hip");
  const prh = keypointByName(prevPose, "right_hip");

  let torso = 0;
  if (kpValid(lh) && kpValid(rh) && kpValid(plh) && kpValid(prh)) {
    const cx1 = (plh.x + prh.x) / 2;
    const cy1 = (plh.y + prh.y) / 2;
    const cx2 = (lh.x + rh.x) / 2;
    const cy2 = (lh.y + rh.y) / 2;
    torso = Math.hypot(cx2 - cx1, cy2 - cy1);
  }

  const wristAvg = (lw + rw) / 2;
  const elbowAvg = (le + re) / 2;
  const shoulderAvg = (ls + rs) / 2;

  return (
    wristAvg * WRIST_WEIGHT +
    elbowAvg * ELBOW_WEIGHT +
    shoulderAvg * SHOULDER_WEIGHT +
    torso * TORSO_WEIGHT
  );
}

function calibrateMotion(rawMotion) {
  const adjusted = Math.max(0, rawMotion - MOTION_THRESHOLD) * 0.02;
  return Math.max(0, Math.min(2.2, adjusted));
}

function updateStableCount(detectedCount, now) {
  if (detectedCount !== candidateCount) {
    candidateCount = detectedCount;
    candidateSince = now;
  }

  if (candidateCount > stableDisplayedCount) {
    if (now - candidateSince >= COUNT_RAISE_HOLD_MS) {
      stableDisplayedCount = candidateCount;
      lastSeenCountChange = now;
    }
  } else if (candidateCount < stableDisplayedCount) {
    if (now - candidateSince >= COUNT_DROP_HOLD_MS) {
      stableDisplayedCount = candidateCount;
      lastSeenCountChange = now;
    }
  }

  state.peopleCount = stableDisplayedCount;
}

function computeEnergy(peopleCount, motionScore) {
  if (peopleCount <= 0) return 0;

  const peopleFactor = 1 + Math.max(0, peopleCount - 1) * 0.9;
  const motionFactor = Math.pow(Math.max(0, motionScore), 1.12);

  return peopleFactor * motionFactor;
}

async function runPoseDetection(now) {
  if (!detectorReady || !state.cameraStarted || video.readyState < 2 || poseBusy) return;

  poseBusy = true;
  try {
    const poses = await detector.estimatePoses(video, {
      maxPoses: 6,
      flipHorizontal: true
    });

    const valid = (poses || []).filter(poseValid);
    currentPoses = valid;
    matchAndTrackBodies(valid, now);
    updateStableCount(valid.length, now);
  } catch (err) {
    console.warn("Pose detection failed:", err);
  } finally {
    poseBusy = false;
  }
}

function drawWindPreview() {
  const w = windCanvas.width;
  const h = windCanvas.height;

  windCtx.clearRect(0, 0, w, h);

  const grad = windCtx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#04101a");
  grad.addColorStop(1, "#080c1a");
  windCtx.fillStyle = grad;
  windCtx.fillRect(0, 0, w, h);

  const lines = 56;
  const intensity = Math.min(2.6, state.energyScore);

  const amp = 8 + intensity * 125;
  const speed = 0.008 + intensity * 0.09;
  const bend = 0.004 + state.motionScore * 0.04;
  const glowAlpha = 0.42 + Math.min(0.42, intensity * 0.16);

  windCtx.lineWidth = 2;
  windCtx.strokeStyle = `rgba(90,220,255,${glowAlpha})`;

  for (let i = 0; i < lines; i++) {
    const yBase = (i / (lines - 1)) * h;
    windCtx.beginPath();

    for (let x = 0; x <= w; x += 10) {
      const y =
        yBase +
        Math.sin(x * bend + windTime + i * 0.25) * amp +
        Math.cos(x * (bend * 0.62) - windTime * 1.33 + i * 0.11) * (amp * 0.18);

      if (x === 0) windCtx.moveTo(x, y);
      else windCtx.lineTo(x, y);
    }

    windCtx.stroke();
  }

  windTime += speed;
}

function tick(now = 0) {
  if (state.cameraStarted && detectorReady) {
    if (now - lastPoseRun > POSE_INTERVAL_MS) {
      runPoseDetection(now);
      lastPoseRun = now;
    }

    let rawMotion = 0;
    for (const tracked of trackedBodies.values()) {
      rawMotion += computeBodyMotion(tracked);
    }

    const calibratedMotion = calibrateMotion(rawMotion);
    state.smoothedMotion = smoothValue(state.smoothedMotion, calibratedMotion, MOTION_ALPHA);
    state.motionScore = state.smoothedMotion;

    const rawEnergy = computeEnergy(state.peopleCount, state.motionScore);
    state.smoothedEnergy = smoothValue(state.smoothedEnergy, rawEnergy, ENERGY_ALPHA);
    state.energyScore = state.smoothedEnergy;

    if (state.ws && state.ws.readyState === WebSocket.OPEN && now - lastWsSend > WS_INTERVAL_MS) {
        const energyNorm = Math.max(0, Math.min(1, state.energyScore / 3.5));
      
        sendWsMessage({
          type: "energy_input",
          ts: Date.now(),
          people_count: state.peopleCount,
          motion_score: Number(state.motionScore.toFixed(4)),
          energy_score: Number(state.energyScore.toFixed(4)),
          energy_norm: Number(energyNorm.toFixed(4))
        });
      
        lastWsSend = now;
      }
  }

  updateStatsUI();
  drawWindPreview();
  requestAnimationFrame(tick);
}

startCameraBtn.addEventListener("click", async () => {
  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    setStatus(`Camera failed: ${err.message}`);
  }
});

connectWsBtn.addEventListener("click", connectWS);

window.addEventListener("load", async () => {
  if (cameraStartedOnce) return;
  cameraStartedOnce = true;
  try {
    await startCamera();
  } catch {
    setStatus("Camera permission needed. Click Start Camera.");
  }
});

setStatus("Open Live Server, allow camera, and move in front of it.");
tick();
