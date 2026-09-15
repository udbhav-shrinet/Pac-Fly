/**
 * FlyWire-derived whole-brain bridge.
 *
 * The large graph stays off the UI thread. This adapter deliberately exposes
 * the same motor contract as the compact model so the arena can switch brain
 * backends without knowing how the graph is represented.
 */
class FullBrainBridge {
  constructor(meta) {
    this.meta = meta;
    this.worker = new Worker('FullBrainWorker.js');
    this.groupIds = new Map(meta.groups.map(group => [group.name, group.id]));
    this.latest = { firedNeurons: 0, groupSpikeCounts: new Uint16Array(meta.group_count), tickCount: 0 };
    this.activity = new Float32Array(meta.group_count);
    this.headingAngle = 0;
    this.ready = false;
    this._accum = 0;
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

  update(dt, sense) {
    if (!this.ready) return null;
    this.latestSenses = sense;
    this.headingAngle = sense.headingIndex * Math.PI / 2;
    this._accum += dt;
    if (this._accum >= 0.1) {
      this._accum -= 0.1;
      const sugar = sense.foodOdor ?? (sense.sugarDist == null ? 0 : Math.max(0, 1 - sense.sugarDist / 12));
      const threat = sense.dangerOdor ?? (sense.ghostDist == null ? 0 : Math.max(0, 1 - sense.ghostDist / 9));
      const visualThreat = (sense.threatVisible ?? 0) * threat;
      const vibration = sense.vibration ?? 0;
      const contact = sense.contact ?? 0;
      this._stimulate(
        ['OLF_ORN_FOOD', 'OLF_ORN_DANGER', 'VIS_LC', 'MECH_CHORD', 'MECH_BRISTLE', 'ANTENNAL_MECH', 'DRIVE_HUNGER'],
        [sugar * 1.5, threat * 1.8, visualThreat * 1.4, vibration * 0.8, contact * 1.8, (sense.proprioception?.turning ? 0.4 : 0.12), 0.18]
      );
      this._stimulate(['THERMO_WARM', 'THERMO_COOL', 'NOCI'], [
        Math.max(0, sense.temperature - 0.5) * 0.8,
        Math.max(0, 0.5 - sense.temperature) * 0.8,
        Math.max(contact, sense.hazardProximity ?? 0) * 0.7,
      ]);
      // Tonic central-complex activity prevents a structurally sparse
      // subgraph from falling permanently silent between sensory events.
      this._stimulate(['CX_FC', 'CX_EPG'], [0.22, 0.12]);
    }
    // FAFB v783 is brain-only, so many VNC leg groups are empty. Use the
    // populated descending/neck motor proxies exposed by the metadata rather
    // than silently returning zero for absent VNC populations.
    const walk = this._activity('GNG_DESC')
      + this._activity('VNC_CPG')
      + this._activity('MN_HEAD');
    const turn = this._activity('CX_EPG') + this._activity('CX_PFN');
    const flee = this._activity('DN_STARTLE')
      + this._activity('MECH_JO')
      + this._activity('OLF_ORN_DANGER');
    const reverse = this._activity('GUS_GRN_BITTER');
    // The aggregated FlyWire artifact does not expose left/right motor
    // labels. Equal turn scores previously made the arena repeatedly choose
    // a turn at every junction. Preserve exploratory turn energy, but give
    // symmetric activity a forward-biased motor output so the fly traverses
    // the map instead of spinning in place.
    const forward = walk + turn * 0.8;
    return { left: turn * 0.12, right: turn * 0.12, forward, reverse: reverse + flee, rest: forward < 0.08 && flee === 0 };
  }

  get state() {
    const hunger = this._activity('DRIVE_HUNGER');
    const fear = this._activity('DRIVE_FEAR')
      + this._activity('DN_STARTLE')
      + this._activity('MECH_JO')
      + this._activity('OLF_ORN_DANGER');
    const dopamine = this._activity('MB_DAN_REW');
    const arousal = Math.min(1, this.activity.reduce((sum, value) => sum + value, 0) / 1600);
    const drives = {
      foraging: Math.min(1, (hunger + this._activity('OLF_ORN_FOOD') + this._activity('MB_MBON_APP')) / 12),
      escape: Math.min(1, fear / 12),
      explore: Math.min(1, (this._activity('CX_FC') + this._activity('CX_PFN')) / 12),
      rest: Math.min(1, this._activity('DRIVE_FATIGUE') / 8),
    };
    return {
      headingAngle: this.headingAngle, npfLevel: Math.min(1, hunger / 10),
      dopamineTransient: Math.min(1, dopamine / 5), panicLevel: Math.min(1, fear / 8),
      octopamineLevel: Math.min(1, fear / 10), arousalLevel: arousal,
      ppl1Transient: Math.min(1, this._activity('MB_DAN_PUN') / 5),
      giantFiberFiring: fear > 0, stunned: false, disgusted: false, exhausted: false,
      behaviorState: fear > 0 ? 'ESCAPE' : hunger > 0 ? 'FORAGING' : 'ALERT',
      senses: this.latestSenses || {},
      drives,
    };
  }

  onPelletEaten(isEnergizer) {
    this._stimulate(['GUS_GRN_SWEET', 'MB_DAN_REW'], [isEnergizer ? 1.4 : 0.35, isEnergizer ? 1.2 : 0.25]);
  }

  onHazardEaten() { this._stimulate(['GUS_GRN_BITTER', 'MB_DAN_PUN'], [1.4, 1]); }
  onGhostCaught() { this._stimulate(['MB_DAN_REW', 'MB_MBON_APP'], [2.4, 1.5]); }
  onCaught() { this._stimulate(['MECH_BRISTLE', 'DRIVE_FEAR', 'DN_STARTLE'], [1, 1, 1]); }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}
