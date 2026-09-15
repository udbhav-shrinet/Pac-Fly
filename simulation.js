/**
 * simulation.js — SimulationManager: the root loop.
 *
 * Owns delta-time stepping (fixed 100ms ticks via an accumulator, so the
 * LIF network's time constants stay meaningful regardless of frame rate),
 * canvas clearing/rendering for the arena + heatmap overlay, and driving
 * every UI surface (God Controls, neural telemetry for the selected fly,
 * population analytics, the event log, CSV export, and the fitness roster).
 */

class SimulationManager {
  constructor() {
    this.worldW = 820;
    this.worldH = 600;
    this.environment = new Environment(this.worldW, this.worldH);
    this.flies = [];
    this.selectedFlyId = null;
    this.sensoryMode = 'A';
    this.globalSelection = 'all';
    this.heatmapOn = false;
    this.running = true;
    this.simTime = 0;
    this.maxPopulation = 40;

    this.fitnessRoster = []; // [{weights: Float32Array, survivedAt: seconds}]
    this.maxRoster = 24;

    this.eventLog = [];
    this.maxEventLog = 200;

    this.populationHistory = []; // [{t, count}]
    this.densityGrid = { cols: 20, rows: 15, data: null };
    this.densityGrid.data = new Float32Array(this.densityGrid.cols * this.densityGrid.rows);

    this.selectedHasHistory = false;

    this.arenaCanvas = document.getElementById('arena-canvas');
    this.actx = this.arenaCanvas.getContext('2d');
    this.heatCanvas = document.getElementById('heatmap-canvas');
    this.hctx = this.heatCanvas.getContext('2d');

    this.charts = {
      al: document.getElementById('chart-al'),
      lc4: document.getElementById('chart-lc4'),
      mb: document.getElementById('chart-mb'),
      dn: document.getElementById('chart-dn'),
    };
    this.rasterCanvas = document.getElementById('raster-canvas');
    this.connectomeCanvas = document.getElementById('connectome-canvas');
    this.histCanvas = document.getElementById('chart-histogram');
    this.survivalCanvas = document.getElementById('chart-survival');
    this.densityCanvas = document.getElementById('chart-density');

    this._bindUI();
  }

