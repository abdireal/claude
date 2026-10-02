// The Animations graph. Nodes compile to OptiFine CEM animation expressions,
// written as Entity Model Features (EMF) .jem files that move the vanilla
// body parts of mobs. A small interpreter runs the very same expressions in
// the live preview, so what you see is what the game evaluates.

import { NODE_DEFS } from './nodes.js';
import { defaultParams } from './codegen.js';
import { MOBS, DEG, partNames, restPose, mobByLabel, vanillaPose } from './mobs.js';

export const ANIM_PACK_DIR = 'assets/minecraft/optifine/cem';

// A number as CEM source. Negative numbers get brackets so "a-(-1)" stays valid.
export function lit(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0';
  const s = String(Number(x.toFixed(4)));
  return x < 0 ? `(${s})` : s;
}

// ------------------------------------------------------------------ parser
// Grammar (OptiFine cem_animation.txt): numbers, variables, function calls,
// unary ! and -, and the binary operators || && == != < <= > >= + - * / %.

const OPS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_][\w.:]*)|(\|\||&&|==|!=|<=|>=|[-+*/%<>!(),]))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (!/\S/.test(src.slice(at))) break;
    m = re.exec(src);
    if (!m) throw new Error(`Unexpected "${src.slice(at, at + 8)}"`);
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] });
  }
  return out;
}

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const ease = {
  easeinoutsine: (k) => -(Math.cos(PI_ * k) - 1) / 2,
  easeinsine: (k) => 1 - Math.cos((k * PI_) / 2),
  easeoutsine: (k) => Math.sin((k * PI_) / 2),
  easeinoutquad: (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
  easeinoutcubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  easeoutback: (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
  easeoutbounce: (k) => {
    const n = 7.5625, d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
  easeoutelastic: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * PI_) / 3)) + 1),
  easeinoutexpo: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 2 ** (20 * k - 10) / 2 : (2 - 2 ** (-20 * k + 10)) / 2),
};
const PI_ = Math.PI;
const hash = (x) => {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const keyframe = (loop) => (k, ...v) => {
  if (!v.length) return 0;
  let t = Math.abs(k);
  if (loop) t %= v.length;
  else t = Math.min(t, v.length - 1);
  const i = Math.floor(t);
  const a = v[i], b = v[(i + 1) % v.length];
  return loop || i + 1 < v.length ? a + (b - a) * (t - i) : a;
};

export const CEM_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: (y, x) => Math.atan2(y, x), torad: (d) => d * DEG, todeg: (r) => r / DEG,
  min: Math.min, max: Math.max, clamp, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
  frac: (x) => x - Math.floor(x), log: Math.log, pow: Math.pow, round: Math.round, signum: Math.sign,
  sqrt: Math.sqrt, fmod: (x, y) => x - y * Math.floor(x / y), lerp: (k, x, y) => x + (y - x) * k,
  random: (seed) => hash(seed ?? Math.random() * 1e4),
  between: (x, a, b) => x >= a && x <= b, equals: (x, y, e) => Math.abs(x - y) <= e, in: (x, ...v) => v.includes(x),
  keyframe: keyframe(false), keyframeloop: keyframe(true),
  wrapdeg: (x) => ((((x + 180) % 360) + 360) % 360) - 180,
  wraprad: (x) => ((((x + PI_) % (2 * PI_)) + 2 * PI_) % (2 * PI_)) - PI_,
  ...Object.fromEntries(Object.entries(ease).map(([n, f]) => [n, (k, a, b) => a + (b - a) * f(clamp(k, 0, 1))])),
};
const LAZY = new Set(['if', 'ifb']);

