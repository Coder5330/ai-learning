/*
 * agent.js — one creature: what it senses, how it moves, how it dies, how it
 * is scored.
 *
 * Movement is on a plane plus a height axis. The agent steers and throttles
 * like a little car, and can jump. Gravity does the rest. Everything it knows
 * about the world arrives through the sensors built in sense() — there is no
 * back channel, and in particular it never sees the distance field used to
 * score it.
 */

/** How many inputs the network sees, given a config. See js/config.js. */
function inputCount(cfg) {
  return cfg.rayCount          // wall distance, fanned out ahead
    + cfg.groundProbes * 2     // is there lava / a hole that far ahead?
    + 3                        // goal: sin, cos, distance
    + 1                        // own speed
    + 3                        // own height, vertical speed, feet on ground?
    + 3                        // nearest hazard: sin, cos, distance
    + 1                        // bias
    + cfg.memory;              // what it chose to remember last tick
}

/** Outputs: steer, throttle, jump, then the memory it keeps. */
function outputCount(cfg) {
  return 3 + cfg.memory;
}

/** Full layer stack for a brain: inputs, the hidden layers, outputs. */
function brainLayers(cfg) {
  return [inputCount(cfg), ...cfg.hiddenLayers, outputCount(cfg)];
}

/** How an agent's run ended — shown in the UI, and useful when tuning. */
const DEATH = {
  NONE: 'alive',
  ESCAPED: 'escaped',
  LAVA: 'lava',
  FELL: 'fell',
  CRUSHED: 'crushed',
  STUCK: 'gave up',
  TIMEOUT: 'ran out of time',
};

class Agent {
  constructor(brain, cfg) {
    this.brain = brain;
    this.cfg = cfg;
    this.inputs = new Float32Array(inputCount(cfg));
    this.memory = new Float32Array(cfg.memory);
    this.trail = [];
  }

  reset(world) {
    this.world = world;
    this.x = world.start.x;
    this.y = world.start.y;
    this.z = 0;
    this.vz = 0;
    this.grounded = true;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = 0;

    this.alive = true;
    this.reachedGoal = false;
    this.death = DEATH.NONE;
    this.ticks = 0;
    this.ticksAtBest = 0;
    this.bumps = 0;
    this.jumps = 0;

    this.startDist = world.startDist;
    this.bestDist = this.startDist;   // closest approach to the exit so far
    this.visited = new Set([world.start.cy * world.w + world.start.cx]);

    this.memory.fill(0);
    this.trail.length = 0;
    this.fitness = 0;
    return this;
  }

  kill(how) {
    this.alive = false;
    this.death = how;
  }

  /** Fill this.inputs from the world. */
  sense() {
    const { cfg, world } = this;
    const inp = this.inputs;
    let k = 0;

    // 1. Wall distance rays. Reported as "closeness": 1 = touching, 0 = clear.
    //    Closeness rather than raw distance keeps the useful signal — a wall in
    //    your face — at the large end of the range, where tanh can act on it.
    const half = cfg.rayFov / 2;
    const stepA = cfg.rayCount > 1 ? cfg.rayFov / (cfg.rayCount - 1) : 0;
    for (let i = 0; i < cfg.rayCount; i++) {
      const a = this.angle - half + stepA * i;
      const d = world.castRay(this.x, this.y, a, cfg.rayRange);
      inp[k++] = 1 - d / cfg.rayRange;
    }

    // 2. What the ground ahead is made of, sampled at increasing distances.
    //    Two separate channels rather than one "danger" number, because lava
    //    and a hole want the same response but are different things, and
    //    collapsing them would force the network to untangle them later.
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (let i = 0; i < cfg.groundProbes; i++) {
      const reach = cfg.probeStart + i * cfg.probeStep;
      const t = world.tileAt(Math.floor(this.x + c * reach), Math.floor(this.y + s * reach));
      inp[k++] = t === TILE.LAVA ? 1 : 0;
      inp[k++] = t === TILE.VOID ? 1 : 0;
    }

    // 3. Where the exit is, as the crow flies. Deliberately a weak hint: it
    //    says "the goal is somewhere over there", not "go this way", and in a
    //    maze it is usually pointing straight into a wall.
    const g = world.nearestGoal(this.x, this.y);
    const gdx = g.cx + 0.5 - this.x, gdy = g.cy + 0.5 - this.y;
    const gdist = Math.hypot(gdx, gdy);
    let rel = Math.atan2(gdy, gdx) - this.angle;
    inp[k++] = Math.sin(rel);
    inp[k++] = Math.cos(rel);
    inp[k++] = Math.min(1, gdist / (world.w + world.h));

    // 4. Proprioception. Without vertical speed it cannot tell rising from
    //    falling, and jump timing becomes guesswork.
    inp[k++] = this.speed / cfg.maxSpeed;
    inp[k++] = Math.max(-1, Math.min(1, this.z));
    inp[k++] = Math.max(-1, Math.min(1, this.vz * 6));
    inp[k++] = this.grounded ? 1 : -1;

    // 5. The nearest hazard, in the same shape as the goal sense.
    let nearest = null, bestSq = Infinity;
    for (const m of world.movers) {
      const d = (m.x - this.x) ** 2 + (m.y - this.y) ** 2;
      if (d < bestSq) { bestSq = d; nearest = m; }
    }
    if (nearest) {
      // Scaled by nearness rather than raw distance, so a hazard on the far
      // side of the arena reads as nothing at all and one about to flatten you
      // is the loudest thing in the vector.
      const near = 1 - Math.min(1, Math.sqrt(bestSq) / cfg.rayRange);
      rel = Math.atan2(nearest.y - this.y, nearest.x - this.x) - this.angle;
      inp[k++] = Math.sin(rel) * near;
      inp[k++] = Math.cos(rel) * near;
      inp[k++] = near;
    } else {
      inp[k++] = 0; inp[k++] = 0; inp[k++] = 0;
    }

    inp[k++] = 1; // bias

    for (let i = 0; i < cfg.memory; i++) inp[k++] = this.memory[i];
    return inp;
  }

