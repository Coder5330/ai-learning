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

const TILE = { WALL: 0, FLOOR: 1, LAVA: 2, VOID: 3, PLATE: 4, DOOR: 5 };

const CHAR_TO_TILE = {
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  '~': TILE.LAVA,
  ' ': TILE.VOID,
  'P': TILE.PLATE,
  'D': TILE.DOOR,
  'S': TILE.FLOOR,
  'G': TILE.FLOOR,
};

/** A crusher, a chaser, or one arm of a spinner, with live position. */
class Mover {
  constructor(spec) {
    this.kind = spec.kind;                    // 'crusher' | 'chaser' | 'spinner'
    this.speed = spec.speed || 0.05;
    this.radius = spec.radius || 0.34;
    // Crushers and spinner arms are short enough to hurdle if you time it.
    // Chasers are not.
    this.height = spec.height || (spec.kind === 'chaser' ? 0.95 : 0.5);
    this.spec = spec;
    this.reset();
  }

  reset() {
    const s = this.spec;
    if (this.kind === 'spinner') {
      this.cx = s.at[0] + 0.5;
      this.cy = s.at[1] + 0.5;
      this.arm = s.arm;                    // how far out this arm sits
      this.angle = s.phase || 0;
      this.x = this.cx + Math.cos(this.angle) * this.arm;
      this.y = this.cy + Math.sin(this.angle) * this.arm;
      return;
    }
    if (this.kind === 'crusher') {
      this.ax = s.from[0] + 0.5; this.ay = s.from[1] + 0.5;
      this.bx = s.to[0] + 0.5;   this.by = s.to[1] + 0.5;
      this.t = s.phase || 0;     // 0..1 along the patrol, ping-ponging
      this.dir = 1;
      // Place it where the phase says, not at the start of the line — a row
      // of staggered crushers should be staggered from tick zero.
      this.x = this.ax + (this.bx - this.ax) * this.t;
      this.y = this.ay + (this.by - this.ay) * this.t;
    } else {
      this.x = s.at[0] + 0.5;
      this.y = s.at[1] + 0.5;
    }
  }

