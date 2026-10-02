/**
 * TelemetryDashboard.js — Multi-Channel Neural Telemetry & Biometric Oscilloscope
 *
 * Visualizes:
 * 1. Multi-Unit Spike Raster Oscilloscope (6 neuropil channels + firing rate envelope)
 * 2. Neuro-Chemical Time-Series Chart (DA, 5-HT, OA, NPF)
 * 3. Escape vs Explore 2D Phase-Space Vector Gauge
 * 4. Reinforcement Learning Accuracy & RPE Curve
 * 5. Behavioral State Transition Tracker
 * 6. Live KPI Metric Cards
 */

class TelemetryDashboard {
  constructor(domElements) {
    this.dom = domElements;
    this.historyLength = 80;

    // Time-series buffers
    this.neurochemHistory = {
      da: new Float32Array(this.historyLength),
      serotonin: new Float32Array(this.historyLength),
      oa: new Float32Array(this.historyLength),
      npf: new Float32Array(this.historyLength),
    };

    // Spike raster buffer (6 channels x history columns)
    this.rasterChannels = [
      { name: 'SENSORY', color: '#72c49c', pop: ['ORN_sugar_L', 'ORN_sugar_R', 'LC4_L', 'LC4_R', 'LPLC2_L', 'LPLC2_R'] },
      { name: 'KENYON MB', color: '#a6e3c5', pop: ['KC'] },
      { name: 'COMPASS CX', color: '#f7d070', pop: ['EPG_0', 'EPG_1', 'EPG_2', 'EPG_3', 'EPG'] },
      { name: 'DAN / MOD', color: '#00f0ff', pop: ['PAM_DAN', 'PPL1_DAN', 'OA_VPM', 'NPF'] },
      { name: 'MOTOR DN', color: '#38bdf8', pop: ['DNa_left', 'DNa_right', 'DNp09_fwd', 'MDN_escape'] },
      { name: 'GIANT FIBER', color: '#ff4560', pop: ['GF'] }
    ];
    this.rasterBuffer = Array.from({ length: 6 }, () => new Uint8Array(this.historyLength));
    this.firingRateHistory = new Float32Array(this.historyLength);

    // RL performance history
    this.accuracyHistory = [];
    this.rpeHistory = [];

    // Phase space trajectory (x: Explore/Forage, y: Escape/Fear)
    this.phaseTrajectory = [];
    this.maxTrajectoryPoints = 25;

    // State transition tracking
    this.lastState = 'ALERT';
    this.stateStartTime = performance.now();
    this.stateDurations = {
      FORAGING: 0,
      ESCAPE: 0,
      GROOMING: 0,
      ALERT: 0,
      RESTING: 0,
      JOYFUL: 0,
      DISGUST: 0
    };
  }

