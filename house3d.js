import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export class House3DScene {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x091427, 20, 60);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );
    this.camera.position.set(0, 6, 14);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.loader = new GLTFLoader();

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.modelPivot = new THREE.Group();
    this.root.add(this.modelPivot);

    this.windowMaterials = [];
    this.chimneyBase = new THREE.Vector3(1.5, 4.5, 0.3);

    this.windStrength = 0;
    this.goalReached = false;
    this.smokeActive = false;

    this.targetLookAt = new THREE.Vector3(0, 2, 0);
    this.cameraBasePos = new THREE.Vector3(0, 6, 14);
    this.modelRadius = 4;

    this.trees = [];
    this.leafClusters = [];
    this.grassBlades = [];
    this.solarPanel = null;
    this.batteryFill = null;
    this.batteryFillMat = null;
    this.batteryShell = null;

    this.powerDotsLeft = [];
    this.powerDotsRight = [];
    
    this.powerAura = null;
    this.powerRing = null;
    
    this.windTurbines = [];

    this.lampPost = null;
    this.lampBulbMat = null;
    this.lampGlow = null;
    this.lampLight = null;

    this.createLights();
    this.createEnvironment();
    this.createEffects();
    this.createDecor();
    this.createPowerConnections();
    this.loadHouseModel();

    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);

    this.animate = this.animate.bind(this);
    this.animate();
  }

  createLights() {
    this.scene.add(new THREE.AmbientLight(0xdce8ff, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xd5ebff, 0x0a1423, 0.9));

    this.sunLight = new THREE.DirectionalLight(0xffe4ae, 1.15);
    this.sunLight.position.set(-10, 16, 10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.PointLight(0x6fd6ff, 0.75, 40, 2);
    this.fillLight.position.set(8, 8, 10);
    this.scene.add(this.fillLight);

    this.windowLight = new THREE.PointLight(0xffd38a, 0, 6, 2);
    this.scene.add(this.windowLight);

    const sunGeo = new THREE.SphereGeometry(0.6, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdc7d });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.sun.position.set(-5.6, 7.65, -4);
    this.scene.add(this.sun);

    const sunGlowGeo = new THREE.SphereGeometry(1.28, 24, 24);
    const sunGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffd96e,
      transparent: true,
      opacity: 0.12,
    });
    this.sunGlow = new THREE.Mesh(sunGlowGeo, sunGlowMat);
    this.sunGlow.position.copy(this.sun.position);
    this.scene.add(this.sunGlow);
  }

  createEnvironment() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 80),
      new THREE.MeshStandardMaterial({
        color: 0x183347,
        roughness: 0.96,
        metalness: 0.02,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const greenPatch = new THREE.Mesh(
      new THREE.CircleGeometry(14, 80),
      new THREE.MeshStandardMaterial({
        color: 0x6f8f63,
        roughness: 0.98,
        metalness: 0.01,
      }),
    );
    greenPatch.rotation.x = -Math.PI / 2;
    greenPatch.position.set(0, 0.012, 0);
    greenPatch.receiveShadow = true;
    this.scene.add(greenPatch);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(9.5, 10.2, 80),
      new THREE.MeshBasicMaterial({
        color: 0x234f78,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);
  }

  createEffects() {
    this.smokePuffs = [];
    const smokeGeo = new THREE.SphereGeometry(0.18, 14, 14);

    for (let i = 0; i < 7; i += 1) {
      const puff = new THREE.Mesh(
        smokeGeo,
        new THREE.MeshStandardMaterial({
          color: 0xd9e8ff,
          transparent: true,
          opacity: 0,
          roughness: 1,
        }),
      );
      this.scene.add(puff);
      this.smokePuffs.push({ mesh: puff, phase: i * 0.13 });
    }

    const auraGeo = new THREE.SphereGeometry(3.4, 32, 32);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xffd56b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.powerAura = new THREE.Mesh(auraGeo, auraMat);
    this.powerAura.position.set(0, 2.4, 0.6);
    this.scene.add(this.powerAura);

    const ringGeo = new THREE.RingGeometry(2.2, 2.45, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd56b,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.powerRing = new THREE.Mesh(ringGeo, ringMat);
    this.powerRing.rotation.x = -Math.PI / 2;
    this.powerRing.position.set(0, 0.08, 0.6);
    this.scene.add(this.powerRing);
  }

  createDecor() {
    this.createTrees();
    this.createSolarPanel();
    this.createBatteryMeter();
    this.createWindTurbines();
    this.createLampPost();
  }

  createTrees() {
    this.trees = [];
    this.leafClusters = [];
  
    const treeConfigs = [
      { x: -5.2, z: -0.2, scale: 1.0 },
      { x: -7.0, z: 1.6, scale: 0.82 },
      { x: -6.2, z: -2.1, scale: 0.72 },
      { x: 5.9, z: 1.8, scale: 0.9 },
      { x: 6.8, z: -1.4, scale: 0.68 },
    ];
  
    treeConfigs.forEach((cfg) => {
      const treeData = this.createTree(cfg.x, cfg.z, cfg.scale);
      this.trees.push(treeData);
      this.leafClusters.push(...treeData.leafClusters);
    });
  }

  createTree(x = -5.2, z = -0.2, scale = 1) {
    const tree = new THREE.Group();
  
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.22 * scale, 2.1 * scale, 12),
      new THREE.MeshStandardMaterial({ color: 0x6c4a30, roughness: 0.95 }),
    );
    trunk.position.set(0, 1.05 * scale, 0);
    trunk.castShadow = true;
    tree.add(trunk);
  
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x7fd0a4,
      roughness: 0.92,
    });
  
    const positions = [
      [-0.25, 2.65, 0.05, 0.58],
      [0.1, 2.95, -0.1, 0.66],
      [0.5, 2.7, 0.1, 0.56],
      [0.2, 3.25, 0.0, 0.62],
      [-0.15, 3.1, -0.18, 0.48],
      [0.42, 3.08, 0.16, 0.46],
    ];
  
    const localLeafClusters = positions.map(([lx, ly, lz, r], i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r * scale, 18, 18),
        leafMat.clone(),
      );
      mesh.position.set(lx * scale, ly * scale, lz * scale);
      mesh.castShadow = true;
      tree.add(mesh);
  
      return {
        mesh,
        baseX: lx * scale,
        baseZ: lz * scale,
        phase: i * 0.45 + Math.random() * 0.6,
      };
    });
  
    tree.position.set(x, 0, z);
    this.scene.add(tree);
  
    return {
      group: tree,
      leafClusters: localLeafClusters,
      phase: Math.random() * Math.PI * 2,
    };
  }

  createGrass() {
    this.grassBlades = [];
    const bladeGeo = new THREE.BoxGeometry(0.045, 0.82, 0.045);

    const bladeMatA = new THREE.MeshStandardMaterial({
      color: 0x8ce5b0,
      emissive: 0x12391f,
      emissiveIntensity: 0.06,
      roughness: 0.95,
    });

    const bladeMatB = new THREE.MeshStandardMaterial({
      color: 0x5fcf91,
      emissive: 0x12391f,
      emissiveIntensity: 0.06,
      roughness: 0.95,
    });

    const createBlade = (x, z, scaleY, rotZ, phase, mat) => {
      const blade = new THREE.Mesh(bladeGeo, mat);
      blade.position.set(x, 0.38, z);
      blade.scale.y = scaleY;
      blade.rotation.z = rotZ;
      blade.castShadow = true;
      this.scene.add(blade);
      this.grassBlades.push({ mesh: blade, baseRotZ: rotZ, phase });
    };

    for (let i = 0; i < 20; i += 1) {
      createBlade(
        -6.05 + i * 0.23,
        1.55 + (i % 3) * 0.16,
        0.95 + (i % 4) * 0.26,
        -0.28 - (i % 2) * 0.08,
        i * 0.32,
        i % 2 === 0 ? bladeMatA : bladeMatB,
      );
    }

    for (let i = 0; i < 20; i += 1) {
      createBlade(
        1.7 + i * 0.22,
        1.45 + (i % 3) * 0.16,
        0.92 + (i % 4) * 0.24,
        -0.24 - (i % 2) * 0.09,
        1.7 + i * 0.28,
        i % 2 === 0 ? bladeMatA : bladeMatB,
      );
    }
  }

  createSolarPanel() {
    this.loader.load(
      "./assets/Solarbattery.glb",
      (gltf) => {
        const panel = gltf.scene;
        const panelFaceMaterials = [];
  
        panel.traverse((obj) => {
          if (!obj.isMesh) return;
  
          obj.castShadow = true;
          obj.receiveShadow = true;
  
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material = obj.material.map((m) => m.clone());
            } else {
              obj.material = obj.material.clone();
            }
  
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  
            mats.forEach((mat) => {
              if (!mat || !("color" in mat)) return;
  
              const c = mat.color;
              const name = `${obj.name || ""} ${mat.name || ""}`.toLowerCase();
  
              const looksBlue =
                c.b > 0.22 &&
                c.b >= c.r * 1.05 &&
                c.b >= c.g * 1.02;
  
              const looksLikePanelByName =
                name.includes("panel") ||
                name.includes("solar") ||
                name.includes("cell") ||
                name.includes("glass");
  
              if ((looksBlue || looksLikePanelByName) && "emissive" in mat) {
                mat.emissive = new THREE.Color(0x4fc3ff);
                mat.emissiveIntensity = 0.02;
                panelFaceMaterials.push(mat);
              }
            });
          }
        });
  
        const uniqueFaceMaterials = [...new Set(panelFaceMaterials)];
  
        const box = new THREE.Box3().setFromObject(panel);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
  
        const desiredHeight = 1.8;
        const scale = desiredHeight / Math.max(size.y, 0.001);
        panel.scale.setScalar(scale);
  
        panel.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(panel);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);
  
        panel.position.x -= scaledCenter.x;
        panel.position.y -= scaledBox.min.y;
        panel.position.z -= scaledCenter.z;
  
        panel.position.add(new THREE.Vector3(-3.6, 0.0, 1.7));
        panel.rotation.y = -Math.PI / 2;
  
        this.solarPanel = {
          model: panel,
          faceMaterials: uniqueFaceMaterials,
        };
  
        this.scene.add(panel);
        console.log("Solarbattery.glb loaded successfully", uniqueFaceMaterials.length);
      },
      undefined,
      (error) => {
        console.error("Failed to load Solarbattery.glb", error);
      },
    );
  }

  createBatteryMeter() {
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 2.25, 0.78),
      new THREE.MeshStandardMaterial({
        color: 0x173253,
        roughness: 0.45,
        metalness: 0.22,
      }),
    );
    shell.position.set(4.0, 1.45, 1.2);
    shell.castShadow = true;

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.1, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xb7d8ff }),
    );
    cap.position.set(0, 1.18, 0);
    shell.add(cap);

    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 1.58, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x0b1a2a,
        roughness: 0.7,
        metalness: 0.02,
      }),
    );
    cavity.position.set(0, -0.08, 0.34);
    shell.add(cavity);

    this.batteryFillMat = new THREE.MeshStandardMaterial({
      color: 0x9fe3ff,
      emissive: 0x7fd2ff,
      emissiveIntensity: 0.35,
      roughness: 0.18,
      metalness: 0.08,
    });

    this.batteryFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 1.56, 0.04),
      this.batteryFillMat,
    );
    this.batteryFill.geometry.translate(0, 0.5, 0);
    this.batteryFill.position.set(0, -0.86, 0.39);
    this.batteryFill.scale.y = 0.02;

    shell.add(this.batteryFill);

    this.batteryShell = shell;
    this.scene.add(shell);
  }

  createLampPost() {
    this.loader.load(
      "./assets/lampost.gltf",
      (gltf) => {
        const lamp = gltf.scene;
  
        lamp.scale.set(0.8, 0.8, 0.8);
        lamp.position.set(3.2, 0, 2.1);
        lamp.rotation.y = -0.4;
  
        lamp.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
  
        this.scene.add(lamp);
        this.lampPost = lamp;
  
        this.lampLight = new THREE.PointLight(0xffd36b, 0, 8, 2);
        this.lampLight.position.set(3.2, 2.8, 2.1);
        this.scene.add(this.lampLight);
      },
      undefined,
      (error) => {
        console.error("Failed to load lamp post:", error);
      },
    );
  }

  createWindTurbines() {
    this.windTurbines = [];
  
    const createSingleTurbine = (x, z, towerHeight = 4.6, scale = 1) => {
      const turbine = new THREE.Group();
  
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08 * scale, 0.14 * scale, towerHeight * scale, 16),
        new THREE.MeshStandardMaterial({
          color: 0xdfe7f2,
          roughness: 0.82,
          metalness: 0.18,
        }),
      );
      tower.position.set(0, (towerHeight * scale) / 2, 0);
      tower.castShadow = true;
      tower.receiveShadow = true;
      turbine.add(tower);
  
      const nacelle = new THREE.Mesh(
        new THREE.BoxGeometry(0.42 * scale, 0.2 * scale, 0.2 * scale),
        new THREE.MeshStandardMaterial({
          color: 0xe8eef7,
          roughness: 0.75,
          metalness: 0.16,
        }),
      );
      nacelle.position.set(0, towerHeight * scale, 0);
      nacelle.castShadow = true;
      turbine.add(nacelle);
  
      const hub = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 * scale, 16, 16),
        new THREE.MeshStandardMaterial({
          color: 0xf2f6fb,
          roughness: 0.7,
          metalness: 0.12,
        }),
      );
      hub.position.set(0.22 * scale, towerHeight * scale, 0);
      hub.castShadow = true;
      turbine.add(hub);
  
      const rotor = new THREE.Group();
      rotor.position.set(0.22 * scale, towerHeight * scale, 0);
  
      const bladeMaterial = new THREE.MeshStandardMaterial({
        color: 0xf4f7fb,
        roughness: 0.72,
        metalness: 0.08,
      });
  
      for (let i = 0; i < 3; i += 1) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.06 * scale, 1.05 * scale, 0.03 * scale),
          bladeMaterial,
        );
      
        // move blade outward from hub
        blade.position.set(0, 0.52 * scale, 0);
        blade.castShadow = true;
        blade.receiveShadow = true;
      
        const bladePivot = new THREE.Group();
        bladePivot.rotation.x = (i / 3) * Math.PI * 2;
        bladePivot.add(blade);
        rotor.add(bladePivot);
      }
  
      turbine.add(rotor);
  
      turbine.position.set(x, 0, z);
