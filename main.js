(() => {
  const $ = id => document.getElementById(id);
  const tracks = [
    { name: 'Ode to Joy', artist: 'Beethoven', notes: [[64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],[60,1],[60,1],[62,1],[64,1],[64,1.5],[62,.5],[62,2]] },
    { name: 'Für Elise', artist: 'Beethoven', notes: [[64,.5],[63,.5],[64,.5],[63,.5],[64,.5],[59,.5],[62,.5],[60,.5],[57,1],[48,.5],[52,.5],[57,.5],[59,1]] },
    { name: 'Moonlight Sonata', artist: 'Beethoven', notes: [[57,.5],[64,.5],[69,.5],[57,.5],[64,.5],[69,.5],[56,.5],[64,.5],[68,.5],[54,.5],[64,.5],[68,.5],[55,.5],[64,.5],[69,.5],[54,1]] },
    { name: 'Canon in D', artist: 'Pachelbel', notes: [62,57,59,54,55,50,55,57,62,57,59,54,55,50,55,57].map(note => [note, .75]) },
    { name: 'Greensleeves', artist: 'Traditional', notes: [64,67,69,69,71,69,67,65,64,62,60,62,64,64].map(note => [note, 1]) },
    { name: 'Amazing Grace', artist: 'Traditional', notes: [60,65,69,65,69,67,65,62,60,65,69,65,69,72,69].map(note => [note, 1]) },
    { name: 'Jingle Bells', artist: 'Traditional', notes: [[64,.5],[64,.5],[64,1],[64,.5],[64,.5],[64,1],[64,.5],[67,.5],[60,.5],[62,.5],[64,2],[65,.5],[65,.5],[65,.5],[65,.5],[65,.5],[65,.25],[64,.25],[64,.5],[64,.25],[64,.25],[65,.5],[64,1],[67,1]] },
    { name: 'Happy Birthday', artist: 'Traditional', notes: [60,60,62,60,65,64,60,60,62,60,67,65,60,60,72,69].map(note => [note, .75]) },
    { name: 'Scarborough Fair', artist: 'Traditional', notes: [69,69,72,74,76,74,72,69,67,69,72,74,72,69,67].map(note => [note, 1]) },
    { name: 'Beethoven Fifth', artist: 'Beethoven', notes: [[67,.4],[67,.4],[67,.4],[63,1.6],[65,.4],[65,.4],[65,.4],[62,1.6]] }
  ];
  const audio = { context: null, master: null, volume: .65, timer: null, note: 0, playing: false, trial: 0, epsilon: 0, q: tracks.map(item => item.notes.map(() => new Map())), dopamine: .32, punishment: 0 };
  const BEAT_MS = 180;
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
    throw error;
  });
  let track = 0;
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
    audio.master.gain.value = audio.volume;
    audio.master.connect(audio.context.destination);
    if (audio.context.state === 'suspended') audio.context.resume();
  }
  function playNote(midi, duration = .55, performer = false, correct = false) {
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
    mix.gain.value = .7;
    envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(.22, now + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    fundamental.connect(mix); second.connect(mix); third.connect(mix);
    mix.connect(envelope).connect(audio.master);
    fundamental.start(now); second.start(now); third.start(now);
    fundamental.stop(now + duration + .05); second.stop(now + duration + .05); third.stop(now + duration + .05);
    const keyIndex = Math.max(0, Math.min(23, midi - 48));
    const key = $('keys').children[keyIndex];
    document.querySelectorAll('.keys button.active').forEach(item => item.classList.remove('active'));
    if (key) {
      key.classList.add('active');
      window.setTimeout(() => key.classList.remove('active'), duration * 1000);
    }
    $('fly').classList.toggle('performing', performer);
    $('performer-status').textContent = performer ? (correct ? 'DOPAMINE + TARGET HIT' : 'PUNISHMENT · WRONG KEY') : 'TARGET KEY READY';
    $('status-text').textContent = performer ? `fly selected key ${keyIndex + 1}` : `fly is learning the next target`;
  }
  function highlightTarget(midi) {
    document.querySelectorAll('.keys button.target').forEach(item => item.classList.remove('target'));
    const target = $('keys').children[Math.max(0, Math.min(23, midi - 48))];
    if (target) target.classList.add('target');
  }
  function renderTrack() {
    const current = tracks[track];
    $('track-name').innerHTML = `${current.name} <em>— ${current.artist}</em>`;
    $('track-note').textContent = 'The fly hears the next target through its sensory input';
    const picker = $('song-picker');
    picker.innerHTML = tracks.map((item, index) => `<option value="${index}">${item.name} — ${item.artist}</option>`).join('');
    picker.value = track;
  }
  function stopTrack() { clearInterval(audio.timer); audio.playing = false; $('play-track').textContent = '▶'; $('fly').classList.remove('performing'); $('performer-status').textContent = 'FLY IS LISTENING'; }
  function startTrack() {
    setupAudio(); stopTrack(); audio.note = 0; audio.trial++; audio.epsilon = 0; audio.playing = true; $('play-track').textContent = 'Ⅱ';
    $('status-text').textContent = 'loading virtual brain...';
    brainReady.then(() => {
      if (!audio.playing) return;
      $('status-text').textContent = `${brainBackend} is choosing`;
      tick();
    }).catch(() => {
      stopTrack();
      $('status-text').textContent = 'virtual brain unavailable';
    });
    const tick = () => {
      if (!audio.playing) return;
      const notes = tracks[track].notes;
      const targetPair = notes[audio.note % notes.length];
      const target = fitToKeyboard(targetPair[0]);
      highlightTarget(target);
      const sense = { sugarBearing: 0, sugarDist: 1, ghostBearing: 0, ghostDist: null, headingIndex: audio.note % 4, foodOdor: 1, dangerOdor: 0, temperature: .5 };
      if (brain) brain.update(.1, sense);
      const memory = audio.q[track][audio.note % notes.length];
      const learned = memory.get(target) || 0;
      const explore = Math.random() < audio.epsilon;
      const midi = explore ? 48 + Math.floor(Math.random() * 24) : target;
      const correct = midi === target;
      memory.set(midi, (memory.get(midi) || 0) + (correct ? 1 : -.45));
      if (!correct && Math.random() < .55) memory.set(target, (memory.get(target) || 0) + .7);
      if (brain) correct ? brain.onPelletEaten(false) : brain.onHazardEaten();
      playNote(midi, Math.max(.1, .16 * targetPair[1]), true, correct);
      $('learning-badge').textContent = `EXPLORATION ${Math.round(audio.epsilon * 100)}%`;
      $('trial-count').textContent = `TRIAL ${String(audio.trial).padStart(3, '0')}`;
      audio.dopamine = correct ? Math.min(1, audio.dopamine + .12) : Math.max(0, audio.dopamine - .06);
      audio.punishment = correct ? Math.max(0, audio.punishment - .08) : Math.min(1, audio.punishment + .12);
      $('dopamine-value').textContent = `${Math.round(audio.dopamine * 100)}%`;
      $('neural-value').textContent = correct ? 'REINFORCED' : 'PUNISHED';
      $('emotion-value').textContent = correct ? (audio.dopamine > .72 ? 'JOYFUL' : 'FOCUSED') : (audio.punishment > .55 ? 'FRUSTRATED' : 'CURIOUS');
      $('hormone-value').textContent = `DA ${Math.round(audio.dopamine * 100)} · 5-HT ${Math.round((1 - audio.punishment) * 62)} · OA ${Math.round(audio.punishment * 100)}`;
      $('neuron-value').textContent = `${correct ? 24 : 8 + Math.floor(Math.random() * 10)} / 24 ACTIVE`;
      updateReceptors(audio.dopamine, 1 - audio.punishment, audio.punishment, $('emotion-value').textContent);
      if (brain && brain.state) {
        const neuralState = brain.state;
        const totalNeurons = brain.neuronCount || 66;
        const activeNeurons = brain.activeNeuronCount || Math.round((neuralState.arousalLevel || 0) * totalNeurons);
        $('neuron-value').textContent = brainBackend === 'FLYWIRE WHOLE-BRAIN'
          ? `${activeNeurons.toLocaleString()} / ${totalNeurons.toLocaleString()} ACTIVE`
          : `${Math.round((neuralState.arousalLevel || 0) * totalNeurons)} / ${totalNeurons} ACTIVE`;
        $('hormone-value').textContent = `DA ${Math.round((neuralState.dopamineTransient || 0) * 100)} · 5-HT ${Math.round((1 - (neuralState.ppl1Transient || 0)) * 62)} · OA ${Math.round((neuralState.octopamineLevel || 0) * 100)}`;
        $('emotion-value').textContent = neuralState.behaviorState || 'FOCUSED';
        $('status-text').textContent = `${brainBackend} · ${neuralState.behaviorState || 'ACTIVE'}`;
        updateReceptors((neuralState.dopamineTransient || 0), 1 - (neuralState.ppl1Transient || 0), (neuralState.octopamineLevel || 0), neuralState.behaviorState || 'FOCUSED');
      }
      audio.note++;
      $('clock').textContent = `${String(Math.floor(audio.note / 2)).padStart(2, '0')}:${String((audio.note * 30) % 60).padStart(2, '0')}`;
      audio.timer = setTimeout(tick, Math.max(90, targetPair[1] * BEAT_MS));
    };
    tick();
  }
  $('play-track').addEventListener('click', () => audio.playing ? stopTrack() : startTrack());
  $('song-picker').addEventListener('change', event => { stopTrack(); track = Number(event.target.value); renderTrack(); });
  [...Array(24)].forEach((_, index) => {
    const key = document.createElement('button'); key.type = 'button'; key.setAttribute('aria-label', `Piano key ${index + 1}`);
    key.setAttribute('aria-hidden', 'true'); $('keys').appendChild(key);
  });
  const RECEPTOR_DOTS = 14;
  const dotRows = { da: $('dots-da'), '5ht': $('dots-5ht'), oa: $('dots-oa') };
  Object.values(dotRows).forEach(row => {
    for (let i = 0; i < RECEPTOR_DOTS; i++) row.appendChild(document.createElement('i'));
  });
  function setReceptorRow(row, level) {
    const lit = Math.round(Math.max(0, Math.min(1, level)) * RECEPTOR_DOTS);
    [...row.children].forEach((dot, index) => {
      dot.classList.toggle('lit', index < lit);
      dot.style.opacity = index < lit ? Math.max(.45, level) : .16;
    });
  }
  function updateReceptors(daLevel, serotoninLevel, oaLevel, mood) {
    setReceptorRow(dotRows.da, daLevel);
    setReceptorRow(dotRows['5ht'], serotoninLevel);
    setReceptorRow(dotRows.oa, oaLevel);
    const ring = $('emotion-ring');
    const balance = Math.round(Math.max(0, Math.min(1, daLevel * .6 + serotoninLevel * .4 - oaLevel * .3)) * 100);
    ring.style.setProperty('--pct', `${balance}%`);
    ring.dataset.mood = (mood || 'CURIOUS').toLowerCase();
    $('emotion-ring-label').textContent = mood || 'CURIOUS';
    $('receptor-mood').textContent = mood || 'CURIOUS';
  }
  updateReceptors(.32, .48, .2, 'CURIOUS');
  function draw() {
    const time = performance.now() / 1000, wave = $('wave'), wctx = wave.getContext('2d'), neural = $('neural'), nctx = neural.getContext('2d');
    wctx.clearRect(0, 0, wave.width, wave.height); wctx.strokeStyle = '#d9b579'; wctx.lineWidth = 2; wctx.beginPath();
    for (let x = 0; x < wave.width; x++) { const y = 65 + Math.sin(x / 38 + time * 2) * 16 + Math.sin(x / 13 + time) * 5; x ? wctx.lineTo(x, y) : wctx.moveTo(x, y); } wctx.stroke();
    nctx.clearRect(0, 0, neural.width, neural.height);
    const activity = brain?.activity || brain?.connectome?.calcium;
    nctx.fillStyle = '#bdcda9';
    for (let i = 0; i < 30; i++) {
      const live = activity ? activity[i % activity.length] : (Math.sin(time * 3 + i) + 1) * .5;
      const x = (i * 71) % neural.width, y = 18 + ((i * 43) % 92), pulse = 2 + Math.min(3, live * 2);
      nctx.globalAlpha = .35 + Math.min(.65, live);
      nctx.beginPath(); nctx.arc(x, y, pulse, 0, Math.PI * 2); nctx.fill();
    }
    nctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  renderTrack(); draw();
})();