  /** @param agents living agents, so a chaser has something to chase */
  step(world, agents) {
    if (this.kind === 'spinner') {
      // No wall checks: a spinner's orbit is validated when the level loads,
      // so it can sweep its circle without ever needing to look.
      this.angle += this.speed;
      this.x = this.cx + Math.cos(this.angle) * this.arm;
      this.y = this.cy + Math.sin(this.angle) * this.arm;
      return;
    }
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
    // Doors are solid to hazards. They are a per-agent idea, but a chaser
    // strolling through one would look like a bug even though it isn't.
    if (!world.blocked(nx, this.y, this.radius, false)) this.x = nx;
    if (!world.blocked(this.x, ny, this.radius, false)) this.y = ny;
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
    this.plates = [];
    this.doors = [];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.rows[y][x];
        const t = CHAR_TO_TILE[c];
        this.tiles[y * this.w + x] = t === undefined ? TILE.WALL : t;
        if (c === 'S') this.start = { x: x + 0.5, y: y + 0.5, cx: x, cy: y };
        if (c === 'G') this.goals.push({ cx: x, cy: y });
        if (c === 'P') this.plates.push({ cx: x, cy: y });
        if (c === 'D') this.doors.push({ cx: x, cy: y });
      }
    }

    // A spinner is written as one entry but is really several arms sharing a
    // centre, evenly spaced so there is a gap to time your run through.
    this.movers = [];
    for (const spec of level.movers || []) {
      if (spec.kind !== 'spinner') { this.movers.push(new Mover(spec)); continue; }
      const arms = spec.arms || 2;
      const reach = spec.reach || 1.4;
      for (let i = 0; i < arms; i++) {
        const base = (spec.phase || 0) + (i / arms) * Math.PI * 2;
        // Two blocks per arm, so an arm reads as a bar rather than a dot.
        for (const frac of [0.55, 1.0]) {
          this.movers.push(new Mover({
            kind: 'spinner', at: spec.at, arm: reach * frac,
            speed: spec.speed || 0.035, phase: base,
            radius: spec.radius || 0.3, height: spec.height,
          }));
        }
      }
    }

    // Two rulers, because there are two jobs. `dist` measures the way out with
    // the doors open; `distPlate` measures the way to the nearest plate with
    // them still shut. An agent that has not found a plate yet is scored on
    // the second and then handed over to the first — which is how a goal it
    // cannot see becomes a gradient it can climb.
    this.dist = this._buildDistanceField(this.goals, true);
    this.distPlate = this.plates.length
      ? this._buildDistanceField(this.plates, false)
      : null;

    this.startDist = this.start ? this.distAt(this.start.cx, this.start.cy) : Infinity;
    this.startPlateDist = this.start && this.distPlate
      ? this.distPlate[this.start.cy * this.w + this.start.cx]
      : Infinity;

    // How far an agent actually has to walk. With a locked exit that is not
    // the distance to the exit at all — it is the detour out to a plate and
    // then the whole way back across to the door. Budgeting the direct
    // distance gives door levels barely half the time they need.
    this.routeLength = this.startDist;
    if (this.plates.length && this.startPlateDist !== Infinity) {
      let best = Infinity;
      for (const p of this.plates) {
        const viaPlate = this.plateDistAt(p.cx, p.cy) + this.distAt(p.cx, p.cy);
        if (viaPlate < best) best = viaPlate;
      }
      if (best !== Infinity) this.routeLength = this.startPlateDist + best;
    }
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

  /** Solid right now, for someone whose doors are open (or not). */
  blocks(cx, cy, doorsOpen) {
    const t = this.tileAt(cx, cy);
    if (t === TILE.WALL) return true;
    return t === TILE.DOOR && !doorsOpen;
  }

  plateDistAt(cx, cy) {
    if (!this.distPlate) return Infinity;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return Infinity;
    return this.distPlate[cy * this.w + cx];
  }

  /** Nearest plate centre, for the "which way is the objective" sense. */
  nearestPlate(x, y) {
    let best = null, bestD = Infinity;
    for (const p of this.plates) {
      const dx = p.cx + 0.5 - x, dy = p.cy + 0.5 - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /**
   * Height of the ground in a cell, or -Infinity where there is none.
   * Lava is at floor level — it is walkable, it just kills you.
   */
  groundAt(cx, cy) {
    const t = this.tileAt(cx, cy);
    if (t === TILE.VOID) return -Infinity;
    return 0;
  }

  isPlate(cx, cy) { return this.tileAt(cx, cy) === TILE.PLATE; }

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
  _buildDistanceField(sources, doorsOpen) {
    const d = new Float64Array(this.w * this.h).fill(Infinity);
    const queue = [];
    for (const g of sources) {
      d[g.cy * this.w + g.cx] = 0;
      queue.push(g.cy * this.w + g.cx);
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const cx = idx % this.w, cy = (idx / this.w) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (this.blocks(nx, ny, doorsOpen)) continue;
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
  castRay(x, y, angle, maxRange, doorsOpen) {
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
      if (this.blocks(cx, cy, doorsOpen)) return Math.min(dist, maxRange);
    }
    return maxRange;
  }

  /** Does a circle of radius r at (x,y) overlap anything solid? */
  blocked(x, y, r, doorsOpen) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.blocks(cx, cy, doorsOpen)) continue;
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
    if (this.start && this.startDist === Infinity) problems.push('goal is not reachable from the start (with the doors open)');
    if (this.doors.length && !this.plates.length) {
      problems.push(`${this.doors.length} door(s) but no plate to open them`);
    }
    if (this.plates.length && this.start && this.startPlateDist === Infinity) {
      problems.push('no plate is reachable from the start with the doors shut');
    }
    if (this.start && this.tileAt(this.start.cx, this.start.cy) !== TILE.FLOOR) {
      problems.push('the start is not on solid floor');
    }
    for (const m of this.movers) {
      const cells = m.kind === 'crusher' ? [m.spec.from, m.spec.to] : [m.spec.at];
      if (m.kind === 'spinner') { /* checked by sweep below */ } else
      for (const [cx, cy] of cells) {
        if (this.isWall(cx, cy)) problems.push(`a ${m.kind} is parked inside a wall at ${cx},${cy}`);
      }
      // A spinner sweeps a circle, so the whole circle has to be clear.
      if (m.kind === 'spinner') {
        const steps = 32;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const px = m.cx + Math.cos(a) * m.arm;
          const py = m.cy + Math.sin(a) * m.arm;
          if (this.isWall(Math.floor(px), Math.floor(py))) {
            problems.push(`a spinner at ${m.spec.at} sweeps through the wall at `
              + `${Math.floor(px)},${Math.floor(py)}`);
            break;
          }
        }
        continue;
      }
      // Endpoints being clear is not enough — a crusher travels in a straight
      // line and will happily slide through anything in between, so walk the
      // whole patrol and check it.
      if (m.kind === 'crusher') {
        const [ax, ay] = m.spec.from, [bx, by] = m.spec.to;
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 4);
        for (let i = 0; i <= steps; i++) {
          const t = steps ? i / steps : 0;
          const cx = Math.round(ax + (bx - ax) * t);
          const cy = Math.round(ay + (by - ay) * t);
          if (this.isWall(cx, cy)) {
            problems.push(`a crusher's patrol from ${ax},${ay} to ${bx},${by} passes through the wall at ${cx},${cy}`);
            break;
          }
        }
      }
    }
    return problems;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { World, Mover, TILE };
}
