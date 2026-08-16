/*
 * world.js — the arena: tiles, hazards, raycasting, and the distance field.
 *
 * A level is an array of equal-length strings:
 *
 *     '#'  wall      solid, too tall to jump over
 *     '.'  floor     safe ground
 *     '~'  lava      ground level, but standing on it is death — jump across
 *     ' '  void      no floor at all; walk off and you fall out of the world
 *     'S'  start     exactly one
 *     'G'  goal      one or more
 *
 * plus a `movers` array describing things that patrol or hunt.
 *
 * The plane is measured in cells: cell (3,2) spans x 3..4, y 2..3. Height is a
 * third axis, z, with the floor at 0 and walls one unit tall.
 */

const TILE = { WALL: 0, FLOOR: 1, LAVA: 2, VOID: 3 };

const CHAR_TO_TILE = {
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  '~': TILE.LAVA,
  ' ': TILE.VOID,
  'S': TILE.FLOOR,
  'G': TILE.FLOOR,
};

/** A crusher or a chaser, with live position. */
class Mover {
  constructor(spec) {
    this.kind = spec.kind;                    // 'crusher' | 'chaser'
    this.speed = spec.speed || 0.05;
    this.radius = spec.radius || 0.34;
    // Crushers are short enough to hurdle if you time it. Chasers are not.
    this.height = spec.height || (spec.kind === 'chaser' ? 0.95 : 0.5);
    this.spec = spec;
    this.reset();
  }

  reset() {
    const s = this.spec;
    if (this.kind === 'crusher') {
      this.ax = s.from[0] + 0.5; this.ay = s.from[1] + 0.5;
      this.bx = s.to[0] + 0.5;   this.by = s.to[1] + 0.5;
      this.t = s.phase || 0;     // 0..1 along the patrol, ping-ponging
      this.dir = 1;
      this.x = this.ax; this.y = this.ay;
    } else {
      this.x = s.at[0] + 0.5;
      this.y = s.at[1] + 0.5;
    }
  }

  /** @param agents living agents, so a chaser has something to chase */
  step(world, agents) {
    if (this.kind === 'crusher') {
      const len = Math.hypot(this.bx - this.ax, this.by - this.ay) || 1;
      this.t += (this.dir * this.speed) / len;
      if (this.t >= 1) { this.t = 1; this.dir = -1; }
      if (this.t <= 0) { this.t = 0; this.dir = 1; }
      this.x = this.ax + (this.bx - this.ax) * this.t;
      this.y = this.ay + (this.by - this.ay) * this.t;
      return;
    }

    // Chaser: head for the closest living agent, sliding along walls so it
    // does not wedge itself in a corner and stop being a threat.
    let target = null, bestD = Infinity;
    for (const a of agents) {
      if (!a.alive) continue;
      const d = (a.x - this.x) ** 2 + (a.y - this.y) ** 2;
      if (d < bestD) { bestD = d; target = a; }
    }
    if (!target) return;
    const ang = Math.atan2(target.y - this.y, target.x - this.x);
    const nx = this.x + Math.cos(ang) * this.speed;
    const ny = this.y + Math.sin(ang) * this.speed;
    if (!world.blocked(nx, this.y, this.radius)) this.x = nx;
    if (!world.blocked(this.x, ny, this.radius)) this.y = ny;
  }
}

