/*
 * ga.js — the evolution part.
 *
 * There is no backprop anywhere in this project. Every agent in a generation
 * runs the same maze with its own random-ish brain, they get scored, the ones
 * that did best have children, the children get scrambled a bit, repeat. That
 * is the entire algorithm.
 */

class Population {
  constructor(cfg) {
    this.cfg = cfg;
    this.generation = 0;
    this.history = [];      // one entry per finished generation, for the graph

    this.layers = brainLayers(cfg);
    this.agents = [];
    for (let i = 0; i < cfg.popSize; i++) {
      this.agents.push(new Agent(new Brain(this.layers), cfg));
    }
  }

  /** Put everyone, and every hazard, back at the start line. */
  reset(world) {
    this.world = world;
    this.ticks = 0;
    world.reset();
    for (const a of this.agents) a.reset(world);
  }

  get anyAlive() {
    return this.agents.some(a => a.alive);
  }

  /** Advance the whole population one tick. Returns false when the run is over. */
  step() {
    if (this.ticks >= this.cfg.maxTicks) return false;
    // Hazards move first, so an agent's senses and its fate in the same tick
    // agree about where the crusher actually is.
    this.world.stepMovers(this.agents);
    let alive = false;
    for (const a of this.agents) {
      if (a.alive) { a.step(); alive = alive || a.alive; }
    }
    this.ticks++;
    return alive;
  }

  /** Run the current generation to completion without rendering. */
  runToEnd() {
    while (this.step()) { /* tick */ }
  }

  /** Whoever is doing best right now — the one worth drawing a trail for. */
  leader() {
    let best = this.agents[0], bestKey = Infinity;
    for (const a of this.agents) {
      // solved beats unsolved; among the rest, closest to the exit wins
      const key = a.reachedGoal ? -1000 + a.ticks / 10000 : a.bestDist;
      if (key < bestKey) { bestKey = key; best = a; }
    }
    return best;
  }

  /**
   * Score everyone, record the stats, and breed the next generation in place.
   * Returns the stats for the generation that just ended.
   */
  evolve() {
    const { cfg } = this;
    // Anyone still going when the clock ran out died of the clock. Recording
    // it here keeps the death breakdown honest instead of leaving a third of
    // the population filed under "alive" forever.
    for (const a of this.agents) {
      if (a.alive) { a.alive = false; a.death = DEATH.TIMEOUT; }
      a.score(cfg.maxTicks);
    }

    const ranked = this.agents.slice().sort((a, b) => b.fitness - a.fitness);
    const solved = ranked.filter(a => a.reachedGoal);
    const stats = {
      generation: this.generation,
      best: ranked[0].fitness,
      avg: ranked.reduce((s, a) => s + a.fitness, 0) / ranked.length,
      solveRate: solved.length / ranked.length,
      bestTicks: solved.length ? Math.min(...solved.map(a => a.ticks)) : null,
      closest: Math.min(...ranked.map(a => a.bestDist)),
      // How far through the switch-then-exit sequence the best agent got.
      // On a level with doors, "closest to the exit" is close to meaningless —
      // an agent two cells from the goal may be standing at a shut door with
      // no way through, which reads as nearly winning when it is nothing of
      // the sort.
      switchesDown: this.world.plates.length
        ? Math.max(...ranked.map(a => a.pressed.size))
        : 0,
      deaths: ranked.reduce((acc, a) => {
        acc[a.death] = (acc[a.death] || 0) + 1;
        return acc;
      }, {}),
    };
    this.history.push(stats);

    // --- breed ---
    const next = [];

    // Elites survive untouched. Without this, a lucky solver can be mutated
    // into uselessness and the population visibly goes backwards.
    for (let i = 0; i < cfg.elites && i < ranked.length; i++) {
      next.push(ranked[i].brain.clone());
    }

    while (next.length < cfg.popSize) {
      const a = this._tournament(ranked);
      const b = this._tournament(ranked);
      const child = Math.random() < cfg.crossoverRate
        ? Brain.crossover(a.brain, b.brain)
        : a.brain.clone();
      child.mutate(cfg.mutationRate, cfg.mutationStrength);
      next.push(child);
    }

    for (let i = 0; i < this.agents.length; i++) {
      this.agents[i] = new Agent(next[i], cfg);
    }

    this.generation++;
    return stats;
  }

  /**
   * Pick a few at random, return the fittest of them. Turning the selection
   * pressure up or down is just changing the sample size — larger means the
   * top performers dominate faster, at the cost of diversity.
   */
  _tournament(ranked) {
    let best = null;
    for (let i = 0; i < this.cfg.tournament; i++) {
      const c = ranked[(Math.random() * ranked.length) | 0];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Population };
}
