(() => {
  const $ = id => document.getElementById(id);

  // Real pieces, corrected pitches/rhythm — the fly performs these exactly,
  // in fixed rhythm. It does not choose or improvise notes; the live brain
  // simulation below drives the stats dashboard (dopamine, hormones,
  // emotion, drives, neuron activity) by reacting to the performance, not
  // the other way around.
  const TRACKS = [
    { name: 'Ode to Joy', artist: 'Beethoven', bpm: 112, notes: [[64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],[60,1],[60,1],[62,1],[64,1],[64,1.5],[62,.5],[62,2]] },
    { name: 'Für Elise', artist: 'Beethoven', bpm: 132, notes: [[64,.5],[63,.5],[64,.5],[63,.5],[64,.5],[59,.5],[62,.5],[60,.5],[57,1],[48,.5],[52,.5],[57,.5],[59,1]] },
    { name: 'Moonlight Sonata', artist: 'Beethoven', bpm: 88, notes: [[57,.5],[64,.5],[69,.5],[57,.5],[64,.5],[69,.5],[56,.5],[64,.5],[68,.5],[54,.5],[64,.5],[68,.5],[55,.5],[64,.5],[69,.5],[54,1]] },
    { name: 'Canon in D', artist: 'Pachelbel', bpm: 96, notes: [62,57,59,54,55,50,55,57,62,57,59,54,55,50,55,57].map(n => [n, .75]) },
    { name: 'Greensleeves', artist: 'Traditional', bpm: 100, notes: [64,67,69,69,71,69,67,65,64,62,60,62,64,64].map(n => [n, 1]) },
    { name: 'Amazing Grace', artist: 'Traditional', bpm: 84, notes: [60,65,69,65,69,67,65,62,60,65,69,65,69,72,69].map(n => [n, 1]) },
    { name: 'Jingle Bells', artist: 'Traditional', bpm: 140, notes: [[64,.5],[64,.5],[64,1],[64,.5],[64,.5],[64,1],[64,.5],[67,.5],[60,.5],[62,.5],[64,2],[65,.5],[65,.5],[65,.5],[65,.5],[65,.5],[65,.25],[64,.25],[64,.5],[64,.25],[64,.25],[65,.5],[64,1],[67,1]] },
    { name: 'Happy Birthday', artist: 'Traditional', bpm: 108, notes: [60,60,62,60,65,64,60,60,62,60,67,65,60,60,72,69].map(n => [n, .75]) },
    { name: 'Scarborough Fair', artist: 'Traditional', bpm: 92, notes: [69,69,72,74,76,74,72,69,67,69,72,74,72,69,67].map(n => [n, 1]) },
    { name: "Beethoven's Fifth", artist: 'Beethoven', bpm: 108, notes: [[67,.4],[67,.4],[67,.4],[63,1.6],[65,.4],[65,.4],[65,.4],[62,1.6]] },
  ];
  let track = 0;
  let noteIndex = 0;
  const BEAT_MS_BASE = 60000; // divided by bpm to get ms per beat

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

  let lastSnap = { arousal: .15, dopamine: .2, drives: { foraging: .2, escape: .05, explore: .3, rest: .2 } };

  // Slow mean-reverting random walk standing in for an actual sensory
  // environment, so the brain sim has something non-repeating to react to
  // while it watches the fly perform. This only feeds the stats dashboard —
  // it has no influence on which notes play.
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
  function fitToKeyboard(midi) {
    let fitted = midi;
    while (fitted < 48) fitted += 12;
    while (fitted > 71) fitted -= 12;
    return fitted;
  }

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

    const hero = document.querySelector('.panel-hero');
    if (hero) {
      hero.style.setProperty('--pulse-x', `${(keyIndex / 23) * 100}%`);
      hero.style.setProperty('--pulse', Math.min(1, gain * 4).toString());
      window.setTimeout(() => hero.style.setProperty('--pulse', '0'), Math.min(400, duration * 700));
    }
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
  function updateDrives(drives) {
    $('drive-foraging').style.width = `${Math.round(Math.min(1, drives.foraging || 0) * 100)}%`;
    $('drive-escape').style.width = `${Math.round(Math.min(1, drives.escape || 0) * 100)}%`;
    $('drive-explore').style.width = `${Math.round(Math.min(1, drives.explore || 0) * 100)}%`;
    $('drive-rest').style.width = `${Math.round(Math.min(1, drives.rest || 0) * 100)}%`;
  }

  function fallbackSnapshot(t) {
    const arousal = .2 + (Math.sin(t * .05) + 1) / 2 * .35;
    const dopamine = .25 + (Math.sin(t * .09 + 1) + 1) / 2 * .3;
    const punishment = (Math.sin(t * .07 + 2) + 1) / 2 * .2;
    return {
      arousal, dopamine, punishment, octopamine: punishment, mood: 'CURIOUS',
      activeNeuronCount: Math.round(arousal * 24), neuronCount: 24, activity: null,
      drives: { foraging: arousal * .6, escape: punishment, explore: arousal * .4, rest: 1 - arousal },
    };
  }

  function brainSnapshot(t) {
    if (!brain || !brain.state) return fallbackSnapshot(t);
    const s = brain.state;
    const activity = brain.activity || brain.connectome?.calcium || null;
    const drives = s.drives || {
      foraging: s.npfLevel || 0,
      escape: s.panicLevel || 0,
      explore: s.arousalLevel || 0,
      rest: Math.max(0, 1 - (s.arousalLevel || 0)),
    };
    return {
      arousal: s.arousalLevel || 0,
      dopamine: s.dopamineTransient || 0,
      punishment: s.ppl1Transient || 0,
      octopamine: s.octopamineLevel || 0,
      mood: s.behaviorState || 'CURIOUS',
      activeNeuronCount: brain.activeNeuronCount || Math.round((s.arousalLevel || 0) * (brain.neuronCount || 24)),
      neuronCount: brain.neuronCount || 24,
      activity, drives,
    };
  }

  function renderTrack() {
    const song = TRACKS[track];
    $('track-title').innerHTML = `${song.name} <em>— ${song.artist}</em>`;
    $('tempo-value').textContent = `${song.bpm} BPM`;
    const picker = $('song-picker');
    picker.innerHTML = TRACKS.map((s, i) => `<option value="${i}">${s.name} — ${s.artist}</option>`).join('');
    picker.value = track;
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
    noteIndex = 0;
    $('play-track').textContent = 'Ⅱ';
    $('status-text').textContent = `${brainBackend} is warming up…`;

    const tick = () => {
      if (!audio.playing) return;
      const t = performance.now() / 1000;
      const song = TRACKS[track];
      const beatMs = BEAT_MS_BASE / song.bpm;
      const [rawMidi, beats] = song.notes[noteIndex % song.notes.length];
      const midi = fitToKeyboard(rawMidi);

      // The brain sim runs alongside the performance, not in charge of it:
      // it gets real sensory drift plus a reward pulse each time the piece
      // resolves to its tonic, and its own state (arousal/dopamine/drives)
      // is what the dashboard below actually reflects.
      stepEnv();
      const snap = brainSnapshot(t);
      lastSnap = snap;
      if (brain) {
        const headingIndex = Math.floor((env.sugarBearing + Math.PI) / (Math.PI / 2)) % 4;
        brain.update(.1, { ...env, headingIndex, temperature: .5 });
        if (noteIndex % song.notes.length === 0) brain.onPelletEaten(false);
      }

      const gain = .16 + snap.dopamine * .14;
      playNote(midi, (beats * beatMs / 1000) * .85, gain);

      $('dopamine-value').textContent = `${Math.round(snap.dopamine * 100)}%`;
      $('neuron-value').textContent = `${Math.round(snap.activeNeuronCount).toLocaleString()} / ${Math.round(snap.neuronCount).toLocaleString()}`;
      $('backend-badge').textContent = brain ? brainBackend : 'BOOTING…';
      $('status-text').textContent = brain ? `${brainBackend} · watching the fly play · ${snap.mood}` : 'the brain sim is still loading…';
      updateReceptors(snap.dopamine, 1 - snap.punishment, snap.octopamine, snap.mood);
      updateDrives(snap.drives);
      $('progress-fill').style.width = `${((noteIndex % song.notes.length) / song.notes.length) * 100}%`;

      noteIndex++;
      const totalBeats = Math.floor(noteIndex / song.notes.length) * song.notes.reduce((a, n) => a + n[1], 0)
        + song.notes.slice(0, noteIndex % song.notes.length).reduce((a, n) => a + n[1], 0);
      const totalSeconds = Math.round(totalBeats * beatMs / 1000);
      $('clock').textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
      audio.timer = setTimeout(tick, beats * beatMs);
    };
    tick();
    brainReady.finally(() => { if (audio.playing) $('status-text').textContent = `${brainBackend} · connected`; });
  }

  $('play-track').addEventListener('click', () => audio.playing ? stopTrack() : startTrack());
  $('song-picker').addEventListener('change', e => {
    track = Number(e.target.value);
    noteIndex = 0;
    renderTrack();
    if (audio.playing) startTrack();
  });
  [...Array(24)].forEach((_, index) => {
    const key = document.createElement('button'); key.type = 'button';
    key.setAttribute('aria-label', `Piano key ${index + 1}`); key.setAttribute('aria-hidden', 'true');
    $('keys').appendChild(key);
  });
  renderTrack();
  updateReceptors(.25, .55, .12, 'CURIOUS');
  updateDrives({ foraging: .2, escape: .05, explore: .3, rest: .2 });

  function draw() {
    const time = performance.now() / 1000, wave = $('wave'), wctx = wave.getContext('2d'), neural = $('neural'), nctx = neural.getContext('2d');
    const amp = 6 + lastSnap.arousal * 55, speed = 1 + lastSnap.dopamine * 2.5;
    wctx.clearRect(0, 0, wave.width, wave.height); wctx.strokeStyle = '#d9a34f'; wctx.lineWidth = 1.5; wctx.beginPath();
    const mid = wave.height / 2;
    for (let x = 0; x < wave.width; x++) { const y = mid + Math.sin(x / 38 + time * speed) * amp + Math.sin(x / 13 + time) * (amp * .3); x ? wctx.lineTo(x, y) : wctx.moveTo(x, y); } wctx.stroke();
    nctx.clearRect(0, 0, neural.width, neural.height);
    const activity = brain?.activity || brain?.connectome?.calcium;
    const cols = 8, rows = 3;
    for (let i = 0; i < cols * rows; i++) {
      const raw = activity ? activity[i % activity.length] : (Math.sin(time * 3 + i) + 1) * .5;
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
