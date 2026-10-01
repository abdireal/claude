// Turns a node graph into GLSL statements, the same way Unity's Shader Graph
// turns its graph into HLSL. One pass per stage: the vertex stage only follows
// the wires that reach "Vertex Offset", the fragment stage follows the rest.

import { NODE_DEFS, TYPE_RANK, BINDS } from './nodes.js';

export const GLSL_TYPES = ['float', 'vec2', 'vec3', 'vec4'];

export function literal(type, v) {
  const f = (x) => {
    let n = Number(x);
    if (!Number.isFinite(n)) n = 0;
    let s = String(Math.round(n * 1e6) / 1e6);
    if (!/[.eE]/.test(s)) s += '.0';
    return s;
  };
  const arr = Array.isArray(v) ? v : [v];
  const size = TYPE_RANK[type] || 1;
  if (size === 1) return f(arr[0]);
  const parts = [];
  for (let i = 0; i < size; i++) parts.push(f(arr[i] !== undefined ? arr[i] : (i === 3 ? 1 : arr.length === 1 ? arr[0] : 0)));
  return `${type}(${parts.join(', ')})`;
}

export function typeOfValue(v) {
  if (Array.isArray(v)) return GLSL_TYPES[Math.min(Math.max(v.length, 1), 4) - 1];
  return 'float';
}

export function widest(a, b) {
  return (TYPE_RANK[a] || 1) >= (TYPE_RANK[b] || 1) ? a : b;
}

// Converts an expression from one GLSL type to another.
export function cast(expr, from, to) {
  if (from === to) return expr;
  const s = TYPE_RANK[from];
  const t = TYPE_RANK[to];
  if (s === 1) return `${to}(${expr})`;
  if (t === 1) return `(${expr}).x`;
  if (t < s) return `(${expr}).${'xyzw'.slice(0, t)}`;
  // widen
  if (s === 2 && t === 3) return `vec3(${expr}, 0.0)`;
  if (s === 2 && t === 4) return `vec4(${expr}, 0.0, 1.0)`;
  if (s === 3 && t === 4) return `vec4(${expr}, 1.0)`;
  return expr;
}

export const varName = (nodeId, port) => `n${nodeId}_${port}`;

function indexLinks(graph) {
  const byTarget = new Map();
  for (const l of graph.links) byTarget.set(`${l.to.node}:${l.to.port}`, l);
  return byTarget;
}

// Infers the concrete type of every port in the graph, so wires and dots can be
// coloured even for nodes that are not connected to the output yet.
export function inferTypes(graph, kind) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = indexLinks(graph);
  const memo = new Map();
  const visiting = new Set();

  function resolve(id) {
    if (memo.has(id)) return memo.get(id);
    const node = nodes.get(id);
    const def = node && NODE_DEFS[node.type];
    if (!def) return { in: {}, out: {}, T: 'float' };
    if (visiting.has(id)) return { in: {}, out: {}, T: 'float' };
    visiting.add(id);
    const raw = {};
    for (const p of def.inputs) {
      const l = links.get(`${id}:${p.id}`);
      if (l) {
        const src = resolve(l.from.node);
        raw[p.id] = src.out[l.from.port] || 'float';
      } else if (p.bind) {
        raw[p.id] = BINDS[kind]?.[p.bind]?.type || p.type;
      } else if (p.type === 'dyn' || p.type === 'dynOrFloat') {
        raw[p.id] = typeOfValue(node.defaults?.[p.id] ?? p.def);
      } else raw[p.id] = p.type;
    }
    let T = 'float';
    for (const p of def.inputs) if (p.type === 'dyn') T = widest(T, raw[p.id]);
    const ins = {};
    for (const p of def.inputs) {
      ins[p.id] = p.type === 'dyn' ? T : p.type === 'dynOrFloat' ? (raw[p.id] === 'float' ? 'float' : T) : p.type;
    }
    const outs = {};
    for (const o of def.outputs) outs[o.id] = o.type === 'dyn' ? T : o.type;
    visiting.delete(id);
    const r = { in: ins, out: outs, T };
    memo.set(id, r);
    return r;
  }
  for (const n of graph.nodes) resolve(n.id);
  return memo;
}

