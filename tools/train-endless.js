#!/usr/bin/env node
/*
 * Train in Endless mode from the terminal: a brand new maze every generation,
 * with the difficulty tier climbing as the population keeps up.
 *
 *   node tools/train-endless.js            # 300 generations
 *   node tools/train-endless.js 800        # ...longer
 *   node tools/train-endless.js 800 20     # ...with one 20-neuron hidden layer
 *
 * The escape rate printed here is worth more than the one from train.js: every
 * maze is unseen, so it is a generalisation score rather than a measure of how
 * well one route was memorised.
 */

Object.assign(globalThis, require('../js/nn.js'));
Object.assign(globalThis, require('../js/world.js'));
Object.assign(globalThis, require('../js/agent.js'));
Object.assign(globalThis, require('../js/ga.js'));
const { CONFIG, tickBudget } = require('../js/config.js');
const { proceduralLevel, describeTier, TIERS } = require('../js/mazegen.js');

const gens = parseInt(process.argv[2] || '300', 10);
const hidden = process.argv[3]
  ? process.argv[3].split(',').map(n => parseInt(n, 10))
  : CONFIG.hiddenLayers;

const cfg = { ...CONFIG, hiddenLayers: hidden };
const pop = new Population(cfg);

let tier = 0, recent = [], mazes = 0;
const reached = [{ tier: 0, gen: 0 }];

console.log(`Endless — a new maze every generation, ${gens} generations`);
console.log(`brain ${brainLayers(cfg).join('→')}, population ${cfg.popSize}\n`);
console.log(' gen | tier | escape% (last 8, unseen mazes) | arena');
console.log('-----+------+-------------------------------+---------------------------');

for (let g = 0; g < gens; g++) {
  const world = new World(proceduralLevel(tier, (Math.random() * 2 ** 31) | 0));
  mazes++;
  cfg.maxTicks = tickBudget(world, cfg);
  pop.reset(world);
  pop.runToEnd();
  const s = pop.evolve();

  recent.push(s.solveRate);
  if (recent.length > 8) recent.shift();
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;

  if (recent.length >= 6 && avg >= cfg.advanceSolveRate && tier < TIERS.length - 1) {
    tier++;
    recent = [];
    reached.push({ tier, gen: g });
    console.log(`${String(g).padStart(4)} | ${String(tier + 1).padStart(4)} | ` +
      `${'levelled up'.padEnd(29)} | ${describeTier(tier)}`);
  } else if (g % 20 === 0) {
    console.log(`${String(g).padStart(4)} | ${String(tier + 1).padStart(4)} | ` +
      `${(avg * 100).toFixed(0).padStart(28)}% | ${describeTier(tier)}`);
  }
}

const avg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
console.log(`\n${mazes} distinct mazes generated.`);
console.log(`finished on tier ${tier + 1} of ${TIERS.length} (${describeTier(tier)})` +
  ` at ${(avg * 100).toFixed(0)}% escape on unseen mazes`);
console.log('tiers reached: ' + reached.map(r => `T${r.tier + 1}@gen${r.gen}`).join(', '));