  log(msg) {
    const t = this.simTime.toFixed(1);
    this.eventLog.push(`[${t}s] ${msg}`);
    if (this.eventLog.length > this.maxEventLog) this.eventLog.shift();
    const el = document.getElementById('event-log');
    const div = document.createElement('div');
    div.textContent = `[${t}s] ${msg}`;
    el.appendChild(div);
    while (el.children.length > this.maxEventLog) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  init(initialPopulation = 10) {
    this.flies = [];
    this.environment.clearSugar();
    this.environment.removeAllGhosts();
    this.environment.seedSugar(22);
    this.environment.addGhost();
    this.environment.addGhost();
    for (let i = 0; i < initialPopulation; i++) this.spawnFly();
    this.selectedFlyId = this.flies.length ? this.flies[0].id : null;
    this.simTime = 0;
    this.populationHistory = [];
    this.running = true;
    hideModal();
    this.log(`Connectome rebooted — population seeded at ${initialPopulation}.`);
  }

  spawnFly() {
    if (this.flies.filter(f => f.alive).length >= this.maxPopulation) {
      this.log('Population cap reached — spawn refused.');
      return;
    }
    const useRoster = this.fitnessRoster.length > 0 && Math.random() < 0.5;
    const weights = useRoster
      ? Connectome.mutate(this.fitnessRoster[Math.floor(Math.random() * this.fitnessRoster.length)].weights)
      : Connectome.randomizedWeights();
    const x = 40 + Math.random() * (this.worldW - 80);
    const y = 40 + Math.random() * (this.worldH - 80);
    const fly = new FlyAgent(x, y, weights, this.environment);
    this.flies.push(fly);
    if (this.selectedFlyId == null) this.selectedFlyId = fly.id;
    this.log(`Fly #${fly.id} spawned${useRoster ? ' (roster genome)' : ''}.`);
    return fly;
  }

  cullFly() {
    const alive = this.flies.filter(f => f.alive);
    if (alive.length === 0) return;
    let target = alive[0];
    for (const f of alive) if (f.energy < target.energy) target = f;
    target.die('culled');
    this.log(`Fly #${target.id} culled by researcher.`);
  }

  selectedFly() {
    return this.flies.find(f => f.id === this.selectedFlyId && f.alive) || null;
  }

  targetFlies() {
    if (this.globalSelection === 'selected') {
      const f = this.selectedFly();
      return f ? [f] : [];
    }
    return this.flies.filter(f => f.alive);
  }

  _bindUI() {
    document.getElementById('btn-spawn-fly').addEventListener('click', () => this.spawnFly());
    document.getElementById('btn-cull-fly').addEventListener('click', () => this.cullFly());
    document.getElementById('global-selection').addEventListener('change', (e) => { this.globalSelection = e.target.value; });

    document.getElementById('btn-adrenaline').addEventListener('click', () => {
      const targets = this.targetFlies();
      for (const f of targets) f.applyAdrenaline();
      this.log(`Adrenaline injected into ${targets.length} fly(ies).`);
    });
    document.getElementById('btn-fasting').addEventListener('click', () => {
      const targets = this.targetFlies();
      for (const f of targets) f.applyFastingHormone();
      this.log(`Fasting hormone injected into ${targets.length} fly(ies).`);
    });
    document.getElementById('btn-dopamine').addEventListener('click', () => {
      const targets = this.targetFlies();
      for (const f of targets) f.applyDopamineSpike();
      this.log(`Dopamine spike triggered in ${targets.length} fly(ies) — motor output locked 3s.`);
    });

    document.querySelectorAll('input[name="sensory-mode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.sensoryMode = e.target.value;
          this.log(`Sensory routing switched to Mode ${this.sensoryMode}.`);
        }
      });
    });

    document.getElementById('btn-add-ghost').addEventListener('click', () => { this.environment.addGhost(); this.log('Predator added to arena.'); });
    document.getElementById('btn-remove-ghost').addEventListener('click', () => { this.environment.removeAllGhosts(); this.log('All predators removed.'); });
    document.getElementById('btn-add-sugar').addEventListener('click', () => { this.environment.seedSugar(8); this.log('Sugar sources bloomed.'); });
    document.getElementById('btn-clear-sugar').addEventListener('click', () => { this.environment.clearSugar(); this.log('Sugar field cleared.'); });

    document.getElementById('toggle-heatmap').addEventListener('change', (e) => {
      this.heatmapOn = e.target.checked;
      this.heatCanvas.style.opacity = this.heatmapOn ? '1' : '0';
    });
    this.heatCanvas.style.opacity = '0';
    this.heatCanvas.style.transition = 'opacity 0.2s ease';

    document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCsv());
    document.getElementById('btn-reboot').addEventListener('click', () => this.init());

    this.arenaCanvas.addEventListener('click', (evt) => {
      const rect = this.arenaCanvas.getBoundingClientRect();
      const scaleX = this.arenaCanvas.width / rect.width;
      const scaleY = this.arenaCanvas.height / rect.height;
      const x = (evt.clientX - rect.left) * scaleX;
      const y = (evt.clientY - rect.top) * scaleY;
      let best = null, bestD = Infinity;
      for (const f of this.flies) {
        if (!f.alive) continue;
        const d = Math.hypot(f.x - x, f.y - y);
        if (d < bestD) { bestD = d; best = f; }
      }
      if (best && bestD < 30) {
        this.selectedFlyId = best.id;
        this.log(`Fly #${best.id} selected.`);
      }
    });
  }

  exportCsv() {
    const fly = this.selectedFly();
    if (!fly) { this.log('CSV export failed — no fly selected.'); return; }
    const rows = [['tick', 'time_s', 'AL_state', 'LC4_state', 'MB_state', 'DN_output']];
    const n = fly.oscHistory.al.length;
    for (let i = 0; i < n; i++) {
      rows.push([i, (i * 0.1).toFixed(2), fly.oscHistory.al[i].toFixed(4), fly.oscHistory.lc4[i].toFixed(4), fly.oscHistory.mb[i].toFixed(4), fly.oscHistory.dn[i].toFixed(4)]);
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pac-fly-telemetry-fly${fly.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.log(`Telemetry for Fly #${fly.id} exported (${n} samples).`);
  }

  update(dt) {
    if (!this.running) return;
    this.simTime += dt;
    this.environment.update(dt, this.flies);

    for (const fly of this.flies) {
      if (!fly.alive) continue;
      fly.update(dt, this.environment, this.sensoryMode, this.worldW, this.worldH);

      const gx = Math.min(this.densityGrid.cols - 1, Math.max(0, Math.floor(fly.x / this.worldW * this.densityGrid.cols)));
      const gy = Math.min(this.densityGrid.rows - 1, Math.max(0, Math.floor(fly.y / this.worldH * this.densityGrid.rows)));
      this.densityGrid.data[gy * this.densityGrid.cols + gx] += dt * 0.5;

      if (!fly.alive) {
        this.log(`Fly #${fly.id} ${fly.deathReason === 'eaten' ? 'was caught by a predator' : fly.deathReason === 'starved' ? 'starved to death' : 'was culled'}.`);
        if (this.selectedFlyId === fly.id) this.selectedFlyId = null;
        continue;
      }

      if (fly.age >= 60 && !fly.rosterCredited) {
        fly.rosterCredited = true;
        this.fitnessRoster.push({ weights: fly.connectome.weights.slice(), survivedAt: this.simTime });
        if (this.fitnessRoster.length > this.maxRoster) this.fitnessRoster.shift();
        this.log(`Fly #${fly.id} survived 60s — genome saved to Fit Roster.`);
      }
    }

    for (let i = this.densityGrid.data.length - 1; i >= 0; i--) this.densityGrid.data[i] *= 0.985;

    if (this.selectedFlyId == null) {
      const alive = this.flies.filter(f => f.alive);
      if (alive.length) this.selectedFlyId = alive[0].id;
    }

    if (Math.floor(this.simTime * 2) !== Math.floor((this.simTime - dt) * 2)) {
      this.populationHistory.push({ t: this.simTime, count: this.flies.filter(f => f.alive).length });
      if (this.populationHistory.length > 400) this.populationHistory.shift();
    }

    const aliveCount = this.flies.filter(f => f.alive).length;
    if (aliveCount === 0 && this.flies.length > 0) {
      this.running = false;
      document.getElementById('modal-detail').textContent = `Simulation ran for ${this.simTime.toFixed(1)}s. Fit Roster carries ${this.fitnessRoster.length} genome(s) forward.`;
      showModal();
    }
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  render() {
    this.drawArena();
    if (this.heatmapOn) this.drawHeatmap(); else this.hctx.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);
    this.drawTelemetry();
    this.drawAnalytics();
    this.updateHud();
  }

  drawArena() {
    const ctx = this.actx, W = this.worldW, H = this.worldH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    ctx.strokeStyle = 'rgba(51,224,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    for (const s of this.environment.sugarSources) {
      const alpha = Math.min(1, s.amount / 40);
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius * 1.8);
      grad.addColorStop(0, `rgba(57,255,136,${0.55 * alpha})`);
      grad.addColorStop(1, 'rgba(57,255,136,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(57,255,136,${0.8 * alpha + 0.2})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, s.radius * 0.35), 0, Math.PI * 2); ctx.fill();
    }

    for (const g of this.environment.ghosts) {
      const r = 12;
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, r * 2.4);
      grad.addColorStop(0, 'rgba(255,51,85,0.5)');
      grad.addColorStop(1, 'rgba(255,51,85,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(g.x, g.y, r * 2.4, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.fillStyle = '#ff3355';
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r, Math.PI, 0);
      ctx.lineTo(r, r * 0.6);
      for (let i = 0; i < 3; i++) {
        const bx = r - (i * (2 * r / 3)) - (r / 3);
        ctx.lineTo(bx, (i % 2 === 0 ? r * 0.9 : r * 0.5));
      }
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const fly of this.flies) {
      if (!fly.alive) continue;
      fly.render(ctx, fly.id === this.selectedFlyId);
    }
  }

  drawHeatmap() {
    const cols = 40, rows = 30;
    const { sugar, threat } = this.environment.computeHeatGrid(cols, rows);
    const ctx = this.hctx, W = this.heatCanvas.width, H = this.heatCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const cw = W / cols, ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const s = sugar[y * cols + x], t = threat[y * cols + x];
        if (s < 0.03 && t < 0.03) continue;
        const r = Math.round(255 * t);
        const g = Math.round(255 * s);
        const alpha = Math.min(0.55, Math.max(s, t) * 0.55);
        ctx.fillStyle = `rgba(${r},${g},80,${alpha})`;
        ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
      }
    }
  }

  drawSparkline(canvas, values, color) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    if (!values || values.length < 2) return;
    const step = w / (values.length - 1);
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step, y = h - Math.min(1, Math.max(0, v)) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawRaster(fly) {
    const canvas = this.rasterCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, w, h);
    if (!fly) return;

    const labelW = 54;
    const plotW = w - labelW;
    const keyNeurons = Connectome.keyNeurons;
    const rowH = h / keyNeurons.length;
    const now = performance.now();
    const windowMs = fly.rasterWindowMs;

    ctx.font = '8px monospace';
    ctx.textBaseline = 'middle';
    keyNeurons.forEach((k, ri) => {
      const y = ri * rowH + rowH / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(labelW, ri * rowH, plotW, 1);
      ctx.fillStyle = '#8a8a8a';
      ctx.fillText(k.id.replace('_', ''), 2, y);
    });

    for (const entry of fly.rasterHistory) {
      const age = now - entry.t;
      if (age > windowMs) continue;
      const x = labelW + (1 - age / windowMs) * plotW;
      entry.spikes.forEach((spiked, ri) => {
        if (!spiked) return;
        const y = ri * rowH + rowH / 2;
        const region = keyNeurons[ri].region;
        ctx.fillStyle = region === 'GF' ? '#ff3355' : region === 'LC4' ? '#ff3355' : region === 'AL' ? '#33e0ff' : region === 'MB' ? '#ffb800' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  drawConnectomeMini(fly) {
    const canvas = this.connectomeCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, w, h);
    if (!fly || !Connectome.graph) return;

    const regions = Connectome.regions;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let e = 0; e < Connectome.m; e++) {
      const preX = (Connectome.nodeX[Connectome.edgesPre[e]] / 100) * w;
      const preY = (Connectome.nodeY[Connectome.edgesPre[e]] / 100) * h;
      const postX = (Connectome.nodeX[Connectome.edgesPost[e]] / 100) * w;
      const postY = (Connectome.nodeY[Connectome.edgesPost[e]] / 100) * h;
      ctx.beginPath(); ctx.moveTo(preX, preY); ctx.lineTo(postX, postY); ctx.stroke();
    }

    for (let i = 0; i < Connectome.n; i++) {
      const x = (Connectome.nodeX[i] / 100) * w, y = (Connectome.nodeY[i] / 100) * h;
      const region = regions[Connectome.region[i]];
      const color = region ? region.color : '#888';
      const v = fly.connectome.v[i];
      const spiked = fly.connectome.spiked[i] === 1;
      const intensity = Math.min(1, Math.max(0.15, v));
      ctx.fillStyle = spiked ? '#ffffff' : color;
      ctx.globalAlpha = spiked ? 1 : 0.35 + intensity * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, spiked ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawTelemetry() {
    const fly = this.selectedFly();
    document.getElementById('selected-fly-tag').textContent = fly
      ? `Fly #${fly.id} · energy ${Math.round(fly.energy * 100)}% · age ${fly.age.toFixed(1)}s`
      : 'no fly selected — click one';

    this.drawSparkline(this.charts.al, fly ? fly.oscHistory.al : [], '#33e0ff');
    this.drawSparkline(this.charts.lc4, fly ? fly.oscHistory.lc4 : [], '#ff3355');
    this.drawSparkline(this.charts.mb, fly ? fly.oscHistory.mb : [], '#ffb800');
    this.drawSparkline(this.charts.dn, fly ? fly.oscHistory.dn : [], '#ffffff');
    this.drawRaster(fly);
    this.drawConnectomeMini(fly);

    const flash = document.getElementById('panic-flash');
    if (fly) {
      const panic = fly.connectome.regionActivity('GF');
      if (panic > 0.8) flash.classList.add('active'); else flash.classList.remove('active');
    } else {
      flash.classList.remove('active');
    }
  }

  drawAnalytics() {
    // Energy histogram
    {
      const canvas = this.histCanvas, ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bins = 10;
      const counts = new Array(bins).fill(0);
      const alive = this.flies.filter(f => f.alive);
      for (const f of alive) counts[Math.min(bins - 1, Math.floor(f.energy * bins))]++;
      const maxC = Math.max(1, ...counts);
      const bw = w / bins;
      counts.forEach((c, i) => {
        const bh = (c / maxC) * (h - 6);
        const hue = i / bins;
        ctx.fillStyle = `hsl(${180 - hue * 140}, 90%, 55%)`;
        ctx.fillRect(i * bw + 2, h - bh, bw - 4, bh);
      });
    }

    // Survival curve
    {
      const canvas = this.survivalCanvas, ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const pts = this.populationHistory;
      if (pts.length > 1) {
        const maxCount = Math.max(1, ...pts.map(p => p.count));
        const maxT = pts[pts.length - 1].t || 1;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = (p.t / maxT) * w;
          const y = h - (p.count / maxCount) * (h - 6) - 2;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#ff33c9';
        ctx.lineWidth = 1.6;
        ctx.shadowColor = '#ff33c9';
        ctx.shadowBlur = 5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Spatial density heatmap
    {
      const canvas = this.densityCanvas, ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const { cols, rows, data } = this.densityGrid;
      const maxV = Math.max(0.001, ...data);
      const cw = w / cols, ch = h / rows;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = data[y * cols + x] / maxV;
          if (v < 0.02) continue;
          ctx.fillStyle = `rgba(51,224,255,${Math.min(0.9, v)})`;
          ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
        }
      }
    }
  }

  updateHud() {
    const alive = this.flies.filter(f => f.alive);
    document.getElementById('stat-population').textContent = `${alive.length}`;
    const avgEnergy = alive.length ? alive.reduce((s, f) => s + f.energy, 0) / alive.length : 0;
    document.getElementById('stat-energy').textContent = `${Math.round(avgEnergy * 100)}%`;
    document.getElementById('stat-time').textContent = `${this.simTime.toFixed(0)}s`;
    const statusEl = document.getElementById('stat-status');
    if (this.running) {
      statusEl.textContent = 'RUNNING';
      statusEl.className = 'stat-value stat-alive';
    } else {
      statusEl.textContent = 'EXTINCT';
      statusEl.className = 'stat-value stat-dead';
    }
    document.getElementById('roster-count').textContent = `${this.fitnessRoster.length}`;
  }
}

function showModal() { document.getElementById('modal-overlay').hidden = false; }
function hideModal() { document.getElementById('modal-overlay').hidden = true; }

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

(async () => {
  await Connectome.load('pruned_connectome.json');
  const sim = new SimulationManager();
  sim.init(10);

  const FIXED_DT = 0.1;
  let lastTime = performance.now();
  let accumulator = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulator += Math.min(dt, 0.25);
    while (accumulator >= FIXED_DT) {
      sim.update(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    sim.render();
  }
  requestAnimationFrame(frame);
})();