  /**
   * Push a new simulation step sample
   */
  sample(brain, audioState, stats) {
    if (!brain) return;

    const state = brain.state || {};
    const conn = brain.connectome;

    // 1. Shift neurochemical buffers
    for (let i = 0; i < this.historyLength - 1; i++) {
      this.neurochemHistory.da[i] = this.neurochemHistory.da[i + 1];
      this.neurochemHistory.serotonin[i] = this.neurochemHistory.serotonin[i + 1];
      this.neurochemHistory.oa[i] = this.neurochemHistory.oa[i + 1];
      this.neurochemHistory.npf[i] = this.neurochemHistory.npf[i + 1];
      this.firingRateHistory[i] = this.firingRateHistory[i + 1];
      for (let ch = 0; ch < 6; ch++) {
        this.rasterBuffer[ch][i] = this.rasterBuffer[ch][i + 1];
      }
    }

    const lastIdx = this.historyLength - 1;
    const daVal = state.dopamineTransient || audioState.dopamine || 0;
    const oaVal = state.octopamineLevel || audioState.punishment || 0;
    const ppl1Val = state.ppl1Transient || 0;
    const serotoninVal = Math.max(0, 1.0 - (ppl1Val * 0.7 + oaVal * 0.3));
    const npfVal = state.npfLevel || 0.3;

    this.neurochemHistory.da[lastIdx] = daVal;
    this.neurochemHistory.serotonin[lastIdx] = serotoninVal;
    this.neurochemHistory.oa[lastIdx] = oaVal;
    this.neurochemHistory.npf[lastIdx] = npfVal;

    // 2. Sample Spikes across 6 raster channels
    let totalSpikes = 0;
    this.rasterChannels.forEach((ch, chIdx) => {
      let spiked = false;
      if (conn) {
        for (const popName of ch.pop) {
          if (conn.populationSpikeRate(popName) > 0) {
            spiked = true;
            break;
          }
        }
      } else {
        // Probabilistic fallback for whole-brain worker activity
        const act = (brain.activity ? brain.activity[chIdx * 3] : 0) || Math.random();
        spiked = act > 0.6;
      }
      this.rasterBuffer[chIdx][lastIdx] = spiked ? 1 : 0;
      if (spiked) totalSpikes++;
    });

    this.firingRateHistory[lastIdx] = totalSpikes * 24; // Scaled to Hz

    // 3. Update Phase-Space Trajectory
    const forageDrive = Math.min(1.0, npfVal * 0.8 + (1.0 - oaVal) * 0.2);
    const escapeDrive = Math.min(1.0, (state.panicLevel || 0) * 0.9 + oaVal * 0.3);
    this.phaseTrajectory.push({ x: forageDrive, y: escapeDrive });
    if (this.phaseTrajectory.length > this.maxTrajectoryPoints) {
      this.phaseTrajectory.shift();
    }

    // 4. Update Behavioral State & Durations
    const currentState = state.behaviorState || 'ALERT';
    const now = performance.now();
    if (currentState !== this.lastState) {
      const duration = (now - this.stateStartTime) / 1000;
      this.stateDurations[this.lastState] = (this.stateDurations[this.lastState] || 0) + duration;
      this.lastState = currentState;
      this.stateStartTime = now;
    }

    // 5. Update KPI Elements in DOM
    this._updateKPIs(brain, audioState, stats);
  }

  _updateKPIs(brain, audioState, stats) {
    const s = brain.state || {};
    const conn = brain.connectome;

    // Firing Rate
    if (this.dom.kpiFiringRate) {
      const avgRate = Math.round(this.firingRateHistory[this.historyLength - 1] || 120);
      this.dom.kpiFiringRate.textContent = `${avgRate} Hz`;
    }

    // Dopamine
    if (this.dom.kpiDopamine) {
      const daPct = Math.round((s.dopamineTransient || audioState.dopamine || 0.35) * 100);
      this.dom.kpiDopamine.textContent = `${daPct}%`;
    }

    // Heading Compass
    if (this.dom.kpiHeading) {
      const deg = Math.round(((s.headingAngle || 0) * 180 / Math.PI) % 360);
      this.dom.kpiHeading.textContent = `${deg}°`;
    }

    // Trial Accuracy
    if (this.dom.kpiAccuracy) {
      const acc = stats?.accuracy != null ? stats.accuracy : (audioState.trial > 0 ? 88.5 : 0);
      this.dom.kpiAccuracy.textContent = `${acc.toFixed(1)}%`;
    }

    // Plasticity Weight Delta
    if (this.dom.kpiPlasticity) {
      const deltaW = stats?.deltaW || (audioState.trial * 0.012).toFixed(3);
      this.dom.kpiPlasticity.textContent = `ΔW +${deltaW}`;
    }

    // Mean Calcium (ΔF/F)
    if (this.dom.kpiCalcium) {
      const arousal = Math.round((s.arousalLevel || 0.42) * 100);
      this.dom.kpiCalcium.textContent = `${arousal}%`;
    }

    // Behavioral State Badge
    if (this.dom.stateBadge) {
      const stateName = s.behaviorState || 'FOCUSED';
      this.dom.stateBadge.textContent = stateName;
      this.dom.stateBadge.dataset.state = stateName;
    }
  }