// Parses one expression into a closure (ctx) => value. ctx has params (render
// parameters), pose (part → {tx, rx, …}) and vars (var.* entity variables).
export function parseCem(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => {
    const t = toks[i];
    if (!t || t.v !== v) throw new Error(`Expected "${v}"`);
    i++;
  };
  const binary = (level) => {
    if (level === OPS.length) return unary();
    let left = binary(level + 1);
    while (peek()?.t === 'op' && OPS[level].includes(peek().v)) {
      const op = toks[i++].v;
      const a = left, b = binary(level + 1);
      left = {
        '||': (c) => !!a(c) || !!b(c), '&&': (c) => !!a(c) && !!b(c),
        '==': (c) => a(c) === b(c), '!=': (c) => a(c) !== b(c),
        '<': (c) => a(c) < b(c), '<=': (c) => a(c) <= b(c), '>': (c) => a(c) > b(c), '>=': (c) => a(c) >= b(c),
        '+': (c) => a(c) + b(c), '-': (c) => a(c) - b(c), '*': (c) => a(c) * b(c), '/': (c) => a(c) / b(c), '%': (c) => a(c) % b(c),
      }[op];
    }
    return left;
  };
  const unary = () => {
    const t = peek();
    if (t?.t === 'op' && t.v === '-') { i++; const a = unary(); return (c) => -a(c); }
    if (t?.t === 'op' && t.v === '!') { i++; const a = unary(); return (c) => !a(c); }
    if (t?.t === 'op' && t.v === '+') { i++; return unary(); }
    return primary();
  };
  const primary = () => {
    const t = toks[i++];
    if (!t) throw new Error('Expression ends too early');
    if (t.t === 'num') return () => t.v;
    if (t.t === 'op' && t.v === '(') { const e = binary(0); take(')'); return e; }
    if (t.t !== 'id') throw new Error(`Unexpected "${t.v}"`);
    if (peek()?.v === '(') {
      i++;
      const args = [];
      if (peek()?.v !== ')') {
        for (;;) {
          args.push(binary(0));
          if (peek()?.v === ',') { i++; continue; }
          break;
        }
      }
      take(')');
      if (LAZY.has(t.v)) {
        return (c) => {
          for (let k = 0; k + 1 < args.length; k += 2) if (args[k](c)) return args[k + 1](c);
          return args.length % 2 ? args[args.length - 1](c) : 0;
        };
      }
      const f = CEM_FUNCS[t.v];
      if (!f) throw new Error(`Unknown function ${t.v}()`);
      return (c) => f(...args.map((a) => a(c)));
    }
    return reader(t.v);
  };
  const e = binary(0);
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}"`);
  return e;
}

function reader(name) {
  if (name === 'pi') return () => PI_;
  if (name === 'e') return () => Math.E;
  if (name === 'true') return () => true;
  if (name === 'false') return () => false;
  const dot = name.indexOf('.');
  if (dot < 0) return (c) => c.params[name] ?? 0;
  const head = name.slice(0, dot), tail = name.slice(dot + 1);
  if (head === 'var' || head === 'varb') return (c) => c.vars[tail] ?? 0;
  return (c) => c.pose[head]?.[tail] ?? 0;
}

function writer(key) {
  const dot = key.indexOf('.');
  const head = key.slice(0, dot), tail = key.slice(dot + 1);
  if (head === 'var' || head === 'varb') return (c, v) => { c.vars[tail] = v; };
  return (c, v) => {
    const p = c.pose[head];
    if (p) p[tail] = tail === 'visible' ? !!v : Number(v);
  };
}

// ---------------------------------------------------------------- compiler

function linksTo(graph) {
  return new Map(graph.links.map((l) => [`${l.to.node}:${l.to.port}`, l]));
}

// Builds expressions for one mob's .jem. Nodes that keep state between frames
// (Smooth, Timer) and Vanilla Pose reads become var.* lines that run first.
function makeBuilder(graph, errors) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = linksTo(graph);
  const memo = new Map();
  const vars = [];
  const stack = new Set();
  function expr(nodeId, port) {
    if (!memo.has(nodeId)) {
      const node = nodes.get(nodeId);
      const def = node && NODE_DEFS[node.type];
      if (!def?.cem) {
        errors.push({ node: nodeId, msg: 'This node only works in shader graphs. Use the animation nodes here.' });
        return '0';
      }
      if (stack.has(nodeId)) {
        errors.push({ node: nodeId, msg: 'This node feeds into itself. Break the loop.' });
        return '0';
      }
      stack.add(nodeId);
      const I = {};
      for (const ip of def.inputs) {
        const l = links.get(`${nodeId}:${ip.id}`);
        if (l) I[ip.id] = `(${expr(l.from.node, l.from.port)})`;
        else if (ip.defExpr && node.defaults?.[ip.id] === undefined) I[ip.id] = `(${ip.defExpr})`;
        else I[ip.id] = lit(node.defaults?.[ip.id] ?? ip.def ?? 0);
      }
      stack.delete(nodeId);
      const P = { ...defaultParams(def), ...(node.params || {}) };
      const r = def.cem({ I, P, node, V: `var.bg${nodeId}` });
      const res = typeof r === 'string' ? { out: { [def.outputs[0]?.id || 'out']: r } } : r;
      for (const line of res.set || []) vars.push(line);
      memo.set(nodeId, res.out || {});
    }
    return memo.get(nodeId)[port] ?? '0';
  }
  return { expr, vars, nodes, links };
}

const CHANNELS = [
  { id: 'rx', kind: 'rot' }, { id: 'ry', kind: 'rot' }, { id: 'rz', kind: 'rot' },
  { id: 'tx', kind: 'move', sign: -1 }, { id: 'ty', kind: 'move', sign: -1 }, { id: 'tz', kind: 'move', sign: -1 },
  { id: 'scale', kind: 'scale' }, { id: 'show', kind: 'show' },
];
const BASE = { rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, scale: 1, show: 1 };

