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
      } else if (message.type === 'error') {
        this._rejectReady(new Error(message.message));
      }
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
    this._accum += dt;
    if (this._accum >= 0.1) {
      this._accum -= 0.1;
      const sugar = sense.sugarDist == null ? 0 : Math.max(0, 1 - sense.sugarDist / 12);
      const threat = sense.ghostDist == null ? 0 : Math.max(0, 1 - sense.ghostDist / 9);
      this._stimulate(
        ['OLF_ORN_FOOD', 'OLF_ORN_DANGER', 'VIS_LC', 'MECH_CHORD', 'DRIVE_HUNGER'],
        [sugar * 0.5, threat * 0.8, threat, 0.12, 0.08]
      );
    }
    const counts = this.latest.groupSpikeCounts || [];
    const walk = counts[this._id('DN_WALK')] || counts[this._id('VNC_CPG')] || 0;
    const turn = counts[this._id('DN_TURN')] || 0;
    const flee = (counts[this._id('DN_STARTLE')] || 0) + (counts[this._id('DN_FLIGHT')] || 0);
    const reverse = counts[this._id('DN_BACKUP')] || 0;
    return { left: turn, right: turn, forward: walk, reverse: reverse + flee, rest: walk === 0 && flee === 0 };
  }

  get state() {
    const counts = this.latest.groupSpikeCounts || [];
    const hunger = counts[this._id('DRIVE_HUNGER')] || 0;
    const fear = (counts[this._id('DRIVE_FEAR')] || 0) + (counts[this._id('DN_STARTLE')] || 0);
    const dopamine = counts[this._id('MB_DAN_REW')] || 0;
    const arousal = Math.min(1, this.latest.firedNeurons / 800);
    return {
      headingAngle: 0, npfLevel: Math.min(1, hunger / 10),
      dopamineTransient: Math.min(1, dopamine / 5), panicLevel: Math.min(1, fear / 8),
      octopamineLevel: Math.min(1, fear / 10), arousalLevel: arousal,
      ppl1Transient: Math.min(1, (counts[this._id('MB_DAN_PUN')] || 0) / 5),
      giantFiberFiring: fear > 0, stunned: false, disgusted: false, exhausted: false,
      behaviorState: fear > 0 ? 'ESCAPE' : hunger > 3 ? 'FORAGING' : 'ALERT',
    };
  }

  onPelletEaten(isEnergizer) {
    this._stimulate(['GUS_GRN_SWEET', 'MB_DAN_REW'], [isEnergizer ? 1.4 : 0.35, isEnergizer ? 1.2 : 0.25]);
  }

  onHazardEaten() { this._stimulate(['GUS_GRN_BITTER', 'MB_DAN_PUN'], [1.4, 1]); }
  onCaught() { this._stimulate(['MECH_BRISTLE', 'DRIVE_FEAR', 'DN_STARTLE'], [1, 1, 1]); }
  isGiantFiberFiring() { return this.state.giantFiberFiring; }
}
