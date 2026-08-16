/*
 * nn.js — a small deep recurrent neural network.
 *
 * There is no library here on purpose: the whole point of watching a thing
 * learn is being able to open the file that does the learning.
 *
 * The default brain is 5 layers deep:
 *
 *     inputs ──▶ 16 ──▶ 16 ──▶ 12 ──▶ outputs
 *      (20)     tanh   tanh   tanh     tanh
 *                                        │
 *                       memory ◀─────────┘
 *
 * Two things worth knowing about that shape:
 *
 * 1. The memory loop is what makes mazes solvable at all. A network with no
 *    memory can only react to what it sees right now, and a dead end looks
 *    exactly the same on the way in as on the way out. The last few outputs
 *    are fed back in as inputs on the next tick, so the agent can carry a
 *    little state — "I already tried left" — through time.
 *
 * 2. Depth is not free under evolution. There is no backprop here, so a
 *    mutation to a layer-1 weight has to survive being reshaped by three more
 *    layers before it shows up as behaviour, which makes early progress
 *    slower than a shallow net. It pays off later: the deep brains keep
 *    improving on the big mazes well past the point where a single hidden
 *    layer flattens out. Layer sizes are a config value — set `hiddenLayers`
 *    to [16] in js/app.js and you can watch the difference.
 */

/** Total weights (and biases) needed for a given layer stack. */
function weightCount(layers) {
  let n = 0;
  for (let i = 1; i < layers.length; i++) n += layers[i] * (layers[i - 1] + 1);
  return n;
}

/** Box–Muller: a normally distributed random number, mean 0, stddev 1. */
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Brain {
  /**
   * @param layers  e.g. [20, 16, 16, 12, 5] — inputs, hiddens..., outputs
   * @param weights optional flat Float32Array; random if omitted
   */
  constructor(layers, weights) {
    this.layers = layers;
    this.weights = weights || Brain.randomWeights(layers);
    // Scratch buffers, reused every tick so we are not allocating 60x a second.
    this._act = layers.map(n => new Float32Array(n));
  }

  static randomWeights(layers) {
    const w = new Float32Array(weightCount(layers));
    let k = 0;
    for (let L = 1; L < layers.length; L++) {
      const fanIn = layers[L - 1];
      // Xavier-ish scaling. With five layers this matters: fixed-variance
      // init drives tanh into saturation by layer three and the whole
      // population starts out behaving identically, which gives evolution
      // nothing to select between.
      const scale = Math.sqrt(1 / fanIn);
      for (let j = 0; j < layers[L]; j++) {
        w[k++] = 0;                                    // bias starts neutral
        for (let i = 0; i < fanIn; i++) w[k++] = gaussian() * scale;
      }
    }
    return w;
  }

  /**
   * Run one forward pass. `inputs` must be layers[0] long.
   * Returns the internal output buffer — copy it if you need to keep it.
   */
  forward(inputs) {
    const { layers, weights } = this;
    const act = this._act;
    act[0].set(inputs);

    let w = 0;
    for (let L = 1; L < layers.length; L++) {
      const prev = act[L - 1], cur = act[L];
      const fanIn = layers[L - 1];
      for (let j = 0; j < layers[L]; j++) {
        let sum = weights[w++]; // bias
        for (let i = 0; i < fanIn; i++) sum += weights[w++] * prev[i];
        cur[j] = Math.tanh(sum);
      }
    }
    return act[layers.length - 1];
  }

  clone() {
    return new Brain(this.layers, this.weights.slice());
  }

  /**
   * Uniform crossover: each weight is taken from one parent or the other.
   * Simple, and it works fine at this scale.
   */
  static crossover(a, b) {
    const w = new Float32Array(a.weights.length);
    for (let i = 0; i < w.length; i++) {
      w[i] = Math.random() < 0.5 ? a.weights[i] : b.weights[i];
    }
    return new Brain(a.layers, w);
  }

  /**
   * Mutate in place.
   * @param rate     chance each individual weight is touched
   * @param strength size of a typical nudge
   */
  mutate(rate, strength) {
    const w = this.weights;
    for (let i = 0; i < w.length; i++) {
      if (Math.random() < rate) {
        // Most mutations are small nudges; occasionally throw a weight out
        // entirely, which is how the population escapes a local optimum.
        if (Math.random() < 0.1) w[i] = gaussian() * 0.5;
        else w[i] += gaussian() * strength;
      }
    }
    return this;
  }

  /** e.g. "20→16→16→12→5 (900 weights)" — shown in the UI. */
  describe() {
    return `${this.layers.join('→')} (${this.weights.length} weights)`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Brain, weightCount, gaussian };
}
