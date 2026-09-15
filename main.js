/* Pac-Fly V2: wiring, researcher controls, and lightweight canvas telemetry. */
(() => {
  let engine = null;
  const fallback = { headingAngle: 0, npfLevel: .2, dopamineTransient: 0, panicLevel: 0, octopamineLevel: 0, arousalLevel: .1, ppl1Transient: 0, giantFiberFiring: false, disgusted: false, exhausted: false, behaviorState: 'GROOMING' };
  const state = () => engine ? engine.state : fallback;
  const game = new PacmanGame(document.getElementById('arcade-canvas'), {
    brainTick: (sense, dt) => engine ? engine.update(dt, sense) : null,
    onPelletEaten: kind => engine && engine.onPelletEaten(kind),
    onHazardEaten: () => engine && engine.onHazardEaten(),
    onCaught: () => engine && engine.onCaught(),
  });
  game.start();
  FlyNeuralEngine.create('connectome.json').then(value => { engine = value; }).catch(error => {
    console.error('Pac-Fly: connectome failed to load.', error);
    document.querySelector('.experiment-panel').dataset.error = 'connectome unavailable';
  });

  if (typeof THREE !== 'undefined') {
    try { const viz = new BrainVisualizer(document.getElementById('brain-canvas'), state); viz.start(); }
    catch (error) { console.warn('Pac-Fly: brain viewport unavailable.', error); }
  }

  const $ = id => document.getElementById(id);
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.tool;
    game.setPlacementMode(mode);
    document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item === button));
    $('tool-status').textContent = mode === 'sugar' ? 'Click open tiles to add sugar' : 'Click open tiles to drop a bitter trap';
  }));
  $('clear-sugar').addEventListener('click', () => game.clearSugar());
  $('fill-sugar').addEventListener('click', () => game.fillSugar());
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
    const values = [clamp(s.npfLevel), clamp(s.panicLevel), clamp(.35 + s.arousalLevel * .45), clamp(1 - s.npfLevel)];
    ctx.beginPath(); values.forEach((v, i) => { const a = -Math.PI / 2 + i * Math.PI / 2, x = cx + Math.cos(a) * r * v, y = cy + Math.sin(a) * r * v; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = 'rgba(109,240,164,.18)'; ctx.fill(); ctx.strokeStyle = '#6df0a4'; ctx.stroke();
    ['FORAGE', 'ESCAPE', 'EXPLORE', 'REST'].forEach((label, i) => { const a = -Math.PI / 2 + i * Math.PI / 2; ctx.fillStyle = '#7d9aa3'; ctx.font = '10px DM Mono'; ctx.textAlign = 'center'; ctx.fillText(label, cx + Math.cos(a) * 76, cy + Math.sin(a) * 76 + 3); });
  }
  function drawScatter(s) {
    const c = $('scatter-chart'), ctx = c.getContext('2d'), w = c.width, h = c.height; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(128,180,190,.2)'; ctx.beginPath(); ctx.moveTo(28, 10); ctx.lineTo(28, h - 20); ctx.lineTo(w - 8, h - 20); ctx.stroke();
    const x = 28 + clamp(s.panicLevel) * (w - 44), y = h - 20 - clamp(s.dopamineTransient) * (h - 36), radius = 6 + clamp(s.arousalLevel) * 18; ctx.fillStyle = 'rgba(255,84,116,.22)'; ctx.strokeStyle = '#ff5474'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#7d9aa3'; ctx.font = '9px DM Mono'; ctx.fillText('FEAR →', w - 46, h - 5); ctx.save(); ctx.translate(10, 80); ctx.rotate(-Math.PI / 2); ctx.fillText('DOPAMINE', 0, 0); ctx.restore();
  }
  function drawAvatar(s) {
    const c = $('fly-avatar'), ctx = c.getContext('2d'), w = c.width, h = c.height, t = performance.now() / 300, active = s.behaviorState === 'ESCAPE' || s.giantFiberFiring, lean = Math.sin(t) * (active ? .2 : .06);
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2, h / 2 + 7); ctx.rotate(lean); ctx.fillStyle = 'rgba(90,210,230,.17)'; ctx.strokeStyle = '#74e9ee'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-25, -8, 28, 10, -.35, 0, Math.PI * 2); ctx.ellipse(25, -8, 28, 10, .35, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = active ? '#ff5474' : '#c3a16b'; ctx.beginPath(); ctx.ellipse(0, 5, 9, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#e8f5f5'; ctx.beginPath(); ctx.arc(0, -16, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#15252b'; ctx.beginPath(); ctx.arc(-3, -17, 2, 0, Math.PI * 2); ctx.arc(3, -17, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  let last = performance.now(), sample = 0, lastState = '';
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; sample += dt * 1000; const s = state();
    if (engine) { game.setSprintActive(engine.isGiantFiberFiring()); engine.setExhausted(game.exhausted); }
    if (sample > 140) { sample = 0; history.push(s); if (history.length > maxHistory) history.shift(); timeline.push(s.behaviorState); if (timeline.length > 72) timeline.shift(); $('timeline-strip').innerHTML = timeline.map(item => `<i data-state="${item}" title="${item}"></i>`).join(''); }
    $('val-npf').textContent = `${Math.round(s.npfLevel * 100)}%`; $('val-panic').textContent = `${Math.round(s.panicLevel * 100)}%`; $('val-dopamine').textContent = `${Math.round(s.dopamineTransient * 100)}%`; $('val-stamina').textContent = `${Math.round(game.stamina * 100)}%`;
    $('meter-npf').style.width = `${clamp(s.npfLevel) * 100}%`; $('meter-panic').style.width = `${clamp(s.panicLevel) * 100}%`; $('meter-dopamine').style.width = `${clamp(s.dopamineTransient) * 100}%`; $('meter-stamina').style.width = `${clamp(game.stamina) * 100}%`;
    $('state-ticker').textContent = s.behaviorState; $('state-ticker').style.color = colors[s.behaviorState] || colors.ALERT; $('state-log').textContent = lastState === s.behaviorState ? $('state-log').textContent : `${lastState || 'BOOT'} → ${s.behaviorState}`; lastState = s.behaviorState;
    $('arousal-pct').textContent = `${Math.round(s.arousalLevel * 100)}%`; $('motor-action').textContent = `HEADING ${Math.round(s.headingAngle * 180 / Math.PI)}°`; $('gf-status').textContent = `GIANT FIBER · ${s.giantFiberFiring ? 'FIRING' : 'IDLE'}`; $('disgust-flag').textContent = s.disgusted ? 'PPL1 AVERSIVE' : 'PPL1 QUIET'; $('stat-score').textContent = game.score; $('stat-lives').textContent = game.lives;
    drawRadar(s); drawScatter(s); drawAvatar(s); requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