turbine.rotation.y = -Math.PI * 0.25;   // rotate slightly toward viewer
this.scene.add(turbine);
  
      this.windTurbines.push({
        group: turbine,
        rotor,
        baseY: turbine.position.y,
        phase: Math.random() * Math.PI * 2,
      });
    };
  
    createSingleTurbine(-2.3, -3.9, 4.8, 1.0);
    createSingleTurbine(3.2, -4.4, 5.2, 1.05);
  }

  createPowerConnections() {
    const dotGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const dotMatLeft = new THREE.MeshBasicMaterial({
      color: 0x8fd6ff,
      transparent: true,
      opacity: 0,
    });
    const dotMatRight = new THREE.MeshBasicMaterial({
      color: 0x8fd6ff,
      transparent: true,
      opacity: 0,
    });

    for (let i = 0; i < 10; i += 1) {
      const dotL = new THREE.Mesh(dotGeo, dotMatLeft.clone());
      const dotR = new THREE.Mesh(dotGeo, dotMatRight.clone());
      this.scene.add(dotL);
      this.scene.add(dotR);
      this.powerDotsLeft.push({ mesh: dotL, phase: i / 10 });
      this.powerDotsRight.push({ mesh: dotR, phase: i / 10 });
    }
  }

  clearModel() {
    while (this.modelPivot.children.length) {
      this.modelPivot.remove(this.modelPivot.children[0]);
    }
    this.windowMaterials = [];
  }

  loadHouseModel() {
    this.loader.load(
      "./assets/house.glb",
      (gltf) => {
        this.clearModel();
        this.setupLoadedModel(gltf.scene);
      },
      undefined,
      () => {
        this.clearModel();
        this.createFallbackHouse();
      },
    );
  }

  setupLoadedModel(model) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;

      obj.castShadow = true;
      obj.receiveShadow = true;

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((m) => m.clone());
        } else {
          obj.material = obj.material.clone();
        }
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat) return;
        mat.side = THREE.DoubleSide;
        if ("toneMapped" in mat) mat.toneMapped = true;
      });

      const n = obj.name.toLowerCase();
      if (n.includes("window") || n.includes("glass")) {
        const mat = mats[0];
        if (mat && "emissive" in mat) {
          mat.emissive = new THREE.Color(0xffc35a);
          mat.emissiveIntensity = 0;
        }
        this.windowMaterials.push(mat);
      }

      if (n.includes("chimney")) {
        const pos = new THREE.Vector3();
        obj.getWorldPosition(pos);
        this.chimneyBase.copy(pos);
      }
    });

    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.rotation.y = Math.PI;
    this.modelPivot.add(wrapper);

    this.fitModelToView(wrapper);

    if (this.windowMaterials.length === 0) {
      model.traverse((obj) => {
        if (!obj.isMesh) return;

        const name = obj.name.toLowerCase();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

        mats.forEach((mat) => {
          if (!mat || !("color" in mat)) return;

          const isLikelyWindowByName =
            name.includes("window") ||
            name.includes("glass");

          const isLikelyWindowByColor =
            mat.color.r > 0.94 &&
            mat.color.g > 0.94 &&
            mat.color.b > 0.94 &&
            Math.abs(mat.color.r - mat.color.g) < 0.05 &&
            Math.abs(mat.color.g - mat.color.b) < 0.05;

          if (isLikelyWindowByName || isLikelyWindowByColor) {
            if ("emissive" in mat) {
              mat.emissive = new THREE.Color(0xffc56a);
              mat.emissiveIntensity = 0;
            }
            this.windowMaterials.push(mat);
          }
        });
      });
    }
  }

  fitModelToView(wrapper) {
    wrapper.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(wrapper);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const desiredSize = 7.2;
    const scale = desiredSize / maxDim;
    wrapper.scale.setScalar(scale);

    wrapper.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(wrapper);
    const center2 = new THREE.Vector3();
    box2.getCenter(center2);

    wrapper.position.x -= center2.x;
    wrapper.position.z -= center2.z;

    wrapper.updateMatrixWorld(true);

    const box3 = new THREE.Box3().setFromObject(wrapper);
    wrapper.position.y -= box3.min.y;

    wrapper.updateMatrixWorld(true);

    const finalBox = new THREE.Box3().setFromObject(wrapper);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);

    const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
    this.modelRadius = sphere.radius;
    this.targetLookAt.copy(finalCenter).setY(finalCenter.y + sphere.radius * 0.22);
    this.cameraBasePos.set(0, sphere.radius * 1.15, sphere.radius * 2.9);

    this.windowLight.position.set(
      finalCenter.x,
      finalCenter.y + sphere.radius * 0.32,
      finalCenter.z + sphere.radius * 0.08,
    );
  }

  createFallbackHouse() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 2.6, 3.4),
      new THREE.MeshStandardMaterial({ color: 0xd8e4f4, roughness: 0.75 }),
    );
    body.position.set(0, 2, 0);
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.7, 1.8, 4),
      new THREE.MeshStandardMaterial({ color: 0x66738a, roughness: 0.85 }),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 4.05, 0);
    group.add(roof);

    const windowMatA = new THREE.MeshStandardMaterial({
      color: 0xe8edf7,
      emissive: 0xffc35a,
      emissiveIntensity: 0,
    });
    const windowMatB = windowMatA.clone();

    const w1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.82, 0.08),
      windowMatA,
    );
    w1.position.set(-1.2, 2.25, 1.74);
    group.add(w1);

    const w2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.82, 0.08),
      windowMatB,
    );
    w2.position.set(1.2, 2.25, 1.74);
    group.add(w2);

    this.windowMaterials = [windowMatA, windowMatB];
    this.modelPivot.add(group);
    this.fitModelToView(group);
  }

  update(state) {
    this.windStrength = clamp(state.wind);
    this.goalReached = Boolean(state.goalReached);
  
    const electricity = clamp(state.electricity);
    const storage = clamp(state.storage);
  
    const glowAmount = this.goalReached ? 1 : 0;
  
    this.windowMaterials.forEach((mat) => {
      if (!mat) return;
      if ("emissive" in mat) {
        mat.emissive = new THREE.Color(0xffc56a);
        mat.emissiveIntensity = glowAmount * 0.22;
      }
    });
  
    this.windowLight.color = new THREE.Color(0xffd38a);
    this.windowLight.intensity = this.goalReached ? 0.18 : 0;
  
    if (this.solarPanel && this.solarPanel.faceMaterials) {
      this.solarPanel.faceMaterials.forEach((mat) => {
        if (!mat) return;
        mat.emissiveIntensity = 0.02 + electricity * 0.28;
      });
    }
  
    if (this.batteryFill) {
      const fill = clamp(storage, 0.02, 1);
      const visualFill = fill >= 0.98 ? 1.03 : fill;
      this.batteryFill.scale.y = visualFill;
    }
  
    if (this.batteryFillMat) {
      this.batteryFillMat.emissiveIntensity = 0.18 + storage * 1.1;
    }
  
    if (this.lampBulbMat) {
      const targetBulbEmissive = this.goalReached ? 2.2 : 0;
      this.lampBulbMat.emissive = new THREE.Color(0xffd36b);
      this.lampBulbMat.emissiveIntensity +=
        (targetBulbEmissive - this.lampBulbMat.emissiveIntensity) * 0.08;
    }
  
    if (this.lampGlow && this.lampGlow.material) {
      const targetGlowOpacity = this.goalReached ? 0.42 : 0;
      this.lampGlow.material.opacity +=
        (targetGlowOpacity - this.lampGlow.material.opacity) * 0.08;
    }
  
    if (this.lampLight) {
      const targetIntensity = this.goalReached ? 2.8 : 0;
      this.lampLight.intensity +=
        (targetIntensity - this.lampLight.intensity) * 0.08;
    }
  
    this.smokeActive = this.goalReached;
  }

  animate() {
    requestAnimationFrame(this.animate);

    const t = this.clock.getElapsedTime();

    this.sun.position.y = 7.65 + Math.sin(t * 0.8) * 0.08;
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.scale.setScalar(1 + Math.sin(t * 1.4) * 0.05);

    const orbitX = Math.sin(t * 0.18) * (this.modelRadius * 0.12);
    const orbitY = Math.sin(t * 0.25) * (this.modelRadius * 0.03);

    this.camera.position.set(
      this.cameraBasePos.x + orbitX,
      this.cameraBasePos.y + orbitY,
      this.cameraBasePos.z,
    );
    this.camera.lookAt(this.targetLookAt);

    if (this.modelPivot.children[0]) {
      this.modelPivot.children[0].rotation.y = Math.sin(t * 0.2) * 0.05;
    }

    this.trees.forEach((treeData, i) => {
      treeData.group.rotation.y =
        Math.sin(t * 0.45 + treeData.phase + i * 0.25) * 0.05;
    });

    this.leafClusters.forEach((leaf, i) => {
      const motion = 0.08 + this.windStrength * 0.34;
      leaf.mesh.position.x =
        leaf.baseX + Math.sin(t * (1.9 + i * 0.08) + leaf.phase) * motion;
      leaf.mesh.position.z =
        leaf.baseZ + Math.cos(t * (1.35 + i * 0.07) + leaf.phase) * motion * 0.8;
      leaf.mesh.rotation.z =
        Math.sin(t * (2.4 + i * 0.12) + leaf.phase) * (0.14 + this.windStrength * 0.8);
    });

    this.grassBlades.forEach((blade) => {
      blade.mesh.rotation.z =
        blade.baseRotZ +
        Math.sin(t * 4.1 + blade.phase) * (0.24 + this.windStrength * 0.95);
    });

    this.powerDotsLeft.forEach((dot) => {
      const active = this.goalReached;
      const u = (t * 0.6 + dot.phase) % 1;
      const start = new THREE.Vector3(-3.1, 1.9, 1.6);
      const end = new THREE.Vector3(-0.8, 2.2, 1.2);
      dot.mesh.position.lerpVectors(start, end, u);
      dot.mesh.position.y += Math.sin(u * Math.PI) * 0.28;
      dot.mesh.material.opacity = active
        ? 0.9 * (1 - Math.abs(u - 0.5) * 1.2)
        : 0;
    });

    this.powerDotsRight.forEach((dot) => {
      const active = this.goalReached;
      const u = (t * 0.6 + dot.phase) % 1;
      const start = new THREE.Vector3(4.6, 1.5, 1.4);
      const end = new THREE.Vector3(1.3, 2.05, 1.1);
      dot.mesh.position.lerpVectors(start, end, u);
      dot.mesh.position.y += Math.sin(u * Math.PI) * 0.22;
      dot.mesh.material.opacity = active
        ? 0.9 * (1 - Math.abs(u - 0.5) * 1.2)
        : 0;
    });

    this.smokePuffs.forEach((puff, i) => {
      const cycle = (t * 0.55 + puff.phase) % 1;
      puff.mesh.visible = this.smokeActive;
      puff.mesh.material.opacity = this.smokeActive
        ? Math.max(0, 0.42 - cycle * 0.42)
        : 0;

      puff.mesh.position.set(
        this.chimneyBase.x + Math.sin(cycle * 7 + i) * 0.18,
        this.chimneyBase.y + cycle * 1.8,
        this.chimneyBase.z + Math.cos(cycle * 5 + i) * 0.12,
      );
      puff.mesh.scale.setScalar(0.8 + cycle * 1.4);
    });

    if (this.powerAura) {
      const targetOpacity = this.goalReached ? 0.14 : 0;
      const pulse = this.goalReached ? 1 + Math.sin(t * 2.2) * 0.06 : 1;

      this.powerAura.material.opacity +=
        (targetOpacity - this.powerAura.material.opacity) * 0.08;
      this.powerAura.scale.setScalar(pulse);
    }

    if (this.powerRing) {
      const targetOpacity = this.goalReached ? 0.22 : 0;
      const ringScale = this.goalReached ? 1 + Math.sin(t * 1.8) * 0.08 : 1;

      this.powerRing.material.opacity +=
        (targetOpacity - this.powerRing.material.opacity) * 0.08;
      this.powerRing.scale.set(ringScale, ringScale, ringScale);
    }

    this.windTurbines.forEach((turbine, i) => {
      const spinSpeed = 0.04 + this.windStrength * 0.08;
    
      turbine.rotor.rotation.x -= spinSpeed;
    
      turbine.group.position.y =
        turbine.baseY + Math.sin(t * 1.2 + turbine.phase + i * 0.4) * 0.015;
    });

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }
}
