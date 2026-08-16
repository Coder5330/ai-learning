# AI learns to escape

120 agents are dropped into a 3D arena with no map, no instructions, and no
idea what lava is. Most of them drive into a wall. Some walk straight into the
fire. The handful that got furthest have children, the children are mutated
slightly, and it runs again.

**And then the maze is thrown away and a new one is generated.** Every single
generation. That is the part that matters.

**Open `index.html` in a browser.** That is the whole setup — no build, no
install, no server, no dependencies. Not even a 3D library: the renderer is
about three hundred lines of WebGL in `js/render3d.js`.

---

## Why the maze changes every time

On a fixed maze, evolution does not have to learn *how to solve a maze*. It can
learn "left, then right, then left" — a memorised route worth nothing anywhere
else. The population looks like it is getting cleverer and is really just
overfitting to one map, and the escape rate mostly tells you how many
generations it took to memorise the answer.

So in **Endless mode** (the default) every generation gets a maze nobody has
ever seen. A memorised route is worth exactly zero. The only thing selection
can reward is general maze-solving, and the escape rate becomes an honest
generalisation score, because it is measured entirely on unseen mazes.

The number gets much *worse* when you do this. That is the point — it was
always the real number.

Difficulty then climbs through nine tiers, adding one new thing at a time, so
that when the escape rate falls off a cliff you can see what caused it:

```
11x9 -> 13x9 -> 13x11 +lava -> 15x11 -> 17x13 +crusher -> 19x13
     -> 21x15 -> 23x15 +chaser -> 25x17
```

A tier is cleared on a *sustained average* over several generations rather than
one good maze — performance on a single maze being the thing we just stopped
caring about.

### How far it actually gets

600 generations, 600 distinct mazes, default settings:

```
tier 1 at gen 0     tier 4 at gen 177
tier 2 at gen 5     tier 5 at gen 215
tier 3 at gen 21    ...and then it plateaus
```

It settles on **tier 5 of 9** — 17x13 mazes with four lava pools and a
patrolling crusher — holding roughly **5-13% escape on mazes it has never
seen**. About one agent in ten walks into a brand new hazard maze and finds the
exit. Reproduce with `node tools/train-endless.js 600`.

Getting past that plateau is an open problem and a good place to start poking.
One obvious idea already did not work: giving the brain more working memory.
Over 250 generations of Endless, 3 / 6 / 10 memory units all finished on tier 4
or 5 at 7-10% mean escape, which is inside the run-to-run noise. Whatever the
ceiling is, it is not memory capacity at these sizes.

There is also a **Campaign** in the level picker: ten hand-made arenas from a
single corridor up to a chaser maze, useful for watching one specific skill
being learned. Level 10 has never been escaped by anything, and is left in
deliberately as a standing challenge.

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
weights is the textbook move and it was actively harmful here: first escape at
generation 33 with crossover off against generation 42 with it on, and a 21%
escape rate against 13%, over four runs each. Two networks can produce the same
behaviour using completely different internal wiring, so a child built half
from each inherits neither.

**Mutation rate matters more than anything else.** At the 2% default, first
escape lands at generation 18 and holds 22%. At 10% — a perfectly ordinary
setting for a smaller network — *nothing ever escaped*, in any of four runs. A
deep brain takes well over a hundred weight changes per child at that rate,
which wrecks a working strategy before selection can act on it.

**Memory earns its place. Depth, so far, does not.** The default brain is five
layers because that is what was asked for, and it works — but on the level I
can measure it against, a single hidden layer beats it outright. Level 8, 150
generations, three runs each:

| brain | first escape | final escape % | best fitness |
|---|---|---|---|
| 3 layers + memory | generation 33 (3/3 runs) | **29%** | **3.12** |
| 3 layers, no memory | generation 31 (3/3) | 20% | 3.02 |
| 5 layers + memory | generation 60 (3/3) | 19% | 2.98 |
| 5 layers, no memory | generation 108 (2/3) | 7% | 2.27 |

Two things to take from that. The recurrent memory is worth having at either
depth — dropping it roughly halves the escape rate and, at five layers, made
one run in three fail to escape at all. Depth costs a lot of early progress and
there is no level here where it has been shown to pay that back. The intuition
that deeper nets should win on harder mazes is reasonable, and it is what an
earlier 2D version of this project appeared to show, but that result did not
survive the move to jumping and hazards, so it is not claimed here.

The dropdown under **Brain** switches depth live, and `node tools/train.js 8
150 20` reproduces the third row. If you want the fastest learner rather than
the deepest one, use it.

**A curriculum is not optional.** Dropped straight into a big hazard maze from
random weights, the population never escaped once in 250 generations. Fed the
same maze after climbing to it, it gets there.

**Punishing death made things worse.** An explicit fitness penalty for dying in
lava made the population hug the far wall and refuse to approach the hazard at
all — which scores worse than dying occasionally, because the exit is on the
other side. The only cost of dying is the progress you then fail to make. That
is enough.

---

## Adding your own arenas

Endless mode generates its own — to change what it produces, edit `TIERS` in
`js/mazegen.js`. To add a hand-made one, open `js/levels.js` and draw it. Every row must be the same length, with
exactly one `S` and at least one reachable `G`:

```js
{
  name: '11 · Your Arena',
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

## Putting it on the internet

It is a static site — no server, no build step, no API. Any static host will
take it as-is.

**Vercel** (`vercel.json` is already in the repo, so it needs no setup):

```sh
npx vercel          # preview URL
npx vercel --prod   # live
```

Or point Vercel at the GitHub repo from its dashboard and every push deploys
itself. Pick "Other" as the framework — there is nothing to build.

**GitHub Pages** works just as well and needs no third party: repo Settings →
Pages → deploy from branch → pick the branch and `/ (root)`.

Either way the whole thing is a few hundred KB of text, and all the computation
happens in the visitor's browser.

---

## Tuning it properly

Watching the canvas and going "hmm, that looks better" will mislead you — the
run-to-run variance is large. Train in the terminal instead:

```sh
node tools/train-endless.js 600      # the honest one: unseen maze every generation
node tools/train-endless.js 600 20   # ...with a single 20-neuron hidden layer

node tools/train.js 8 300            # one fixed campaign level, 300 generations
node tools/train.js 8 300 20         # ...with a single 20-neuron hidden layer
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
js/mazegen.js            procedural generation and the difficulty tiers
js/levels.js             the hand-made campaign arenas, as ASCII
js/nn.js                 the neural network
js/world.js              tiles, hazards, raycasting, flood-fill distance
js/agent.js              senses, movement, dying, scoring
js/ga.js                 selection, mutation, generations
js/render3d.js           the WebGL renderer, from scratch
js/app.js                main loop, stats, the brain diagram
tools/train-endless.js   headless training on procedural mazes
tools/train.js           headless training on one fixed level
tools/gen-maze.js        maze generator
tools/validate-levels.js
```

Nothing depends on anything you have to install. The `tools/` scripts need
Node; the page itself needs a browser with WebGL2, which is anything from the
last decade.

---

Inspired by [AI Warehouse](https://www.youtube.com/watch?v=M4AYM1XwJd4)'s maze
series, which trains its agent across procedurally generated mazes rather than
one fixed map — the detail this project was missing until it wasn't.