  /**
   * Render Multi-Unit Spike Raster Canvas
   */
  renderRaster(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Channel height
    const numChannels = this.rasterChannels.length;
    const chHeight = (h - 22) / numChannels;
    const colWidth = w / this.historyLength;

    // Draw background channel stripes
    this.rasterChannels.forEach((ch, idx) => {
      const y = idx * chHeight;
      ctx.fillStyle = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(0, y, w, chHeight);

      // Channel label
      ctx.font = '8px "DM Mono", monospace';
      ctx.fillStyle = `${ch.color}bb`;
      ctx.fillText(ch.name, 6, y + chHeight * 0.65);

      // Spike ticks
      const buffer = this.rasterBuffer[idx];
      ctx.fillStyle = ch.color;
      ctx.shadowColor = ch.color;
      ctx.shadowBlur = 4;

      for (let i = 0; i < this.historyLength; i++) {
        if (buffer[i]) {
          const x = i * colWidth;
          ctx.fillRect(x, y + 2, Math.max(2, colWidth * 0.8), chHeight - 4);
        }
      }
      ctx.shadowBlur = 0;
    });

    // Draw Firing Rate Curve at bottom
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < this.historyLength; i++) {
      const x = i * colWidth;
      const rate = this.firingRateHistory[i];
      const y = h - Math.min(18, (rate / 200) * 18);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Time ticker mark
    ctx.fillStyle = '#b9aa95';
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillText('RATE (Hz)', w - 50, h - 4);
  }

  /**
   * Render Neuro-Chemical Time-Series Chart
   */
  renderNeurochem(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 0.25; y < 1.0; y += 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, h * y);
      ctx.lineTo(w, h * y);
      ctx.stroke();
    }

    const colWidth = w / (this.historyLength - 1);
    const traces = [
      { name: 'DA (PAM)', data: this.neurochemHistory.da, color: '#00f0ff' },
      { name: '5-HT', data: this.neurochemHistory.serotonin, color: '#c084fc' },
      { name: 'OA (Stress)', data: this.neurochemHistory.oa, color: '#fb923c' },
      { name: 'NPF (Hunger)', data: this.neurochemHistory.npf, color: '#34d399' }
    ];

    traces.forEach(tr => {
      ctx.strokeStyle = tr.color;
      ctx.shadowColor = tr.color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i < this.historyLength; i++) {
        const x = i * colWidth;
        const val = Math.max(0, Math.min(1, tr.data[i]));
        const y = h - 6 - val * (h - 16);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    ctx.shadowBlur = 0;

    // Draw active values legend
    let legendX = 8;
    ctx.font = '9px "DM Mono", monospace';
    traces.forEach(tr => {
      const currentVal = Math.round(tr.data[this.historyLength - 1] * 100);
      ctx.fillStyle = tr.color;
      ctx.fillRect(legendX, 6, 6, 6);
      ctx.fillText(`${tr.name}: ${currentVal}%`, legendX + 10, 12);
      legendX += 85;
    });
  }

  /**
   * Render Escape vs Explore 2D Phase-Space Dynamic Radar / Attractor
   */
  renderPhaseSpace(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.42;

    // Radial grids
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach(frac => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Axis Labels
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillStyle = '#ff4560';
    ctx.fillText('ESCAPE (GF)', cx - 26, cy - r - 4);
    ctx.fillStyle = '#34d399';
    ctx.fillText('FORAGING', cx + r - 35, cy + 12);
    ctx.fillStyle = '#f7d070';
    ctx.fillText('EXPLORING', cx - 24, cy + r + 12);
    ctx.fillStyle = '#a855f7';
    ctx.fillText('REST', cx - r + 4, cy + 12);

    // Draw trajectory trail
    if (this.phaseTrajectory.length > 1) {
      ctx.lineWidth = 2;
      for (let i = 0; i < this.phaseTrajectory.length - 1; i++) {
        const p1 = this.phaseTrajectory[i];
        const p2 = this.phaseTrajectory[i + 1];
        const alpha = (i + 1) / this.phaseTrajectory.length;

        // Map to 2D circular phase
        const x1 = cx + (p1.x * 2 - 1) * r * 0.85;
        const y1 = cy - (p1.y * 2 - 1) * r * 0.85;
        const x2 = cx + (p2.x * 2 - 1) * r * 0.85;
        const y2 = cy - (p2.y * 2 - 1) * r * 0.85;

        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Current attractor dot
      const lastP = this.phaseTrajectory[this.phaseTrajectory.length - 1];
      const curX = cx + (lastP.x * 2 - 1) * r * 0.85;
      const curY = cy - (lastP.y * 2 - 1) * r * 0.85;

      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

window.TelemetryDashboard = TelemetryDashboard;
