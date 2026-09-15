/**
 * BrainVisualizer.js — a lightweight Three.js 3D viewport rendering four
 * (plus one bonus) functional Drosophila brain regions as glowing GCaMP-style
 * structures, driven by whatever FlyNeuralState snapshot `getState()` returns
 * each frame.
 *
 * This module never imports FlyNeuralEngine or PacmanGame — it only calls
 * the `getState` function it's given. That keeps the 3D layer fully
 * decoupled: the arcade loop never waits on it, and it never reaches back
 * into gameplay.
 *
 * Requires the global THREE (r128) plus the classic examples/js builds of
 * EffectComposer / RenderPass / UnrealBloomPass / ShaderPass / OrbitControls,
 * loaded via <script> tags before this file — see index.html.
 */

class BrainVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => import('./FlyNeuralEngine.js').FlyNeuralState} getState
   */
  constructor(canvas, getState) {
    this.canvas = canvas;
    this.getState = getState;
    this.running = false;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.6, 6.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.ambientLight = new THREE.AmbientLight(0x333344, 1.2);
    this.scene.add(this.ambientLight);
    const key = new THREE.PointLight(0x8888ff, 0.6, 20);
    key.position.set(3, 4, 4);
    this.scene.add(key);

    this._buildRegions();
    this._buildImagingField();
    this._buildBloom(width, height);

    if (typeof THREE.OrbitControls === 'function') {
      this.controls = new THREE.OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 3;
      this.controls.maxDistance = 12;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.6;
    }

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // -------------------------------------------------------------------
  // Scene construction
  // -------------------------------------------------------------------

  _glowMaterial(color, intensity = 0.2) {
    return new THREE.MeshStandardMaterial({
      color: 0x14141c,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      roughness: 0.45,
      metalness: 0.1,
    });
  }

  _buildRegions() {
    const group = new THREE.Group();
    this.scene.add(group);
    this.root = group;

    // A dense point cloud gives the viewport the crisp-center / diffuse-halo
    // character of two-photon calcium imaging instead of solid cartoon nodes.
    const neuronPositions = [];
    let seed = 90317;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 720; i++) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = 0.35 + random() * 1.35;
      neuronPositions.push(
        Math.sin(phi) * Math.cos(theta) * radius * 1.15,
        Math.cos(phi) * radius * 0.82,
        Math.sin(phi) * Math.sin(theta) * radius * 0.68
      );
    }
    const neuronGeometry = new THREE.BufferGeometry();
    neuronGeometry.setAttribute('position', new THREE.Float32BufferAttribute(neuronPositions, 3));
    const neuronMaterial = new THREE.PointsMaterial({
      color: 0x7de8ff,
      size: 0.055,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const neuronCloud = new THREE.Points(neuronGeometry, neuronMaterial);
    group.add(neuronCloud);
    this.neuronCloud = neuronCloud;
    const haloMaterial = neuronMaterial.clone();
    haloMaterial.color.set(0x1b6680);
    haloMaterial.size = 0.16;
    haloMaterial.opacity = 0.08;
    const haloCloud = new THREE.Points(neuronGeometry, haloMaterial);
    group.add(haloCloud);
    this.neuronHalo = haloCloud;

    // --- Ellipsoid Body: a toroidal ring + one orbiting "phase bump" ---
    const ebGroup = new THREE.Group();
    ebGroup.position.set(0, 1.6, 0);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.14, 20, 48),
      this._glowMaterial(0x33e0ff, 0.15)
    );
    ring.rotation.x = Math.PI / 2.1;
    ebGroup.add(ring);
    const bump = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 20, 20),
      this._glowMaterial(0x33e0ff, 1.2)
    );
    ebGroup.add(bump);
    group.add(ebGroup);
    this.ellipsoidBody = { group: ebGroup, ring, bump, radius: 1.1 };

    // --- Mushroom Body: bilateral lobes ---
    const mbGroup = new THREE.Group();
    mbGroup.position.set(0, 0.3, 0);
    const lobeGeo = new THREE.SphereGeometry(0.55, 20, 20);
    const lobeL = new THREE.Mesh(lobeGeo, this._glowMaterial(0xffb800, 0.15));
    lobeL.position.set(-0.75, 0, 0);
    lobeL.scale.set(1, 1.3, 0.8);
    const lobeR = lobeL.clone();
    lobeR.position.set(0.75, 0, 0);
    mbGroup.add(lobeL, lobeR);
    group.add(mbGroup);
    this.mushroomBody = { group: mbGroup, lobes: [lobeL, lobeR] };

    // --- PAM cluster: small spheres flanking the mushroom body ---
    const pamGroup = new THREE.Group();
    pamGroup.position.set(0, 0.3, 0.9);
    const pamSpheres = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), this._glowMaterial(0xffaa33, 0.2));
      const angle = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.25, 0);
      pamGroup.add(s);
      pamSpheres.push(s);
    }
    group.add(pamGroup);
    this.pamCluster = { group: pamGroup, spheres: pamSpheres };

    // --- PPL1 cluster: aversive/negative-reinforcement, purple ---
    const ppl1Group = new THREE.Group();
    ppl1Group.position.set(0, 0.3, -0.9);
    const ppl1Spheres = [];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), this._glowMaterial(0xa020f0, 0.12));
      const angle = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(angle) * 0.7, Math.sin(angle) * 0.2, 0);
      ppl1Group.add(s);
      ppl1Spheres.push(s);
    }
    group.add(ppl1Group);
    this.ppl1Cluster = { group: ppl1Group, spheres: ppl1Spheres };

    // --- Giant Fiber System: a ganglion + descending axon tubes ---
    const gfGroup = new THREE.Group();
    gfGroup.position.set(0, -0.7, 0);
    const ganglion = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), this._glowMaterial(0x33e0ff, 0.2));
    gfGroup.add(ganglion);
    const axons = [];
    for (let i = -1; i <= 1; i += 2) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(i * 0.3, -0.6, 0.1),
        new THREE.Vector3(i * 0.5, -1.3, 0),
      ]);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 20, 0.045, 8, false),
        this._glowMaterial(0x33e0ff, 0.2)
      );
      gfGroup.add(tube);
      axons.push(tube);
    }
    group.add(gfGroup);
    this.giantFiber = { group: gfGroup, ganglion, axons };
  }

  _buildImagingField() {
    const field = new THREE.Group();
    field.position.z = -0.35;
    this.scene.add(field);
    const grid = new THREE.GridHelper(5.4, 18, 0x155064, 0x0b2834);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.8;
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    field.add(grid);
    const fiberMaterial = new THREE.LineBasicMaterial({
      color: 0x17657a, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    const fibers = new THREE.Group();
    let seed = 417;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 34; i++) {
      const points = [];
      const start = new THREE.Vector3((random() - 0.5) * 3.4, (random() - 0.5) * 2.8, (random() - 0.5) * 1.2);
      for (let j = 0; j < 7; j++) {
        points.push(new THREE.Vector3(
          start.x + (random() - 0.5) * 1.2,
          start.y + (j - 3) * 0.22 + (random() - 0.5) * 0.18,
          start.z + (random() - 0.5) * 0.35
        ));
      }
      fibers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), fiberMaterial));
    }
    field.add(fibers);
    this.imagingField = { group: field, grid, fibers };
  }

  _buildBloom(width, height) {
    if (typeof THREE.EffectComposer !== 'function' || typeof THREE.UnrealBloomPass !== 'function') {
      this.composer = null; // graceful fallback: plain renderer.render()
      return;
    }
    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(width, height), 1.1, 0.6, 0.15);
    this.composer.addPass(bloom);
    this.bloomPass = bloom;
  }

  _onResize() {
    const width = this.canvas.clientWidth || 320;
    const height = this.canvas.clientHeight || 360;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.composer) this.composer.setSize(width, height);
  }

  // -------------------------------------------------------------------
  // Per-frame update, driven purely by the state snapshot
  // -------------------------------------------------------------------

  _applyState(state, dt) {
    const activity = Math.max(state.arousalLevel || 0, state.panicLevel || 0, state.dopamineTransient || 0);
    // Ellipsoid Body: the active bump orbits the ring at the current heading.
    const { ring, bump, radius } = this.ellipsoidBody;
    const targetX = Math.cos(state.headingAngle) * radius;
    const targetZ = Math.sin(state.headingAngle) * radius;
    bump.position.x += (targetX - bump.position.x) * Math.min(1, dt * 10);
    bump.position.z += (targetZ - bump.position.z) * Math.min(1, dt * 10);
    ring.material.emissiveIntensity = 0.12 + state.panicLevel * 0.5 + state.octopamineLevel * 0.25;

    // Mushroom Body: gold flash on dopamine transient.
    for (const lobe of this.mushroomBody.lobes) {
      lobe.material.emissiveIntensity = 0.12 + state.dopamineTransient * 2.2;
    }

    // PAM cluster: baseline dimly tracks hunger (npf), flashes gold with dopamine.
    for (const s of this.pamCluster.spheres) {
      s.material.emissiveIntensity = 0.08 + state.npfLevel * 0.35 + state.dopamineTransient * 1.4;
    }

    // PPL1 cluster: purple aversive flash.
    for (const s of this.ppl1Cluster.spheres) {
      s.material.emissiveIntensity = 0.05 + state.ppl1Transient * 2.0;
    }

    // Giant Fiber: cyan/white burst on escape reflex firing.
    const gfIntensity = state.giantFiberFiring ? 2.4 : 0.15 + state.panicLevel * 0.6 + state.octopamineLevel * 0.3;
    this.giantFiber.ganglion.material.emissiveIntensity = gfIntensity;
    for (const axon of this.giantFiber.axons) axon.material.emissiveIntensity = gfIntensity;
    const gfColor = state.giantFiberFiring ? 0xffffff : 0x33e0ff;
    this.giantFiber.ganglion.material.emissive.set(gfColor);
    for (const axon of this.giantFiber.axons) axon.material.emissive.set(gfColor);

    // Overall scene brightness breathes with arousal — a hyper-alert brain
    // reads as a brighter, more "lit up" viewport, a distracted/calm one dims.
    if (this.ambientLight) {
      this.ambientLight.intensity = 1.0 + (state.arousalLevel || 0) * 0.9;
    }
    if (this.neuronCloud) {
      this.neuronCloud.material.opacity = 0.18 + (state.arousalLevel || 0) * 0.62;
      this.neuronCloud.material.size = 0.035 + activity * 0.055;
      this.neuronCloud.rotation.y += dt * 0.08;
    }
    if (this.neuronHalo) {
      this.neuronHalo.material.opacity = 0.05 + activity * 0.2;
      this.neuronHalo.material.size = 0.12 + activity * 0.1;
      this.neuronHalo.rotation.y -= dt * 0.035;
    }
    if (this.imagingField) {
      this.imagingField.grid.material.opacity = 0.12 + activity * 0.24;
      this.imagingField.fibers.rotation.z += dt * 0.012;
      this.imagingField.fibers.children.forEach((fiber, index) => {
        fiber.material.opacity = 0.12 + activity * 0.4 + (index % 5 === 0 ? (state.dopamineTransient || 0) * 0.5 : 0);
      });
    }
  }

  // -------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------

  start() {
    this.running = true;
    this._lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }
  stop() { this.running = false; }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this._lastTime) / 1000);
    this._lastTime = now;

    const state = this.getState();
    if (state) this._applyState(state, dt);
    if (this.controls) this.controls.update();

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    requestAnimationFrame((t) => this._loop(t));
  }
}
