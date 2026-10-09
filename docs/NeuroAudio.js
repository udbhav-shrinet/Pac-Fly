/**
 * NeuroAudio.js — Multi-Model Web Audio Synthesizer for Drosophila Neural Piano
 *
 * Implements 4 rich acoustic and electronic instrument sound models:
 * 1. Concert Grand Piano — Additive multi-harmonic acoustic model with felt damping & soundboard resonance
 * 2. Lofi Rhodes Electric — Dual-FM tine synthesis with chorus LFO and warm tube saturation
 * 3. 80s FM Neuro-Synth — Dynamic 2-operator FM synthesis with filter envelope & space delay
 * 4. Cozy Cafe Kalimba — Resonant wooden thumb piano with organic metallic ping & body resonance
 */

class NeuroAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.dryGain = null;
    this.wetGain = null;
    this.volume = 0.70;
    this.reverbLevel = 0.35;
    this.instrument = 'grand-piano'; // 'grand-piano' | 'rhodes' | 'neuro-synth' | 'kalimba'
    this.tempoScale = 1.0; // 0.5x to 4.0x
    this.activeVoices = new Set();
  }

  init() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();

    // Master gain
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;

    // Convolver Reverb setup (synthetic impulse response)
    this.reverbNode = this.context.createConvolver();
    this._createSyntheticImpulse(2.2, 2.0);

    this.dryGain = this.context.createGain();
    this.wetGain = this.context.createGain();
    this.dryGain.gain.value = 1.0 - (this.reverbLevel * 0.5);
    this.wetGain.gain.value = this.reverbLevel;

    this.dryGain.connect(this.masterGain);
    this.reverbNode.connect(this.wetGain);
    this.wetGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.context) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
    }
  }

  setReverb(level) {
    this.reverbLevel = Math.max(0, Math.min(1, level));
    if (this.dryGain && this.wetGain && this.context) {
      this.dryGain.gain.setTargetAtTime(1.0 - (this.reverbLevel * 0.4), this.context.currentTime, 0.05);
      this.wetGain.gain.setTargetAtTime(this.reverbLevel * 0.8, this.context.currentTime, 0.05);
    }
  }

  setInstrument(inst) {
    if (['grand-piano', 'rhodes', 'neuro-synth', 'kalimba'].includes(inst)) {
      this.instrument = inst;
    }
  }

  setTempoScale(scale) {
    this.tempoScale = Math.max(0.25, Math.min(4.0, scale));
  }

  midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  _createSyntheticImpulse(duration, decay) {
    if (!this.context) return;
    const sampleRate = this.context.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = this.context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * decay);
      left[i] = (Math.random() * 2 - 1) * envelope;
      right[i] = (Math.random() * 2 - 1) * envelope;
    }
    this.reverbNode.buffer = impulse;
  }

  /**
   * Play a note using the currently selected instrument model
   * @param {number} midi MIDI note number (e.g. 60 = Middle C)
   * @param {number} duration Note duration in seconds
   * @param {number} velocity Velocity 0.0 to 1.0
   * @param {boolean} isCorrect Feedback styling (dopamine/punish sparkle)
   */
  play(midi, duration = 0.5, velocity = 0.8, isCorrect = true) {
    this.init();
    if (!this.context) return;

    const ctx = this.context;
    const now = ctx.currentTime;
    const freq = this.midiToHz(midi);
    const dur = Math.max(0.12, duration);

    // Audio routing bus for this note
    const noteGain = ctx.createGain();
    noteGain.connect(this.dryGain);
    noteGain.connect(this.reverbNode);

    switch (this.instrument) {
      case 'grand-piano':
        this._playGrandPiano(freq, dur, velocity, now, noteGain);
        break;
      case 'rhodes':
        this._playRhodes(freq, dur, velocity, now, noteGain);
        break;
      case 'neuro-synth':
        this._playNeuroSynth(freq, dur, velocity, now, noteGain);
        break;
      case 'kalimba':
        this._playKalimba(freq, dur, velocity, now, noteGain);
        break;
      default:
        this._playGrandPiano(freq, dur, velocity, now, noteGain);
    }
  }

  /**
   * 1. Concert Grand Piano Model
   * Multi-harmonic additive synthesis with hammer transient, wood resonance, and felt decay
   */
  _playGrandPiano(freq, duration, velocity, now, outNode) {
    const ctx = this.context;
    const harmonics = [
      { ratio: 1.0, gain: 1.0, type: 'triangle' },
      { ratio: 2.0, gain: 0.45, type: 'sine' },
      { ratio: 3.0, gain: 0.22, type: 'sine' },
      { ratio: 4.0, gain: 0.08, type: 'sine' },
      { ratio: 5.0, gain: 0.03, type: 'sine' }
    ];

    const mix = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(12000, freq * 8 * (0.5 + velocity * 0.5)), now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, freq * 2), now + duration * 0.8);

    const env = ctx.createGain();
    const peakGain = 0.28 * velocity;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peakGain, now + 0.008); // Sharp hammer strike
    env.gain.exponentialRampToValueAtTime(peakGain * 0.6, now + 0.08); // Initial body drop
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.15); // Felt decay

    harmonics.forEach(h => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = h.type;
      osc.frequency.setValueAtTime(freq * h.ratio, now);
      // Slight detune for acoustic richness
      if (h.ratio === 1.0) osc.detune.setValueAtTime(1.5, now);
      if (h.ratio === 2.0) osc.detune.setValueAtTime(-1.8, now);

      oscGain.gain.value = h.gain;
      osc.connect(oscGain);
      oscGain.connect(mix);

      osc.start(now);
      osc.stop(now + duration + 0.2);
    });

    mix.connect(filter);
    filter.connect(env);
    env.connect(outNode);
  }

  /**
   * 2. Lofi Rhodes Electric Piano Model
   * Frequency modulation with chorus vibrato LFO and bell-like tines
   */
  _playRhodes(freq, duration, velocity, now, outNode) {
    const ctx = this.context;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const env = ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, now);

    // Tine modulator
    modulator.type = 'sine';
    modulator.frequency.setValueAtTime(freq * 3.0, now);

    const modIndex = 180 * velocity;
    modGain.gain.setValueAtTime(modIndex, now);
    modGain.gain.exponentialRampToValueAtTime(5, now + duration * 0.6);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    // Chorus LFO for warm vintage Rhodes wobble
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(3.8, now);
    lfoGain.gain.setValueAtTime(2.2, now);
    lfo.connect(lfoGain);
    lfoGain.connect(carrier.detune);

    const peak = 0.24 * velocity;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.015);
    env.gain.exponentialRampToValueAtTime(peak * 0.45, now + 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.25);

    carrier.connect(env);
    env.connect(outNode);

    carrier.start(now);
    modulator.start(now);
    lfo.start(now);

    carrier.stop(now + duration + 0.3);
    modulator.stop(now + duration + 0.3);
    lfo.stop(now + duration + 0.3);
  }

  /**
   * 3. 80s FM Neuro-Synth Model
   * Dynamic dual-operator FM with swept resonant lowpass filter
   */
  _playNeuroSynth(freq, duration, velocity, now, outNode) {
    const ctx = this.context;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(freq, now);

    modulator.type = 'triangle';
    modulator.frequency.setValueAtTime(freq * 2.005, now);

    const modVal = freq * 1.5 * velocity;
    modGain.gain.setValueAtTime(modVal, now);
    modGain.gain.exponentialRampToValueAtTime(modVal * 0.1, now + duration * 0.7);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    // Resonant Filter Sweep
    filter.type = 'lowpass';
    filter.Q.value = 4.5;
    filter.frequency.setValueAtTime(Math.min(14000, freq * 10 * velocity), now);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, now + duration);

    const peak = 0.22 * velocity;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.2);

    carrier.connect(filter);
    filter.connect(env);
    env.connect(outNode);

    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + duration + 0.25);
    modulator.stop(now + duration + 0.25);
  }

  /**
   * 4. Cozy Cafe Kalimba Model
   * Wooden thumb piano with fast transient ping & rich warm body resonance
   */
  _playKalimba(freq, duration, velocity, now, outNode) {
    const ctx = this.context;
    const fundamental = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const click = ctx.createOscillator();

    const fGain = ctx.createGain();
    const oGain = ctx.createGain();
    const clickGain = ctx.createGain();
    const env = ctx.createGain();

    // Pure warm sine for the wood bar
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(freq, now);

    // Metallic ping harmonic
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 5.4, now);

    // Thumb plucking click
    click.type = 'triangle';
    click.frequency.setValueAtTime(freq * 11.2, now);

    fGain.gain.value = 1.0;
    oGain.gain.value = 0.35;
    clickGain.gain.setValueAtTime(0.4 * velocity, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

    fundamental.connect(fGain);
    overtone.connect(oGain);
    click.connect(clickGain);

    fGain.connect(env);
    oGain.connect(env);
    clickGain.connect(env);

    const peak = 0.32 * velocity;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.005);
    env.gain.exponentialRampToValueAtTime(peak * 0.3, now + 0.09);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.3);

    env.connect(outNode);

    fundamental.start(now);
    overtone.start(now);
    click.start(now);

    fundamental.stop(now + duration + 0.35);
    overtone.stop(now + duration + 0.35);
    click.stop(now + 0.04);
  }

  /**
   * Trigger a micro-stimulus sound effect (Sugar chime, Bitter buzz, Looming whoosh)
   */
  playStimulusSfx(type) {
    this.init();
    if (!this.context) return;
    const ctx = this.context;
    const now = ctx.currentTime;

    if (type === 'sugar') {
      // Sparkling rising triad
      [72, 76, 79, 84].forEach((note, idx) => {
        setTimeout(() => this.play(note, 0.4, 0.6, true), idx * 45);
      });
    } else if (type === 'bitter') {
      // Dissonant buzz
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.3);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.32);
    } else if (type === 'threat') {
      // Sub-bass thump + ominous sweep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.45);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (type === 'optogenetics') {
      // High-tech laser sweep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.22);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  }
}

window.NeuroAudio = NeuroAudio;
