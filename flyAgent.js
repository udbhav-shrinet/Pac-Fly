/**
 * flyAgent.js — the physical embodiment of a fly: continuous-space
 * kinematics, energy budget, sensory gathering (routed through the active
 * Sensory Mutation mode), and motor execution driven by its own Connectome
 * instance. Nothing in here decides "flee the ghost" as a rule — the
 * Connectome's motor readout (steer bias, forward drive, panic) is the only
 * thing that steers the body; this class just turns that into physics.
 */

let __flyIdCounter = 1;

class FlyAgent {
  constructor(x, y, weights, environment) {
    this.id = __flyIdCounter++;
    this.x = x;
    this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 40;
    this.energy = 1.0;
    this.alive = true;
    this.age = 0; // seconds
    this.score = 0;
    this.deathReason = null;
    this.rosterCredited = false;

    this.connectome = new Connectome(weights);

    this.trail = [];
    this.oscHistory = { al: [], lc4: [], mb: [], dn: [] };
    this.oscLen = 140;
    this.rasterHistory = []; // [{t, spikes: bool[]}]
    this.rasterWindowMs = 5000;

    this.adrenalineUntil = 0;
    this.fastingUntil = 0;
    this.dopamineLockUntil = 0;
  }

  applyAdrenaline() {
    this.adrenalineUntil = performance.now() + 4000;
  }
  applyFastingHormone() {
    this.energy = Math.min(this.energy, 0.10);
    this.fastingUntil = performance.now() + 6000;
  }
  applyDopamineSpike() {
    const motor = this.connectome.readMotor();
    this.connectome.motorLock = { forward: motor.forward, left: motor.left, right: motor.right, panic: motor.panic, hunger: motor.hunger, dopamine: motor.dopamine, gfFired: false };
    this.dopamineLockUntil = performance.now() + 3000;
  }

  sense(environment, sensoryMode) {
    const { source, dist: sugarDist } = environment.nearestSugar(this.x, this.y, 300);
    const sugarProximity = source ? Math.max(0, 1 - sugarDist / 260) : 0;

    let ghostToAL = 0, ghostToLC4 = 0;
    let nearestGhost = null, nearestGhostDist = Infinity;
    const nearby = environment.nearbyGhosts(this.x, this.y, 240);
    for (const { ghost, dist } of nearby) {
      const proximity = Math.max(0, 1 - dist / 220);
      if (dist < nearestGhostDist) { nearestGhostDist = dist; nearestGhost = ghost; }

      if (sensoryMode === 'B') {
        // Apex Predator: ghost is mathematically inverted into a sugar signal.
        ghostToAL += proximity;
      } else if (sensoryMode === 'C') {
        // Optic Flow Stealth: route by whether the ghost is facing the fly.
        const ghostForwardX = Math.cos(ghost.heading), ghostForwardY = Math.sin(ghost.heading);
        const toFlyX = this.x - ghost.x, toFlyY = this.y - ghost.y;
        const len = Math.hypot(toFlyX, toFlyY) || 1;
        const dot = ghostForwardX * (toFlyX / len) + ghostForwardY * (toFlyY / len);
        if (dot < 0) ghostToAL += proximity * 0.6; // behind the ghost's FOV: stalk
        else ghostToLC4 += proximity; // ghost turning toward the fly: panic
      } else {
        // Mode A: Biological Standard.
        ghostToLC4 += proximity;
      }
    }

    return { sugarProximity, source, ghostToAL, ghostToLC4, nearestGhost, nearestGhostDist };
  }

