/**
 * main.js — Drosophila Synaptic Cafe Master Controller
 *
 * Integrates:
 * - NeuroAudio multi-model sound synthesizer (Grand Piano, Rhodes, Neuro-Synth, Kalimba)
 * - ConnectomeVisualizer 2D/3D biological neural circuit canvas with GCaMP6f calcium imaging
 * - TelemetryDashboard multi-channel oscilloscope, neurochemical tracker & attractor phase space
 * - Continuous autonomous reinforcement learning song practice engine with mastery transitions
 * - Micro-stimulus injection deck & interactive 24-key piano
 */

(() => {
  const $ = id => document.getElementById(id);

  // 10 Curated Master Melodies with difficulty and metadata
  const TRACKS = [
    { name: 'Ode to Joy', artist: 'L. van Beethoven', difficulty: '★☆☆', desc: 'An die Freude — simple step-wise melody ideal for initial synaptic weight conditioning', notes: [[64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],[60,1],[60,1],[62,1],[64,1],[64,1.5],[62,.5],[62,2]] },
    { name: 'Für Elise', artist: 'L. van Beethoven', difficulty: '★★☆', desc: 'Bagatelle in A minor — rapid chromatic oscillations challenging Kenyon Cell sparse coding', notes: [76,75,76,75,76,71,74,72,69,45,52,57,60,64,69,71].map(note => [note, .75]) },
    { name: 'Moonlight Sonata', artist: 'L. van Beethoven', difficulty: '★★☆', desc: 'Piano Sonata No. 14 — gentle arpeggiated triplets demanding sustained calcium integration', notes: [57,64,69,57,64,69,57,64,69,55,64,69,55,64,69,53].map(note => [note, .75]) },
    { name: 'Canon in D', artist: 'J. Pachelbel', difficulty: '★★☆', desc: 'Polyphonic harmonic progression across two octaves with sequential motor stepping', notes: [62,61,62,64,66,67,69,66,67,69,71,72,71,69,67,66].map(note => [note, .75]) },
    { name: 'Greensleeves', artist: 'Traditional Folk', difficulty: '★★☆', desc: 'Dorian mode folk ballad testing descending DNa lateral steering precision', notes: [64,67,69,69,71,69,67,65,64,62,60,62,64,64].map(note => [note, 1]) },
    { name: 'Amazing Grace', artist: 'Traditional', difficulty: '★☆☆', desc: 'Pentatonic hymn with wide intervallic leaps activating Johnston organ proxies', notes: [60,65,69,65,69,67,65,62,60,65,69,65,69,72,69].map(note => [note, 1]) },
    { name: 'Jingle Bells', artist: 'J. Pierpont', difficulty: '★☆☆', desc: 'Fast rhythmic staccato pulse exciting mushroom body output neurons', notes: [64,64,64,64,64,64,64,67,60,62,64,65,65,65,65,65].map(note => [note, .5]) },
    { name: 'Happy Birthday', artist: 'Traditional', difficulty: '★☆☆', desc: 'Universal celebration tune with syncopated cadence and octave climax', notes: [60,60,62,60,65,64,60,60,62,60,67,65,60,60,72,69].map(note => [note, .75]) },
    { name: 'Scarborough Fair', artist: 'Traditional', difficulty: '★★★', desc: 'Modal folk song with delicate micro-timing and intricate descending runs', notes: [69,69,72,74,76,74,72,69,67,69,72,74,72,69,67].map(note => [note, 1]) },
    { name: 'Symphony No. 5', artist: 'L. van Beethoven', difficulty: '★★★', desc: 'Fate motif — powerful explosive bursts driving Giant Fiber threshold transitions', notes: [64,64,64,60,64,64,64,57,64,64,64,60,64,64,64,57].map(note => [note, .5]) }
  ];

  // Engine state
  const audio = new NeuroAudio();
  let visualizer = null;
  let dashboard = null;

  const state = {
    playing: false,
    autonomous: true,
    currentTrack: 0,
    noteIndex: 0,
    timer: null,
    trial: 1,
    epsilon: 0.05,
    qTable: TRACKS.map(t => t.notes.map(() => new Map())),
    stats: {
      totalNotes: 0,
      correctNotes: 0,
      accuracy: 94.5,
      deltaW: 0.042,
    },
    brain: null,
    brainBackend: 'CONNECTOME LIF (66)',
    activeKeyIndex: -1,
    targetKeyIndex: -1,
    isManualPlaying: false
  };

  const BASE_BEAT_MS = 220;

  // Keyboard mapping for computer typing (A..K and W..U)
  const KEY_MAP = {
    'a': 48, 'w': 49, 's': 50, 'e': 51, 'd': 52, 'f': 53, 't': 54, 'g': 55, 'y': 56, 'h': 57, 'u': 58, 'j': 59,
    'k': 60, 'o': 61, 'l': 62, 'p': 63, ';': 64, "'": 65
  };

  function fitToKeyboard(midi) {
    let fitted = midi;
    while (fitted < 48) fitted += 12;
    while (fitted > 71) fitted -= 12;
    return fitted;
  }

  // Initialize Drosophila Brain
  async function initBrain() {
    try {
      if (window.FullBrainBridge) {
        state.brain = await FullBrainBridge.create();
        state.brainBackend = 'FLYWIRE WHOLE-BRAIN (139k)';
      }
    } catch (err) {
      console.warn('Whole-brain worker unavailable, falling back to Compact Connectome LIF:', err);
      try {
        state.brain = await FlyNeuralEngine.create('connectome.json');
        state.brainBackend = 'COMPACT CONNECTOME LIF (66)';
      } catch (err2) {
        console.error('Failed to load connectome:', err2);
      }
    }

    if (visualizer && state.brain) {
      visualizer.setBrain(state.brain);
    }

    if ($('brain-backend-badge')) {
      $('brain-backend-badge').textContent = state.brainBackend;
    }
  }

  // Build 24 Piano Keys (2 Octaves: MIDI 48 to 71)
  function setupPianoKeys() {
    const keysContainer = $('keys');
    if (!keysContainer) return;
    keysContainer.innerHTML = '';

    // Standard piano layout (14 white, 10 black)
    const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false,
                     false, true, false, true, false, false, true, false, true, false, true, false];

    for (let i = 0; i < 24; i++) {
      const midi = 48 + i;
      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      keyBtn.className = `piano-key ${isBlack[i] ? 'black-key' : 'white-key'}`;
      keyBtn.dataset.midi = midi;
      keyBtn.dataset.index = i;
      keyBtn.setAttribute('aria-label', `Piano key ${midi}`);

      // Manual interaction
      keyBtn.addEventListener('mousedown', () => {
        handleManualKeyPress(midi, i);
      });

      keysContainer.appendChild(keyBtn);
    }
  }

  function highlightKey(keyIndex, isTarget = false, isCorrect = true) {
    const keys = $('keys')?.children;
    if (!keys) return;

    if (isTarget) {
      document.querySelectorAll('.piano-key.target').forEach(k => k.classList.remove('target'));
      if (keys[keyIndex]) keys[keyIndex].classList.add('target');
      state.targetKeyIndex = keyIndex;
    } else {
      document.querySelectorAll('.piano-key.active').forEach(k => k.classList.remove('active', 'correct', 'error'));
      if (keys[keyIndex]) {
        keys[keyIndex].classList.add('active', isCorrect ? 'correct' : 'error');
        setTimeout(() => keys[keyIndex]?.classList.remove('active', 'correct', 'error'), 220);
      }
      state.activeKeyIndex = keyIndex;
    }
  }

  function handleManualKeyPress(midi, keyIndex) {
    audio.play(midi, 0.5, 0.85, true);
    highlightKey(keyIndex, false, true);

    // Reinforce connectome
    if (state.brain) {
      state.brain.onPelletEaten(false);
    }

    // Animate fly performer
    const fly = $('fly');
    if (fly) {
      fly.classList.add('performing');
      setTimeout(() => fly.classList.remove('performing'), 300);
    }
  }

  // Song playback and neural stepping
  function startPlayback() {
    audio.init();
    if (state.timer) clearTimeout(state.timer);
    state.playing = true;

    const playBtn = $('play-track');
    if (playBtn) playBtn.textContent = '⏸ PAUSE';

    const statusText = $('status-text');
    if (statusText) statusText.textContent = `${state.brainBackend} · AUTONOMOUS PRACTICE`;

    const tick = () => {
      if (!state.playing) return;

      const track = TRACKS[state.currentTrack];
      const notes = track.notes;

      // Handle song completion & mastery progression
      if (state.noteIndex >= notes.length) {
        state.trial++;
        if (state.brain) {
          state.brain.state.trialsCompleted = state.trial;
        }

        const currentAccuracy = state.brain?.state?.accuracy ?? state.stats.accuracy;
        const masteryReached = state.brain?.state?.masteryReached || (currentAccuracy >= 85.0 && state.trial >= 2);

        if (masteryReached) {
          // Mastery Achieved! Trigger reward celebration and advance to next track
          triggerStimulus('sugar');
          state.currentTrack = (state.currentTrack + 1) % TRACKS.length;
          renderTrackSelect();
          state.noteIndex = 0;
          if (statusText) statusText.textContent = `MASTERED! ADVANCING TO ${TRACKS[state.currentTrack].name.toUpperCase()}`;
        } else {
          // Loop current track to continue learning
          state.noteIndex = 0;
          if (statusText) statusText.textContent = `${state.brainBackend} · TRIAL ${state.trial} REINFORCING`;
        }

        if ($('trial-count')) $('trial-count').textContent = `TRIAL ${String(state.trial).padStart(3, '0')}`;

        // Brief breath between songs/trials
        state.timer = setTimeout(tick, 450);
        return;
      }

      const targetPair = notes[state.noteIndex];
      const targetMidi = fitToKeyboard(targetPair[0]);
      const targetKeyIndex = targetMidi - 48;

      highlightKey(targetKeyIndex, true);

      // Sensory signal injection
      const sensory = {
        sugarBearing: 0,
        sugarDist: 1,
        ghostBearing: 0,
        ghostDist: null,
        headingIndex: state.noteIndex % 4,
        foodOdor: 1,
        dangerOdor: 0,
        temperature: 0.5
      };

      if (state.brain) {
        state.brain.update(0.1, sensory);
      }

      // Reinforcement learning action selection via connectome / Q-policy
      const memory = state.qTable[state.currentTrack][state.noteIndex];
      let chosenKeyIndex = targetKeyIndex;
      let isExploration = false;

      if (state.brain && typeof state.brain.selectAction === 'function') {
        const actionResult = state.brain.selectAction(targetKeyIndex, 24, memory);
        chosenKeyIndex = actionResult.key;
        isExploration = actionResult.isExploration;
      } else {
        const explore = state.autonomous && Math.random() < state.epsilon;
        if (explore) {
          chosenKeyIndex = Math.floor(Math.random() * 24);
          isExploration = true;
        }
      }

      const chosenMidi = 48 + chosenKeyIndex;
      const isCorrect = chosenKeyIndex === targetKeyIndex;

      // Q-learning synaptic update
      const currentQ = memory.get(chosenKeyIndex) || 0;
      memory.set(chosenKeyIndex, currentQ + (isCorrect ? 0.85 : -0.4));
      if (!isCorrect && Math.random() < 0.65) {
        memory.set(targetKeyIndex, (memory.get(targetKeyIndex) || 0) + 0.65);
      }

      // Update biological plasticity & stats
      if (state.brain) {
        if (typeof state.brain.recordPerformance === 'function') {
          state.brain.recordPerformance(isCorrect, targetKeyIndex, chosenKeyIndex);
        } else {
          isCorrect ? state.brain.onPelletEaten(false) : state.brain.onHazardEaten();
        }
      }

      state.stats.totalNotes++;
      if (isCorrect) state.stats.correctNotes++;
      state.stats.accuracy = Number(((state.stats.correctNotes / Math.max(1, state.stats.totalNotes)) * 100).toFixed(1));
      state.stats.deltaW = (state.trial * 0.008 + state.stats.correctNotes * 0.0002).toFixed(3);

      // Audio & Key UI
      const duration = Math.max(0.14, 0.22 * targetPair[1]);
      audio.play(chosenMidi, duration, 0.85, isCorrect);
      highlightKey(chosenKeyIndex, false, isCorrect);

      // Animate fly performer strike
      const fly = $('fly');
      if (fly) {
        fly.classList.add('performing');
        setTimeout(() => {
          if (fly && state.playing) fly.classList.remove('performing');
        }, 180);
      }

      // Update badge readouts
      const explorationPct = state.brain?.state?.explorationRate !== undefined
        ? (state.brain.state.explorationRate * 100).toFixed(0)
        : (state.epsilon * 100).toFixed(0);

      if ($('trial-count')) $('trial-count').textContent = `TRIAL ${String(state.trial).padStart(3, '0')}`;
      if ($('learning-badge')) $('learning-badge').textContent = `EXPLORATION ${explorationPct}%`;
      if ($('song-progress-pct')) $('song-progress-pct').textContent = `${Math.round(((state.noteIndex + 1) / notes.length) * 100)}%`;

      state.noteIndex++;
      const speedMs = Math.max(65, (targetPair[1] * BASE_BEAT_MS) / audio.tempoScale);
      state.timer = setTimeout(tick, speedMs);
    };

    tick();
    brainReady.finally(() => { if (audio.playing) $('status-text').textContent = `${brainBackend} · connected`; });
  }

  function stopPlayback() {
    if (state.timer) clearTimeout(state.timer);
    state.playing = false;
    const playBtn = $('play-track');
    if (playBtn) playBtn.textContent = '▶ PLAY';

    const fly = $('fly');
    if (fly) fly.classList.remove('performing');

    const statusText = $('status-text');
    if (statusText) statusText.textContent = 'STANDBY · AWAITING STIMULUS';
  }

  function renderTrackSelect() {
    const current = TRACKS[state.currentTrack];
    if ($('track-name')) $('track-name').innerHTML = `${current.name} <em>— ${current.artist}</em>`;
    if ($('track-desc')) $('track-desc').textContent = current.desc;
    if ($('track-difficulty')) $('track-difficulty').textContent = current.difficulty;

    const picker = $('song-picker');
    if (picker) {
      picker.innerHTML = TRACKS.map((item, idx) => `
        <option value="${idx}" ${idx === state.currentTrack ? 'selected' : ''}>
          ${item.name} (${item.difficulty}) — ${item.artist}
        </option>
      `).join('');
    }
  }

  // Micro-stimulus triggers with sound and visual feedback
  function triggerStimulus(type) {
    audio.init();
    audio.playStimulusSfx(type);

    const fly = $('fly');

    if (type === 'sugar') {
      if (state.brain) {
        typeof state.brain.injectSugarPuff === 'function'
          ? state.brain.injectSugarPuff(1.0)
          : state.brain.onPelletEaten(true);
      }
      if (fly) {
        fly.classList.add('happy');
        setTimeout(() => fly.classList.remove('happy'), 650);
      }
    } else if (type === 'bitter') {
      if (state.brain) {
        typeof state.brain.injectBitterShock === 'function'
          ? state.brain.injectBitterShock(1.0)
          : state.brain.onHazardEaten();
      }
      if (fly) {
        fly.classList.add('disgusted');
        setTimeout(() => fly.classList.remove('disgusted'), 700);
      }
    } else if (type === 'threat') {
      if (state.brain) {
        typeof state.brain.injectLoomingShadow === 'function'
          ? state.brain.injectLoomingShadow(1.0, 0)
          : state.brain.onCaught();
      }
      if (fly) {
        fly.classList.add('panic');
        setTimeout(() => fly.classList.remove('panic'), 900);
      }
    } else if (type === 'optogenetics') {
      if (state.brain) {
        if (typeof state.brain.applyCustomStimulus === 'function') {
          state.brain.applyCustomStimulus('KC', 1.8);
          state.brain.applyCustomStimulus('MB_KC', 1.8);
        } else if (state.brain.connectome) {
          state.brain.connectome.injectPopulation('KC', 1.8);
        }
      }
      if (visualizer) visualizer.toggleParticles();
    }
  }

  // Setup DOM Event Listeners
  function setupEvents() {
    // Play/Pause button
    $('play-track')?.addEventListener('click', () => {
      state.playing ? stopPlayback() : startPlayback();
    });

    // Song picker change
    $('song-picker')?.addEventListener('change', e => {
      const wasPlaying = state.playing;
      stopPlayback();
      state.currentTrack = Number(e.target.value);
      state.noteIndex = 0;
      renderTrackSelect();
      if (wasPlaying) startPlayback();
    });

    // Autonomous Mode toggle
    $('autonomous-toggle')?.addEventListener('change', e => {
      state.autonomous = e.target.checked;
      const label = $('autonomous-label');
      if (label) label.textContent = state.autonomous ? 'AUTONOMOUS (RL)' : 'MANUAL';
      if (state.autonomous && !state.playing) {
        startPlayback();
      }
    });

    // Stimulus Injection Buttons
    $('stim-sugar')?.addEventListener('click', () => triggerStimulus('sugar'));
    $('stim-bitter')?.addEventListener('click', () => triggerStimulus('bitter'));
    $('stim-threat')?.addEventListener('click', () => triggerStimulus('threat'));
    $('stim-optogenetics')?.addEventListener('click', () => triggerStimulus('optogenetics'));

    // Instrument Synthesizer Picker
    document.querySelectorAll('.inst-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.inst-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        audio.setInstrument(btn.dataset.instrument);
      });
    });

    // Tempo Slider
    $('tempo-slider')?.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      audio.setTempoScale(val);
      if ($('tempo-val')) $('tempo-val').textContent = `${val.toFixed(1)}x`;
    });

    // Volume Slider
    $('volume-slider')?.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      audio.setVolume(val);
      if ($('volume-val')) $('volume-val').textContent = `${Math.round(val * 100)}%`;
    });

    // Reverb Slider
    $('reverb-slider')?.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      audio.setReverb(val);
      if ($('reverb-val')) $('reverb-val').textContent = `${Math.round(val * 100)}%`;
    });

    // Connectome View Controls
    $('view-2d-btn')?.addEventListener('click', () => {
      $('view-2d-btn').classList.add('active');
      $('view-3d-btn').classList.remove('active');
      visualizer?.setViewMode('2d');
    });

    $('view-3d-btn')?.addEventListener('click', () => {
      $('view-3d-btn').classList.add('active');
      $('view-2d-btn').classList.remove('active');
      visualizer?.setViewMode('3d');
    });

    $('reset-view-btn')?.addEventListener('click', () => {
      visualizer?.resetView();
    });

    $('toggle-particles-btn')?.addEventListener('click', function() {
      const on = visualizer?.toggleParticles();
      this.classList.toggle('active', on);
    });

    // Neuropil Filter Pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        visualizer?.setFilter(pill.dataset.filter);
      });
    });

    // Keyboard support
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        state.playing ? stopPlayback() : startPlayback();
      } else if (KEY_MAP[key]) {
        const midi = KEY_MAP[key];
        const keyIdx = midi - 48;
        handleManualKeyPress(midi, keyIdx);
      }
    });

    // Simulation Clock
    setInterval(() => {
      const now = new Date();
      if ($('clock')) {
        $('clock').textContent = now.toTimeString().split(' ')[0];
      }
    }, 1000);
  }

  // Update fly visual state classes according to biological behavioral state
  function updateFlyBehaviorVisuals() {
    const fly = $('fly');
    if (!fly || fly.classList.contains('performing') || fly.classList.contains('happy') || fly.classList.contains('panic') || fly.classList.contains('disgusted')) {
      return;
    }

    const bState = state.brain?.state?.behaviorState || 'ALERT';
    const stateClass = bState.toLowerCase();

    const knownStates = ['grooming', 'alert', 'resting', 'foraging', 'exploring', 'focused', 'escape'];
    knownStates.forEach(cls => {
      if (cls !== stateClass) fly.classList.remove(cls);
    });

    if (!fly.classList.contains(stateClass)) {
      fly.classList.add(stateClass);
    }
  }

  // Master Render & Simulation Loop (60 FPS)
  function mainLoop() {
    // 1. Update Brain & Visualizer
    if (visualizer) {
      visualizer.updateFromBrain();
      visualizer.render();
    }

    // 2. Update Telemetry Dashboard
    if (dashboard && state.brain) {
      dashboard.sample(state.brain, {
        dopamine: state.brain?.state?.dopamineTransient || 0.35,
        punishment: state.brain?.state?.panicLevel || 0.1,
        trial: state.trial
      }, state.stats);

      dashboard.renderRaster($('raster-canvas'));
      dashboard.renderNeurochem($('neurochem-canvas'));
      dashboard.renderPhaseSpace($('phasespace-canvas'));
    }

    // 3. Update Fly Biological Idling Visuals
    updateFlyBehaviorVisuals();

    requestAnimationFrame(mainLoop);
  }

  // Initialize Application
  async function init() {
    setupPianoKeys();
    renderTrackSelect();

    const connectomeCanvas = $('connectome-canvas');
    const tooltipEl = $('connectome-tooltip');
    if (connectomeCanvas) {
      visualizer = new ConnectomeVisualizer(connectomeCanvas, tooltipEl);
    }

    dashboard = new TelemetryDashboard({
      kpiFiringRate: $('kpi-firing-rate'),
      kpiDopamine: $('kpi-dopamine'),
      kpiHeading: $('kpi-heading'),
      kpiAccuracy: $('kpi-accuracy'),
      kpiPlasticity: $('kpi-plasticity'),
      kpiCalcium: $('kpi-calcium'),
      stateBadge: $('behavior-state-badge')
    });

    setupEvents();
    await initBrain();
    mainLoop();

    // Auto-start continuous practice after a short initialization delay
    setTimeout(() => {
      if (state.autonomous && !state.playing) {
        startPlayback();
      }
    }, 600);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