// Compiles the whole graph: one ordered list of [variable, expression] per mob.
export function compileAnim(graph) {
  const errors = [];
  const perMob = new Map();
  const sinks = graph.nodes.filter((n) => NODE_DEFS[n.type]?.animSink);
  for (const sink of sinks) {
    const def = NODE_DEFS[sink.type];
    const P = { ...defaultParams(def), ...(sink.params || {}) };
    const mob = mobByLabel(P.mob);
    if (!mob) { errors.push({ node: sink.id, msg: 'Pick a mob.' }); continue; }
    if (!partNames(mob).includes(P.part)) {
      errors.push({ node: sink.id, msg: `${MOBS[mob].label} has no part called "${P.part}". Pick one from the list.` });
      continue;
    }
    if (!perMob.has(mob)) perMob.set(mob, { builder: makeBuilder(graph, errors), sets: [], sinks: [] });
    const m = perMob.get(mob);
    m.sinks.push(sink.id);
    const replace = P.mode === 'Replace vanilla';
    const rest = restPose(mob, P.part);
    const part = P.part;
    for (const ch of CHANNELS) {
      const l = m.builder.links.get(`${sink.id}:${ch.id}`);
      const given = sink.defaults?.[ch.id];
      const active = !!l || (given !== undefined && Number(given) !== BASE[ch.id]);
      const e = l ? `(${m.builder.expr(l.from.node, l.from.port)})` : lit(given ?? BASE[ch.id]);
      if (ch.kind === 'rot') {
        if (replace) m.sets.push([`${part}.${ch.id}`, active ? `${lit(rest[ch.id])}+torad(${e})` : lit(rest[ch.id])]);
        else if (active) m.sets.push([`${part}.${ch.id}`, `${part}.${ch.id}+torad(${e})`]);
      } else if (ch.kind === 'move' && active) {
        // Model space has y pointing down and the mob facing -z, so up, forward
        // and the mob's right are negative there.
        const base = replace ? lit(rest[ch.id]) : `${part}.${ch.id}`;
        m.sets.push([`${part}.${ch.id}`, `${base}-${e}`]);
      } else if (ch.kind === 'scale' && active) {
        for (const ax of ['sx', 'sy', 'sz']) m.sets.push([`${part}.${ax}`, replace ? e : `${part}.${ax}*${e}`]);
      } else if (ch.kind === 'show' && active) {
        m.sets.push([`${part}.visible`, `${e}>0.5`]);
      }
    }
  }
  const mobs = new Map();
  for (const [mob, m] of perMob) {
    const lines = [...m.builder.vars, ...m.sets].map(([k, e]) => [k, e.replace(/\s+/g, '')]);
    mobs.set(mob, { lines, sinks: m.sinks });
  }
  return { mobs, errors };
}

// The expression one node output produces, for its preview curve.
export function nodeExpression(graph, nodeId, port) {
  const errors = [];
  const b = makeBuilder(graph, errors);
  const e = b.expr(nodeId, port);
  return { expr: e, vars: b.vars, errors };
}

// ------------------------------------------------------------------ export

// One .jem per affected model. An empty attached part carries the animations,
// so the game keeps its own geometry and textures.
export function buildEmfFiles(compiled) {
  const files = {};
  for (const [mob, m] of compiled.mobs) {
    if (!m.lines.length) continue;
    const first = Object.keys(MOBS[mob].parts)[0];
    const jem = {
      credit: 'Made with BlockGraph',
      textureSize: [64, 64],
      models: [{
        part: first,
        id: 'blockgraph_animation',
        attach: true,
        animations: [Object.fromEntries(m.lines)],
      }],
    };
    const text = JSON.stringify(jem, null, 2) + '\n';
    for (const f of MOBS[mob].files) files[`${ANIM_PACK_DIR}/${f}.jem`] = text;
  }
  return files;
}

// Checks every exported expression with the parser above.
export function checkCompiled(compiled) {
  const problems = [];
  for (const [mob, m] of compiled.mobs) {
    for (const [k, e] of m.lines) {
      try { parseCem(e); } catch (err) { problems.push(`${mob} ${k}: ${err.message}`); }
    }
  }
  return problems;
}

// ----------------------------------------------------------------- runtime

// Turns compiled lines into a program the preview can run every frame.
export function makeAnimProgram(compiled) {
  const progs = new Map();
  for (const [mob, m] of compiled.mobs) {
    const steps = [];
    for (const [k, e] of m.lines) {
      try { steps.push([writer(k), parseCem(e)]); } catch { /* reported by checkCompiled */ }
    }
    progs.set(mob, steps);
  }
  return {
    has: (mob) => progs.has(mob),
    // params: CEM render parameters; vars: this mob's var.* store.
    run(mob, params, vars) {
      const pose = vanillaPose(mob, params);
      const steps = progs.get(mob);
      if (steps) {
        const c = { params, pose, vars };
        for (const [set, get] of steps) {
          const v = get(c);
          if (typeof v === 'boolean' || Number.isFinite(v)) set(c, v);
        }
      }
      return pose;
    },
  };
}

