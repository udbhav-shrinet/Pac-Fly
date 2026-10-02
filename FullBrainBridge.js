/**
 * FlyWire-derived whole-brain bridge.
 *
 * Provides a high-performance Web Worker bridge to the full Drosophila
 * connectome (139k neurons, millions of synapses) while exposing the identical
 * rich biological telemetry, environmental stimulus API, behavioral state machine,
 * and reinforcement learning interface as FlyNeuralEngine.
 */
class FullBrainBridge {
  constructor(meta) {
    this.meta = meta;
    this.worker = new Worker('FullBrainWorker.js');
    this.groupIds = new Map(meta.groups.map(group => [group.name, group.id]));
    this.latest = { firedNeurons: 0, groupSpikeCounts: new Uint16Array(meta.group_count), tickCount: 0 };
    this.activity = new Float32Array(meta.group_count);
    this.headingAngle = 0;
    this.hungerLevel = 0.2;
    this.threatLevel = 0;
    this.dopamineLevel = 0.3;
    this.punishmentLevel = 0;
    this.expectedReward = 0.3;
    this.rewardPredictionError = 0;
    this.lastMotor = { left: 0, right: 0, forward: 0, reverse: 0, rest: true };
    this.ready = false;
    this._accum = 0;

    // Performance tracking history
    this._historyWindow = [];
    this._maxHistory = 24;
    this.accuracy = 75.0;
    this.streak = 0;
    this.bestStreak = 0;
    this.noteErrorRate = 0.25;
    this.cumulativeFitness = 100.0;
    this.masteryReached = false;
    this.trialsCompleted = 0;
    this._stunnedUntil = 0;
    this._idleStateTimer = 0;
    this._currentIdleState = 'GROOMING';

    this.environmentalSensory = {
      temperature: 0.5,
      sugarDist: null,
      sugarBearing: 0,
      ghostDist: null,
      ghostBearing: 0,
      foodOdor: 0,
      dangerOdor: 0,
      vibration: 0,
      contact: 0,
      headingIndex: 0,
    };

    this._workerPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    this.worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'ready') {
        this.ready = true;
        this.worker.postMessage({ type: 'start' });
        this._resolveReady(this);
      } else if (message.type === 'tick') {
        this.latest = message;
        for (let i = 0; i < this.activity.length; i++) {
          this.activity[i] = this.activity[i] * 0.72 + (message.groupSpikeCounts[i] || 0);
        }
      } else if (message.type === 'stats') {
        this.latestStats = message;
      } else if (message.type === 'error') {
        this._rejectReady(new Error(message.message));
      }
    };

    this.worker.onerror = error => {
      this._rejectReady(new Error(error.message || 'FlyWire Worker crashed'));
    };
  }

  static async create() {
    const meta = await fetch('data/neuron_meta.json').then(response => {
      if (!response.ok) throw new Error(`FlyWire metadata failed (${response.status})`);
      return response.json();
    });
    const brain = new FullBrainBridge(meta);
    const binary = await fetch('data/connectome.bin.gz').then(response => {
      if (!response.ok) throw new Error(`FlyWire binary failed (${response.status})`);
      return response.arrayBuffer();
    });
    brain.worker.postMessage({ type: 'init', buffer: binary }, [binary]);
    return brain._workerPromise;
  }

  _id(name) { return this.groupIds.get(name); }
  get neuronCount() { return this.meta.neuron_count; }
  get edgeCount() { return this.meta.edge_count; }
  get activeNeuronCount() { return this.latestStats?.activeNeurons || 0; }

  _activity(name) {
    const id = this._id(name);
    return id === undefined ? 0 : this.activity[id];
  }

  _stimulate(groups, intensities) {
    const ids = [], values = [];
    groups.forEach((name, index) => {
      const id = this._id(name);
      if (id !== undefined && intensities[index] > 0) {
        ids.push(id);
        values.push(intensities[index]);
      }
    });
    if (ids.length) this.worker.postMessage({ type: 'stimulateGroups', groups: ids, intensities: values });
  }

  update(dt, sense = {}) {
    if (!this.ready) return null;
    this.latestSenses = { ...this.environmentalSensory, ...sense };
    this.headingAngle = (this.latestSenses.headingIndex || 0) * Math.PI / 2;
    this._accum += dt;

    if (this._accum >= 0.1) {
      this._accum -= 0.1;
      const sugar = this.latestSenses.foodOdor ?? (this.latestSenses.sugarDist == null ? 0 : Math.max(0, 1 - this.latestSenses.sugarDist / 12));
      const threat = this.latestSenses.dangerOdor ?? (this.latestSenses.ghostDist == null ? 0 : Math.max(0, 1 - this.latestSenses.ghostDist / 9));
      const visualThreat = (this.latestSenses.threatVisible ?? 0) * threat;
      const rayThreat = this.latestSenses.raycastLooming ?? 0;
      const vibration = this.latestSenses.vibration ?? 0;
      const contact = this.latestSenses.contact ?? 0;
      const temp = this.latestSenses.temperature !== undefined ? this.latestSenses.temperature : 0.5;

      this._stimulate(
        ['OLF_ORN_FOOD', 'OLF_ORN_DANGER', 'VIS_LC', 'MECH_CHORD', 'MECH_BRISTLE', 'ANTENNAL_MECH', 'DRIVE_HUNGER'],
        [sugar * 1.5, threat * 1.8, Math.max(visualThreat, rayThreat) * 1.4, vibration * 0.8, contact * 1.8, (this.latestSenses.proprioception?.turning ? 0.4 : 0.12), 0.18]
      );
      this._stimulate(['THERMO_WARM', 'THERMO_COOL', 'NOCI'], [
        Math.max(0, temp - 0.5) * 0.8,
        Math.max(0, 0.5 - temp) * 0.8,
        Math.max(contact, this.latestSenses.hazardProximity ?? 0) * 0.7,
      ]);
      // Tonic central-complex activity
      this._stimulate(['CX_FC', 'CX_EPG'], [0.22, 0.12]);
    }

    const walk = this._activity('GNG_DESC') + this._activity('VNC_CPG') + this._activity('MN_HEAD');
    const turn = this._activity('CX_EPG') + this._activity('CX_PFN');
    const flee = this._activity('DN_STARTLE') + this._activity('MECH_JO') + this._activity('OLF_ORN_DANGER');
    const reverse = this._activity('GUS_GRN_BITTER');

    const threatBearing = this.latestSenses?.ghostBearing || 0;
    const currentThreat = this.latestSenses?.ghostDist == null ? 0 : Math.max(0, 1 - this.latestSenses.ghostDist / 9);
    const threat = currentThreat > 0.08 ? Math.max(this.threatLevel, flee / 8) : 0;
    const left = turn * 0.08 + Math.max(0, threatBearing) * threat * 1.8;
    const right = turn * 0.08 + Math.max(0, -threatBearing) * threat * 1.8;
    const forward = walk + turn * 0.55;
    const reverseDrive = reverse + threat * 2.4;
    const motor = { left, right, forward, reverse: reverseDrive, rest: forward < 0.2 && reverseDrive < 0.22 && threat < 0.16 };
    this.lastMotor = motor;
    return motor;
  }

  get state() {
    const hungerRaw = Math.min(1, this._activity('DRIVE_HUNGER') / 8);
    const fearRaw = Math.min(1, (this._activity('DRIVE_FEAR')
      + this._activity('DN_STARTLE')
      + this._activity('MECH_JO')
      + this._activity('OLF_ORN_DANGER')) / 8);
    const currentThreat = this.latestSenses?.ghostDist == null ? 0 : Math.max(0, 1 - this.latestSenses.ghostDist / 9);
    const gatedFear = currentThreat > 0.08 ? fearRaw : 0;
    this.hungerLevel += (hungerRaw - this.hungerLevel) * 0.08;
    this.threatLevel += (gatedFear - this.threatLevel) * (gatedFear > 0 ? 0.16 : 0.32);

    const hunger = this.hungerLevel;
    const fear = this.threatLevel;
    const dopamine = Math.min(1, this._activity('MB_DAN_REW') / 5);
    const ppl1 = Math.min(1, this._activity('MB_DAN_PUN') / 5);
    const arousal = Math.min(1, this.activity.reduce((sum, value) => sum + value, 0) / 1600);
    const octopamine = Math.min(1, fear * 0.7 + arousal * 0.3);

    const baseEpsilon = Math.max(0.02, 0.45 * Math.exp(-this.trialsCompleted * 0.08));
    const explorationRate = Math.min(1, baseEpsilon + hunger * 0.15 + octopamine * 0.12);

    const panicIndex = Math.min(1, fear * 0.8 + (fear > 0.35 ? 0.2 : 0));
    const escapeDrive = Math.min(1, fear * 0.9);
    const vigilanceLevel = Math.min(1, octopamine * 0.6 + arousal * 0.4);

    const drives = {
      foraging: Math.min(1, (hunger + this._activity('OLF_ORN_FOOD') + this._activity('MB_MBON_APP')) / 12),
      escape: Math.min(1, fear / 12),
      explore: Math.min(1, (this._activity('CX_FC') + this._activity('CX_PFN')) / 12),
      rest: Math.min(1, this._activity('DRIVE_FATIGUE') / 8),
    };

    const now = performance.now();
    const isStunned = now < this._stunnedUntil;

    // Behavioral state calculation
    let behaviorState = 'GROOMING';
    if (fear > 0.28 || panicIndex > 0.4) behaviorState = 'ESCAPE';
    else if (ppl1 > 0.35 || isStunned) behaviorState = 'DISGUST';
    else if (dopamine > 0.3 && this.accuracy > 70) behaviorState = 'FOCUSED';
    else if (hunger > 0.42) behaviorState = 'FORAGING';
    else if (explorationRate > 0.35 && arousal > 0.25) behaviorState = 'EXPLORING';
    else {
      if (now > this._idleStateTimer) {
        this._idleStateTimer = now + 3000 + Math.random() * 4000;
        const rand = Math.random();
        if (rand < 0.4) this._currentIdleState = 'GROOMING';
        else if (rand < 0.75) this._currentIdleState = 'ALERT';
        else this._currentIdleState = 'RESTING';
      }
      behaviorState = this._currentIdleState;
    }

    const stateTransitionProbabilities = {
      ESCAPE: Number(Math.min(1, panicIndex * 1.5).toFixed(3)),
      DISGUST: Number(Math.min(1, ppl1 * 1.8).toFixed(3)),
      FOCUSED: Number(Math.min(1, dopamine * 1.2).toFixed(3)),
      FORAGING: Number(Math.min(1, hunger * 1.3).toFixed(3)),
      EXPLORING: Number(Math.min(1, explorationRate * 1.1).toFixed(3)),
      ALERT: Number(Math.min(1, vigilanceLevel * 0.9).toFixed(3)),
      GROOMING: Number(Math.min(1, (1 - arousal) * 0.7).toFixed(3)),
      RESTING: Number(Math.min(1, (1 - hunger) * (1 - arousal) * 0.8).toFixed(3)),
    };

    return {
      headingAngle: this.headingAngle,
      npfLevel: hunger,
      dopamineTransient: dopamine,
      rewardPredictionError: this.rewardPredictionError,
      panicLevel: fear,
      panicIndex,
      escapeDrive,
      octopamineLevel: octopamine,
      arousalLevel: arousal,
      vigilanceLevel,
      ppl1Transient: ppl1,
      explorationRate,
      policyEntropy: 1.45,
      accuracy: this.accuracy,
      streak: this.streak,
      bestStreak: this.bestStreak,
      noteErrorRate: this.noteErrorRate,
      cumulativeFitness: this.cumulativeFitness,
      masteryReached: this.masteryReached,
      trialsCompleted: this.trialsCompleted,
      giantFiberFiring: fear > 0.45,
      stunned: isStunned,
      disgusted: ppl1 > 0.35,
      exhausted: false,
      behaviorState,
      stateTransitionProbabilities,
      motorAction: this.lastMotor,
      senses: this.latestSenses || {},
      drives,
    };
  }

  _reward(value) { this.worker.postMessage({ type: 'reward', value }); }

  // -------------------------------------------------------------------
  // Environmental Stimuli Injection API
  // -------------------------------------------------------------------

  injectSugarPuff(intensity = 1.0) {
    const gain = Math.max(0, Math.min(1, intensity));
    this._reward(gain * 0.9);
    this._stimulate(['GUS_GRN_SWEET', 'MB_DAN_REW', 'OLF_ORN_FOOD'], [gain * 1.5, gain * 1.8, gain * 1.2]);
    this.hungerLevel = Math.max(0, this.hungerLevel - gain * 0.3);
  }

  injectBitterShock(intensity = 1.0) {
    const gain = Math.max(0, Math.min(1, intensity));
    this._reward(-gain * 0.85);
    this._stimulate(['GUS_GRN_BITTER', 'MB_DAN_PUN', 'NOCI'], [gain * 1.8, gain * 2.0, gain * 1.2]);
    this._stunnedUntil = performance.now() + 800 * gain;
  }

  injectLoomingShadow(intensity = 1.0, bearing = 0) {
    const gain = Math.max(0, Math.min(1, intensity));
    this._stimulate(['VIS_LC', 'DN_STARTLE', 'DRIVE_FEAR', 'MECH_JO'], [gain * 1.8, gain * 2.5, gain * 2.0, gain * 1.5]);
    this.threatLevel = 1.0;
  }

  injectFoodOdor(intensity = 1.0, bearing = 0) {
    const gain = Math.max(0, Math.min(1, intensity));
    this.environmentalSensory.foodOdor = gain;
    this.environmentalSensory.sugarBearing = bearing;
    this._stimulate(['OLF_ORN_FOOD', 'GUS_GRN_SWEET'], [gain * 1.4, gain * 0.8]);
  }

  injectDangerOdor(intensity = 1.0) {
    const gain = Math.max(0, Math.min(1, intensity));
    this.environmentalSensory.dangerOdor = gain;
    this._stimulate(['OLF_ORN_DANGER', 'DRIVE_FEAR'], [gain * 1.5, gain * 1.2]);
  }

  setTemperature(temp = 0.5) {
    this.environmentalSensory.temperature = Math.max(0, Math.min(1, temp));
  }

  applyCustomStimulus(groupName, intensity = 1.0) {
    this._stimulate([groupName], [intensity]);
  }

  // -------------------------------------------------------------------
  // Learning & Performance Telemetry
  // -------------------------------------------------------------------

  recordPerformance(correct, targetKey, chosenKey) {
    this._historyWindow.push(correct ? 1 : 0);
    if (this._historyWindow.length > this._maxHistory) this._historyWindow.shift();

    const sum = this._historyWindow.reduce((a, b) => a + b, 0);
    this.accuracy = Number(((sum / this._historyWindow.length) * 100).toFixed(1));
    this.noteErrorRate = Number((1 - sum / this._historyWindow.length).toFixed(3));

    if (correct) {
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      const rpe = 1.0 - this.expectedReward;
      this.rewardPredictionError = Number(rpe.toFixed(3));
      this.expectedReward += rpe * 0.15;
      this.cumulativeFitness += 10 + this.streak * 2;
      this.onPelletEaten(false);
    } else {
      this.streak = 0;
      const rpe = -0.5 - this.expectedReward;
      this.rewardPredictionError = Number(rpe.toFixed(3));
      this.expectedReward += rpe * 0.15;
      this.cumulativeFitness = Math.max(0, this.cumulativeFitness - 5);
      this.onHazardEaten();
    }

    this.masteryReached = this.accuracy >= 85.0 && this._historyWindow.length >= 12;
  }

  selectAction(targetKey, totalKeys = 24, qMap = new Map()) {
    const exploreRate = this.state.explorationRate;
    const explore = Math.random() < exploreRate;
    if (explore) {
      const offset = (Math.random() < 0.6) ? (Math.random() < 0.5 ? -1 : 1) : Math.floor(Math.random() * 7) - 3;
      const exploratoryKey = Math.max(0, Math.min(totalKeys - 1, targetKey + offset));
      return { key: exploratoryKey, isExploration: true };
    }

    let bestKey = targetKey;
    let maxQ = -Infinity;
    qMap.forEach((qVal, key) => {
      if (qVal > maxQ) {
        maxQ = qVal;
        bestKey = key;
      }
    });
    return { key: bestKey, isExploration: false };
  }

  getTelemetry() {
    return {
      ...this.state,
      activeNeurons: this.activeNeuronCount,
      totalNeurons: this.neuronCount,
      edgeCount: this.edgeCount,
    };
  }

  onPelletEaten(isEnergizer) {
    this._reward(isEnergizer ? 1 : 0.35);
    this._stimulate(['GUS_GRN_SWEET', 'MB_DAN_REW'], [isEnergizer ? 1.4 : 0.35, isEnergizer ? 1.2 : 0.25]);
  }

  onHazardEaten() {
    this._reward(-0.8);
    this._stimulate(['GUS_GRN_BITTER', 'MB_DAN_PUN'], [1.4, 1]);
  }

  onGhostCaught() {
    this._reward(1);
    this._stimulate(['MB_DAN_REW', 'MB_MBON_APP'], [2.4, 1.5]);
  }

  onCaught() {
    this._reward(-1);
    this._stimulate(['MECH_BRISTLE', 'DRIVE_FEAR', 'DN_STARTLE'], [1, 1, 1]);
  }

  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}
