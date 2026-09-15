/**
 * main.js — bootstrap/wiring layer only.
 *
 * This is the single place that knows about all three modules. PacmanGame,
 * FlyNeuralEngine, and BrainVisualizer never import each other — main.js
 * bridges them: game events feed the neural engine, and the neural engine's
 * state feeds back into the game (sprint speed, stun) and into the 3D
 * visualizer (read-only, every frame). Each module keeps its own render
 * loop; this file only runs a small periodic sync + HUD update, including
 * the oscilloscope-style telemetry graphs and the alertness ring.
 */

(() => {
  const engine = new FlyNeuralEngine();

  const arcadeCanvas = document.getElementById('arcade-canvas');
  const game = new PacmanGame(arcadeCanvas, {
    onDirectionChange: (angle) => engine.onDirectionChange(angle),
    onPelletEaten: (isEnergizer) => engine.onPelletEaten(isEnergizer),
    onGhostDistanceUpdate: (dist) => engine.onGhostDistanceUpdate(dist),
    onHazardEaten: () => engine.onHazardEaten(),
    onCaught: () => engine.onCaught(),
  });

  game.start();

  // The 3D visualizer depends on Three.js loading from a CDN. If that
  // fails (offline, blocked, slow network), the arcade game must keep
  // running — it never depends on this module having succeeded.
  let visualizer = null;
  if (typeof THREE === 'undefined') {
    console.warn('Pac-Fly: THREE.js did not load — running without the 3D connectome visualizer.');
    document.querySelector('.brain-panel')?.classList.add('brain-unavailable');
  } else {
    try {
      const brainCanvas = document.getElementById('brain-canvas');
      visualizer = new BrainVisualizer(brainCanvas, () => engine.state);
      visualizer.start();
    } catch (err) {
      console.warn('Pac-Fly: BrainVisualizer failed to initialize — running without it.', err);
      document.querySelector('.brain-panel')?.classList.add('brain-unavailable');
    }
  }

  const hazardBtn = document.getElementById('btn-hazard-mode');
  hazardBtn.addEventListener('click', () => {
    const active = !game.hazardPlacementMode;
    game.setHazardPlacementMode(active);
    hazardBtn.classList.toggle('armed', active);
    hazardBtn.textContent = active ? '◆ Click maze to place trap' : '+ Place Bitter Trap';
  });

  // ---------------------------------------------------------------------
  // Oscilloscope telemetry: small rolling history buffers, sampled at a
  // fixed cadence (not every animation frame) so the traces read as a
  // real scrolling waveform instead of noise.
  // ---------------------------------------------------------------------

  const HIST_LEN = 90;
  const SAMPLE_MS = 110;
  const history = {
    hunger: new Array(HIST_LEN).fill(0),
    panic: new Array(HIST_LEN).fill(0),
    stress: new Array(HIST_LEN).fill(0),
    dopamine: new Array(HIST_LEN).fill(0),
    stamina: new Array(HIST_LEN).fill(1),
  };
  function pushHistory(s) {
    history.hunger.push(s.npfLevel); history.hunger.shift();
    history.panic.push(s.panicLevel); history.panic.shift();
    history.stress.push(s.octopamineLevel); history.stress.shift();
    history.dopamine.push(s.dopamineTransient); history.dopamine.shift();
    history.stamina.push(game.stamina); history.stamina.shift();
  }

  function drawSparkline(canvas, values, color) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    const step = w / (values.length - 1);
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step, y = h - Math.min(1, Math.max(0, v)) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  const STATE_COLORS = {
    ESCAPE: '#ff3355',
    DISGUST: '#a020f0',
    EXHAUSTED: '#8a8a94',
    FORAGING: '#39ff88',
    GROOMING: '#33e0ff',
    ALERT: '#eaeaea',
  };

  function drawArousalRing(canvas, level, color) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const start = -Math.PI / 2;
    const end = start + Math.min(1, Math.max(0, level)) * Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const graphCanvases = {
    hunger: document.getElementById('graph-npf'),
    panic: document.getElementById('graph-panic'),
    stress: document.getElementById('graph-stress'),
    dopamine: document.getElementById('graph-dopamine'),
    stamina: document.getElementById('graph-stamina'),
  };
  const graphColors = { hunger: '#ff9a3c', panic: '#ff3355', stress: '#ff5577', dopamine: '#ffb800', stamina: '#33e0ff' };
  const ringCanvas = document.getElementById('arousal-ring');

  const els = {
    valNpf: document.getElementById('val-npf'),
    valPanic: document.getElementById('val-panic'),
    valStress: document.getElementById('val-stress'),
    valDopamine: document.getElementById('val-dopamine'),
    valStamina: document.getElementById('val-stamina'),
    gfStatus: document.getElementById('gf-status'),
    score: document.getElementById('stat-score'),
    lives: document.getElementById('stat-lives'),
    heading: document.getElementById('stat-heading'),
    arousalPct: document.getElementById('arousal-pct'),
    stateTicker: document.getElementById('state-ticker'),
    disgustFlag: document.getElementById('disgust-flag'),
    hungerCard: document.querySelector('.graph-card[data-metric="hunger"]'),
  };

  let lastTime = performance.now();
  let sampleAccum = 0;

  function syncLoop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    engine.update(dt);
    game.setSprintActive(engine.isGiantFiberFiring());
    engine.setExhausted(game.exhausted);

    const s = engine.state;

    sampleAccum += dt * 1000;
    if (sampleAccum >= SAMPLE_MS) {
      sampleAccum = 0;
      pushHistory(s);
      drawSparkline(graphCanvases.hunger, history.hunger, graphColors.hunger);
      drawSparkline(graphCanvases.panic, history.panic, graphColors.panic);
      drawSparkline(graphCanvases.stress, history.stress, graphColors.stress);
      drawSparkline(graphCanvases.dopamine, history.dopamine, graphColors.dopamine);
      drawSparkline(graphCanvases.stamina, history.stamina, graphColors.stamina);
    }

    const stateColor = STATE_COLORS[s.behaviorState] || '#33e0ff';
    drawArousalRing(ringCanvas, s.arousalLevel, stateColor);

    els.valNpf.textContent = `${Math.round(s.npfLevel * 100)}%`;
    els.valPanic.textContent = `${Math.round(s.panicLevel * 100)}%`;
    els.valStress.textContent = `${Math.round(s.octopamineLevel * 100)}%`;
    els.valDopamine.textContent = `${Math.round(s.dopamineTransient * 100)}%`;
    els.valStamina.textContent = `${Math.round(game.stamina * 100)}%`;
    els.hungerCard.classList.toggle('critical', s.npfLevel > 0.85);

    els.gfStatus.textContent = s.giantFiberFiring ? 'FIRING' : 'idle';
    els.gfStatus.className = s.giantFiberFiring ? 'gf-status gf-firing' : 'gf-status';

    els.score.textContent = game.score;
    els.lives.textContent = game.lives;
    els.heading.textContent = `${Math.round((s.headingAngle * 180) / Math.PI)}°`;

    els.arousalPct.textContent = `${Math.round(s.arousalLevel * 100)}%`;
    els.stateTicker.textContent = s.behaviorState;
    els.stateTicker.dataset.state = s.behaviorState;
    els.disgustFlag.hidden = !s.disgusted;

    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);
})();