class World {
  constructor(level) {
    this.name = level.name || 'unnamed';
    this.rows = level.rows;
    this.h = this.rows.length;
    this.w = this.rows[0].length;

    this.tiles = new Uint8Array(this.w * this.h);
    this.start = null;
    this.goals = [];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.rows[y][x];
        const t = CHAR_TO_TILE[c];
        this.tiles[y * this.w + x] = t === undefined ? TILE.WALL : t;
        if (c === 'S') this.start = { x: x + 0.5, y: y + 0.5, cx: x, cy: y };
        if (c === 'G') this.goals.push({ cx: x, cy: y });
      }
    }

    this.movers = (level.movers || []).map(s => new Mover(s));

    this.dist = this._buildDistanceField();
    this.startDist = this.start ? this.distAt(this.start.cx, this.start.cy) : Infinity;
    this.openCells = this.tiles.reduce((n, t) => n + (t === TILE.WALL ? 0 : 1), 0);
  }

  /** Put the hazards back where they started, so every generation is fair. */
  reset() {
    for (const m of this.movers) m.reset();
  }

  stepMovers(agents) {
    for (const m of this.movers) m.step(this, agents);
  }

  tileAt(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return TILE.WALL;
    return this.tiles[cy * this.w + cx];
  }

  isWall(cx, cy) { return this.tileAt(cx, cy) === TILE.WALL; }

  /**
   * Height of the ground in a cell, or -Infinity where there is none.
   * Lava is at floor level — it is walkable, it just kills you.
   */
  groundAt(cx, cy) {
    const t = this.tileAt(cx, cy);
    if (t === TILE.VOID) return -Infinity;
    return 0;
  }

  /**
   * Flood fill outward from the goal, so every open cell knows how many steps
   * it is from the exit.
   *
   * Lava and void count as passable, because they are — by jumping. That makes
   * the shortest path run straight through the hazards, which is the point:
   * the safe way round is longer, and the population has to decide.
   *
   * This is the scoring ruler, NOT something the agents see. Feeding it to the
   * network would be handing over the answer; using it to rank agents is just
   * measuring who got closer. Straight-line distance would be a bad ruler — in
   * a maze the wall beside the goal is "close" and completely useless.
   */
  _buildDistanceField() {
    const d = new Float64Array(this.w * this.h).fill(Infinity);
    const queue = [];
    for (const g of this.goals) {
      d[g.cy * this.w + g.cx] = 0;
      queue.push(g.cy * this.w + g.cx);
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const cx = idx % this.w, cy = (idx / this.w) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (this.isWall(nx, ny)) continue;
        const ni = ny * this.w + nx;
        if (d[ni] !== Infinity) continue;
        d[ni] = d[idx] + 1;
        queue.push(ni);
      }
    }
    return d;
  }

  distAt(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return Infinity;
    return this.dist[cy * this.w + cx];
  }

  maxDist() {
    let m = 0;
    for (const v of this.dist) if (v !== Infinity && v > m) m = v;
    return m;
  }

  isGoalCell(cx, cy) { return this.distAt(cx, cy) === 0; }

  nearestGoal(x, y) {
    let best = null, bestD = Infinity;
    for (const g of this.goals) {
      const dx = g.cx + 0.5 - x, dy = g.cy + 0.5 - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  /**
   * Distance from (x,y) along `angle` until we hit a wall, capped at maxRange.
   * Standard DDA grid march — steps cell boundary to cell boundary, so cost is
   * proportional to how far the ray travels rather than to some step size.
   */
  castRay(x, y, angle, maxRange) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let cx = Math.floor(x), cy = Math.floor(y);

    const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);

    let stepX, stepY, sideX, sideY;
    if (dx < 0) { stepX = -1; sideX = (x - cx) * deltaX; }
    else { stepX = 1; sideX = (cx + 1 - x) * deltaX; }
    if (dy < 0) { stepY = -1; sideY = (y - cy) * deltaY; }
    else { stepY = 1; sideY = (cy + 1 - y) * deltaY; }

    let dist = 0;
    while (dist < maxRange) {
      if (sideX < sideY) { dist = sideX; sideX += deltaX; cx += stepX; }
      else { dist = sideY; sideY += deltaY; cy += stepY; }
      if (this.isWall(cx, cy)) return Math.min(dist, maxRange);
    }
    return maxRange;
  }

  /** Does a circle of radius r at (x,y) overlap a wall? */
  blocked(x, y, r) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.isWall(cx, cy)) continue;
        const nx = Math.max(cx, Math.min(x, cx + 1));
        const ny = Math.max(cy, Math.min(y, cy + 1));
        const ddx = x - nx, ddy = y - ny;
        if (ddx * ddx + ddy * ddy < r * r) return true;
      }
    }
    return false;
  }

  /** Sanity check used by tools/validate-levels.js. */
  validate() {
    const problems = [];
    if (this.rows.some(r => r.length !== this.w)) problems.push('rows are not all the same length');
    if (!this.start) problems.push('no S (start)');
    if (this.rows.join('').split('S').length - 1 > 1) problems.push('more than one S');
    if (this.goals.length === 0) problems.push('no G (goal)');
    if (this.start && this.startDist === Infinity) problems.push('goal is not reachable from the start');
    if (this.start && this.tileAt(this.start.cx, this.start.cy) !== TILE.FLOOR) {
      problems.push('the start is not on solid floor');
    }
    for (const m of this.movers) {
      const cells = m.kind === 'crusher' ? [m.spec.from, m.spec.to] : [m.spec.at];
      for (const [cx, cy] of cells) {
        if (this.isWall(cx, cy)) problems.push(`a ${m.kind} is parked inside a wall at ${cx},${cy}`);
      }
    }
    return problems;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { World, Mover, TILE };
}
