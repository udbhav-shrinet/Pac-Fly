/* Pac-Fly V2: wiring, researcher controls, and lightweight canvas telemetry. */
(() => {
  let engine = null;
  const fallback = { headingAngle: 0, npfLevel: .2, dopamineTransient: 0, panicLevel: 0, octopamineLevel: 0, arousalLevel: .1, ppl1Transient: 0, giantFiberFiring: false, disgusted: false, exhausted: false, behaviorState: 'GROOMING', drives: { foraging: .2, escape: 0, explore: .35, rest: .8 } };
  const state = () => engine ? engine.state : fallback;
  let ghostRewards = 0;
  const game = new PacmanGame(document.getElementById('arcade-canvas'), {
    brainTick: (sense, dt) => engine ? engine.update(dt, sense) : null,
    onPelletEaten: kind => engine && engine.onPelletEaten && engine.onPelletEaten(kind),
    onHazardEaten: () => engine && engine.onHazardEaten && engine.onHazardEaten(),
    onGhostCaught: () => {
      ghostRewards++;
      $('reward-flag').textContent = `GHOST REWARD · ${ghostRewards}`;
      $('ghost-reward-inline').textContent = ghostRewards;
      engine && engine.onGhostCaught && engine.onGhostCaught();
    },
    onCaught: () => engine && engine.onCaught && engine.onCaught(),
  });
  game.start();
  // Prefer the versioned 139,255-neuron FlyWire-derived binary. The compact
  // 66-neuron circuit remains a deterministic offline fallback.
  FullBrainBridge.create().then(value => {
    engine = value;
    document.querySelector('.live-dot').textContent = '● FLYWIRE WHOLE-BRAIN';
    $('brain-status').textContent = 'FLYWIRE • 139,255 neurons • LIVE';
  }).catch(error => {
    console.warn('Pac-Fly: full brain unavailable; using compact circuit.', error);
    $('brain-status').textContent = 'COMPACT CIRCUIT • FALLBACK';
    return FlyNeuralEngine.create('connectome.json').then(value => { engine = value; });
  }).catch(error => {
    console.error('Pac-Fly: no brain backend loaded.', error);
    document.querySelector('.experiment-panel').dataset.error = 'connectome unavailable';
  });

  if (typeof THREE !== 'undefined') {
    try { const viz = new BrainVisualizer(document.getElementById('brain-canvas'), state); viz.start(); }
    catch (error) { console.warn('Pac-Fly: brain viewport unavailable.', error); }
  }

  const $ = id => document.getElementById(id);
  document.querySelectorAll('.view-tab').forEach(tab => tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    document.querySelectorAll('.view-tab').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.view-arena,.view-brain,.view-data').forEach(panel => panel.classList.toggle('view-active', panel.classList.contains(`view-${view}`)));
  }));
  document.querySelectorAll('.view-arena').forEach(panel => panel.classList.add('view-active'));
  document.querySelectorAll('.dpad button').forEach(button => {
    const setDirection = event => {
      event.preventDefault();
      if (game.humanMode) game.humanDir = button.dataset.dir;
    };
    button.addEventListener('pointerdown', setDirection);
    button.addEventListener('click', setDirection);
  });
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.tool;
    game.setPlacementMode(mode);
    document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item === button));
    $('tool-status').textContent = mode === 'sugar' ? 'Click open tiles to add sugar' : 'Click open tiles to drop a bitter trap';
  }));
  $('clear-sugar').addEventListener('click', () => game.clearSugar());
  $('fill-sugar').addEventListener('click', () => game.fillSugar());
  $('pause-game').addEventListener('click', event => {
    game.setPaused(!game.paused);
    event.currentTarget.textContent = game.paused ? 'Resume' : 'Pause';
    $('tool-status').textContent = game.paused ? 'Experiment paused' : 'Select a tool, then tap the arena';
  });
  $('reset-game').addEventListener('click', () => {
    game.resetExperiment();
    $('pause-game').textContent = 'Pause';
    $('tool-status').textContent = 'Experiment reset';
  });
  document.querySelectorAll('[data-challenge]').forEach(button => button.addEventListener('click', () => {
    const preset = { calm: [0.7, 0.65], rush: [1.35, 1.25], swarm: [1.05, 1.7] }[button.dataset.challenge];
    $('fly-speed').value = preset[0];
    $('ghost-speed').value = preset[1];
    $('fly-speed').dispatchEvent(new Event('input'));
    $('ghost-speed').dispatchEvent(new Event('input'));
    document.querySelectorAll('[data-challenge]').forEach(item => item.classList.toggle('active', item === button));
    $('tool-status').textContent = `${button.textContent} challenge loaded`;
  }));
  $('human-toggle').addEventListener('click', event => {
    game.setHumanMode(!game.humanMode);
    event.currentTarget.textContent = game.humanMode ? 'Return to brain' : 'Enter chase mode';
    $('tool-status').textContent = game.humanMode ? 'WASD / arrow keys: catch the autonomous fly' : 'Select a tool, then click the arena';
    document.querySelector('.live-dot').textContent = game.humanMode ? '● HUMAN CHASE' : '● AUTONOMOUS';
  });
  $('fly-speed').addEventListener('input', event => { const v = Number(event.target.value); game.setFlySpeedScale(v); $('fly-speed-value').textContent = `${v.toFixed(1)}×`; });
  $('ghost-speed').addEventListener('input', event => { const v = Number(event.target.value); game.setGhostSpeedScale(v); $('ghost-speed-value').textContent = `${v.toFixed(1)}×`; });
  $('behavior-toggle').addEventListener('click', event => {
    const prey = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(prey));
    game.setGhostBehavior(prey ? 'prey' : 'predator');
    $('behavior-value').textContent = prey ? 'SUGAR / PREY' : 'PREDATORS';
    $('arena-mode').textContent = prey ? 'PREY FIELD' : 'PREDATOR FIELD';
  });
  $('theme-toggle').addEventListener('click', event => {
    document.body.classList.toggle('light');
    const light = document.body.classList.contains('light');
    event.currentTarget.textContent = light ? '☾' : '☼';
    event.currentTarget.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  });

  const history = [], timeline = [], maxHistory = 90;
  const colors = { FORAGING: '#6df0a4', ESCAPE: '#ff5474', DISGUST: '#c285ff', EXHAUSTED: '#74808a', GROOMING: '#47d8e8', ALERT: '#e6f2f4' };
  const clamp = value => Math.max(0, Math.min(1, value || 0));
  function drawRadar(s) {
    const canvas = $('drive-chart'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2 + 5, r = 57;
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(128,180,190,.22)'; ctx.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + i * Math.PI / 2; const rr = r * ring / 3; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke(); }
    const drives = s.drives || { foraging: s.npfLevel, escape: s.panicLevel, explore: .35 + s.arousalLevel * .45, rest: 1 - s.npfLevel };
    const values = [clamp(drives.foraging), clamp(drives.escape), clamp(drives.explore), clamp(drives.rest)];
    ctx.beginPath(); values.forEach((v, i) => { const a = -Math.PI / 2 + i * Math.PI / 2, x = cx + Math.cos(a) * r * v, y = cy + Math.sin(a) * r * v; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = 'rgba(109,240,164,.18)'; ctx.fill(); ctx.strokeStyle = '#6df0a4'; ctx.stroke();
    ['FORAGE', 'ESCAPE', 'EXPLORE', 'REST'].forEach((label, i) => { const a = -Math.PI / 2 + i * Math.PI / 2; ctx.fillStyle = '#7d9aa3'; ctx.font = '10px DM Mono'; ctx.textAlign = 'center'; ctx.fillText(label, cx + Math.cos(a) * 76, cy + Math.sin(a) * 76 + 3); });
  }
  function drawScatter(s) {
    const c = $('scatter-chart'), ctx = c.getContext('2d'), w = c.width, h = c.height; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(128,180,190,.2)'; ctx.beginPath(); ctx.moveTo(28, 10); ctx.lineTo(28, h - 20); ctx.lineTo(w - 8, h - 20); ctx.stroke();
    const x = 28 + clamp(s.panicLevel) * (w - 44), y = h - 20 - clamp(s.dopamineTransient) * (h - 36), radius = 6 + clamp(s.arousalLevel) * 18; ctx.fillStyle = 'rgba(255,84,116,.22)'; ctx.strokeStyle = '#ff5474'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#7d9aa3'; ctx.font = '9px DM Mono'; ctx.fillText('THREAT →', w - 55, h - 5); ctx.save(); ctx.translate(10, 80); ctx.rotate(-Math.PI / 2); ctx.fillText('REWARD', 0, 0); ctx.restore();
  }
  function drawTrend() {
    const c = $('trend-chart'), ctx = c.getContext('2d'), w = c.width, h = c.height;
    const key = $('trend-signal').value;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(128,180,190,.18)';
    ctx.lineWidth = 1;
    for (let row = 1; row < 4; row++) { ctx.beginPath(); ctx.moveTo(20, row * h / 4); ctx.lineTo(w - 8, row * h / 4); ctx.stroke(); }
    if (history.length < 2) return;
    const points = history.map(item => clamp(key === 'stamina' ? game.stamina : item[key]));
    ctx.beginPath();
    points.forEach((value, index) => {
      const x = 20 + index * (w - 28) / Math.max(1, points.length - 1);
      const y = h - 10 - value * (h - 20);
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = key === 'panicLevel' ? '#ff5474' : key === 'dopamineTransient' ? '#ffc857' : '#47d8e8';
    ctx.stroke();
  }
  function drawAvatar(s) {
    const c = $('fly-avatar'), ctx = c.getContext('2d'), w = c.width, h = c.height, t = performance.now() / 300, active = s.behaviorState === 'ESCAPE' || s.giantFiberFiring, lean = Math.sin(t) * (active ? .2 : .06);
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2, h / 2 + 7); ctx.rotate(lean); ctx.fillStyle = 'rgba(90,210,230,.17)'; ctx.strokeStyle = '#74e9ee'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-25, -8, 28, 10, -.35, 0, Math.PI * 2); ctx.ellipse(25, -8, 28, 10, .35, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = active ? '#ff5474' : '#c3a16b'; ctx.beginPath(); ctx.ellipse(0, 5, 9, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#e8f5f5'; ctx.beginPath(); ctx.arc(0, -16, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#15252b'; ctx.beginPath(); ctx.arc(-3, -17, 2, 0, Math.PI * 2); ctx.arc(3, -17, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  let last = performance.now(), sample = 0, lastState = '', stateSince = performance.now();
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; sample += dt * 1000; const s = state();
    if (engine) {
      game.setSprintActive(engine.isGiantFiberFiring ? engine.isGiantFiberFiring() : engine.state.giantFiberFiring);
      if (engine.setExhausted) engine.setExhausted(game.exhausted);
    }
    if (sample > 140) {
      sample = 0;
      history.push({ ...s, stamina: game.stamina });
      if (history.length > maxHistory) history.shift();
      if (lastState !== s.behaviorState) {
        if (lastState) timeline.push({ state: lastState, duration: now - stateSince });
        stateSince = now;
        lastState = s.behaviorState;
      } else if (!timeline.length || timeline[timeline.length - 1].state !== s.behaviorState) {
        timeline.push({ state: s.behaviorState, duration: 0 });
      } else {
        timeline[timeline.length - 1].duration = now - stateSince;
      }
      while (timeline.reduce((total, item) => total + item.duration, 0) > 12600) timeline.shift();
      const total = Math.max(1, timeline.reduce((sum, item) => sum + item.duration, 0));
      $('timeline-strip').innerHTML = timeline.map(item => `<i data-state="${item.state}" style="flex:${Math.max(1, item.duration / total * 100)}" title="${item.state} · ${(item.duration / 1000).toFixed(1)} s"></i>`).join('');
    }
    $('val-npf').textContent = `${Math.round(s.npfLevel * 100)}%`; $('val-panic').textContent = `${Math.round(s.panicLevel * 100)}%`; $('val-dopamine').textContent = `${Math.round(s.dopamineTransient * 100)}%`; $('val-stamina').textContent = `${Math.round(game.stamina * 100)}%`;
    $('meter-npf').style.width = `${clamp(s.npfLevel) * 100}%`; $('meter-panic').style.width = `${clamp(s.panicLevel) * 100}%`; $('meter-dopamine').style.width = `${clamp(s.dopamineTransient) * 100}%`; $('meter-stamina').style.width = `${clamp(game.stamina) * 100}%`;
    $('state-ticker').textContent = s.behaviorState; $('state-ticker').style.color = colors[s.behaviorState] || colors.ALERT; $('state-log').textContent = lastState === s.behaviorState ? $('state-log').textContent : `${lastState || 'BOOT'} → ${s.behaviorState}`;
    $('arousal-pct').textContent = `${Math.round(s.arousalLevel * 100)}%`; $('motor-action').textContent = `ARENA HEADING ${Math.round(s.headingAngle * 180 / Math.PI)}°`; $('gf-status').textContent = `ESCAPE PROXY · ${s.giantFiberFiring ? 'ACTIVE' : 'IDLE'}`; $('disgust-flag').textContent = s.disgusted ? 'AVERSIVE PROXY ACTIVE' : 'AVERSIVE PROXY QUIET'; $('stat-score').textContent = game.score; $('stat-lives').textContent = game.lives;
    if (engine instanceof FullBrainBridge && engine.latest) $('brain-status').textContent = `FLYWIRE • 139,255 neurons • TICK ${engine.latest.tickCount}`;
    drawRadar(s); drawScatter(s); drawTrend(); drawAvatar(s); requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
