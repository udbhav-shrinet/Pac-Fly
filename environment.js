/**
 * environment.js — spatial hashing, sugar gradients, and predator (Ghost)
 * state. The Environment owns everything that isn't a fly's own body or
 * brain, and everything a FlyAgent perceives is read through it.
 */

class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  key(cx, cy) { return `${cx},${cy}`; }
  cellOf(x, y) { return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)]; }
  clear() { this.cells.clear(); }
  insert(id, x, y) {
    const [cx, cy] = this.cellOf(x, y);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = []; this.cells.set(k, bucket); }
    bucket.push(id);
  }
  /** Returns candidate ids in the cells overlapping a radius around (x,y). */
  queryRadius(x, y, r) {
    const out = [];
    const minCx = Math.floor((x - r) / this.cellSize), maxCx = Math.floor((x + r) / this.cellSize);
    const minCy = Math.floor((y - r) / this.cellSize), maxCy = Math.floor((y + r) / this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
}

class Ghost {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 55;
    this.turnCooldown = 0;
  }
}

class Environment {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.sugarSources = []; // {id, x, y, radius, amount}
    this.ghosts = [];
    this.nextSugarId = 1;
    this.flyHash = new SpatialHash(60);
    this.sugarHash = new SpatialHash(80);
    this.ghostHash = new SpatialHash(80);
  }

  addSugarBlob(x, y, amount = 40, radius = 16) {
    this.sugarSources.push({ id: this.nextSugarId++, x, y, radius, amount });
  }

  seedSugar(count) {
    for (let i = 0; i < count; i++) {
      const x = 30 + Math.random() * (this.width - 60);
      const y = 30 + Math.random() * (this.height - 60);
      this.addSugarBlob(x, y, 30 + Math.random() * 30, 10 + Math.random() * 8);
    }
  }

  clearSugar() { this.sugarSources = []; }

  addGhost() {
    if (this.ghosts.length >= 8) return;
    const x = Math.random() < 0.5 ? 40 : this.width - 40;
    const y = 40 + Math.random() * (this.height - 80);
    this.ghosts.push(new Ghost(x, y));
  }

  removeAllGhosts() { this.ghosts = []; }

  rebuildHashes(flies) {
    this.flyHash.clear();
    for (const f of flies) if (f.alive) this.flyHash.insert(f, f.x, f.y);

    this.sugarHash.clear();
    for (const s of this.sugarSources) this.sugarHash.insert(s, s.x, s.y);

    this.ghostHash.clear();
    for (const g of this.ghosts) this.ghostHash.insert(g, g.x, g.y);
  }

  nearestSugar(x, y, radius = 260) {
    const candidates = this.sugarHash.queryRadius(x, y, radius);
    let best = null, bestD = Infinity;
    for (const s of candidates) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return { source: best, dist: bestD };
  }

  nearbyGhosts(x, y, radius = 220) {
    const candidates = this.ghostHash.queryRadius(x, y, radius);
    return candidates.map(g => ({ ghost: g, dist: Math.hypot(g.x - x, g.y - y) }));
  }

  nearestFly(x, y, radius = 400, exclude = null) {
    const candidates = this.flyHash.queryRadius(x, y, radius);
    let best = null, bestD = Infinity;
    for (const f of candidates) {
      if (f === exclude || !f.alive) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return { fly: best, dist: bestD };
  }

  update(dt, flies) {
    for (const g of this.ghosts) {
      g.turnCooldown -= dt;
      if (g.turnCooldown <= 0) {
        const { fly, dist } = this.nearestFly(g.x, g.y, 500);
        if (fly && dist < 500) {
          const desired = Math.atan2(fly.y - g.y, fly.x - g.x);
          let delta = desired - g.heading;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          g.heading += delta * 0.6 + (Math.random() - 0.5) * 0.6;
        } else {
          g.heading += (Math.random() - 0.5) * 1.2;
        }
        g.turnCooldown = 0.4 + Math.random() * 0.4;
      }
      g.x += Math.cos(g.heading) * g.speed * dt;
      g.y += Math.sin(g.heading) * g.speed * dt;
      if (g.x < 20) { g.x = 20; g.heading = Math.PI - g.heading; }
      if (g.x > this.width - 20) { g.x = this.width - 20; g.heading = Math.PI - g.heading; }
      if (g.y < 20) { g.y = 20; g.heading = -g.heading; }
      if (g.y > this.height - 20) { g.y = this.height - 20; g.heading = -g.heading; }
    }

    // Sugar sources slowly regenerate; fully depleted ones are pruned and
    // occasionally a fresh one blooms to keep the field alive.
    this.sugarSources = this.sugarSources.filter(s => s.amount > 0.5);
    if (Math.random() < dt * 0.15 && this.sugarSources.length < 40) {
      this.seedSugar(1);
    }

    this.rebuildHashes(flies);
  }

  /** Coarse gradient field for the pheromone heatmap overlay — cheap to sample at low resolution. */
  computeHeatGrid(cols, rows) {
    const grid = new Float32Array(cols * rows); // sugar channel
    const threat = new Float32Array(cols * rows); // ghost threat channel
    const cw = this.width / cols, ch = this.height / rows;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cx = gx * cw + cw / 2, cy = gy * ch + ch / 2;
        let sugarVal = 0;
        for (const s of this.sugarSources) {
          const d = Math.hypot(s.x - cx, s.y - cy);
          sugarVal += Math.max(0, 1 - d / 140) * (s.amount / 60);
        }
        let threatVal = 0;
        for (const g of this.ghosts) {
          const d = Math.hypot(g.x - cx, g.y - cy);
          threatVal += Math.max(0, 1 - d / 160);
        }
        grid[gy * cols + gx] = Math.min(1, sugarVal);
        threat[gy * cols + gx] = Math.min(1, threatVal);
      }
    }
    return { sugar: grid, threat, cols, rows };
  }
}
