/**
 * PacmanGame.js — a pixel-accurate recreation of the 1980 arcade Pac-Man
 * tile grid, maze rendering, movement, and ghost AI.
 *
 * This module is deliberately self-contained: it owns its own canvas,
 * its own requestAnimationFrame loop, and its own input handling. It knows
 * nothing about neurons, neurotransmitters, or Three.js — it only exposes
 * a small set of event callbacks (onDirectionChange, onPelletEaten,
 * onGhostDistanceUpdate, onHazardEaten) so a separate biological model can
 * observe gameplay without this file ever importing it. That separation is
 * what keeps the arcade loop at a steady 60 FPS regardless of how much work
 * the neural/3D side is doing.
 */

/** @typedef {{dx:number, dy:number}} Vec2i */

const DIRS = {
  right: { dx: 1, dy: 0, angle: 0 },
  down: { dx: 0, dy: 1, angle: 0.5 * Math.PI },
  left: { dx: -1, dy: 0, angle: Math.PI },
  up: { dx: 0, dy: -1, angle: 1.5 * Math.PI },
};
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

// The original arcade maze, tile-for-tile. Rows 0-2 and 34-35 are the
// off-screen buffer the ROM's tile engine reserves; the real 28x31
// playfield is rows [3, 33].
const MAZE_ROWS = [
  "____________________________",
  "____________________________",
  "____________________________",
  "||||||||||||||||||||||||||||",
  "|............||............|",
  "|.||||.|||||.||.|||||.||||.|",
  "|o||||.|||||.||.|||||.||||o|",
  "|.||||.|||||.||.|||||.||||.|",
  "|..........................|",
  "|.||||.||.||||||||.||.||||.|",
  "|.||||.||.||||||||.||.||||.|",
  "|......||....||....||......|",
  "||||||.||||| || |||||.||||||",
  "_____|.||||| || |||||.|_____",
  "_____|.||          ||.|_____",
  "_____|.|| |||--||| ||.|_____",
  "||||||.|| |______| ||.||||||",
  "      .   |______|   .      ",
  "||||||.|| |______| ||.||||||",
  "_____|.|| |||||||| ||.|_____",
  "_____|.||          ||.|_____",
  "_____|.|| |||||||| ||.|_____",
  "||||||.|| |||||||| ||.||||||",
  "|............||............|",
  "|.||||.|||||.||.|||||.||||.|",
  "|.||||.|||||.||.|||||.||||.|",
  "|o..||.......  .......||..o|",
  "|||.||.||.||||||||.||.||.|||",
  "|||.||.||.||||||||.||.||.|||",
  "|......||....||....||......|",
  "|.||||||||||.||.||||||||||.|",
  "|.||||||||||.||.||||||||||.|",
  "|..........................|",
  "||||||||||||||||||||||||||||",
  "____________________________",
  "____________________________",
];

const GRID_W = 28;
const PLAYFIELD_TOP = 3;
const PLAYFIELD_ROWS = 31;
const TUNNEL_ROW = 17;

class PacmanGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   onDirectionChange?: (angle:number) => void,
   *   onPelletEaten?: (isEnergizer:boolean) => void,
   *   onGhostDistanceUpdate?: (minDistanceTiles:number) => void,
   *   onHazardEaten?: () => void,
   *   onCaught?: () => void,
   * }} callbacks
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.tile = 16;

    canvas.width = GRID_W * this.tile;
    canvas.height = PLAYFIELD_ROWS * this.tile;

    this.running = false;
    this._lastTime = 0;
    this.mouthPhase = 0;
    this.score = 0;
    this.lives = 3;
    this.frozenUntil = 0;
    this.hazardFlashUntil = 0;
    this.sprintActive = false;
    this.stamina = 1.0;
    this.hazardPlacementMode = false;
    this._lastMinGhostDist = Infinity;
    this.catchFlashUntil = 0;
    this._invulnerableUntil = 0;
    this.exhausted = false;

    this._buildBoard();
    this._resetActors();
    this._bindInput();
  }

  // -------------------------------------------------------------------
  // Board construction
  // -------------------------------------------------------------------

  tileAt(row, col) {
    if (row < 0 || row >= MAZE_ROWS.length) return '_';
    let c = col;
    if (row === TUNNEL_ROW) {
      if (c < 0) c = GRID_W - 1;
      if (c >= GRID_W) c = 0;
    } else if (c < 0 || c >= GRID_W) {
      return '_';
    }
    return MAZE_ROWS[row][c];
  }

  isFloor(row, col, forGhost = false) {
    const t = this.tileAt(row, col);
    if (t === '.' || t === 'o' || t === ' ') return true;
    if (forGhost && t === '-') return true;
    return false;
  }

  wrapCol(row, col) {
    if (row !== TUNNEL_ROW) return col;
    if (col < 0) return GRID_W - 1;
    if (col >= GRID_W) return 0;
    return col;
  }

  _buildBoard() {
    this.pellets = new Map(); // "row,col" -> 'normal' | 'energizer'
    for (let row = PLAYFIELD_TOP; row < PLAYFIELD_TOP + PLAYFIELD_ROWS; row++) {
      for (let col = 0; col < GRID_W; col++) {
        const t = MAZE_ROWS[row][col];
        if (t === '.') this.pellets.set(`${row},${col}`, 'normal');
        else if (t === 'o') this.pellets.set(`${row},${col}`, 'energizer');
      }
    }
    this.hazards = new Map(); // "row,col" -> true
  }

  _resetActors() {
    this.pac = {
      row: 26, col: 13, // classic start tile, directly beneath the ghost house
      moveT: 0,
      dir: 'left', queuedDir: 'left',
      speed: 7.6, // tiles/sec
    };

    const ghostDefs = [
      { name: 'blinky', color: '#ff0000', row: 14, col: 13, scatter: { row: 3, col: 25 } },
      { name: 'pinky', color: '#ffb8ff', row: 17, col: 13, scatter: { row: 3, col: 2 } },
      { name: 'inky', color: '#00ffff', row: 17, col: 14, scatter: { row: 33, col: 27 } },
      { name: 'clyde', color: '#ffb851', row: 17, col: 12, scatter: { row: 33, col: 0 } },
    ];
    this.ghosts = ghostDefs.map((g, i) => ({
      ...g,
      moveT: 0,
      dir: 'up', queuedDir: 'up',
      speed: 6.6,
      leaveAt: performance.now() + i * 1200,
      inHouse: true,
    }));
  }

  /** Pixel position derived from the actor's tile + in-flight progress — never stored, always computed. */
  _actorPixel(actor) {
    const d = DIRS[actor.dir];
    const px = (actor.col + 0.5) * this.tile + d.dx * actor.moveT * this.tile;
    const py = (actor.row - PLAYFIELD_TOP + 0.5) * this.tile + d.dy * actor.moveT * this.tile;
    return { px, py };
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  _bindInput() {
    // Pac-Man is not player-controlled — he has his own brain. The only
    // human input this game accepts is placing bitter traps in the maze.
    this.canvas.addEventListener('click', (evt) => {
      if (!this.hazardPlacementMode) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width, scaleY = this.canvas.height / rect.height;
      const x = (evt.clientX - rect.left) * scaleX, y = (evt.clientY - rect.top) * scaleY;
      const col = Math.floor(x / this.tile);
      const row = Math.floor(y / this.tile) + PLAYFIELD_TOP;
      this.placeHazard(row, col);
    });
  }

  setHazardPlacementMode(active) { this.hazardPlacementMode = active; }

  placeHazard(row, col) {
    if (!this.isFloor(row, col)) return false;
    const key = `${row},${col}`;
    if (this.pellets.has(key) && this.pellets.get(key) !== 'normal') return false;
    this.hazards.set(key, true);
    return true;
  }

  /** Called by the bootstrap layer when the Giant Fiber escape reflex fires. */
  setSprintActive(active) { this.sprintActive = active; }

  /** Called by the bootstrap layer when the aversive circuit stuns Pac-Man. */
  freezeFor(ms) { this.frozenUntil = Math.max(this.frozenUntil, performance.now() + ms); }

  // -------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------

  start() {
    this.running = true;
    requestAnimationFrame((t) => this._loop(t));
  }
  stop() { this.running = false; }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - (this._lastTime || now)) / 1000);
    this._lastTime = now;
    this.update(dt, now);
    this.render();
    requestAnimationFrame((t) => this._loop(t));
  }

  // -------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------

  update(dt, now) {
    const frozen = now < this.frozenUntil;

    if (!frozen) {
      this._updatePacAutonomy();
      this._updateActorMovement(this.pac, dt, this._sprintSpeed(dt), true);
      this._handlePelletsAndHazards(now);
    }

    for (const g of this.ghosts) {
      if (g.inHouse) {
        if (now >= g.leaveAt) { g.inHouse = false; g.row = 15; g.col = 13; g.moveT = 0; g.dir = 'up'; g.queuedDir = 'up'; }
        continue;
      }
      this._updateGhostTarget(g);
      this._updateActorMovement(g, dt, g.speed, false);
    }

    this._updateGhostDistanceCallback();
    this._checkGhostCollision(now);

    this.mouthPhase += dt * (this.sprintActive ? 14 : this.exhausted ? 4 : 9);
  }

  _sprintSpeed(dt) {
    // Exhaustion slump: once stamina bottoms out, the fly can't sprint AND
    // can't even keep up a normal pace — it slows to a dozy crawl until it
    // recovers, exactly like the real post-escape refractory drop.
    this.exhausted = this.stamina <= 0.05;

    if (this.sprintActive && this.stamina > 0.02) {
      this.stamina = Math.max(0, this.stamina - dt * 0.5);
      return this.pac.speed * 1.6;
    }
    this.stamina = Math.min(1, this.stamina + dt * (this.exhausted ? 0.18 : 0.25));
    return this.exhausted ? this.pac.speed * 0.45 : this.pac.speed;
  }

  /**
   * Ghosts are predators, not scenery — actual contact matters. On catch:
   * a big fear spike fires, Pac-Man freezes and flashes, and both he and
   * every ghost reset to their spawn tiles (classic arcade "life lost"
   * beat) with a brief invulnerability window so they don't immediately
   * re-collide while still overlapping the spawn point.
   */
  _checkGhostCollision(now) {
    if (now < this._invulnerableUntil || now < this.frozenUntil) return;
    const pacPx = this._actorPixel(this.pac);
    for (const g of this.ghosts) {
      if (g.inHouse) continue;
      const gPx = this._actorPixel(g);
      const dist = Math.hypot(pacPx.px - gPx.px, pacPx.py - gPx.py);
      if (dist < this.tile * 0.6) {
        this.lives = Math.max(0, this.lives - 1);
        this.catchFlashUntil = now + 700;
        this.freezeFor(650);
        this._invulnerableUntil = now + 2200;
        this.callbacks.onCaught && this.callbacks.onCaught();
        this._respawnAfterCatch();
        if (this.lives === 0) {
          this.lives = 3;
          this._buildBoard();
        }
        break;
      }
    }
  }

  _respawnAfterCatch() {
    const pac = this.pac;
    pac.row = 26; pac.col = 13; pac.moveT = 0; pac.dir = 'left'; pac.queuedDir = 'left';
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      g.inHouse = true;
      g.moveT = 0;
      g.dir = 'up'; g.queuedDir = 'up';
      g.leaveAt = performance.now() + 600 + i * 900;
      const spawn = [{ row: 14, col: 13 }, { row: 17, col: 13 }, { row: 17, col: 14 }, { row: 17, col: 12 }][i];
      g.row = spawn.row; g.col = spawn.col;
    }
  }

  /**
   * Discrete tile-step movement: an actor always occupies an integer
   * (row, col) tile and a 0..1 progress fraction toward the tile it is
   * currently entering. Direction changes are only ever evaluated at the
   * instant that progress wraps — i.e. exactly when the actor is centered
   * on a tile — which is what gives Pac-Man his authentic no-wall-clipping
   * tile-snapped turning instead of free continuous steering.
   */
  _updateActorMovement(actor, dt, speed, isPac) {
    const d = DIRS[actor.dir];
    const openCurrent = this.isFloor(actor.row + d.dy, this.wrapCol(actor.row, actor.col + d.dx), !isPac);

    if (openCurrent) {
      actor.moveT += speed * dt;
    } else {
      actor.moveT = 0;
    }

    if (actor.moveT >= 1) {
      actor.moveT -= 1;
      const newRow = actor.row + d.dy;
      const newCol = this.wrapCol(actor.row, actor.col + d.dx);
      actor.row = newRow;
      actor.col = newCol;
      this._tryQueuedTurn(actor, isPac);
    } else if (!openCurrent) {
      // Halted at a wall: still allow the queued direction to release us.
      this._tryQueuedTurn(actor, isPac);
    }
  }

  _tryQueuedTurn(actor, isPac) {
    if (!actor.queuedDir || actor.queuedDir === actor.dir) return;
    const qd = DIRS[actor.queuedDir];
    if (this.isFloor(actor.row + qd.dy, this.wrapCol(actor.row, actor.col + qd.dx), !isPac)) {
      const prevDir = actor.dir;
      actor.dir = actor.queuedDir;
      if (isPac && prevDir !== actor.dir) {
        this.callbacks.onDirectionChange && this.callbacks.onDirectionChange(DIRS[actor.dir].angle);
      }
    }
  }

  _nearestPelletFrom(row, col) {
    let best = null, bestD = Infinity;
    for (const key of this.pellets.keys()) {
      const [r, c] = key.split(',').map(Number);
      const d = Math.abs(r - row) + Math.abs(c - col);
      if (d < bestD) { bestD = d; best = { row: r, col: c }; }
    }
    return best;
  }

  /**
   * Pac-Man has no player input. Every tile-center decision is driven by
   * the same two biological pressures the neural engine names: predator
   * avoidance (ghosts, sensed by proximity) and foraging drive (pellets,
   * treated as sugar). Ghosts are sensed well before they're adjacent —
   * this is a fly's looming-detector, not eyesight — so fleeing kicks in
   * early and a direction that would step onto (or swap places with) a
   * ghost's current tile is never chosen while any other option exists.
   * Fleeing itself stays noisy — an approximation of the Giant Fiber's
   * erratic evasive turning; otherwise Pac-Man greedily closes distance
   * on the nearest pellet, same as the old connectome-driven fly.
   */
  _updatePacAutonomy() {
    const pac = this.pac;
    const options = [];
    for (const name of Object.keys(DIRS)) {
      const d = DIRS[name];
      if (this.isFloor(pac.row + d.dy, this.wrapCol(pac.row, pac.col + d.dx), false)) options.push(name);
    }
    if (options.length === 0) return;
    const nonReverse = options.filter(o => o !== OPPOSITE[pac.dir]);
    let candidates = nonReverse.length > 0 ? nonReverse : options;

    let nearestGhost = null, nearestGhostDist = Infinity;
    for (const g of this.ghosts) {
      if (g.inHouse) continue;
      const d = Math.hypot(g.row - pac.row, g.col - pac.col);
      if (d < nearestGhostDist) { nearestGhostDist = d; nearestGhost = g; }
    }
    const fleeing = nearestGhostDist < 7.5; // sensed well before adjacency — a looming detector, not eyesight

    // Hard safety rule: never voluntarily step onto (or swap through) a
    // ghost's current tile if any other candidate direction exists.
    const ghostTiles = new Set();
    for (const g of this.ghosts) {
      if (!g.inHouse) ghostTiles.add(`${Math.round(g.row)},${Math.round(g.col)}`);
    }
    const safeCandidates = candidates.filter((name) => {
      const d = DIRS[name];
      const nr = pac.row + d.dy, nc = this.wrapCol(pac.row, pac.col + d.dx);
      return !ghostTiles.has(`${nr},${nc}`);
    });
    if (safeCandidates.length > 0) candidates = safeCandidates;

    const pelletTarget = this._nearestPelletFrom(pac.row, pac.col);

    let best = candidates[0], bestScore = -Infinity;
    for (const name of candidates) {
      const d = DIRS[name];
      const nr = pac.row + d.dy, nc = this.wrapCol(pac.row, pac.col + d.dx);
      let score = 0;

      if (fleeing && nearestGhost) {
        score += Math.hypot(nr - nearestGhost.row, nc - nearestGhost.col) * 4;
        score += (Math.random() - 0.5) * 3; // erratic zig-zag to break line of sight
      } else if (pelletTarget) {
        score -= Math.hypot(nr - pelletTarget.row, nc - pelletTarget.col);
      }

      if (this.hazards.has(`${nr},${nc}`)) score -= 8; // avoid known bitter traps
      if (name === pac.dir) score += 0.3; // mild momentum, avoids twitchy reversals
      score += Math.random() * (fleeing ? 0.3 : 0.5);

      if (score > bestScore) { bestScore = score; best = name; }
    }
    pac.queuedDir = best;
  }

  _updateGhostTarget(g) {
    const pac = this.pac;
    const pacRow = pac.row, pacCol = pac.col;
    const pacDir = DIRS[pac.dir];
    let target;

    if (g.name === 'blinky') {
      target = { row: pacRow, col: pacCol };
    } else if (g.name === 'pinky') {
      target = { row: pacRow + pacDir.dy * 4, col: pacCol + pacDir.dx * 4 };
    } else if (g.name === 'inky') {
      const blinky = this.ghosts.find(x => x.name === 'blinky');
      const aheadRow = pacRow + pacDir.dy * 2, aheadCol = pacCol + pacDir.dx * 2;
      target = { row: aheadRow * 2 - blinky.row, col: aheadCol * 2 - blinky.col };
    } else {
      const dist = Math.hypot(g.row - pac.row, g.col - pac.col);
      target = dist > 8 ? { row: pacRow, col: pacCol } : g.scatter;
    }

    // Choose the open, non-reverse direction that minimizes straight-line
    // distance to the target tile — exactly the original arcade's ghost
    // steering algorithm (no pathfinding, no BFS).
    let best = g.dir, bestD = Infinity;
    for (const name of Object.keys(DIRS)) {
      if (name === OPPOSITE[g.dir]) continue;
      const d = DIRS[name];
      const nc = this.wrapCol(g.row, g.col + d.dx);
      if (!this.isFloor(g.row + d.dy, nc, true)) continue;
      const dd = Math.hypot((g.row + d.dy) - target.row, nc - target.col);
      if (dd < bestD) { bestD = dd; best = name; }
    }
    g.queuedDir = best;
  }

  _handlePelletsAndHazards(now) {
    const row = this.pac.row, col = this.pac.col;
    const key = `${row},${col}`;

    if (this.hazards.has(key)) {
      this.hazards.delete(key);
      this.hazardFlashUntil = now + 600;
      this.freezeFor(800);
      this.callbacks.onHazardEaten && this.callbacks.onHazardEaten();
      return;
    }

    if (this.pellets.has(key)) {
      const kind = this.pellets.get(key);
      this.pellets.delete(key);
      this.score += kind === 'energizer' ? 50 : 10;
      this.callbacks.onPelletEaten && this.callbacks.onPelletEaten(kind === 'energizer');
      if (this.pellets.size === 0) this._buildBoard();
    }
  }

  _updateGhostDistanceCallback() {
    let min = Infinity;
    for (const g of this.ghosts) {
      if (g.inHouse) continue;
      const d = Math.hypot(g.row - this.pac.row, g.col - this.pac.col);
      if (d < min) min = d;
    }
    if (Math.abs(min - this._lastMinGhostDist) > 0.01) {
      this._lastMinGhostDist = min;
      this.callbacks.onGhostDistanceUpdate && this.callbacks.onGhostDistanceUpdate(min);
    }
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  render() {
    const ctx = this.ctx, T = this.tile;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawWalls();
    this._drawPellets();
    this._drawHazards();
    this._drawGhosts();
    this._drawPac();

    const now = performance.now();
    if (now < this.catchFlashUntil) {
      const alpha = (this.catchFlashUntil - now) / 700;
      ctx.fillStyle = `rgba(255,0,60,${0.28 * alpha})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _drawWalls() {
    const ctx = this.ctx, T = this.tile;
    const drawPass = (color, width, inset) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let row = PLAYFIELD_TOP; row < PLAYFIELD_TOP + PLAYFIELD_ROWS; row++) {
        for (let col = 0; col < GRID_W; col++) {
          if (MAZE_ROWS[row][col] !== '|') continue;
          const left = col * T, top = (row - PLAYFIELD_TOP) * T, right = left + T, bottom = top + T;
          if (this.isFloor(row - 1, col)) { ctx.moveTo(left + inset, top + inset); ctx.lineTo(right - inset, top + inset); }
          if (this.isFloor(row + 1, col)) { ctx.moveTo(left + inset, bottom - inset); ctx.lineTo(right - inset, bottom - inset); }
          if (this.isFloor(row, this.wrapCol(row, col - 1))) { ctx.moveTo(left + inset, top + inset); ctx.lineTo(left + inset, bottom - inset); }
          if (this.isFloor(row, this.wrapCol(row, col + 1))) { ctx.moveTo(right - inset, top + inset); ctx.lineTo(right - inset, bottom - inset); }
        }
      }
      ctx.stroke();
    };
    // Double-stroke: a soft glow pass, a base blue pass, then a thin inner highlight.
    ctx.save();
    ctx.shadowColor = '#2121de';
    ctx.shadowBlur = 6;
    drawPass('#2121de', 3, 1.5);
    ctx.restore();
    drawPass('#5a5aff', 1, 3.2);

    // Ghost house door
    ctx.strokeStyle = '#ffb8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13 * T, (15 - PLAYFIELD_TOP) * T);
    ctx.lineTo(15 * T, (15 - PLAYFIELD_TOP) * T);
    ctx.stroke();
  }

  _drawPellets() {
    const ctx = this.ctx, T = this.tile;
    for (const [key, kind] of this.pellets) {
      const [row, col] = key.split(',').map(Number);
      const cx = (col + 0.5) * T, cy = (row - PLAYFIELD_TOP + 0.5) * T;
      if (kind === 'normal') {
        ctx.fillStyle = '#ffe8c2';
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      } else {
        const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 130);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#ffe8c2';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawHazards() {
    const ctx = this.ctx, T = this.tile;
    for (const key of this.hazards.keys()) {
      const [row, col] = key.split(',').map(Number);
      const cx = (col + 0.5) * T, cy = (row - PLAYFIELD_TOP + 0.5) * T;
      ctx.fillStyle = '#a020f0';
      ctx.shadowColor = '#a020f0';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  _drawPac() {
    const ctx = this.ctx, T = this.tile;
    const r = T * 0.46;
    const mouthMax = Math.PI / 3; // ~60 degrees
    const mouth = Math.abs(Math.sin(this.mouthPhase)) * mouthMax;
    const stunned = performance.now() < this.frozenUntil;

    const { px, py } = this._actorPixel(this.pac);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(DIRS[this.pac.dir].angle);
    if (this.exhausted && !stunned) {
      // Sleepiness slump: a slow droopy squash-and-nod instead of a crisp circle.
      const nod = Math.sin(performance.now() / 260) * 0.08;
      ctx.rotate(nod);
      ctx.scale(1, 0.82);
    }
    ctx.fillStyle = stunned ? '#a020f0' : this.exhausted ? '#c9a400' : '#ffff00';
    ctx.shadowColor = stunned ? '#a020f0' : this.exhausted ? '#c9a400' : '#ffff00';
    ctx.shadowBlur = this.sprintActive ? 14 : 6;
    ctx.beginPath();
    ctx.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawGhosts() {
    const ctx = this.ctx, T = this.tile;
    for (const g of this.ghosts) {
      const r = T * 0.46;
      const { px, py } = this._actorPixel(g);
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = g.color;
      ctx.shadowColor = g.color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r, Math.PI, 0);
      ctx.lineTo(r, r * 0.6);
      for (let i = 0; i < 3; i++) {
        const bx = r - (i * (2 * r / 3)) - (r / 3);
        ctx.lineTo(bx, i % 2 === 0 ? r * 0.9 : r * 0.55);
      }
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-r * 0.32, -r * 0.15, r * 0.22, 0, Math.PI * 2);
      ctx.arc(r * 0.32, -r * 0.15, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0000aa';
      const pd = DIRS[g.dir];
      ctx.beginPath();
      ctx.arc(-r * 0.32 + pd.dx * r * 0.1, -r * 0.15 + pd.dy * r * 0.1, r * 0.11, 0, Math.PI * 2);
      ctx.arc(r * 0.32 + pd.dx * r * 0.1, -r * 0.15 + pd.dy * r * 0.1, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
