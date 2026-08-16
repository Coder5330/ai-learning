# AI learns to escape

120 agents are dropped into a 3D arena with no map, no instructions, and no
idea what lava is. Most of them drive into a wall. Some walk straight into the
fire. The handful that got furthest have children, the children are mutated
slightly, and it runs again.

After a few dozen rounds they can cross a room. After a few hundred they can
time a jump over a two-cell chasm, hurdle a moving crusher, and find the exit
of a maze they have never seen.

**Open `index.html` in a browser.** That is the whole setup — no build, no
install, no server, no dependencies. Not even a 3D library: the renderer is
about three hundred lines of WebGL in `js/render3d.js`.

---

## What you are looking at

Drag to orbit, scroll to zoom.

| | |
|---|---|
| **Blue cubes** | the population, all running the same arena at once |
| **White cube** | whoever is currently doing best, with a marker floating above it |
| **Green cubes** | agents that made it to the exit |
| **Small dark cubes** | the dead. They pile up along the lava edge, which tells you most of what you need to know |
| **Orange** | lava. Standing on it kills. Jumping over it does not |
| **Black gaps** | void. No floor at all — a missed jump falls forever |
| **Red blocks** | crushers, patrolling a fixed line. Short enough to hurdle |
| **Pink block** | the chaser. It comes for whoever is nearest, and it is too tall to jump |
| **Green beacon** | the exit |
| **White dots** | the leader's route, including the arc of every jump |

The **How the last generation ended** panel is the most informative thing on
the page. Watch `lava` fall and `ran out of time` rise as the population learns
that fire is a thing.

### Controls

- **Speed** — simulation ticks per frame. Crank it up once the novelty wears off.
- **Turbo 25** — run 25 generations without drawing. Click again to stop.
- **Mutation rate / size** — how much each child differs from its parent. Both live.
- **Level up automatically** — once the population can reliably escape, move it
  to the next arena, brains and all.
- **Follow the leader** — camera tracks the current best agent.
- Keyboard: `space` pause, `n` next generation, `t` turbo, `f` follow, `r` recentre.

Open the browser console and you have `maze.state` to poke at —
`maze.state.pop.history`, `maze.state.pop.leader().brain.weights`, and so on.

---

## How it actually works

Each agent has a **five-layer neural network**:

```
    33 inputs ──▶ 20 ──▶ 16 ──▶ 12 ──▶ 6 outputs      1298 weights
                 tanh   tanh   tanh    tanh
                                         │
                          memory ◀───────┘
```

**In:** nine distance rays fanned out in front of it; five probes asking what
the floor is made of a little way ahead (lava? hole? — two separate channels,
because they want the same response but are different things); the straight-line
direction and distance to the exit; its own speed, height, vertical speed and
whether its feet are down; the direction and distance of the nearest hazard; a
bias; and three numbers it chose to remember on the previous tick.

**Out:** steering, throttle, jump, and those three memory values.

The memory loop is not decoration. Without it an agent can only react to what
is in front of it right now — and a dead end looks exactly the same walking in
as walking out. Memory lets it carry a scrap of state through time.

The jump arc is tuned so that geometry does the teaching: it peaks at 0.81
units and a wall is 1.0, so walls can never be hurdled; hang time carries it
about 2.7 cells, so a two-cell gap is possible and a four-cell one is not.
Crushers are half a unit tall and *can* be cleared. Chasers cannot.

The nine arenas are graded, and the curriculum only moves the population up
once it can reliably escape the one it is on — carrying its brains with it. The
ladder matters more than it sounds: dropped straight into the big hazard maze
from random weights, the population never escapes once in 250 generations. Fed
the same maze after climbing to it, it gets there.

There is **no backpropagation anywhere in this project**. Nothing computes a
gradient or tells an agent what it should have done. Every agent runs the
arena, gets a score, and the best ones become the parents of the next
generation with their weights randomly jiggled. That is the entire learning
algorithm, and it is about ninety lines in `js/ga.js`.

Fitness rewards getting closer to the exit — measured by flood-fill distance,
so "close" means close *through the corridors*, not close as the crow flies —
pays a large bonus for escaping, pays more the faster you escape, adds a tiny
bonus for exploring, and subtracts a tiny amount for scraping along walls.