  /** One tick of think → move → survive → score. */
  step() {
    if (!this.alive) return;
    const { cfg, world } = this;

    const out = this.brain.forward(this.sense());

    this.angle += out[0] * cfg.maxTurn;
    this.speed = cfg.minSpeed + ((out[1] + 1) / 2) * (cfg.maxSpeed - cfg.minSpeed);

    // Jumping only works with your feet on the ground, which is the whole
    // difficulty: the decision has to be made before the edge, not at it.
    if (out[2] > 0 && this.grounded) {
      this.vz = cfg.jumpImpulse;
      this.grounded = false;
      this.jumps++;
    }

    for (let i = 0; i < cfg.memory; i++) this.memory[i] = out[3 + i];

    // --- horizontal movement -------------------------------------------------
    // Each axis is resolved separately so that clipping a wall makes the agent
    // slide along it instead of stopping dead. Sliding matters more than it
    // sounds: without it a corner is an instant dead end, and the population
    // never discovers corridors at all.
    const nx = this.x + Math.cos(this.angle) * this.speed;
    const ny = this.y + Math.sin(this.angle) * this.speed;
    let moved = false;
    if (!world.blocked(nx, this.y, cfg.radius)) { this.x = nx; moved = true; }
    if (!world.blocked(this.x, ny, cfg.radius)) { this.y = ny; moved = true; }
    if (!moved) this.bumps++;

    // --- vertical movement ---------------------------------------------------
    this.vz -= cfg.gravity;
    this.z += this.vz;

    const cx = Math.floor(this.x), cy = Math.floor(this.y);
    const ground = world.groundAt(cx, cy);

    if (this.z <= ground) {
      this.z = ground;
      this.vz = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    this.ticks++;

    // --- ways to die ---------------------------------------------------------
    if (this.z < cfg.fallDeathDepth) { this.kill(DEATH.FELL); return; }

    if (this.grounded && world.tileAt(cx, cy) === TILE.LAVA) {
      this.kill(DEATH.LAVA);
      return;
    }

    for (const m of world.movers) {
      // Crushers are short: clear one in the air and it misses you.
      if (this.z >= m.height) continue;
      const dx = m.x - this.x, dy = m.y - this.y;
      const rr = m.radius + cfg.radius;
      if (dx * dx + dy * dy < rr * rr) { this.kill(DEATH.CRUSHED); return; }
    }

    // --- bookkeeping ---------------------------------------------------------
    this.visited.add(cy * world.w + cx);
    if (this.ticks % 4 === 0) this.trail.push(this.x, this.y, this.z);

    const d = world.distAt(cx, cy);
    if (d < this.bestDist) {
      this.bestDist = d;
      this.ticksAtBest = this.ticks;
    }

    if (world.isGoalCell(cx, cy) && this.grounded) {
      this.reachedGoal = true;
      this.kill(DEATH.ESCAPED);
    } else if (this.ticks - this.ticksAtBest > cfg.stagnationTicks) {
      // Wedged in a corner or driving in circles. Cutting it loose here is
      // purely a speed optimisation — its score is already locked in.
      this.kill(DEATH.STUCK);
    }
  }

  /**
   * Score, roughly in [0, 4].
   *
   * The shape matters more than the numbers. Progress is the bulk of it so
   * there is a gradient to climb from the very first generation; the escape
   * bonus is big enough that escaping always beats almost-escaping; the
   * exploration term is small and exists only to make poking down an unknown
   * corridor very slightly better than sitting still.
   *
   * Note there is no penalty for dying in lava beyond the progress you failed
   * to make. Adding one made the population hug the far wall and refuse to
   * approach the hazard at all, which is worse than dying occasionally.
   */
  score(maxTicks) {
    const progress = (this.startDist - this.bestDist) / Math.max(1, this.startDist);
    let f = Math.max(0, progress);

    if (this.reachedGoal) {
      // Escaped, and faster is better — this is what stops the population
      // settling for a working-but-daft route once it can finish at all.
      f += 1 + 2 * (1 - this.ticks / maxTicks);
    }

    f += 0.002 * this.visited.size;   // curiosity, gently
    f -= 0.0008 * this.bumps;         // scraping along walls is not free

    this.fitness = Math.max(0, f);
    return this.fitness;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Agent, DEATH, inputCount, outputCount, brainLayers };
}
