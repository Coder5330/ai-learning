/*
 * config.js — every dial in one place.
 *
 * The sliders in the page write into a copy of this at runtime; these are the
 * starting values. If you want to experiment properly, change them here and
 * run `node tools/train.js` to get numbers instead of vibes.
 */

const CONFIG = {
  // --- brain ---------------------------------------------------------------
  // Hidden layers between the senses and the controls. Five layers all in
  // (inputs → 20 → 16 → 12 → outputs). See the note at the top of js/nn.js
  // about why depth is slower to get going but goes further.
  hiddenLayers: [20, 16, 12],
  memory: 3,              // recurrent units; 0 turns memory off entirely

  // --- senses --------------------------------------------------------------
  rayCount: 9,
  rayFov: Math.PI * 1.25, // rays fan out this wide, centred on the heading
  rayRange: 8,            // cells
  groundProbes: 5,        // "what is the floor made of, that far ahead"
  probeStart: 0.6,        // first probe, in cells
  probeStep: 0.7,         // spacing between probes

  // --- body ----------------------------------------------------------------
  radius: 0.20,           // in cells — a corridor is 1 cell wide
  maxSpeed: 0.15,         // cells per tick at full throttle
  minSpeed: 0.03,         // it can slow down, but never fully park
  maxTurn: 0.30,          // radians per tick

  // Jump arc: apex = impulse² / (2·gravity) = 0.81, which is deliberately just
  // under the 1.0 wall height, so walls can never be hurdled. Hang time is
  // 2·impulse/gravity = 18 ticks, carrying it about 2.7 cells at full speed —
  // enough for a two-cell lava strip, not enough for four.
  gravity: 0.02,
  jumpImpulse: 0.18,
  fallDeathDepth: -3,     // fall this far below the floor and you are gone

  // 0 disables it. Culling agents that had not improved in a while was a
  // speed trick, but backing out of a deep dead end looks exactly like being
  // stuck right up until the moment it pays off, so it was also throwing away
  // the one behaviour a maze rewards. Nobody gives up now.
  stagnationTicks: 0,

  // --- evolution -----------------------------------------------------------
  popSize: 120,
  elites: 12,             // top brains copied into the next generation untouched
  tournament: 4,          // selection pressure: bigger = greedier

  // Crossover is OFF, and that is a measured choice rather than laziness.
  // Mixing weights from two deep networks reliably made things worse in
  // testing (on the first level: first escape around generation 23 with a 3%
  // escape rate, versus generation 9 and 36% without). The reason is that two
  // brains can arrive at the same behaviour using completely different
  // internal arrangements, so a child built half from each inherits neither.
  // Shallow nets suffer from this much less — turn it back up if you shrink
  // the brain.
  crossoverRate: 0,

  // Deep nets need a gentler hand than shallow ones. At 10% the default brain
  // takes well over a hundred weight changes per child, which is enough to
  // wreck a working strategy before it can ever be selected for.
  mutationRate: 0.02,     // chance each individual weight is nudged
  mutationStrength: 0.15, // size of a typical nudge

  // --- curriculum ----------------------------------------------------------
  autoAdvance: true,      // move up a level once the current one is beaten
  // "Beaten" means this share of the population escaping, for this many
  // generations running. Asking for a third of them was too strict on the
  // branchy mazes — the population would sit on one level for hundreds of
  // generations with a handful of agents escaping every time, which reads as
  // being stuck rather than as being careful.
  advanceSolveRate: 0.18,
  advanceStableGens: 3,
};

/**
 * How long a single run gets, in ticks.
 *
 * The obvious formula — shortest path, times a fudge factor — is wrong, and
 * wrong in a way that looks exactly like the level being too hard. An agent
 * cannot walk the shortest path, because it does not know where the exit is;
 * it has to explore, and exploring a maze costs time proportional to the
 * number of cells in it, not to the length of the answer. On a 27x19 maze
 * budgeted at 2.2x the direct route, the population was reaching within 13
 * cells of the exit and then having the clock stopped on it, with all 120
 * agents timing out every single generation.
 *
 * So the budget is the sum of two things: enough time to walk the real route
 * (through every switch), plus enough to sweep most of the arena on the way.
 */
function tickBudget(world, cfg) {
  const walk = world.routeLength * 1.5;      // the answer, with slack
  const explore = world.openCells * 1.2;     // finding the answer
  return Math.round((walk + explore) / cfg.maxSpeed) + 150;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, tickBudget };
}