  update(dt, environment, sensoryMode, worldW, worldH) {
    if (!this.alive) return;
    const now = performance.now();
    if (this.adrenalineUntil && now > this.adrenalineUntil) this.adrenalineUntil = 0;
    if (this.fastingUntil && now > this.fastingUntil) { this.fastingUntil = 0; this.connectome.alWeightMultiplier = 1.0; }
    if (this.dopamineLockUntil && now > this.dopamineLockUntil) { this.dopamineLockUntil = 0; this.connectome.motorLock = null; }

    const adrenalineActive = this.adrenalineUntil > 0;
    this.connectome.forcedLC4 = adrenalineActive ? 1.0 : -1;
    if (this.fastingUntil > 0) this.connectome.alWeightMultiplier = 1.8;

    const sensed = this.sense(environment, sensoryMode);
    this.connectome.injectAL(sensed.sugarProximity * 1.0 + sensed.ghostToAL * 1.0);
    this.connectome.injectLC4(sensed.ghostToLC4 * 1.3);
    this.connectome.step();

    const motor = this.connectome.readMotor();
    const panicking = motor.panic > 0.55 || adrenalineActive;

    let steerTorque = (motor.right - motor.left) * 2.4;
    if (!panicking && sensed.source) {
      const desired = Math.atan2(sensed.source.y - this.y, sensed.source.x - this.x);
      const diff = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading));
      steerTorque += Math.sin(diff) * motor.hunger * 3.0;
    } else if (panicking && sensed.nearestGhost) {
      const away = Math.atan2(this.y - sensed.nearestGhost.y, this.x - sensed.nearestGhost.x);
      const diff = Math.atan2(Math.sin(away - this.heading), Math.cos(away - this.heading));
      steerTorque += Math.sin(diff) * motor.panic * 4.0;
      steerTorque += (Math.random() - 0.5) * 6 * motor.panic;
    }

    this.heading += steerTorque * dt;

    let baseSpeed = 42 * (1 + motor.forward * 0.7);
    if (panicking) baseSpeed *= 1.5;
    if (adrenalineActive) baseSpeed = Math.max(baseSpeed, 150);
    this.speed = baseSpeed;

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    const margin = 14;
    if (this.x < margin) { this.x = margin; this.heading = Math.PI - this.heading; }
    if (this.x > worldW - margin) { this.x = worldW - margin; this.heading = Math.PI - this.heading; }
    if (this.y < margin) { this.y = margin; this.heading = -this.heading; }
    if (this.y > worldH - margin) { this.y = worldH - margin; this.heading = -this.heading; }

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 16) this.trail.shift();

    let drain = 0.018 * (this.speed / 42);
    if (adrenalineActive) drain *= 3;
    this.energy = Math.max(0, this.energy - drain * dt);

    if (sensed.source) {
      const d = Math.hypot(sensed.source.x - this.x, sensed.source.y - this.y);
      if (d < sensed.source.radius) {
        const consumed = Math.min(sensed.source.amount, 22 * dt);
        sensed.source.amount -= consumed;
        this.energy = Math.min(1, this.energy + consumed * 0.02);
        this.score += consumed * 0.6;
        const mbDan = Connectome.regionGroups['MB'] || [];
        for (const i of mbDan) {
          if (Connectome.nodeIds[i].startsWith('MB_DAN')) this.connectome.externalCurrent[i] += 0.8 * dt * 20;
        }
      }
    }

    for (const { ghost, dist } of environment.nearbyGhosts(this.x, this.y, 30)) {
      if (dist < 13) { this.die('eaten'); break; }
    }

    if (this.alive && this.energy <= 0) this.die('starved');

    this.age += dt;

    this.oscHistory.al.push(motor.hunger);
    this.oscHistory.lc4.push(this.connectome.regionActivity('LC4'));
    this.oscHistory.mb.push(motor.dopamine);
    this.oscHistory.dn.push(motor.forward);
    for (const k of Object.keys(this.oscHistory)) {
      if (this.oscHistory[k].length > this.oscLen) this.oscHistory[k].shift();
    }

    this.rasterHistory.push({ t: now, spikes: this.connectome.keyNeuronSpikes() });
    while (this.rasterHistory.length && now - this.rasterHistory[0].t > this.rasterWindowMs) {
      this.rasterHistory.shift();
    }
  }

  die(reason) {
    this.alive = false;
    this.deathReason = reason;
  }

  render(ctx, selected) {
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const alpha = (i / this.trail.length) * 0.35;
      ctx.fillStyle = `rgba(255,204,0,${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const size = 7;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);

    if (selected) {
      ctx.strokeStyle = '#33e0ff';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#33e0ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, size + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const energyColor = this.energy > 0.5 ? '#ffcc00' : this.energy > 0.2 ? '#ff9900' : '#ff3355';
    ctx.fillStyle = energyColor;
    ctx.shadowColor = energyColor;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.8, size * 0.7);
    ctx.lineTo(-size * 0.4, 0);
    ctx.lineTo(-size * 0.8, -size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
