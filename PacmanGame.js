/**
 * PacmanGame.js — a pixel-accurate recreation of the 1980 arcade Pac-Man
 * tile grid, maze rendering, movement, and ghost AI.
 *
 * This module is deliberately self-contained: it owns its own canvas,
 * its own requestAnimationFrame loop, and its own input handling. It knows
 * nothing about neurons, LIF dynamics, or Three.js — every tick it hands
 * `callbacks.brainTick(sense)` a small sensory snapshot (bearing/distance
 * to the nearest sugar and nearest ghost, current heading) and reads back
 * motor scores {left, right, forward, reverse, rest}, which it turns into
 * an actual maze move. It never decides direction itself — the connectome
 * does. That separation is what keeps the arcade loop at a steady 60 FPS
 * regardless of how much work the neural/3D side is doing.
 */

/** @typedef {{dx:number, dy:number}} Vec2i */

const DIRS = {
  right: { dx: 1, dy: 0, angle: 0 },
  down: { dx: 0, dy: 1, angle: 0.5 * Math.PI },
  left: { dx: -1, dy: 0, angle: Math.PI },
  up: { dx: 0, dy: -1, angle: 1.5 * Math.PI },
};
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };
const DIR_ORDER = ['right', 'down', 'left', 'up']; // clockwise sequence, matches the DIRS angle convention
const DIR_INDEX = { right: 0, down: 1, left: 2, up: 3 };
function rotateCW(dir) { return DIR_ORDER[(DIR_INDEX[dir] + 1) % 4]; }
function rotateCCW(dir) { return DIR_ORDER[(DIR_INDEX[dir] + 3) % 4]; }
function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// The base topology is expanded 2x in both axes at load time. This creates a
// 56x62 arena (4x the playable area) while preserving the known routes.
const BASE_MAZE_ROWS = [
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

const MAZE_SCALE = 2;
const GRID_W = 28 * MAZE_SCALE;
const PLAYFIELD_TOP = 3 * MAZE_SCALE;
const PLAYFIELD_ROWS = 31 * MAZE_SCALE;
const TUNNEL_ROW = 17 * MAZE_SCALE;
const MAZE_ROWS = (() => {
  const rows = [];
  for (const line of BASE_MAZE_ROWS) {
    const expanded = [...line].map(char => char.repeat(MAZE_SCALE)).join('');
    rows.push(expanded, expanded);
  }
  // Add connector openings at several wall junctions. These are deliberate
  // alternate routes, not random holes, and keep the enlarged map traversable.
  const connectors = [[14, 10], [14, 44], [26, 22], [26, 34], [42, 10], [42, 44], [54, 22], [54, 34]];
  for (const [row, col] of connectors) {
    for (let dy = 0; dy < 2; dy++) {
      const chars = [...rows[row + dy]];
      chars[col] = '.';
      chars[col + 1] = '.';
      rows[row + dy] = chars.join('');
    }
  }
  return rows;
})();

class PacmanGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   brainTick?: (sense: {sugarBearing:?number, sugarDist:?number, ghostBearing:?number, ghostDist:?number, headingIndex:number}) => ({left:number,right:number,forward:number,reverse:number,rest:boolean}|null),
   *   onPelletEaten?: (isEnergizer:boolean) => void,
   *   onGhostCaught?: () => void,
   *   onHazardEaten?: () => void,
   *   onCaught?: () => void,
   * }} callbacks
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    // The enlarged 56 x 62 board remains responsive through CSS max sizing.
    this.tile = 8;

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
    this.placementMode = 'trap';
    this.ghostBehavior = 'predator';
    this.humanMode = false;
    this.humanDir = null;
    this.flySpeedScale = 1;
    this.ghostSpeedScale = 1;
    this.catchFlashUntil = 0;
    this.frightenedUntil = 0;
    this._invulnerableUntil = 0;
    this.exhausted = false;
    this.paused = false;
    this.motorAction = 'RESTING';

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
      row: 26 * MAZE_SCALE, col: 13 * MAZE_SCALE,
      moveT: 0,
      dir: 'left', queuedDir: 'left',
      speed: 7.6, // tiles/sec
      resting: false,
    };

    const ghostDefs = [
      { name: 'blinky', color: '#ff0000', row: 14 * MAZE_SCALE, col: 13 * MAZE_SCALE, scatter: { row: 3 * MAZE_SCALE, col: 25 * MAZE_SCALE } },
      { name: 'pinky', color: '#ffb8ff', row: 17 * MAZE_SCALE, col: 13 * MAZE_SCALE, scatter: { row: 3 * MAZE_SCALE, col: 2 * MAZE_SCALE } },
      { name: 'inky', color: '#00ffff', row: 17 * MAZE_SCALE, col: 14 * MAZE_SCALE, scatter: { row: 33 * MAZE_SCALE, col: 27 * MAZE_SCALE } },
      { name: 'clyde', color: '#ffb851', row: 17 * MAZE_SCALE, col: 12 * MAZE_SCALE, scatter: { row: 33 * MAZE_SCALE, col: 0 } },
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
      if (!this.hazardPlacementMode && this.placementMode !== 'sugar') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width, scaleY = this.canvas.height / rect.height;
      const x = (evt.clientX - rect.left) * scaleX, y = (evt.clientY - rect.top) * scaleY;
      const col = Math.floor(x / this.tile);
      const row = Math.floor(y / this.tile) + PLAYFIELD_TOP;
      if (this.placementMode === 'sugar') this.placeSugar(row, col);
      else this.placeHazard(row, col);
    });
    window.addEventListener('keydown', (evt) => {
      const keys = { ArrowRight: 'right', d: 'right', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowUp: 'up', w: 'up' };
      if (this.humanMode && keys[evt.key]) {
        this.humanDir = keys[evt.key];
        evt.preventDefault();
      }
    });
  }

  setHazardPlacementMode(active) { this.hazardPlacementMode = active; }
  setHumanMode(active) { this.humanMode = Boolean(active); }
  setPaused(active) { this.paused = Boolean(active); }
  resetExperiment() {
    this.score = 0;
    this.lives = 3;
    this.frightenedUntil = 0;
    this.stamina = 1;
    this._buildBoard();
    this._resetActors();
  }

  setPlacementMode(mode) {
    if (mode !== 'sugar' && mode !== 'trap') throw new Error(`Unknown placement mode: ${mode}`);
    this.placementMode = mode;
    this.hazardPlacementMode = mode === 'trap';
  }

  setGhostBehavior(mode) {
    if (mode !== 'predator' && mode !== 'prey') throw new Error(`Unknown ghost behavior: ${mode}`);
    this.ghostBehavior = mode;
  }

  setFlySpeedScale(value) { this.flySpeedScale = Math.max(0.35, Math.min(2, Number(value))); }
  setGhostSpeedScale(value) { this.ghostSpeedScale = Math.max(0.35, Math.min(2, Number(value))); }

  clearSugar() {
    for (const [key, kind] of this.pellets) {
      if (kind === 'normal') this.pellets.delete(key);
    }
  }

  fillSugar() {
    for (let row = PLAYFIELD_TOP; row < PLAYFIELD_TOP + PLAYFIELD_ROWS; row++) {
      for (let col = 0; col < GRID_W; col++) {
        if (this.isFloor(row, col) && !this.hazards.has(`${row},${col}`)) {
          this.pellets.set(`${row},${col}`, 'normal');
        }
      }
    }
  }

  placeHazard(row, col) {
    if (!this.isFloor(row, col)) return false;
    const key = `${row},${col}`;
    if (this.pellets.has(key) && this.pellets.get(key) !== 'normal') return false;
    this.hazards.set(key, true);
    this.pellets.delete(key);
    // A bitter trap is an immediate environmental intervention, not a
    // delayed collision: remove a ghost occupying the affected tile.
    for (const ghost of this.ghosts) {
      if (Math.round(ghost.row) === row && Math.round(ghost.col) === col) {
        ghost.inHouse = true;
        ghost.row = 17 * MAZE_SCALE;
        ghost.col = 13 * MAZE_SCALE;
        ghost.moveT = 0;
        ghost.leaveAt = performance.now() + 1800;
      }
    }
    return true;
  }

  placeSugar(row, col) {
    if (!this.isFloor(row, col)) return false;
    const key = `${row},${col}`;
    if (this.hazards.has(key)) this.hazards.delete(key);
    this.pellets.set(key, 'normal');
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
    if (this.paused) return;
    const frozen = now < this.frozenUntil;

    if (!frozen) {
      this._updatePacBrain(dt);
      const speed = this._sprintSpeed(dt); // always run: stamina regen/drain and the exhaustion flag apply whether or not the fly is resting
      if (!this.pac.resting) {
        this._updateActorMovement(this.pac, dt, speed, true);
      }
      this._handlePelletsAndHazards(now);
    }

    for (const g of this.ghosts) {
      if (g.inHouse) {
        if (now >= g.leaveAt) { g.inHouse = false; g.row = 15; g.col = 13; g.moveT = 0; g.dir = 'up'; g.queuedDir = 'up'; }
        continue;
      }
      this._updateGhostTarget(g);
      this._updateActorMovement(g, dt, g.speed * this.ghostSpeedScale, false);
    }

    this._checkGhostCollision(now);

    this.mouthPhase += dt * (this.pac.resting ? 1.5 : this.sprintActive ? 14 : this.exhausted ? 4 : 9);
  }

  _sprintSpeed(dt) {
    // Exhaustion slump: once stamina bottoms out, the fly can't sprint AND
    // can't even keep up a normal pace — it slows to a dozy crawl until it
    // recovers, exactly like the real post-escape refractory drop.
    this.exhausted = this.stamina <= 0.05;

    if (this.sprintActive && this.stamina > 0.02) {
      this.stamina = Math.max(0, this.stamina - dt * 0.5);
      return this.pac.speed * this.flySpeedScale * 1.6;
    }
    this.stamina = Math.min(1, this.stamina + dt * (this.exhausted ? 0.18 : 0.25));
    return (this.exhausted ? this.pac.speed * 0.45 : this.pac.speed) * this.flySpeedScale;
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
        if (now < this.frightenedUntil) {
          this.score += 200;
          g.inHouse = true;
          g.row = 17;
          g.col = 13;
          g.moveT = 0;
          g.leaveAt = now + 900;
          this.callbacks.onGhostCaught && this.callbacks.onGhostCaught();
          continue;
        }
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
    pac.row = 26 * MAZE_SCALE; pac.col = 13 * MAZE_SCALE; pac.moveT = 0; pac.dir = 'left'; pac.queuedDir = 'left'; pac.resting = false;
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      g.inHouse = true;
      g.moveT = 0;
      g.dir = 'up'; g.queuedDir = 'up';
      g.leaveAt = performance.now() + 600 + i * 900;
      const spawn = [{ row: 14 * MAZE_SCALE, col: 13 * MAZE_SCALE }, { row: 17 * MAZE_SCALE, col: 13 * MAZE_SCALE }, { row: 17 * MAZE_SCALE, col: 14 * MAZE_SCALE }, { row: 17 * MAZE_SCALE, col: 12 * MAZE_SCALE }][i];
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
      actor.dir = actor.queuedDir;
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

  _lineOfSight(row, col, targetRow, targetCol) {
    const steps = Math.max(Math.abs(targetRow - row), Math.abs(targetCol - col));
    for (let i = 1; i < steps; i++) {
      const r = Math.round(row + (targetRow - row) * i / steps);
      const c = Math.round(col + (targetCol - col) * i / steps);
      if (!this.isFloor(r, this.wrapCol(r, c))) return false;
    }
    return true;
  }

  /**
   * Pac-Man has no player input and no distance-scoring heuristic either.
   * Every decision point, this method (1) works out which directions are
   * physically safe to consider — walls excluded always, a ghost's own
   * tile excluded whenever any alternative exists, a known bitter-trap
   * tile excluded the same way — then (2) hands the brain a sensory
   * snapshot (bearing + distance to the nearest sugar, bearing + distance
   * to the nearest sensed ghost, current heading index) and reads back
   * motor scores for turning left, right, continuing straight, or
   * reversing. The candidate whose relative direction best matches the
   * strongest motor score wins. If the brain's `rest` flag comes back
   * true — low forward drive, low escape drive — Pac-Man simply stops
   * moving this tick, exactly like a fly resting or grooming.
   */
  _updatePacBrain(dt) {
    const pac = this.pac;
    if (this.humanMode) {
      if (this.humanDir) pac.queuedDir = this.humanDir;
      pac.resting = false;
      return;
    }
    const options = [];
    for (const name of Object.keys(DIRS)) {
      const d = DIRS[name];
      if (this.isFloor(pac.row + d.dy, this.wrapCol(pac.row, pac.col + d.dx), false)) options.push(name);
    }
    if (options.length === 0) return;
    const nonReverse = options.filter(o => o !== OPPOSITE[pac.dir]);
    let candidates = nonReverse.length > 0 ? nonReverse : options;

    // Hard safety rules: never voluntarily step onto a ghost's tile, or a
    // known bitter trap, while any other candidate direction exists.
    const ghostTiles = new Set();
    for (const g of this.ghosts) {
      if (!g.inHouse) ghostTiles.add(`${Math.round(g.row)},${Math.round(g.col)}`);
    }
    const notOntoGhost = candidates.filter((name) => {
      const d = DIRS[name];
      const nr = pac.row + d.dy, nc = this.wrapCol(pac.row, pac.col + d.dx);
      return !ghostTiles.has(`${nr},${nc}`);
    });
    if (notOntoGhost.length > 0) candidates = notOntoGhost;
    const notOntoHazard = candidates.filter((name) => {
      const d = DIRS[name];
      const nr = pac.row + d.dy, nc = this.wrapCol(pac.row, pac.col + d.dx);
      return !this.hazards.has(`${nr},${nc}`);
    });
    if (notOntoHazard.length > 0) candidates = notOntoHazard;

    // --- Simulated fly sensory field -------------------------------------
    // These are environmental channels, not raw pixels/audio: the game
    // models compound gradients, optic looming, substrate vibration,
    // contact, proprioception, temperature, and compass cues.
    const pellet = this._nearestPelletFrom(pac.row, pac.col);
    let sugarBearing = null, sugarDist = null;
    const sugarVisible = pellet && this._lineOfSight(pac.row, pac.col, pellet.row, pellet.col);
    if (pellet) {
      sugarDist = Math.abs(pellet.row - pac.row) + Math.abs(pellet.col - pac.col);
      const targetAngle = Math.atan2(pellet.row - pac.row, pellet.col - pac.col);
      sugarBearing = angleDiff(targetAngle, DIRS[pac.dir].angle);
    }

    let nearestGhost = null, nearestGhostDist = Infinity;
    for (const g of this.ghosts) {
      if (g.inHouse) continue;
      const d = Math.hypot(g.row - pac.row, g.col - pac.col);
      if (d < nearestGhostDist) { nearestGhostDist = d; nearestGhost = g; }
    }
    let ghostBearing = null, ghostDist = null;
    const threatVisible = nearestGhost && this._lineOfSight(pac.row, pac.col, nearestGhost.row, nearestGhost.col);
    if (nearestGhost && nearestGhostDist < 12) {
      ghostDist = nearestGhostDist;
      const targetAngle = Math.atan2(nearestGhost.row - pac.row, nearestGhost.col - pac.col);
      ghostBearing = angleDiff(targetAngle, DIRS[pac.dir].angle);
    }

    let nearbyHazard = 0;
    for (const key of this.hazards.keys()) {
      const [r, c] = key.split(',').map(Number);
      nearbyHazard = Math.max(nearbyHazard, Math.max(0, 1 - Math.hypot(r - pac.row, c - pac.col) / 8));
    }
    const vibration = this.ghosts.reduce((total, ghost) => {
      if (ghost.inHouse) return total;
      return total + Math.max(0, 1 - Math.hypot(ghost.row - pac.row, ghost.col - pac.col) / 14) * (0.45 + ghost.moveT * 0.55);
    }, 0);
    const temperature = 0.5 + 0.18 * Math.sin(performance.now() / 18000);
    const contact = nearbyHazard > 0.85 || (nearestGhost && nearestGhostDist < 1.1) ? 1 : 0;
    const sense = {
      sugarBearing, sugarDist, ghostBearing, ghostDist,
      foodOdor: pellet ? Math.max(0, 1 - sugarDist / 18) : 0,
      dangerOdor: nearestGhost ? Math.max(0, 1 - nearestGhostDist / 18) : 0,
      foodVisible: sugarVisible ? 1 : 0,
      threatVisible: threatVisible ? 1 : 0,
      vibration: Math.min(1, vibration),
      contact, hazardProximity: nearbyHazard,
      proprioception: { heading: DIR_INDEX[pac.dir], speed: pac.resting ? 0 : this.flySpeedScale, turning: pac.queuedDir !== pac.dir },
      temperature,
      humidity: 0.5,
      lightLevel: threatVisible || sugarVisible ? 0.75 : 0.42,
      headingIndex: DIR_INDEX[pac.dir],
    };
    const motor = this.callbacks.brainTick ? this.callbacks.brainTick(sense, dt) : null;
    if (!motor) return; // no fixed-timestep brain tick landed this frame — hold the current decision
    const motorValues = { left: motor.left || 0, right: motor.right || 0, forward: motor.forward || 0, reverse: motor.reverse || 0 };
    const strongest = Object.entries(motorValues).sort((a, b) => b[1] - a[1])[0];
    this.motorAction = motor.rest ? 'RESTING' : strongest[0] === 'reverse' ? 'ESCAPE / REVERSE' : strongest[0].toUpperCase();

    // Strict survival override: resting/grooming is never honored with a
    // predator nearby, whatever the network's momentary motor readout
    // says. This is a hard rule, not a suggestion.
    const ghostIsClose = ghostDist != null && ghostDist < 5;
    this.pac.resting = !!motor.rest && !ghostIsClose;
    if (this.pac.resting) return;

    const relativeLabel = (name) => {
      if (name === pac.dir) return 'forward';
      if (name === rotateCCW(pac.dir)) return 'left';
      if (name === rotateCW(pac.dir)) return 'right';
      return 'reverse';
    };

    let best = candidates[0], bestScore = -Infinity;
    for (const name of candidates) {
      const label = relativeLabel(name);
      const score = (motor[label] || 0) + Math.random() * 0.02; // tiny biological noise, not a heuristic
      if (score > bestScore) { bestScore = score; best = name; }
    }
    pac.queuedDir = best;
  }

  _updateGhostTarget(g) {
    const pac = this.pac;
    const pacRow = pac.row, pacCol = pac.col;
    const pacDir = DIRS[pac.dir];
    let target;

    if (this.ghostBehavior === 'prey') {
      // Prey ghosts flee from the fly by targeting the opposite vector.
      const awayRow = g.row + (g.row - pacRow) * 8;
      const awayCol = g.col + (g.col - pacCol) * 8;
      target = { row: awayRow, col: awayCol };
    } else if (g.name === 'blinky') {
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
      if (kind === 'energizer') this.frightenedUntil = now + 8000;
      this.callbacks.onPelletEaten && this.callbacks.onPelletEaten(kind === 'energizer');
      if (this.pellets.size === 0) this._buildBoard();
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
    ctx.moveTo(13 * MAZE_SCALE * T, (15 * MAZE_SCALE - PLAYFIELD_TOP) * T);
    ctx.lineTo(15 * MAZE_SCALE * T, (15 * MAZE_SCALE - PLAYFIELD_TOP) * T);
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
    ctx.shadowBlur = this.pac.resting ? 3 : this.sprintActive ? 14 : 6;
    const restMouth = this.pac.resting ? mouth * 0.35 : mouth;
    ctx.beginPath();
    ctx.arc(0, 0, r, restMouth, Math.PI * 2 - restMouth);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Movement autonomy made visible: the brain's own DNp09/MDN output
    // came back below the movement threshold, so the fly is genuinely
    // motionless — resting/grooming, not just waiting on the player.
    if (this.pac.resting) {
      const bob = Math.sin(performance.now() / 400) * 2;
      ctx.save();
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(150,220,255,0.85)';
      ctx.fillText('z', px + r * 0.7, py - r * 1.1 + bob);
      ctx.font = '7px monospace';
      ctx.fillText('z', px + r * 1.2, py - r * 0.6 + bob);
      ctx.restore();
    }
  }

  _drawGhosts() {
    const ctx = this.ctx, T = this.tile;
    for (const g of this.ghosts) {
      const r = T * 0.46;
      const { px, py } = this._actorPixel(g);
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = g.color;
      if (performance.now() < this.frightenedUntil) {
        ctx.fillStyle = '#3159d8';
        ctx.shadowColor = '#5d8cff';
      }
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