// Compiles one stage of one graph.
// Returns { lines, outputs: {portId: expr}, errors: [{node, msg}], settings: Map, used: Set }
export function compileStage(graph, kind, stage) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = indexLinks(graph);
  const lines = [];
  const errors = [];
  const settings = new Map();
  const emitted = new Map();
  const visiting = new Set();
  const used = new Set();

  const outNode = graph.nodes.find((n) => NODE_DEFS[n.type]?.isOutput && NODE_DEFS[n.type].graphs.includes(kind));
  if (!outNode) {
    errors.push({ node: null, msg: 'This graph has no output node.' });
    return { lines, outputs: {}, errors, settings, used };
  }

  function rawInput(node, def, p) {
    const l = links.get(`${node.id}:${p.id}`);
    if (l && nodes.has(l.from.node)) {
      const src = visit(l.from.node);
      if (!src) return { expr: literal('float', 0), type: 'float' };
      const t = src.types[l.from.port];
      if (!t) return { expr: literal('float', 0), type: 'float' };
      return { expr: varName(l.from.node, l.from.port), type: t };
    }
    if (p.bind) {
      const b = BINDS[kind]?.[p.bind];
      if (b) {
        if (b.fragOnly && stage === 'vertex') {
          errors.push({ node: node.id, msg: `"${p.name}" uses the block texture, which only exists for pixels, not for Vertex Offset.` });
          return { expr: literal(p.type, 0), type: p.type };
        }
        return { expr: b.expr, type: b.type };
      }
    }
    const v = node.defaults?.[p.id] ?? p.def ?? 0;
    const t = p.type === 'dyn' || p.type === 'dynOrFloat' ? typeOfValue(v) : p.type;
    return { expr: literal(t, v), type: t };
  }

  function resolveInputs(node, def, ports) {
    const raw = {};
    for (const p of ports) raw[p.id] = rawInput(node, def, p);
    let T = 'float';
    for (const p of ports) if (p.type === 'dyn') T = widest(T, raw[p.id].type);
    const I = {};
    for (const p of ports) {
      let target = p.type;
      if (p.type === 'dyn') target = T;
      else if (p.type === 'dynOrFloat') target = raw[p.id].type === 'float' ? 'float' : T;
      I[p.id] = cast(raw[p.id].expr, raw[p.id].type, target);
    }
    return { I, T };
  }

  function visit(id) {
    if (emitted.has(id)) return emitted.get(id);
    if (visiting.has(id)) {
      errors.push({ node: id, msg: 'This node is part of a loop. Wires must not lead back into themselves.' });
      return null;
    }
    const node = nodes.get(id);
    const def = node && NODE_DEFS[node.type];
    if (!def) {
      errors.push({ node: id, msg: `Unknown node type "${node?.type}".` });
      return null;
    }
    visiting.add(id);
    used.add(id);
    if (def.graphs && !def.graphs.includes(kind)) {
      errors.push({ node: id, msg: `${def.title} can't be used in this graph.` });
    }
    if (def.fragOnly && stage === 'vertex') {
      errors.push({ node: id, msg: `${def.title} only exists for pixels, so it can't feed Vertex Offset.` });
    }
    const { I, T } = resolveInputs(node, def, def.inputs);
    const V = `n${id}_`;
    const params = { ...defaultParams(def), ...(node.params || {}) };
    let res;
    try {
      res = def.gen({ I, P: params, T, V, kind, stage, settings, node, lit: literal });
    } catch (e) {
      errors.push({ node: id, msg: `Could not build ${def.title}: ${e.message}` });
      res = { out: {} };
    }
    const outs = typeof res === 'string' ? { out: res } : res.out || {};
    if (res && res.pre) lines.push(res.pre);
    const types = {};
    for (const o of def.outputs) {
      const t = o.type === 'dyn' ? T : o.type;
      types[o.id] = t;
      lines.push(`${t} ${varName(id, o.id)} = ${outs[o.id] ?? literal(t, 0)};`);
    }
    visiting.delete(id);
    const info = { types };
    emitted.set(id, info);
    return info;
  }

  const outDef = NODE_DEFS[outNode.type];
  const ports = outDef.inputs.filter((p) => (p.stage || 'fragment') === stage);
  const { I } = resolveInputs(outNode, outDef, ports);
  used.add(outNode.id);
  return { lines, outputs: I, errors, settings, used, outNode, outParams: { ...defaultParams(outDef), ...(outNode.params || {}) } };
}

export function defaultParams(def) {
  const p = {};
  for (const prm of def.params || []) p[prm.id] = prm.def;
  return p;
}

// Collects every setting node in both graphs, so the Iris menu and the preview
// uniforms agree even for settings that are not wired up yet.
export function collectSettings(graphs) {
  const map = new Map();
  const problems = [];
  for (const kind of Object.keys(graphs)) {
    for (const n of graphs[kind].nodes) {
      const def = NODE_DEFS[n.type];
      if (!def?.setting) continue;
      const P = { ...defaultParams(def), ...(n.params || {}) };
      const prev = map.get(P.name);
      if (prev && (prev.kind !== def.setting || prev.value !== P.value)) {
        problems.push({ node: n.id, msg: `Two settings share the ID ${P.name} but have different values. Give one a new Setting ID.` });
        continue;
      }
      map.set(P.name, { kind: def.setting, ...P, node: n.id, graph: kind });
    }
  }
  return { settings: map, problems };
}
