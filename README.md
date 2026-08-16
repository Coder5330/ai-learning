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
11x9 -> 13x9 -> +lava -> 15x11 -> +locked exit -> +lava again
     -> +crusher -> +spinner -> 21x15 -> +chaser -> 25x17
     -> 27x19 +2 switches -> 29x19 -> 31x21 +3 switches
```

Fourteen tiers, ending on a 31x21 maze with three switches, sixteen lava
pools, spinners, crushers and a chaser — with the loops thinned out until
there is very nearly one correct route. Nothing has reached the top yet; the
ladder keeps going so that it can.

Each new hazard arrives on its own before anything is stacked on top of it —
the locked exit especially, since it is the first time running straight at the
goal is the wrong move.

A tier is cleared on a *sustained average* over several generations rather than
one good maze — performance on a single maze being the thing we just stopped
caring about.

### How far it actually gets

400 generations, 400 distinct mazes, default settings:

```
tier 1 at gen 0     tier 4 at gen 164
tier 2 at gen 15    tier 5 at gen 249   (locked exit)
tier 3 at gen 21    tier 6 at gen 283   (locked exit + lava)
```

So it generalises to unseen mazes with lava, and then to unseen mazes with a
locked exit it has to find a plate for — which is the result worth having,
because none of that can be memorised. It stalls on tier 6 at a low single-digit
escape rate. Reproduce with `node tools/train-endless.js 400`.

**The most interesting number in the project is the gap between two of them.**
On the fixed hand-made plate level the population reaches 56% escape. On
procedurally generated mazes with the same mechanic it manages a few percent.
That difference is exactly what a fixed maze hides: on one map the agents learn
"the plate is over *there*", a memorised location worth nothing anywhere else.

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
| **Magenta bars** | spinners, sweeping a circle on a fixed rhythm. There is a gap between the arms |
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
    38 inputs ──▶ 20 ──▶ 16 ──▶ 12 ──▶ 6 outputs      1398 weights
                 tanh   tanh   tanh    tanh
                                         │
                          memory ◀───────┘
```

**In:** nine distance rays fanned out in front of it; five probes asking what
the floor is made of a little way ahead (lava? hole? — two separate channels,
because they want the same response but are different things); four probes
asking how heavily trodden the ground ahead, to each side and behind already
is; the straight-line direction and distance to *its current objective*; its
own speed, height, vertical speed and whether its feet are down; the direction
and distance of the nearest hazard; whether its doors are open yet; a bias; and
three numbers it chose to remember on the previous tick.

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

### Locked doors, and the sparse-reward problem

Once the exit is sealed behind a door, "got closer to the exit" is a useless
signal: the exit is unreachable, so there is nothing to climb towards and
evolution has no gradient at all. This is the classic sparse reward.

The fix is two rulers instead of one. The world keeps a second distance field
measuring the way to the nearest plate *with the doors still shut*. Finding the
plate is worth the first half of an agent's score, escaping afterwards is worth
the second, and the halves are contiguous so stepping on the plate is never a
step backwards. The "where is my objective" sense retargets from the exit to
the plate while the doors are shut, so the same three inputs serve both phases
and the network needs no separate sense for the sub-goal — just one extra input
telling it whether its doors are open.

With more than one switch this generalises: each switch is a phase of its own
and the exit is the last, every phase owning an equal slice of the score.
Progress inside a phase is measured fresh from wherever the agent was standing
when the phase began, so setting off *away* from the exit to reach the second
switch counts as progress rather than as going backwards.

Doors are per agent, not global. All 120 share one maze, so a global door would
mean one lucky agent finds the switch and the other 119 stroll through having
learned nothing.

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

**Knowing where you have already been is worth more than anything else in
here.** A person beats one of these mazes in a handful of tries, and the
reason is not reflexes — it is that they remember try one. "That way was a
dead end, take the other branch." Three floats of recurrent memory cannot hold
that, so for a long time the population was not searching the maze, it was
wandering it.

Each agent now carries a visit count per cell and senses it through four
probes: ahead, both sides, and behind. Not a map — just *have I been that way*.
The Switchyard, 200 generations each, everything else identical:

| | best fitness | switches pressed |
|---|---|---|
| trail sense on | **0.84** | **2 of 2** |
| trail sense off | 0.41 | **0** |

Without it the population never pressed a single switch. Not "pressed them
slowly" — never, in 200 generations, and never in a separate 650-generation run
either, where the fitness sat flat at 0.41 for six hundred generations. That
0.41 was entirely the small exploration bonus; actual progress was zero.

With it, both switches go down reliably. Four numbers, and they are the
difference between a search and a random walk.

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

**Nobody should be allowed to give up.** Agents that had not got closer in 140
ticks used to be culled, as a speed optimisation — an agent that has stopped
making progress is usually wedged in a corner. But backing out of a deep dead
end looks exactly like being wedged, right up until the moment it pays off, so
the cull was quietly binning the one behaviour a maze actually rewards.
Removing it was expected to cost performance. Instead Endless mode reached tier
4 at generation 55 rather than 177, and a 60-generation run still finishes in
twelve seconds.

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
    { kind: 'spinner', at: [5, 2], arms: 3, reach: 1.5, speed: 0.035 },
  ],
},
```

| char | |
|---|---|
| `#` | wall — solid, too tall to jump |
| `.` | floor |
| `~` | lava — ground level, but standing on it kills |
| ` ` | void — no floor at all |
| `P` | pressure switch — **every** switch must be pressed before the doors open |
| `D` | door — solid until this agent has pressed a plate |
| `S` | start (exactly one) |
| `G` | goal |

Then check it:

```sh
node tools/validate-levels.js
```

which confirms every level parses, has a start and a reachable goal, that no
hazard is parked inside a wall, that no crusher's patrol line runs through one
on its way, and that no spinner's circle sweeps through one — and prints the shortest path length so you can slot the level
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
tools/build-levels.js    regenerates the five campaign arenas
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
