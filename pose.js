function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export class MotionDetector {
  constructor({ video, canvas, onMetrics, onStatus }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.onMetrics = onMetrics;
    this.onStatus = onStatus;
    this.stream = null;
    this.rafId = 0;
    this.running = false;
    this.previousFrame = null;
    this.smoothedMotion = 0;
    this.smoothedEnergy = 0;
    this.lastPresence = 0;
  }

  async start() {
    if (this.running) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        facingMode: "user",
      },
      audio: false,
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.onStatus?.("Camera started.");
    this.loop();
  }

  stop() {
    this.running = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    this.previousFrame = null;

    this.onMetrics?.({
      peopleCount: 0,
      motionScore: 0,
      energyScore: 0,
      cameraReady: false,
    });

    this.onStatus?.("Camera stopped.");
  }

  loop() {
    if (!this.running) return;

    const { width, height } = this.canvas;

    this.ctx.drawImage(this.video, 0, 0, width, height);

    const imageData = this.ctx.getImageData(0, 0, width, height).data;
    const sample = new Float32Array(width * height);

    for (let src = 0, dst = 0; src < imageData.length; src += 4, dst += 1) {
      const r = imageData[src];
      const g = imageData[src + 1];
      const b = imageData[src + 2];
      sample[dst] = r * 0.299 + g * 0.587 + b * 0.114;
    }

    let diffSum = 0;

    if (this.previousFrame) {
      for (let i = 0; i < sample.length; i += 2) {
        diffSum += Math.abs(sample[i] - this.previousFrame[i]);
      }
    }

    this.previousFrame = sample;

    const normalizedDiff = clamp(diffSum / 104000);
    const boostedMotion = clamp(Math.pow(normalizedDiff * 1.86, 0.78));
    const boostedEnergy = clamp(Math.pow(normalizedDiff * 1.62, 0.86));

    this.smoothedMotion = this.smoothedMotion * 0.78 + boostedMotion * 0.22;
    this.smoothedEnergy = this.smoothedEnergy * 0.83 + boostedEnergy * 0.17;

    const presence = this.smoothedMotion > 0.014 ? 1 : 0;
    this.lastPresence = this.lastPresence * 0.87 + presence * 0.13;

    this.onMetrics?.({
      peopleCount: this.lastPresence > 0.23 ? 1 : 0,
      motionScore: clamp(this.smoothedMotion),
      energyScore: clamp(this.smoothedEnergy),
      cameraReady: true,
    });

    this.rafId = requestAnimationFrame(() => this.loop());
  }
}
