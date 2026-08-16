#!/usr/bin/env node
/*
 * Check every level in js/levels.js is actually solvable before you load it.
 *
 *   node tools/validate-levels.js
 *
 * Exits non-zero if anything is wrong, so it works as a pre-commit check too.
 */

const { World, TILE } = require('../js/world.js');
const LEVELS = require('../js/levels.js');

let failed = 0;

for (const level of LEVELS) {
  let maze, problems;
  try {
    maze = new World(level);
    problems = maze.validate();
  } catch (err) {
    problems = [`could not be parsed: ${err.message}`];
  }

  if (problems.length) {
    failed++;
    console.log(`✗ ${level.name}`);
    for (const p of problems) console.log(`    ${p}`);
  } else {
    let lava = 0, voids = 0;
    for (const t of maze.tiles) {
      if (t === TILE.LAVA) lava++;
      if (t === TILE.VOID) voids++;
    }
    const hazards = [
      maze.doors.length ? `${maze.plates.length}P/${maze.doors.length}D` : null,
      lava ? `${lava} lava` : null,
      voids ? `${voids} void` : null,
      maze.movers.length ? `${maze.movers.length} ${maze.movers.map(m => m.kind).join('/')}` : null,
    ].filter(Boolean).join(', ') || 'no hazards';
    console.log(
      `✓ ${level.name.padEnd(18)} ${String(maze.w).padStart(3)}x${String(maze.h).padEnd(3)}` +
      ` path ${String(maze.startDist).padStart(4)}` +
      `  ${String(maze.openCells).padStart(4)} open` +
      `  ${hazards}`
    );
  }
}

console.log(failed ? `\n${failed} level(s) need fixing.` : `\nAll ${LEVELS.length} levels OK.`);
process.exit(failed ? 1 : 0);
