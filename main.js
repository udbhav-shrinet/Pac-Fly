/**
 * main.js — bootstrap/wiring layer only.
 *
 * This is the single place that knows about all three modules. PacmanGame,
 * FlyNeuralEngine, and BrainVisualizer never import each other — main.js
 * bridges them: game events feed the neural engine, and the neural engine's
 * state feeds back into the game (sprint speed, stun) and into the 3D
 * visualizer (read-only, every frame). Each module keeps its own render
 * loop; this file only runs a small periodic sync + HUD update.
 */

(() => {
  const engine = new FlyNeuralEngine();

  const arcadeCanvas = document.getElementById('arcade-canvas');
  const game = new PacmanGame(arcadeCanvas, {
    onDirectionChange: (angle) => engine.onDirectionChange(angle),
    onPelletEaten: (isEnergizer) => engine.onPelletEaten(isEnergizer),
    onGhostDistanceUpdate: (dist) => engine.onGhostDistanceUpdate(dist),
    onHazardEaten: () => engine.onHazardEaten(),
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

  const els = {
    npf: document.getElementById('meter-npf'),
    dopamine: document.getElementById('meter-dopamine'),
    octopamine: document.getElementById('meter-octopamine'),
    ppl1: document.getElementById('meter-ppl1'),
    stamina: document.getElementById('meter-stamina'),
    gfStatus: document.getElementById('gf-status'),
    score: document.getElementById('stat-score'),
    heading: document.getElementById('stat-heading'),
  };

  let lastTime = performance.now();
  function syncLoop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    engine.update(dt);
    game.setSprintActive(engine.isGiantFiberFiring());

    const s = engine.state;
    els.npf.style.width = `${Math.round(s.npfLevel * 100)}%`;
    els.dopamine.style.width = `${Math.round(s.dopamineTransient * 100)}%`;
    els.octopamine.style.width = `${Math.round(s.octopamineLevel * 100)}%`;
    els.ppl1.style.width = `${Math.round(s.ppl1Transient * 100)}%`;
    els.stamina.style.width = `${Math.round(game.stamina * 100)}%`;
    els.gfStatus.textContent = s.giantFiberFiring ? 'FIRING' : 'idle';
    els.gfStatus.className = s.giantFiberFiring ? 'gf-status gf-firing' : 'gf-status';
    els.score.textContent = game.score;
    els.heading.textContent = `${Math.round((s.headingAngle * 180) / Math.PI)}°`;

    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);
})();
