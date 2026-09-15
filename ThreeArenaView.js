/* Synchronized 3D presentation and compound-eye raycast sensor. */
class ThreeArenaView {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02070b);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.raycaster = new THREE.Raycaster();
    this.walls = [];
    this._build();
    this._resize();
    addEventListener('resize', () => this._resize());
    this.running = true;
    requestAnimationFrame(() => this._loop());
  }
  _build() {
    this.scene.add(new THREE.HemisphereLight(0x8bdff0, 0x061018, 1.5));
    const key = new THREE.DirectionalLight(0x9befff, 1.8);
    key.position.set(0, 25, 8);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x06151c, roughness: .9 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    const group = new THREE.Group();
    for (let row = 0; row < 72; row += 2) for (let col = 0; col < 56; col += 2) {
      const tile = this.game.tileAt(row + 6, col);
      if (tile === '|') {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.8, 1.7), new THREE.MeshStandardMaterial({ color: 0x145064, emissive: 0x062733, emissiveIntensity: .7 }));
        wall.position.set(col - 28, .9, row - 31); group.add(wall); this.walls.push(wall);
      }
    }
    this.scene.add(group);
    this.avatar = new THREE.Mesh(new THREE.SphereGeometry(.65, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0x8a4f00, emissiveIntensity: .8 }));
    this.scene.add(this.avatar);
    this.ghostGroup = new THREE.Group(); this.scene.add(this.ghostGroup);
    for (let i = 0; i < 4; i++) {
      const ghost = new THREE.Mesh(new THREE.SphereGeometry(.55, 12, 10), new THREE.MeshStandardMaterial({ color: [0xff476d,0xffa8e0,0x42e7ef,0xffc857][i], emissive: 0x221018, emissiveIntensity: .5 }));
      this.ghostGroup.add(ghost);
    }
  }
  _resize() { const w = this.canvas.clientWidth || 320, h = this.canvas.clientHeight || 260; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false); }
  _position(actor) { return new THREE.Vector3(actor.col - 28, .7, actor.row - 31); }
  sense() {
    const p = this._position(this.game.pac), angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[this.game.pac.dir];
    const hits = [];
    for (let i = -3; i <= 3; i++) {
      const ray = new THREE.Vector3(Math.cos(angle + i * .14), 0, Math.sin(angle + i * .14));
      this.raycaster.set(p, ray); const hit = this.raycaster.intersectObjects(this.walls, false)[0];
      hits.push(hit ? Math.min(1, hit.distance / 12) : 1);
    }
    return { raycastVision: hits, raycastLooming: 1 - Math.min(...hits), raycastCenter: hits[3] };
  }
  _loop() {
    if (!this.running) return;
    const p = this._position(this.game.pac), dir = DIRS[this.game.pac.dir];
    this.avatar.position.lerp(p, .18);
    this.camera.position.lerp(new THREE.Vector3(p.x - dir.dx * 8, 5.5, p.z - dir.dy * 8), .08);
    this.camera.lookAt(p.x, .3, p.z);
    this.game.ghosts.forEach((g, i) => { const ghost = this.ghostGroup.children[i]; ghost.position.lerp(this._position(g), .2); });
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }
}
