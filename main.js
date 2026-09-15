(() => {
  const $ = id => document.getElementById(id);

  // C major pentatonic across ~2 octaves, entirely inside the 24-key range
  // (MIDI 48-71). Every interval between any two of these notes is
  // consonant, so whatever the brain sim picks, it can't land on a bad note.
  const SCALE = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69];
  const BEAT_MS = 460;

  const audio = { context: null, master: null, timer: null, playing: false };
  let brain = null;
  let brainBackend = 'CONNECTOME LIF';
  const brainReady = FullBrainBridge.create().then(value => {
    brain = value;
    brainBackend = 'FLYWIRE WHOLE-BRAIN';
  }).catch(() => FlyNeuralEngine.create('connectome.json').then(value => {
    brain = value;
    brainBackend = 'COMPACT CONNECTOME LIF';
  })).catch(error => {
    console.error('Virtual fly brain failed to load.', error);
  });

  const melody = { degree: 4, beat: 0, activityEma: null };
  let lastSnap = { arousal: .15, dopamine: .2 };

  // The sim was fed pure sinusoids before, which drives it into a fixed
  // periodic attractor within a few seconds — real spiking networks don't
  // wander unless their input does. This is a slow random walk (mean-
  // reverting so it stays in a plausible sensory range) standing in for an
  // actual environment, so the brain has something non-repeating to react
  // to. The walk is the only randomness in the loop; note choice below is
  // still 100% a function of the brain's own state.
  const env = { sugarBearing: 0, sugarDist: 5, ghostBearing: 0, ghostDist: 6, foodOdor: .6, dangerOdor: .15 };
  function wander(value, center, spread, revert, noise) {
    const next = value + (center - value) * revert + (Math.random() - .5) * noise;
    return Math.max(center - spread, Math.min(center + spread, next));
  }
  function stepEnv() {
    env.sugarBearing = wander(env.sugarBearing, 0, Math.PI, .02, .35);
    env.sugarDist = wander(env.sugarDist, 5, 4, .03, .8);
    env.ghostBearing = wander(env.ghostBearing, 0, Math.PI, .015, .3);
    env.ghostDist = wander(env.ghostDist, 6, 4, .03, .9);
    env.foodOdor = wander(env.foodOdor, .55, .4, .04, .12);
    env.dangerOdor = wander(env.dangerOdor, .18, .18, .04, .08);
  }

  const midiToHz = midi => 440 * Math.pow(2, (midi - 69) / 12);

  function setupAudio() {
    audio.context ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.master ||= audio.context.createGain();
    audio.master.gain.value = .8;
    audio.master.connect(audio.context.destination);
    if (audio.context.state === 'suspended') audio.context.resume();
  }

  function playNote(midi, duration, gain) {
    setupAudio();
    const now = audio.context.currentTime;
    const envelope = audio.context.createGain();
    const fundamental = audio.context.createOscillator();
    const second = audio.context.createOscillator();
    const third = audio.context.createOscillator();
    const mix = audio.context.createGain();
    fundamental.type = 'triangle'; fundamental.frequency.value = midiToHz(midi);
    second.type = 'sine'; second.frequency.value = midiToHz(midi) * 2;
    third.type = 'sine'; third.frequency.value = midiToHz(midi) * 3;
    mix.gain.value = .55;
    envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.02, gain), now + .015);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    fundamental.connect(mix); second.connect(mix); third.connect(mix);
    mix.connect(envelope).connect(audio.master);
    fundamental.start(now); second.start(now); third.start(now);
    fundamental.stop(now + duration + .05); second.stop(now + duration + .05); third.stop(now + duration + .05);

    const keyIndex = Math.max(0, Math.min(23, midi - 48));
    document.querySelectorAll('.keys button.active').forEach(item => item.classList.remove('active'));
    const key = $('keys').children[keyIndex];
    if (key) { key.classList.add('active'); window.setTimeout(() => key.classList.remove('active'), duration * 1000); }

    const performer = $('performer');
    performer.style.left = `${((keyIndex + .5) / 24) * 100}%`;
    performer.classList.remove('hit'); void performer.offsetWidth; performer.classList.add('hit');
    window.setTimeout(() => performer.classList.remove('hit'), 160);
  }

  // A soft held root note underneath the brain-chosen melody — a fixed
  // accompaniment layer (like a sustain pedal), not a decision the fly makes.
  function playDrone(midi, duration, gain) {
    setupAudio();
    const now = audio.context.currentTime;
    const envelope = audio.context.createGain();
    const osc = audio.context.createOscillator();
    osc.type = 'sine'; osc.frequency.value = midiToHz(midi);
    envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.01, gain), now + .4);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(envelope).connect(audio.master);
    osc.start(now); osc.stop(now + duration + .1);
  }

  const RECEPTOR_DOTS = 14;
  const dotRows = { da: $('dots-da'), '5ht': $('dots-5ht'), oa: $('dots-oa') };
  Object.values(dotRows).forEach(row => { for (let i = 0; i < RECEPTOR_DOTS; i++) row.appendChild(document.createElement('i')); });
  function setReceptorRow(row, level) {
    const lit = Math.round(Math.max(0, Math.min(1, level)) * RECEPTOR_DOTS);
    [...row.children].forEach((dot, index) => { dot.style.opacity = index < lit ? Math.max(.45, level) : .15; });
  }
  function updateReceptors(daLevel, serotoninLevel, oaLevel, mood) {
    setReceptorRow(dotRows.da, daLevel);
    setReceptorRow(dotRows['5ht'], serotoninLevel);
    setReceptorRow(dotRows.oa, oaLevel);
    const balance = Math.round(Math.max(0, Math.min(1, daLevel * .6 + serotoninLevel * .4 - oaLevel * .3)) * 100);
    const ring = $('emotion-ring');
    ring.style.setProperty('--pct', `${balance}%`);
    ring.dataset.mood = (mood || 'CURIOUS').toLowerCase();
    $('emotion-value').textContent = mood || 'CURIOUS';
  }

  // Deterministic stand-in oscillation while the real connectome is still
  // loading, so the piano starts playing immediately instead of waiting —
  // once `brain` resolves, live simulated state takes over below.
  function fallbackSnapshot(t) {
    const heading = ((Math.sin(t * .1) + 1) / 2) * Math.PI * 2;
    const arousal = .2 + (Math.sin(t * .05) + 1) / 2 * .35;
    const dopamine = .25 + (Math.sin(t * .09 + 1) + 1) / 2 * .3;
    const punishment = (Math.sin(t * .07 + 2) + 1) / 2 * .2;
    return { heading, arousal, dopamine, punishment, octopamine: punishment, mood: 'CURIOUS', activeNeuronCount: Math.round(arousal * 24), neuronCount: 24, activity: null };
  }

  function brainSnapshot(t) {
    if (!brain || !brain.state) return fallbackSnapshot(t);
    const s = brain.state;
    const activity = brain.activity || brain.connectome?.calcium || null;
    return {
      heading: s.headingAngle || 0,
      arousal: s.arousalLevel || 0,
      dopamine: s.dopamineTransient || 0,
      punishment: s.ppl1Transient || 0,
      octopamine: s.octopamineLevel || 0,
      mood: s.behaviorState || 'CURIOUS',
      activeNeuronCount: brain.activeNeuronCount || Math.round((s.arousalLevel || 0) * (brain.neuronCount || 24)),
      neuronCount: brain.neuronCount || 24,
      activity,
    };
  }

  function stopTrack() {
    clearInterval(audio.timer);
    audio.playing = false;
    $('play-track').textContent = '▶';
    $('status-text').textContent = 'paused — press play to resume the performance';
  }

  function startTrack() {
    setupAudio();
    stopTrack();
    audio.playing = true;
    $('play-track').textContent = 'Ⅱ';
    $('status-text').textContent = 'the brain is warming up…';

    const tick = () => {
      if (!audio.playing) return;
      const t = performance.now() / 1000;
      const snap = brainSnapshot(t);
      lastSnap = snap;

      stepEnv();
      if (brain) {
        // headingIndex is a free-running clock, not derived from the brain's
        // own output — FullBrainBridge's headingAngle just echoes whatever
        // index it's given, so feeding it back in would collapse to a fixed point.
        const headingIndex = Math.floor(t / 1.4) % 4;
        brain.update(.1, { ...env, headingIndex, temperature: .5 });
      }

      // Register drifts with overall arousal (a real, continuously-updated
      // readout of network-wide spiking). On top of that, a burst detector
      // compares this tick's total activity against its own rolling average —
      // when the network fires noticeably above or below its own recent
      // baseline, that punctuates the melody up or down. Both signals come
      // straight out of the live simulation; nothing here is scripted.
      const activity = snap.activity;
      const activitySum = activity && activity.length ? activity.reduce((a, b) => a + b, 0) : null;
      let burst = 0;
      if (activitySum != null) {
        melody.activityEma = melody.activityEma == null ? activitySum : melody.activityEma * .85 + activitySum * .15;
        if (melody.activityEma > 1e-3) {
          const ratio = activitySum / melody.activityEma;
          burst = Math.max(-4, Math.min(4, Math.round((ratio - 1) * 7)));
        }
      }
      const arousalTerm = Math.max(0, Math.min(1, snap.arousal / .22));
      const rewardTerm = snap.dopamine - snap.punishment * .5;
      const centerFrac = Math.max(0, Math.min(1, arousalTerm + rewardTerm * .25));
      const centerDegree = Math.round(centerFrac * (SCALE.length - 1));
      const targetDegree = Math.max(0, Math.min(SCALE.length - 1, centerDegree + burst));
      const diff = targetDegree - melody.degree;
      const step = Math.sign(diff) * Math.min(3, Math.abs(diff));
      melody.degree = Math.max(0, Math.min(SCALE.length - 1, melody.degree + step));
      let midi = SCALE[melody.degree];
      if (arousalTerm > .8 && melody.beat % 8 === 0) midi = Math.min(71, midi + 12);

      const durationBeats = Math.max(.45, 1.5 - snap.arousal * .95);
      const gain = .12 + snap.dopamine * .18;
      playNote(midi, durationBeats * BEAT_MS / 1000 * .82, gain);

      if (melody.beat % 4 === 0) {
        const root = melody.degree < 5 ? SCALE[0] : SCALE[5];
        playDrone(root, durationBeats * 4 * BEAT_MS / 1000, .045);
      }

      if (melody.degree === 0 && brain) brain.onPelletEaten(false);

      $('dopamine-value').textContent = `${Math.round(snap.dopamine * 100)}%`;
      $('neuron-value').textContent = `${Math.round(snap.activeNeuronCount).toLocaleString()} / ${Math.round(snap.neuronCount).toLocaleString()}`;
      $('backend-badge').textContent = brain ? brainBackend : 'BOOTING…';
      $('status-text').textContent = brain ? `${brainBackend} · ${snap.mood}` : 'placeholder pulse while the connectome loads…';
      updateReceptors(snap.dopamine, 1 - snap.punishment, snap.octopamine, snap.mood);

      melody.beat++;
      $('clock').textContent = `${String(Math.floor(melody.beat / 8)).padStart(2, '0')}:${String((melody.beat * 7) % 60).padStart(2, '0')}`;
      audio.timer = setTimeout(tick, durationBeats * BEAT_MS);
    };
    tick();
    brainReady.finally(() => { if (audio.playing) $('status-text').textContent = `${brainBackend} · connected`; });
  }

  $('play-track').addEventListener('click', () => audio.playing ? stopTrack() : startTrack());
  [...Array(24)].forEach((_, index) => {
    const key = document.createElement('button'); key.type = 'button';
    key.setAttribute('aria-label', `Piano key ${index + 1}`); key.setAttribute('aria-hidden', 'true');
    $('keys').appendChild(key);
  });
  updateReceptors(.25, .55, .12, 'CURIOUS');

  function draw() {
    const time = performance.now() / 1000, wave = $('wave'), wctx = wave.getContext('2d'), neural = $('neural'), nctx = neural.getContext('2d');
    // Amplitude and speed track real arousal/dopamine readouts, so a calmer
    // or more rewarded brain visibly settles or livens the line.
    const amp = 6 + lastSnap.arousal * 55, speed = 1 + lastSnap.dopamine * 2.5;
    wctx.clearRect(0, 0, wave.width, wave.height); wctx.strokeStyle = '#d9a34f'; wctx.lineWidth = 1.5; wctx.beginPath();
    for (let x = 0; x < wave.width; x++) { const y = 45 + Math.sin(x / 38 + time * speed) * amp + Math.sin(x / 13 + time) * (amp * .3); x ? wctx.lineTo(x, y) : wctx.moveTo(x, y); } wctx.stroke();
    nctx.clearRect(0, 0, neural.width, neural.height);
    const activity = brain?.activity || brain?.connectome?.calcium;
    const cols = 8, rows = 3;
    for (let i = 0; i < cols * rows; i++) {
      const raw = activity ? activity[i % activity.length] : (Math.sin(time * 3 + i) + 1) * .5;
      // Spike counts have no fixed ceiling across backends, so squash softly
      // toward 0..1 instead of assuming a scale.
      const live = activity ? 1 - 1 / (1 + raw * .3) : raw;
      const col = i % cols, row = Math.floor(i / cols);
      const x = (col + .5) * (neural.width / cols), y = (row + .5) * (neural.height / rows);
      const pulse = 1.4 + live * 2.4;
      nctx.globalAlpha = .18 + live * .75;
      nctx.fillStyle = live > .5 ? '#d9a34f' : '#8b8175';
      nctx.beginPath(); nctx.arc(x, y, pulse, 0, Math.PI * 2); nctx.fill();
    }
    nctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();
