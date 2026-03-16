function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }
  
  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  
  export class MarkerDetector {
    constructor({ video, canvas, onMetrics, onStatus }) {
      this.video = video;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { willReadFrequently: true });
  
      this.onMetrics = onMetrics;
      this.onStatus = onStatus;
  
      this.running = false;
      this.stream = null;
      this.timer = null;
  
      this.prevAngle = null;
      this.smoothedMotion = 0;
      this.smoothedEnergy = 0;
  
      this.processWidth = 320;
      this.processHeight = 240;
    }
  
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
  
      this.video.srcObject = this.stream;
      await this.video.play();
  
      this.canvas.width = this.processWidth;
      this.canvas.height = this.processHeight;
  
      this.running = true;
      this.onStatus("Rotation marker tracking ready.");
      this.loop();
    }
  
    stop() {
      this.running = false;
  
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
  
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
  
      this.prevAngle = null;
      this.smoothedMotion = 0;
      this.smoothedEnergy = 0;
    }
  
    emitMetrics(found, motionScore, energyScore) {
      this.onMetrics({
        peopleCount: found ? 1 : 0,
        motionScore,
        energyScore,
      });
    }
  
    detectRotationMarker() {
      this.ctx.drawImage(
        this.video,
        0,
        0,
        this.processWidth,
        this.processHeight,
      );
  
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.processWidth,
        this.processHeight,
      );
  
      const data = imageData.data;
  
      let cyanSumX = 0;
      let cyanSumY = 0;
      let cyanCount = 0;
  
      let magentaSumX = 0;
      let magentaSumY = 0;
      let magentaCount = 0;
  
      for (let y = 0; y < this.processHeight; y += 1) {
        for (let x = 0; x < this.processWidth; x += 1) {
          const i = (y * this.processWidth + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
  
          const isCyan =
            r < 160 &&
            g > 110 &&
            b > 110 &&
            g > r + 20 &&
            b > r + 20;
  
          const isMagenta =
            r > 120 &&
            g < 160 &&
            b > 120 &&
            r > g + 10 &&
            b > g + 10;
  
          if (isCyan) {
            cyanSumX += x;
            cyanSumY += y;
            cyanCount += 1;
          }
  
          if (isMagenta) {
            magentaSumX += x;
            magentaSumY += y;
            magentaCount += 1;
          }
        }
      }
  
      const cyanFound = cyanCount > 400;
      const magentaFound = magentaCount > 25;
  
      if (!cyanFound || !magentaFound) {
        this.prevAngle = null;
        return { found: false, rotationalMotion: 0 };
      }
  
      const cyanCenter = {
        x: cyanSumX / cyanCount,
        y: cyanSumY / cyanCount,
      };
  
      const magentaCenter = {
        x: magentaSumX / magentaCount,
        y: magentaSumY / magentaCount,
      };
  
      const dx = magentaCenter.x - cyanCenter.x;
      const dy = magentaCenter.y - cyanCenter.y;
      const markerRadius = Math.sqrt(dx * dx + dy * dy);
  
      if (markerRadius < 8) {
        this.prevAngle = null;
        return { found: false, rotationalMotion: 0 };
      }
  
      // debug draw
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(cyanCenter.x, cyanCenter.y);
      this.ctx.lineTo(magentaCenter.x, magentaCenter.y);
      this.ctx.stroke();
  
      this.ctx.fillStyle = "#00ff00";
      this.ctx.beginPath();
      this.ctx.arc(cyanCenter.x, cyanCenter.y, 6, 0, Math.PI * 2);
      this.ctx.fill();
  
      this.ctx.fillStyle = "#ff00ff";
      this.ctx.beginPath();
      this.ctx.arc(magentaCenter.x, magentaCenter.y, 6, 0, Math.PI * 2);
      this.ctx.fill();
  
      const angle = Math.atan2(dy, dx);
  
      let rotationalMotion = 0;
  
      if (this.prevAngle !== null) {
        const delta = Math.abs(angleDelta(angle, this.prevAngle));
        const deadZone = 0.03;
        const adjusted = Math.max(0, delta - deadZone);
        const velocity = adjusted * 7;
        const intensity = Math.pow(velocity, 1.4);
        rotationalMotion = Math.min(intensity, 1);
      }
  
      this.prevAngle = angle;
  
      return { found: true, rotationalMotion };
    }
  
    loop() {
      if (!this.running) return;
  
      try {
        const result = this.detectRotationMarker();
        const targetMotion = result.found ? result.rotationalMotion : 0;
  
        this.smoothedMotion =
          this.smoothedMotion * 0.88 + targetMotion * 0.12;
  
        this.smoothedEnergy =
          this.smoothedEnergy + this.smoothedMotion * 0.015;
  
        if (targetMotion < 0.01) {
          this.smoothedEnergy *= 0.994;
        }
  
        this.smoothedEnergy = clamp(this.smoothedEnergy);
  
        if (!result.found) {
          this.smoothedMotion *= 0.9;
          this.smoothedEnergy *= 0.96;
        }
  
        this.emitMetrics(
          result.found,
          clamp(this.smoothedMotion),
          clamp(this.smoothedEnergy),
        );
      } catch (error) {
        console.error("Rotation marker loop failed:", error);
        this.onStatus(`Rotation marker error: ${error.message}`);
        this.emitMetrics(false, 0, 0);
      }
  
      this.timer = setTimeout(() => this.loop(), 100);
    }
  }