// A mob in the preview: turns the controls (walk speed, attack, hurt…) into
// the render parameters EMF provides in game.
export class AnimSim {
  constructor() {
    this.limbSwing = 0;
    this.limbSpeed = 0;
    this.age = 0;
    this.attackAt = -1;
    this.hurtAt = -1;
    this.jumpAt = -1;
    this.vars = {};
    this.time = 0;
  }

  attack() { this.attackAt = this.time; }
  hurt() { this.hurtAt = this.time; }
  jump() { this.jumpAt = this.time; }

  // ctl: { walk 0–1, sneak, water, angry, look }
  step(dt, ctl) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const target = ctl.walk * (ctl.sneak ? 0.35 : 1);
    this.limbSpeed += (target - this.limbSpeed) * Math.min(1, dt * 8);
    this.limbSwing += this.limbSpeed * dt * 20 * 1.1;
    this.age += dt * 20;
    const sinceAtk = this.attackAt < 0 ? 99 : this.time - this.attackAt;
    const sinceHurt = this.hurtAt < 0 ? 99 : this.time - this.hurtAt;
    const sinceJump = this.jumpAt < 0 ? 99 : this.time - this.jumpAt;
    const jumpH = sinceJump < 0.6 ? Math.sin((sinceJump / 0.6) * Math.PI) * 1.2 : 0;
    const hurtTime = sinceHurt < 0.5 ? 10 - sinceHurt * 20 : 0;
    const t = this.time;
    this.params = {
      limb_swing: this.limbSwing, limb_speed: this.limbSpeed, age: this.age, time: this.age + 6000,
      frame_time: dt, frame_counter: Math.floor(this.age * 3),
      head_yaw: ctl.look ? Math.sin(t * 0.7) * 35 : 0, head_pitch: ctl.look ? Math.sin(t * 0.45 + 1) * 15 : 0,
      swing_progress: sinceAtk < 0.3 ? sinceAtk / 0.3 : 0,
      hurt_time: hurtTime, death_time: 0, health: hurtTime > 0 ? 14 : 20, max_health: 20, id: 7, rule_index: 0,
      day_time: 6000, day_count: 0, dimension: 0, distance: 4, height_above_ground: jumpH,
      move_forward: this.limbSpeed > 0.05 ? 1 : 0, move_strafing: 0,
      is_on_ground: jumpH <= 0, is_jumping: jumpH > 0, is_in_water: !!ctl.water, is_wet: !!ctl.water,
      is_sneaking: !!ctl.sneak, is_sprinting: this.limbSpeed > 0.85, is_aggressive: !!ctl.angry,
      is_hurt: hurtTime > 0, is_alive: true, is_child: false, is_riding: false, is_ridden: false, is_burning: false,
      is_swimming: false, is_climbing: false, is_blocking: false, is_using_item: false, is_invisible: false,
      is_holding_item_right: false, is_holding_item_left: false, is_sitting: false, is_tamed: false, is_glowing: false,
      is_in_lava: false, is_in_gui: false, is_on_head: false, is_in_hand: false, is_in_item_frame: false,
      is_swinging_right_arm: sinceAtk < 0.3, is_swinging_left_arm: false, is_first_person_hand: false, is_paused: false,
    };
    this.jumpHeight = jumpH;
    return this.params;
  }
}

// Samples a node's value over a short scripted clip (walk, attack, hurt) for
// the curve drawn on the node.
export function sampleNode(graph, nodeId, port, seconds = 4, rate = 30) {
  const { expr, vars, errors } = nodeExpression(graph, nodeId, port);
  if (errors.length) return { error: errors[0].msg };
  let get;
  const sets = [];
  try {
    get = parseCem(expr);
    for (const [k, e] of vars) sets.push([writer(k), parseCem(e)]);
  } catch (err) {
    return { error: err.message };
  }
  const sim = new AnimSim();
  const store = {};
  const values = [];
  const dt = 1 / rate;
  for (let f = 0; f < seconds * rate; f++) {
    const t = f * dt;
    if (Math.abs(t - 2.0) < dt / 2) sim.attack();
    if (Math.abs(t - 3.0) < dt / 2) sim.hurt();
    const params = sim.step(dt, { walk: t < 1.5 ? t / 1.5 : 1, look: true });
    const c = { params, pose: vanillaPose('zombie', params), vars: store };
    for (const [set, g] of sets) set(c, g(c));
    const v = Number(get(c));
    values.push(Number.isFinite(v) ? v : 0);
  }
  return { values };
}
