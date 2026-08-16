#!/usr/bin/env node
/*
 * Run training in the terminal, with no rendering. Useful for checking that a
 * change to the fitness function or the brain shape actually helped, instead
 * of squinting at the canvas and guessing.
 *
 *   node tools/train.js                    # level 1, 60 generations
 *   node tools/train.js 4 300              # level 4, 300 generations
 *   node tools/train.js 4 300 16,16,12     # ...with that hidden-layer stack
 *
 * Args: <level number> <generations> <hidden layers, comma separated>
 */

Object.assign(globalThis, require('../js/nn.js'));
Object.assign(globalThis, require('../js/world.js'));
Object.assign(globalThis, require('../js/agent.js'));
Object.assign(globalThis, require('../js/ga.js'));
const LEVELS = require('../js/levels.js');
const { CONFIG, tickBudget } = require('../js/config.js');

const levelNo = parseInt(process.argv[2] || '1', 10);
const gens = parseInt(process.argv[3] || '60', 10);
const hidden = process.argv[4]
  ? process.argv[4].split(',').map(n => parseInt(n, 10))
  : CONFIG.hiddenLayers;

const level = LEVELS[levelNo - 1];
if (!level) {
  console.error(`No level ${levelNo}. There are ${LEVELS.length}.`);
  process.exit(1);
}

const maze = new World(level);
const cfg = { ...CONFIG, hiddenLayers: hidden };
cfg.maxTicks = tickBudget(maze, cfg);

const pop = new Population(cfg);
console.log(`${level.name}  —  ${maze.w}x${maze.h}, shortest path ${maze.startDist} cells` +
  (maze.movers.length ? `, ${maze.movers.length} mover(s)` : ''));
console.log(`brain ${brainLayers(cfg).join('→')}, population ${cfg.popSize}, ${cfg.maxTicks} ticks per run\n`);
console.log(' gen |    best |     avg | solved | closest | fastest | how they died');
console.log('-----+---------+---------+--------+---------+---------+--------------');

const started = Date.now();
let firstSolve = null;
for (let g = 0; g < gens; g++) {
  pop.reset(maze);
  pop.runToEnd();
  const s = pop.evolve();
  if (firstSolve === null && s.solveRate > 0) firstSolve = s.generation;
  if (g % 5 === 0 || g === gens - 1 || s.generation === firstSolve) {
    console.log(
      `${String(s.generation).padStart(4)} |` +
      `${s.best.toFixed(3).padStart(8)} |` +
      `${s.avg.toFixed(3).padStart(8)} |` +
      `${(s.solveRate * 100).toFixed(0).padStart(5)}% |` +
      `${String(s.closest).padStart(8)} |` +
      `${String(s.bestTicks ?? '—').padStart(8)} | ` +
      Object.entries(s.deaths)
        .filter(([k]) => k !== 'escaped')
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`).join(', ')
    );
  }
}

const last = pop.history[pop.history.length - 1];
console.log(
  `\nfirst solve: ${firstSolve === null ? 'never' : `generation ${firstSolve}`}` +
  `   final solve rate: ${(last.solveRate * 100).toFixed(0)}%` +
  `   ${((Date.now() - started) / 1000).toFixed(1)}s`
);