---

## Three things that turned out to matter

All measured with `tools/train.js`, not guessed.

**Crossover makes it worse, so it is off.** Breeding two brains by mixing their
weights is the textbook move, and here it was actively harmful — first escape
at generation ~23 with a 3% escape rate, versus generation ~9 and 36% with
crossover disabled. Two networks can produce the same behaviour using
completely different internal wiring, so a child built half from each inherits
neither. Set `crossoverRate` in `js/config.js` if you want to watch it fail.

**Depth is slow to start and then wins.** On the small arenas a single hidden
layer learns faster. On the big maze it never finishes at all. Over 150
generations, two runs each:

| brain | first escape | best fitness reached |
|---|---|---|
| 5 layers + memory | generation 134 | **1.57** |
| 5 layers, no memory | never | 1.13 |
| 3 layers + memory | never | 0.70 |
| 3 layers, no memory | never | 0.72 |

Only the deep brain ever got out. Two runs per row is a small sample and the
first-escape numbers are noisy, but the fitness gap is wide and consistent.
There is a dropdown under **Brain** to switch depth and watch it yourself.

**Punishing death made things worse.** An explicit fitness penalty for dying in
lava made the population hug the far wall and refuse to approach the hazard at
all — which scores worse than dying occasionally, because the exit is on the
other side. The only cost of dying is the progress you then fail to make. That
is enough.

---

## Adding your own arenas

Open `js/levels.js` and draw one. Every row must be the same length, with
exactly one `S` and at least one reachable `G`:

```js
{
  name: '10 · Your Arena',
  note: 'Shown under the level picker.',
  rows: [
    '#############',
    '#S...~..  ..#',
    '#....~..  ..#',
    '#....~..  .G#',
    '#############',
  ],
  movers: [
    { kind: 'crusher', from: [3, 1], to: [3, 3], speed: 0.07, phase: 0.5 },
    { kind: 'chaser',  at: [8, 2], speed: 0.085 },
  ],
},
```

| char | |
|---|---|
| `#` | wall — solid, too tall to jump |
| `.` | floor |
| `~` | lava — ground level, but standing on it kills |
| ` ` | void — no floor at all |
| `S` | start (exactly one) |
| `G` | goal |

Then check it:

```sh
node tools/validate-levels.js
```

which confirms every level parses, has a start and a reachable goal, that no
hazard is parked inside a wall, and that no crusher's patrol line runs through
one on its way — and prints the shortest path length so you can slot the level
in at the right difficulty. That last check is not hypothetical: it caught a
crusher sliding through a wall in this very repo.

Or have a maze generated:

```sh
node tools/gen-maze.js 21 15        # cols, rows
node tools/gen-maze.js 31 21 0      # loopiness 0 = exactly one route, brutal
node tools/gen-maze.js 21 15 0.1 42 # fixed seed, same maze every time
```

It prints ASCII ready to paste straight into `levels.js`. Add the lava yourself.

---

## Tuning it properly

Watching the canvas and going "hmm, that looks better" will mislead you — the
run-to-run variance is large. Train in the terminal instead:

```sh
node tools/train.js              # level 1, 60 generations
node tools/train.js 8 300        # level 8, 300 generations
node tools/train.js 8 300 20     # ...with a single 20-neuron hidden layer
```

It prints a table per generation including the death breakdown, which is
usually where the answer is.

Every knob lives in `js/config.js` with a comment explaining what it does and,
where it is non-obvious, why it is set the way it is.

---

## Files

```
index.html               markup and the control panel
css/style.css
js/config.js             every tunable value, in one place
js/levels.js             the arenas, as ASCII
js/nn.js                 the neural network
js/world.js              tiles, hazards, raycasting, flood-fill distance
js/agent.js              senses, movement, dying, scoring
js/ga.js                 selection, mutation, generations
js/render3d.js           the WebGL renderer, from scratch
js/app.js                main loop, stats, the brain diagram
tools/train.js           headless training, prints a table
tools/gen-maze.js        maze generator
tools/validate-levels.js
```

Nothing depends on anything you have to install. The `tools/` scripts need
Node; the page itself needs a browser with WebGL2, which is anything from the
last decade.
