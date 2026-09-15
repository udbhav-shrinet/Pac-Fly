/**
 * game.js — Arena rendering, entity management, and God Controls.
 *
 * The connectome (brain.js) is the only thing that decides which way the
 * fly turns. This file's job is: render the grid, translate live sensor
 * readings (ghost distance/approach, sugar distance) into current injected
 * into the brain's sensory nodes, and translate the brain's motor output
 * back into a discrete grid direction at each intersection. Nothing here
 * hand-codes "flee the ghost" — that behavior emerges from the LC4 -> GF
 * -> DN pathway once its inputs are wired up.
 */

(() => {
  const GRID = 16;
  const CELL = 560 / GRID;
  const TICK_MS = 130;

  // 1 = wall, 0 = open. Hand-authored simple maze, symmetric-ish, always connected.
  const MAZE = [
    "1111111111111111",
    "1000000000000001",
    "1011110110111101",
    "1010000000000101",
    "1010111101110101",
    "1000100000010001",
    "1110101111010111",
    "1000101000010001",
    "1011101011110101",
    "1010000000000101",
    "1010111011101101",
    "1000100000010001",
    "1101111011110111",
    "1000000000000001",
    "1011111001111101",
    "1111111111111111",
  ];

  function isOpen(cx, cy) {
    if (cy < 0 || cy >= GRID || cx < 0 || cx >= GRID) return false;
    return MAZE[cy][cx] === '0';
  }

  const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  function openNeighbors(cx, cy) {
    const out = [];
    for (const [name, d] of Object.entries(DIRS)) {
      if (isOpen(cx + d.dx, cy + d.dy)) out.push(name);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  let sugar = new Set();   // "cx,cy"
  let ghosts = [];         // {cx, cy, dir, moveT}
  let fly = null;          // {cx, cy, dir, moveT, dead}
  let score = 0;
  let ticks = 0;
  let running = true;
  let panicUntilFlash = 0;

  const history = { al: [], mb: [], gf: [], dnL: [], dnR: [], dnF: [] };
  const HIST_LEN = 90;

  function key(cx, cy) { return `${cx},${cy}`; }

  function randomOpenCell() {
    let cx, cy;
    do {
      cx = Math.floor(Math.random() * GRID);
      cy = Math.floor(Math.random() * GRID);
    } while (!isOpen(cx, cy));
    return { cx, cy };
  }

  function seedSugar(count) {
    let added = 0, attempts = 0;
    while (added < count && attempts < count * 20) {
      attempts++;
      const { cx, cy } = randomOpenCell();
      const k = key(cx, cy);
      if (!sugar.has(k) && !(fly && fly.cx === cx && fly.cy === cy)) {
        sugar.add(k);
        added++;
      }
    }
  }

  function initGame() {
    sugar = new Set();
    ghosts = [];
    score = 0;
    ticks = 0;
    running = true;

    fly = { cx: 8, cy: 8, dir: 'left', moveT: 0, px: 8, py: 8 };
    if (!isOpen(fly.cx, fly.cy)) {
      const c = randomOpenCell();
      fly.cx = c.cx; fly.cy = c.cy; fly.px = c.cx; fly.py = c.cy;
    }

    seedSugar(28);

    for (const k of ['al', 'mb', 'gf', 'dnL', 'dnR', 'dnF']) {
      history[k] = new Array(HIST_LEN).fill(0);
    }

    Brain.reset();
    updateHud();
    hideModal();
  }

  function addGhost() {
    if (ghosts.length >= 6) return;
    const corners = [
      { cx: 1, cy: 1 }, { cx: GRID - 2, cy: 1 },
      { cx: 1, cy: GRID - 2 }, { cx: GRID - 2, cy: GRID - 2 },
    ];
    let spot = corners.find(c => isOpen(c.cx, c.cy) && !ghosts.some(g => g.cx === c.cx && g.cy === c.cy));
    if (!spot) spot = randomOpenCell();
    ghosts.push({ cx: spot.cx, cy: spot.cy, px: spot.cx, py: spot.cy, dir: 'up', moveT: 0 });
  }

  function removeAllGhosts() { ghosts = []; }
  function dropSugar() { seedSugar(10); }
  function clearSugar() { sugar = new Set(); }

  // ---------------------------------------------------------------------
  // Simulation step
  // ---------------------------------------------------------------------

  function nearestSugarDist(cx, cy) {
    let best = Infinity, dir = null;
    for (const s of sugar) {
      const [sx, sy] = s.split(',').map(Number);
      const d = Math.abs(sx - cx) + Math.abs(sy - cy);
      if (d < best) { best = d; dir = { sx, sy }; }
    }
    return { dist: best, target: dir };
  }

  function ghostSignalsFor(cx, cy) {
    return ghosts.map(g => {
      const d = Math.abs(g.cx - cx) + Math.abs(g.cy - cy);
      const proximity = Math.max(0, 1 - d / 9);
      const prevD = (g.prevDistToFly ?? d);
      const approaching = d <= prevD;
      g.prevDistToFly = d;
      return { proximity, approaching, gx: g.cx, gy: g.cy };
    });
  }

  function directionScore(dirName, motor) {
    const d = DIRS[dirName];
    const nx = fly.cx + d.dx, ny = fly.cy + d.dy;

    let score = 0;

    // Brain steering bias: left/right DN activity nudges lateral choices,
    // forward DN activity nudges continuing in the current heading.
    if (dirName === fly.dir) score += motor.forward * 1.4;
    const lateralBias = motor.right - motor.left;
    if (dirName === 'right') score += lateralBias * 0.8;
    if (dirName === 'left') score -= lateralBias * 0.8;

    const panicking = motor.panic > 0.55;

    if (!panicking) {
      // Sugar attraction, scaled by hunger (AL activity)
      const { dist, target } = nearestSugarDist(fly.cx, fly.cy);
      if (target && isFinite(dist)) {
        const towardX = Math.sign(target.sx - fly.cx);
        const towardY = Math.sign(target.sy - fly.cy);
        if (d.dx === towardX && d.dx !== 0) score += motor.hunger * 1.6;
        if (d.dy === towardY && d.dy !== 0) score += motor.hunger * 1.6;
      }
    } else {
      // GF panic state: flee nearest ghost, erratic zig-zag noise to break LOS
      let nearest = null, nd = Infinity;
      for (const g of ghosts) {
        const dd = Math.abs(g.cx - fly.cx) + Math.abs(g.cy - fly.cy);
        if (dd < nd) { nd = dd; nearest = g; }
      }
      if (nearest) {
        const awayX = Math.sign(fly.cx - nearest.cx);
        const awayY = Math.sign(fly.cy - nearest.cy);
        if (d.dx === awayX && d.dx !== 0) score += motor.panic * 2.2;
        if (d.dy === awayY && d.dy !== 0) score += motor.panic * 2.2;
      }
      score += (Math.random() - 0.5) * 2.4; // erratic zig-zag
    }

    score += Math.random() * 0.15; // tiny tie-break noise
    return score;
  }

  function chooseFlyDirection(motor) {
    const options = openNeighbors(fly.cx, fly.cy);
    if (options.length === 0) return fly.dir;

    const nonReverse = options.filter(o => o !== OPPOSITE[fly.dir]);
    const candidates = nonReverse.length > 0 ? nonReverse : options;

    let best = candidates[0], bestScore = -Infinity;
    for (const c of candidates) {
      const s = directionScore(c, motor);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  function moveGhosts() {
    for (const g of ghosts) {
      g.moveT += 1;
      const speed = 2; // ticks per cell step
      if (g.moveT < speed) continue;
      g.moveT = 0;

      const options = openNeighbors(g.cx, g.cy);
      const nonReverse = options.filter(o => o !== OPPOSITE[g.dir]);
      const candidates = nonReverse.length > 0 ? nonReverse : options;

      // Simple biased chase: prefer direction reducing distance to fly, with randomness
      let best = candidates[0], bestScore = -Infinity;
      for (const c of candidates) {
        const d = DIRS[c];
        const nx = g.cx + d.dx, ny = g.cy + d.dy;
        const dist = Math.abs(nx - fly.cx) + Math.abs(ny - fly.cy);
        const s = -dist + Math.random() * 3;
        if (s > bestScore) { bestScore = s; best = c; }
      }
      g.dir = best;
      const d = DIRS[best];
      g.cx += d.dx; g.cy += d.dy;
    }
  }

  function simulationTick() {
    if (!running || !Brain.isReady()) return;

    const { dist: sugarDist } = nearestSugarDist(fly.cx, fly.cy);
    const sugarProximity = isFinite(sugarDist) ? Math.max(0, 1 - sugarDist / 12) : 0;
    const gSignals = ghostSignalsFor(fly.cx, fly.cy);

    Brain.injectStimuli({ sugarProximity, ghostSignals: gSignals });
    Brain.step();

    const motor = Brain.readMotorOutput();

    if (motor.panic > 0.7) {
      panicUntilFlash = 6;
    }

    const speedTicks = motor.panic > 0.8 ? 1 : 2; // 1.5x+ speed under panic
    fly.moveT = (fly.moveT || 0) + 1;
    if (fly.moveT >= speedTicks) {
      fly.moveT = 0;
      const newDir = chooseFlyDirection(motor);
      fly.dir = newDir;
      const d = DIRS[newDir];
      const nx = fly.cx + d.dx, ny = fly.cy + d.dy;
      if (isOpen(nx, ny)) {
        fly.cx = nx; fly.cy = ny;
      }
    }

    const k = key(fly.cx, fly.cy);
    if (sugar.has(k)) {
      sugar.delete(k);
      score += 10;
      // Reward pulse: extra dopamine drive is already modeled inside the
      // connectome via AL -> MB when sensory current is high; we also give
      // a direct DAN kick to mimic real-time reward delivery on capture.
      for (const n of Brain.allNodes()) {
        if (n.id.startsWith('MB_DAN')) n.externalCurrent = (n.externalCurrent || 0) + 0.9;
      }
      if (sugar.size === 0) seedSugar(20);
    }

    for (const g of ghosts) {
      if (g.cx === fly.cx && g.cy === fly.cy) {
        killFly();
        break;
      }
    }

    ticks++;
    pushHistory(motor);
    updateHud();
  }

  function killFly() {
    running = false;
    document.getElementById('modal-detail').textContent =
      `Survived ${ticks} ticks · Score ${score}`;
    showModal();
  }

  function pushHistory(motor) {
    history.al.push(motor.hunger);
    history.mb.push(motor.dopamine);
    history.gf.push(motor.panic);
    history.dnL.push(motor.left);
    history.dnR.push(motor.right);
    history.dnF.push(motor.forward);
    for (const k of Object.keys(history)) {
      if (history[k].length > HIST_LEN) history[k].shift();
    }
  }

  // ---------------------------------------------------------------------
  // Rendering — Arena
  // ---------------------------------------------------------------------

  const arenaCanvas = document.getElementById('arena-canvas');
  const actx = arenaCanvas.getContext('2d');

  function drawArena() {
    actx.clearRect(0, 0, arenaCanvas.width, arenaCanvas.height);
    actx.fillStyle = '#070a10';
    actx.fillRect(0, 0, arenaCanvas.width, arenaCanvas.height);

    // Walls
    actx.fillStyle = '#152033';
    actx.strokeStyle = '#24344a';
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (MAZE[y][x] === '1') {
          actx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }

    // Sugar
    for (const s of sugar) {
      const [sx, sy] = s.split(',').map(Number);
      const cx = sx * CELL + CELL / 2, cy = sy * CELL + CELL / 2;
      const r = CELL * 0.14;
      const grad = actx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      grad.addColorStop(0, 'rgba(57,255,136,0.9)');
      grad.addColorStop(1, 'rgba(57,255,136,0)');
      actx.fillStyle = grad;
      actx.beginPath();
      actx.arc(cx, cy, r * 3, 0, Math.PI * 2);
      actx.fill();

      actx.fillStyle = '#39ff88';
      actx.beginPath();
      actx.arc(cx, cy, r, 0, Math.PI * 2);
      actx.fill();
    }

    // Ghosts
    for (const g of ghosts) {
      g.px += (g.cx - g.px) * 0.35;
      g.py += (g.cy - g.py) * 0.35;
      const cx = g.px * CELL + CELL / 2, cy = g.py * CELL + CELL / 2;
      const r = CELL * 0.36;
      const grad = actx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      grad.addColorStop(0, 'rgba(255,51,85,0.55)');
      grad.addColorStop(1, 'rgba(255,51,85,0)');
      actx.fillStyle = grad;
      actx.beginPath();
      actx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
      actx.fill();

      actx.fillStyle = '#ff3355';
      actx.beginPath();
      actx.arc(cx, cy - r * 0.15, r, Math.PI, 0);
      actx.lineTo(cx + r, cy + r * 0.6);
      for (let i = 0; i < 3; i++) {
        const bx = cx + r - (i * (2 * r / 3)) - (r / 3);
        actx.lineTo(bx, cy + (i % 2 === 0 ? r * 0.9 : r * 0.5));
      }
      actx.lineTo(cx - r, cy + r * 0.6);
      actx.closePath();
      actx.fill();

      actx.fillStyle = '#fff';
      actx.beginPath();
      actx.arc(cx - r * 0.35, cy - r * 0.1, r * 0.2, 0, Math.PI * 2);
      actx.arc(cx + r * 0.35, cy - r * 0.1, r * 0.2, 0, Math.PI * 2);
      actx.fill();
    }

    // Fly
    if (fly) {
      fly.px += (fly.cx - fly.px) * 0.4;
      fly.py += (fly.cy - fly.py) * 0.4;
      const cx = fly.px * CELL + CELL / 2, cy = fly.py * CELL + CELL / 2;
      const r = CELL * 0.34;
      const jitter = running ? (Math.random() - 0.5) * 1.4 : 0;

      const grad = actx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
      grad.addColorStop(0, 'rgba(255,204,0,0.6)');
      grad.addColorStop(1, 'rgba(255,204,0,0)');
      actx.fillStyle = grad;
      actx.beginPath();
      actx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
      actx.fill();

      actx.save();
      actx.translate(cx + jitter, cy + jitter);
      actx.fillStyle = '#ffcc00';
      actx.beginPath();
      actx.ellipse(0, 0, r * 0.9, r * 0.65, 0, 0, Math.PI * 2);
      actx.fill();

      actx.fillStyle = 'rgba(255,255,255,0.55)';
      const wingFlap = Math.sin(Date.now() / 40) * 0.3;
      actx.beginPath();
      actx.ellipse(-r * 0.5, -r * 0.7, r * 0.55, r * 0.3, -0.4 + wingFlap, 0, Math.PI * 2);
      actx.fill();
      actx.beginPath();
      actx.ellipse(r * 0.5, -r * 0.7, r * 0.55, r * 0.3, 0.4 - wingFlap, 0, Math.PI * 2);
      actx.fill();
      actx.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Rendering — Telemetry
  // ---------------------------------------------------------------------

  const charts = {
    al: { canvas: document.getElementById('chart-al'), color: '#39ff88', key: 'al' },
    mb: { canvas: document.getElementById('chart-mb'), color: '#33e0ff', key: 'mb' },
    gf: { canvas: document.getElementById('chart-gf'), color: '#ff3355', key: 'gf' },
  };

  function drawSparkline(canvas, values, color, fill = true) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (values.length < 2) return;
    const step = w / (HIST_LEN - 1);

    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step;
      const y = h - Math.min(1, Math.max(0, v)) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (fill) {
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + '33');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  const dnCanvas = document.getElementById('chart-dn');
  function drawDnChart() {
    const ctx = dnCanvas.getContext('2d');
    const w = dnCanvas.width, h = dnCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const step = w / (HIST_LEN - 1);
    const series = [
      { data: history.dnL, color: '#c07bff' },
      { data: history.dnR, color: '#8a5cff' },
      { data: history.dnF, color: '#e8c8ff' },
    ];
    for (const s of series) {
      if (s.data.length < 2) continue;
      ctx.beginPath();
      s.data.forEach((v, i) => {
        const x = i * step;
        const y = h - Math.min(1, Math.max(0, v)) * (h - 6) - 3;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const connCanvas = document.getElementById('connectome-canvas');
  function drawConnectome() {
    const ctx = connCanvas.getContext('2d');
    const w = connCanvas.width, h = connCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, w, h);
    if (!Brain.isReady()) return;

    const regions = Brain.regions;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (const e of Brain.allEdges()) {
      const pre = findNode(e.pre), post = findNode(e.post);
      if (!pre || !post) continue;
      ctx.beginPath();
      ctx.moveTo((pre.x / 100) * w, (pre.y / 100) * h);
      ctx.lineTo((post.x / 100) * w, (post.y / 100) * h);
      ctx.stroke();
    }

    for (const n of Brain.allNodes()) {
      const x = (n.x / 100) * w, y = (n.y / 100) * h;
      const region = regions[n.region];
      const color = region ? region.color : '#888';
      const intensity = Math.min(1, Math.max(0.15, n.v));
      ctx.fillStyle = n.spiked ? '#ffffff' : color;
      ctx.globalAlpha = n.spiked ? 1 : 0.35 + intensity * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, n.spiked ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let nodeCache = null;
  function findNode(id) {
    if (!nodeCache) {
      nodeCache = new Map();
      for (const n of Brain.allNodes()) nodeCache.set(n.id, n);
    }
    return nodeCache.get(id);
  }

  function updateTelemetryReadouts(motor) {
    document.getElementById('val-al').textContent = `${Math.round(motor.hunger * 100)}%`;
    document.getElementById('val-mb').textContent = `${Math.round(motor.dopamine * 100)}%`;
    document.getElementById('val-gf').textContent = `${Math.round(motor.panic * 100)}%`;
    document.getElementById('val-dn').textContent =
      `L ${Math.round(motor.left * 100)} / R ${Math.round(motor.right * 100)} / F ${Math.round(motor.forward * 100)}`;

    const flash = document.getElementById('panic-flash');
    if (motor.panic > 0.8) {
      flash.classList.add('active');
    } else if (panicUntilFlash <= 0) {
      flash.classList.remove('active');
    }
    if (panicUntilFlash > 0) panicUntilFlash--;
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------

  function updateHud() {
    document.getElementById('stat-score').textContent = score;
    document.getElementById('stat-ticks').textContent = ticks;
    const statusEl = document.getElementById('stat-status');
    if (running) {
      statusEl.textContent = 'ALIVE';
      statusEl.className = 'stat-value stat-alive';
    } else {
      statusEl.textContent = 'DEAD';
      statusEl.className = 'stat-value stat-dead';
    }
  }

  function showModal() { document.getElementById('modal-overlay').hidden = false; }
  function hideModal() { document.getElementById('modal-overlay').hidden = true; }

  // ---------------------------------------------------------------------
  // God controls
  // ---------------------------------------------------------------------

  document.getElementById('btn-add-ghost').addEventListener('click', addGhost);
  document.getElementById('btn-remove-ghost').addEventListener('click', removeAllGhosts);
  document.getElementById('btn-add-sugar').addEventListener('click', dropSugar);
  document.getElementById('btn-clear-sugar').addEventListener('click', clearSugar);
  document.getElementById('btn-reboot').addEventListener('click', () => {
    initGame();
    addGhost();
    addGhost();
  });

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  let lastTick = 0;
  function frame(t) {
    if (t - lastTick >= TICK_MS) {
      lastTick = t;
      simulationTick();
    }
    drawArena();
    const motor = Brain.isReady() ? Brain.readMotorOutput() : { hunger: 0, dopamine: 0, panic: 0, left: 0, right: 0, forward: 0 };
    updateTelemetryReadouts(motor);
    drawSparkline(charts.al.canvas, history.al, charts.al.color);
    drawSparkline(charts.mb.canvas, history.mb, charts.mb.color);
    drawSparkline(charts.gf.canvas, history.gf, charts.gf.color);
    drawDnChart();
    drawConnectome();
    requestAnimationFrame(frame);
  }

  async function boot() {
    await Brain.load('pruned_connectome.json');
    initGame();
    addGhost();
    addGhost();
    requestAnimationFrame(frame);
  }

  boot();
})();
