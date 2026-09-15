(() => {
  const $ = id => document.getElementById(id);
  const tracks = [
    { name: 'Ode to Joy', artist: 'Beethoven', notes: [64,64,65,67,67,65,64,62,60,60,62,64,64,62,62] },
    { name: 'Greensleeves', artist: 'Traditional', notes: [64,67,69,69,71,69,67,65,64,62,60,62,64,64] },
    { name: 'Canon in D', artist: 'Pachelbel', notes: [62,61,62,64,66,67,69,66,67,69,71,72,71,69,67,66] }
  ];
  const audio = { context: null, master: null, volume: .65, timer: null, note: 0, playing: false, uploaded: false };
  let track = 0;
  const midiToHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
  function setupAudio() {
    audio.context ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.master ||= audio.context.createGain();
    audio.master.gain.value = audio.volume;
    audio.master.connect(audio.context.destination);
    if (audio.context.state === 'suspended') audio.context.resume();
  }
  function playNote(midi, duration = .55) {
    setupAudio();
    const now = audio.context.currentTime;
    const osc = audio.context.createOscillator();
    const envelope = audio.context.createGain();
    osc.type = 'triangle'; osc.frequency.value = midiToHz(midi);
    envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(.26, now + .025);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(envelope).connect(audio.master); osc.start(now); osc.stop(now + duration + .05);
    $('status-text').textContent = `fly playing key ${((midi - 48) % 24) + 1}`;
  }
  function renderTrack() {
    const current = tracks[track];
    $('track-name').innerHTML = `${current.name} <em>— ${current.artist}</em>`;
    $('track-note').textContent = 'Public-domain piano arrangement · ready to play';
  }
  function stopTrack() { clearInterval(audio.timer); audio.playing = false; $('play-track').textContent = '▶'; }
  function startTrack() {
    setupAudio(); stopTrack(); audio.playing = true; $('play-track').textContent = 'Ⅱ';
    audio.timer = setInterval(() => {
      const notes = tracks[track].notes;
      playNote(notes[audio.note++ % notes.length], .5);
      $('clock').textContent = `${String(Math.floor(audio.note / 2)).padStart(2, '0')}:${String((audio.note * 30) % 60).padStart(2, '0')}`;
    }, 600);
  }
  $('play-track').addEventListener('click', () => audio.playing ? stopTrack() : startTrack());
  $('previous').addEventListener('click', () => { stopTrack(); track = (track + tracks.length - 1) % tracks.length; renderTrack(); });
  $('next').addEventListener('click', () => { stopTrack(); track = (track + 1) % tracks.length; renderTrack(); });
  $('volume').addEventListener('input', event => { audio.volume = Number(event.target.value); $('volume-label').textContent = `${Math.round(audio.volume * 100)}%`; if (audio.master) audio.master.gain.value = audio.volume; });
  $('song-file').addEventListener('change', event => {
    const file = event.target.files[0]; if (!file) return;
    stopTrack(); audio.uploaded = true; $('uploaded-audio').src = URL.createObjectURL(file); $('uploaded-audio').volume = audio.volume;
    $('uploaded-audio').play(); $('track-name').innerHTML = `${file.name} <em>— your audio</em>`; $('track-note').textContent = 'Playing your local audio file';
  });
  [...Array(24)].forEach((_, index) => {
    const key = document.createElement('button'); key.type = 'button'; key.setAttribute('aria-label', `Piano key ${index + 1}`);
    key.addEventListener('pointerdown', () => playNote(48 + index, .7)); $('keys').appendChild(key);
  });
  function draw() {
    const time = performance.now() / 1000, wave = $('wave'), wctx = wave.getContext('2d'), neural = $('neural'), nctx = neural.getContext('2d');
    wctx.clearRect(0, 0, wave.width, wave.height); wctx.strokeStyle = '#d9b579'; wctx.lineWidth = 2; wctx.beginPath();
    for (let x = 0; x < wave.width; x++) { const y = 65 + Math.sin(x / 38 + time * 2) * 16 + Math.sin(x / 13 + time) * 5; x ? wctx.lineTo(x, y) : wctx.moveTo(x, y); } wctx.stroke();
    nctx.clearRect(0, 0, neural.width, neural.height); nctx.fillStyle = '#bdcda9';
    for (let i = 0; i < 30; i++) { const x = (i * 71) % neural.width, y = 18 + ((i * 43) % 92), pulse = 2 + (Math.sin(time * 3 + i) + 1) * 2; nctx.beginPath(); nctx.arc(x, y, pulse, 0, Math.PI * 2); nctx.fill(); }
    $('dopamine-value').textContent = `${Math.round(30 + (Math.sin(time * 1.5) + 1) * 15)}%`; requestAnimationFrame(draw);
  }
  renderTrack(); draw();
})();
