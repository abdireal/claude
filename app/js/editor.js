// The node canvas: draws nodes and wires, and handles dragging, connecting,
// panning, zooming and selection. It edits the graph object it was given and
// reports every change back to the app.

import { NODE_DEFS, BINDS, rgbToHex, hexToLinear, normStops, swizzleMask, allowedIn } from './nodes.js';
import { inferTypes, defaultParams } from './codegen.js';
import { previewableNode, choiceOptions, choiceIndex } from './targets.js';

export const HEAD = 34;
export const ROW = 26;
export const PAD = 6;
const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

export function nodeWidth(node) {
  return NODE_DEFS[node.type]?.width || 180;
}

export class GraphEditor {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.view = { x: 0, y: 0, z: 1 };
    this.selection = new Set();
    this.selectedLink = null;
    this.errorNodes = new Map();
    this.world = el('div', 'world');
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'wires');
    this.svg.setAttribute('aria-hidden', 'true');
    this.layer = el('div', 'nodes-layer');
    this.world.append(this.svg, this.layer);
    this.marquee = el('div', 'marquee');
    this.marquee.hidden = true;
    root.append(this.world, this.marquee);
    this.bind();
  }

  // ------------------------------------------------------------ model access

  load(graph, kind, view) {
    this.graph = graph;
    this.kind = kind;
    if (view) this.view = view;
    this.selection.clear();
    this.selectedLink = null;
    this.render();
    this.applyView();
  }

  node(id) {
    return this.graph.nodes.find((n) => n.id === id);
  }

  linkInto(nodeId, portId) {
    return this.graph.links.find((l) => l.to.node === nodeId && l.to.port === portId);
  }

  addNode(type, x, y, extra = {}) {
    const def = NODE_DEFS[type];
    if (!def) return null;
    const node = { id: this.graph.nextId++, type, x: Math.round(x), y: Math.round(y), params: defaultParams(def), defaults: {}, ...extra };
    if (def.setting) node.params.name = this.uniqueSettingName(node.params.name);
    if (def.texturePicker && !node.params.tex) node.params.tex = this.opts.defaultTexture?.(this.kind) || '';
    this.graph.nodes.push(node);
    return node;
  }

  uniqueSettingName(base) {
    const taken = new Set(this.opts.allSettingNames ? this.opts.allSettingNames() : []);
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }

  connect(from, to) {
    if (from.node === to.node) return false;
    if (this.reaches(to.node, from.node)) {
      this.opts.toast?.('That wire would make a loop, so it was not added.');
      return false;
    }
    this.graph.links = this.graph.links.filter((l) => !(l.to.node === to.node && l.to.port === to.port));
    this.graph.links.push({ id: this.graph.nextId++, from: { ...from }, to: { ...to } });
    return true;
  }

  // Is `target` reachable by following wires forward from `start`?
  reaches(start, target) {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const l of this.graph.links) if (l.from.node === id) stack.push(l.to.node);
    }
    return false;
  }

  deleteSelection() {
    if (this.selectedLink != null) {
      this.graph.links = this.graph.links.filter((l) => l.id !== this.selectedLink);
      this.selectedLink = null;
      this.changed(true);
      return true;
    }
    const ids = [...this.selection].filter((id) => !NODE_DEFS[this.node(id)?.type]?.isOutput);
    if (!ids.length) {
      if (this.selection.size) this.opts.toast?.('The output node stays. Every graph needs one.');
      return false;
    }
    const set = new Set(ids);
    this.graph.nodes = this.graph.nodes.filter((n) => !set.has(n.id));
    this.graph.links = this.graph.links.filter((l) => !set.has(l.from.node) && !set.has(l.to.node));
    this.selection.clear();
    this.changed(true);
    return true;
  }

  copySelection() {
    const ids = new Set([...this.selection].filter((id) => !NODE_DEFS[this.node(id)?.type]?.isOutput));
    if (!ids.size) return null;
    const nodes = this.graph.nodes.filter((n) => ids.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)));
    const links = this.graph.links.filter((l) => ids.has(l.from.node) && ids.has(l.to.node)).map((l) => JSON.parse(JSON.stringify(l)));
    return { kind: this.kind, nodes, links };
  }

  paste(clip, offset = 40) {
    if (!clip || !clip.nodes?.length) return;
    const map = new Map();
    this.selection.clear();
    for (const n of clip.nodes) {
      const def = NODE_DEFS[n.type];
      if (!def || !allowedIn(def, this.kind)) continue;
      const copy = { ...JSON.parse(JSON.stringify(n)), id: this.graph.nextId++, x: n.x + offset, y: n.y + offset };
      if (def.setting) copy.params.name = this.uniqueSettingName(copy.params.name);
      map.set(n.id, copy.id);
      this.graph.nodes.push(copy);
      this.selection.add(copy.id);
    }
    for (const l of clip.links) {
      if (map.has(l.from.node) && map.has(l.to.node)) {
        this.graph.links.push({ id: this.graph.nextId++, from: { node: map.get(l.from.node), port: l.from.port }, to: { node: map.get(l.to.node), port: l.to.port } });
      }
    }
    this.changed(true);
  }

  changed(structural) {
    if (structural) this.render();
    this.opts.onChange?.({ structural });
  }

  setErrors(list) {
    this.errorNodes = new Map();
    for (const e of list) if (e.node != null) this.errorNodes.set(e.node, e.msg);
    for (const elx of this.layer.children) {
      const id = Number(elx.dataset.id);
      const msg = this.errorNodes.get(id);
      elx.classList.toggle('has-error', !!msg);
      const badge = elx.querySelector('.node-error');
      if (badge) {
        badge.hidden = !msg;
        badge.title = msg || '';
      }
    }
  }

  // --------------------------------------------------------------- geometry

  portPos(node, dir, portId) {
    const def = NODE_DEFS[node.type];
    const list = dir === 'in' ? def.inputs : def.outputs;
    const idx = Math.max(0, list.findIndex((p) => p.id === portId));
    const y = node.y + HEAD + PAD + idx * ROW + ROW / 2;
    const x = dir === 'in' ? node.x : node.x + nodeWidth(node);
    return [x, y];
  }

  toWorld(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return [(clientX - r.left - this.view.x) / this.view.z, (clientY - r.top - this.view.y) / this.view.z];
  }

  center() {
    const r = this.root.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const g = 24 * z;
    this.root.style.backgroundSize = `${g}px ${g}px, ${g * 5}px ${g * 5}px, ${g * 5}px ${g * 5}px`;
    this.root.style.backgroundPosition = `${x}px ${y}px`;
    this.opts.onView?.(this.view);
  }

  frameAll(animate = false, padLeft = 0) {
    const ns = this.graph.nodes;
    if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const elx = this.layer.querySelector(`[data-id="${n.id}"]`);
      const h = elx ? elx.offsetHeight : 120;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + nodeWidth(n));
      y1 = Math.max(y1, n.y + h);
    }
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 48;
    const usable = padLeft && r.width - padLeft > 360 ? padLeft : 0;
    const z = Math.max(0.3, Math.min(1.1, Math.min((r.width - usable - pad * 2) / (x1 - x0), (r.height - pad * 2 - 40) / (y1 - y0))));
    this.view.z = z;
    this.view.x = usable + (r.width - usable - (x1 - x0) * z) / 2 - x0 * z;
    this.view.y = 20 + (r.height - 40 - (y1 - y0) * z) / 2 - y0 * z;
    this.world.classList.toggle('animate', animate);
    this.applyView();
    if (animate) setTimeout(() => this.world.classList.remove('animate'), 260);
  }

  // Pushes nodes down until none overlap. Used after loading a preset, since
  // node previews make nodes taller than the preset layouts assume.
  resolveOverlaps(gap = 20) {
    const els = new Map([...this.layer.children].map((e) => [Number(e.dataset.id), e]));
    const boxes = this.graph.nodes.map((n) => ({ n, w: nodeWidth(n), h: els.get(n.id)?.offsetHeight || 100 }));
    boxes.sort((a, b) => a.n.y - b.n.y || a.n.x - b.n.x);
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      for (let pass = 0; pass < boxes.length; pass++) {
        let bumped = false;
        for (let j = 0; j < i; j++) {
          const a = boxes[j];
          const xOverlap = a.n.x < b.n.x + b.w + 8 && b.n.x < a.n.x + a.w + 8;
          const yOverlap = b.n.y < a.n.y + a.h + gap && b.n.y + b.h > a.n.y;
          if (xOverlap && yOverlap) {
            b.n.y = Math.round(a.n.y + a.h + gap);
            bumped = moved = true;
          }
        }
        if (!bumped) break;
      }
    }
    if (moved) this.updateNodePositions(this.graph.nodes.map((n) => n.id));
    return moved;
  }

  zoomBy(f, cx, cy) {
    const r = this.root.getBoundingClientRect();
    const mx = cx ?? r.width / 2;
    const my = cy ?? r.height / 2;
    const z = Math.max(0.3, Math.min(2, this.view.z * f));
    const wx = (mx - this.view.x) / this.view.z;
    const wy = (my - this.view.y) / this.view.z;
    this.view.x = mx - wx * z;
    this.view.y = my - wy * z;
    this.view.z = z;
    this.applyView();
  }

  // -------------------------------------------------------------- rendering

  render() {
    if (!this.graph) return;
    this.types = inferTypes(this.graph, this.kind);
    this.layer.textContent = '';
    for (const n of this.graph.nodes) this.layer.append(this.renderNode(n));
    this.renderLinks();
    this.setErrors([...this.errorNodes].map(([node, msg]) => ({ node, msg })));
    this.opts.onRendered?.();
  }

  renderNode(n) {
    const def = NODE_DEFS[n.type];
    const t = this.types.get(n.id) || { in: {}, out: {} };
    const box = el('div', `node cat-${(def?.cat || 'Math').toLowerCase()}`);
    box.dataset.id = n.id;
    box.style.width = nodeWidth(n) + 'px';
    box.style.transform = `translate(${n.x}px, ${n.y}px)`;
    if (this.selection.has(n.id)) box.classList.add('selected');
    if (def?.isOutput) box.classList.add('is-output');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', def ? def.title : n.type);

    if (def?.isNote) return this.renderNote(n, box);

    const head = el('div', 'node-head');
    const title = el('span', 'node-title', def ? def.title : `Unknown: ${n.type}`);
    head.append(title);
    if (def?.setting) {
      const chip = el('span', 'node-chip', 'Iris');
      chip.title = 'Shows up in Iris → Shader Settings';
      head.append(chip);
    }
    const err = el('span', 'node-error', '!');
    err.hidden = true;
    head.append(err);
    box.append(head);
    if (!def) return box;

    const rows = el('div', 'node-rows');
    const count = Math.max(def.inputs.length, def.outputs.length);
    for (let i = 0; i < count; i++) {
      const row = el('div', 'node-row');
      const ip = def.inputs[i];
      const op = def.outputs[i];
      if (ip) row.append(this.renderInput(n, def, ip, t.in[ip.id]));
      else row.append(el('span'));
      if (op) {
        const port = el('div', `port out t-${t.out[op.id] || op.type}`);
        if (this.graph.links.some((l) => l.from.node === n.id && l.from.port === op.id)) port.classList.add('connected');
        port.dataset.port = op.id;
        port.dataset.dir = 'out';
        port.title = `${op.name} (${t.out[op.id] || op.type})`;
        port.append(el('span', 'port-label', op.name), el('span', 'dot'));
        row.append(port);
      }
      rows.append(row);
    }
    box.append(rows);

    const controls = this.renderControls(n, def);
    if (controls) box.append(controls);
    if (this.opts.showPreviews?.() && previewableNode(def)) {
      const c = el('canvas', 'node-preview');
      c.width = 160;
      c.height = 96;
      c.setAttribute('aria-hidden', 'true');
      box.append(c);
    }
    return box;
  }

  renderNote(n, box) {
    box.classList.add('note');
    const head = el('div', 'node-head');
    head.append(el('span', 'node-title', 'Note'));
    const ta = el('textarea', 'note-text');
    ta.value = n.params?.text ?? '';
    ta.rows = 4;
    ta.setAttribute('aria-label', 'Sticky note text');
    ta.addEventListener('change', () => {
      n.params = n.params || {};
      n.params.text = ta.value;
      this.opts.onChange?.({ structural: false, commit: true, moved: true });
    });
    box.append(head, ta);
    return box;
  }

  renderInput(n, def, ip, type) {
    const port = el('div', `port in t-${type || ip.type}`);
    port.dataset.port = ip.id;
    port.dataset.dir = 'in';
    port.title = `${ip.name} (${type || ip.type})`;
    if (ip.stage === 'vertex') port.classList.add('vertex');
    port.append(el('span', 'dot'), el('span', 'port-label', ip.name));
    const linked = this.linkInto(n.id, ip.id);
    if (linked) port.classList.add('connected');
    if (!linked) {
      if (ip.bind) {
        const b = BINDS[this.kind]?.[ip.bind];
        if (b) port.append(el('span', 'port-hint', b.label));
      } else if (ip.defLabel) {
        port.append(el('span', 'port-hint', ip.defLabel));
      } else {
        const v = n.defaults?.[ip.id] ?? ip.def;
        const isFloat = !Array.isArray(v) && (ip.type === 'float' || ip.type === 'dyn' || ip.type === 'dynOrFloat');
        if (isFloat) {
          const input = el('input', 'inline-num');
          input.type = 'number';
          input.step = '0.05';
          input.value = fmt(v);
          input.setAttribute('aria-label', `${def.title} ${ip.name}`);
          input.addEventListener('change', () => {
            n.defaults = n.defaults || {};
            n.defaults[ip.id] = Number(input.value) || 0;
            this.opts.onChange?.({ structural: false, commit: true });
          });
          port.append(input);
        } else if (ip.color) {
          const c = el('input', 'inline-color');
          c.type = 'color';
          c.value = rgbToHex(Array.isArray(v) ? v : [v, v, v]);
          c.setAttribute('aria-label', `${def.title} ${ip.name}`);
          c.addEventListener('input', () => {
            n.defaults = n.defaults || {};
            n.defaults[ip.id] = hexToLinear(c.value);
            this.opts.onChange?.({ structural: false });
          });
          c.addEventListener('change', () => this.opts.onChange?.({ structural: false, commit: true }));
          port.append(c);
        } else if (ip.stage !== 'vertex') {
          port.append(el('span', 'port-hint', Array.isArray(v) ? `(${v.map(fmt).join(', ')})` : fmt(v)));
        }
      }
    }
    return port;
  }

  renderControls(n, def) {
    const visible = def.params.filter((p) => !['label', 'min', 'max', 'step'].includes(p.id) || !def.setting);
    if (!visible.length) return null;
    const wrap = el('div', 'node-controls');
    const P = { ...defaultParams(def), ...(n.params || {}) };
    const commit = (live) => this.opts.onChange?.({ structural: false, commit: !live, param: true, node: n.id });

    if (def.setting === 'slider') {
      const label = el('div', 'ctl-setting');
      label.append(el('span', 'ctl-id', P.name), el('span', 'ctl-val', fmt(P.value)));
      const range = el('input', 'ctl-range');
      range.type = 'range';
      range.min = P.min;
      range.max = P.max;
      range.step = P.step || 0.01;
      range.value = P.value;
      range.setAttribute('aria-label', P.label || P.name);
      range.addEventListener('input', () => {
        n.params.value = Number(range.value);
        label.querySelector('.ctl-val').textContent = fmt(range.value);
        commit(true);
      });
      range.addEventListener('change', () => commit(false));
      wrap.append(label, range);
      return wrap;
    }
    if (def.setting === 'choice') {
      const s = el('select', 'ctl-select');
      s.setAttribute('aria-label', P.label || P.name);
      choiceOptions(P).forEach((o, i) => {
        const opt = el('option', null, o);
        opt.value = String(i);
        s.append(opt);
      });
      s.value = String(choiceIndex(P));
      s.addEventListener('change', () => {
        n.params.value = Number(s.value);
        commit(false);
      });
      const id = el('div', 'ctl-setting');
      id.append(el('span', 'ctl-id', P.name));
      wrap.append(id, s);
      return wrap;
    }
    if (def.setting === 'toggle') {
      const row = el('label', 'ctl-switch');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!P.value;
      cb.addEventListener('change', () => {
        n.params.value = cb.checked;
        commit(false);
      });
      row.append(cb, el('span', 'switch'), el('span', 'ctl-id', P.name));
      wrap.append(row);
      return wrap;
    }
    for (const p of visible) {
      if (p.kind === 'number') {
        const input = el('input', 'ctl-num');
        input.type = 'number';
        input.step = p.step || 0.05;
        input.value = fmt(P[p.id]);
        input.setAttribute('aria-label', p.name);
        input.addEventListener('change', () => {
          n.params[p.id] = Number(input.value) || 0;
          commit(false);
        });
        wrap.append(input);
      } else if (p.kind === 'color') {
        const c = el('input', 'ctl-color');
        c.type = 'color';
        c.value = P[p.id];
        c.setAttribute('aria-label', p.name);
        c.addEventListener('input', () => {
          n.params[p.id] = c.value;
          commit(true);
        });
        c.addEventListener('change', () => commit(false));
        const hexLabel = el('span', 'ctl-hex', P[p.id]);
        c.addEventListener('input', () => { hexLabel.textContent = c.value; });
        const row = el('div', 'ctl-color-row');
        row.append(c, hexLabel);
        wrap.append(row);
      } else if (p.kind === 'select') {
        const s = el('select', 'ctl-select');
        s.setAttribute('aria-label', p.name);
        // Options can depend on other params (an Animate Part's parts follow its mob).
        for (const o of typeof p.options === 'function' ? p.options(P) : p.options) {
          const opt = el('option', null, o);
          opt.value = o;
          s.append(opt);
        }
        s.value = P[p.id];
        s.addEventListener('change', () => {
          n.params[p.id] = s.value;
          if (def.onParamChange) {
            def.onParamChange(n.params, p.id);
            this.render();
          }
          commit(false);
        });
        const row = el('label', 'ctl-select-row');
        row.append(el('span', null, p.name), s);
        wrap.append(row);
      } else if (p.kind === 'bool') {
        const row = el('label', 'ctl-switch');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!P[p.id];
        cb.addEventListener('change', () => {
          n.params[p.id] = cb.checked;
          commit(false);
        });
        row.append(cb, el('span', 'switch'), el('span', null, p.name));
        wrap.append(row);
      } else if (p.kind === 'text') {
        const input = el('input', 'ctl-num ctl-text');
        input.value = P[p.id];
        input.spellcheck = false;
        input.setAttribute('aria-label', p.name);
        input.addEventListener('change', () => {
          n.params[p.id] = input.value;
          commit(false);
        });
        const row = el('label', 'ctl-select-row');
        row.append(el('span', null, p.name), input);
        wrap.append(row);
      } else if (p.kind === 'swizzle') {
        const input = el('input', 'ctl-num');
        input.value = P[p.id];
        input.maxLength = 4;
        input.spellcheck = false;
        input.setAttribute('aria-label', p.name);
        input.addEventListener('change', () => {
          n.params[p.id] = swizzleMask(input.value);
          input.value = n.params[p.id];
          this.changed(true);
          this.opts.onChange?.({ structural: true, commit: true });
        });
        const row = el('label', 'ctl-select-row');
        row.append(el('span', null, p.name), input);
        wrap.append(row);
      } else if (p.kind === 'gradient') {
        const stops = normStops(P[p.id]);
        const strip = el('div', 'ctl-gradient');
        const hard = (P.mode === 'fixed');
        strip.style.background = `linear-gradient(90deg, ${stops.map((st, i) => {
          if (!hard || i === 0) return `${st.c} ${st.t * 100}%`;
          return `${stops[i - 1].c} ${st.t * 100}%, ${st.c} ${st.t * 100}%`;
        }).join(', ')})`;
        strip.title = 'Edit the stops in the inspector';
        wrap.append(strip);
      } else if (p.kind === 'texture') {
        const sel = el('select', 'ctl-select');
        sel.setAttribute('aria-label', p.name);
        const none = el('option', null, 'Choose a texture…');
        none.value = '';
        sel.append(none);
        for (const t of this.opts.textureList?.(this.kind) || []) {
          const opt = el('option', null, t.name);
          opt.value = t.id;
          sel.append(opt);
        }
        sel.value = P[p.id] || '';
        sel.addEventListener('change', () => {
          n.params[p.id] = sel.value;
          commit(false);
        });
        wrap.append(sel);
      } else if (p.kind === 'code') {
        const first = String(P[p.id] || '').split('\n').find((l) => l.trim() && !l.trim().startsWith('//')) || '';
        const code = el('code', 'ctl-code', first || '(empty)');
        code.title = 'Edit the code in the inspector';
        wrap.append(code);
      }
    }
    return wrap.children.length ? wrap : null;
  }

  renderLinks() {
    const svg = this.svg;
    svg.textContent = '';
    for (const l of this.graph.links) {
      const a = this.node(l.from.node);
      const b = this.node(l.to.node);
      if (!a || !b) continue;
      const type = this.types?.get(a.id)?.out[l.from.port] || 'float';
      const d = this.wirePath(this.portPos(a, 'out', l.from.port), this.portPos(b, 'in', l.to.port));
      const g = document.createElementNS(SVGNS, 'g');
      g.dataset.link = l.id;
      const hit = document.createElementNS(SVGNS, 'path');
      hit.setAttribute('class', 'wire-hit');
      hit.setAttribute('d', d);
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', `wire t-${type}${this.selectedLink === l.id ? ' selected' : ''}`);
      p.setAttribute('d', d);
      g.append(hit, p);
      svg.append(g);
    }
    if (this.temp) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', `wire temp t-${this.temp.type}`);
      p.setAttribute('d', this.temp.from ? this.wirePath(this.temp.a, this.temp.b) : this.wirePath(this.temp.b, this.temp.a));
      svg.append(p);
    }
  }

  wirePath([x1, y1], [x2, y2]) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  updateNodePositions(ids) {
    for (const id of ids) {
      const n = this.node(id);
      const elx = this.layer.querySelector(`[data-id="${id}"]`);
      if (n && elx) elx.style.transform = `translate(${n.x}px, ${n.y}px)`;
    }
    this.renderLinks();
  }

  refreshSelection() {
    for (const elx of this.layer.children) elx.classList.toggle('selected', this.selection.has(Number(elx.dataset.id)));
    this.renderLinks();
    this.opts.onSelect?.();
  }

  select(ids, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.selectedLink = null;
    this.refreshSelection();
  }

  // ------------------------------------------------------------------ input

  bind() {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', (e) => this.onUp(e, true));
    root.addEventListener('wheel', (e) => {
      if (e.target.closest('input, select')) return;
      e.preventDefault();
      const r = root.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1) {
        this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        this.view.x -= e.deltaX;
        this.view.y -= e.deltaY;
        this.applyView();
      }
    }, { passive: false });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = e.target.closest('.wire-hit');
      if (hit) {
        const id = Number(hit.parentNode.dataset.link);
        this.graph.links = this.graph.links.filter((l) => l.id !== id);
        this.changed(true);
        return;
      }
      if (!e.target.closest('.node')) {
        const [x, y] = this.toWorld(e.clientX, e.clientY);
        this.opts.onRequestSearch?.({ clientX: e.clientX, clientY: e.clientY, x, y });
      }
    });
    root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.node')) return;
      const [x, y] = this.toWorld(e.clientX, e.clientY);
      this.opts.onRequestSearch?.({ clientX: e.clientX, clientY: e.clientY, x, y });
    });
    root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('application/x-blockgraph-node')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    root.addEventListener('drop', (e) => {
      const type = e.dataTransfer?.getData('application/x-blockgraph-node');
      if (!type) return;
      e.preventDefault();
      const [x, y] = this.toWorld(e.clientX, e.clientY);
      const n = this.addNode(type, x - 20, y - 14);
      if (n) {
        this.selection = new Set([n.id]);
        this.changed(true);
        this.opts.onSelect?.();
      }
    });
  }

  onDown(e) {
    if (e.button === 2) return;
    const target = e.target;
    if (target.closest('input, select, textarea, button, .ctl-switch')) return;
    this.root.focus({ preventScroll: true });
    const port = target.closest('.port');
    const nodeEl = target.closest('.node');
    const wire = target.closest('.wire-hit');
    this.downAt = [e.clientX, e.clientY];
    this.moved = false;

    if (port && nodeEl && e.button === 0) {
      const id = Number(nodeEl.dataset.id);
      const node = this.node(id);
      const dir = port.dataset.dir;
      const portId = port.dataset.port;
      const types = this.types.get(id) || { in: {}, out: {} };
      if (dir === 'out') {
        const a = this.portPos(node, 'out', portId);
        this.temp = { from: { node: id, port: portId }, a, b: a, type: types.out[portId] || 'float' };
      } else {
        const existing = this.linkInto(id, portId);
        if (existing) {
          this.graph.links = this.graph.links.filter((l) => l !== existing);
          const src = this.node(existing.from.node);
          const a = this.portPos(src, 'out', existing.from.port);
          const st = this.types.get(src.id)?.out[existing.from.port] || 'float';
          this.temp = { from: { ...existing.from }, a, b: this.portPos(node, 'in', portId), type: st, detached: true };
          this.render();
        } else {
          const a = this.portPos(node, 'in', portId);
          this.temp = { to: { node: id, port: portId }, a, b: a, type: types.in[portId] || 'float' };
        }
      }
      this.mode = 'wire';
      this.root.setPointerCapture(e.pointerId);
      this.renderLinks();
      return;
    }

    if (nodeEl) {
      const id = Number(nodeEl.dataset.id);
      if (e.shiftKey) {
        if (this.selection.has(id)) this.selection.delete(id);
        else this.selection.add(id);
      } else if (!this.selection.has(id)) {
        this.selection = new Set([id]);
      }
      this.selectedLink = null;
      this.refreshSelection();
      this.mode = 'drag';
      this.dragStart = this.toWorld(e.clientX, e.clientY);
      this.dragOrig = new Map([...this.selection].map((sid) => {
        const n = this.node(sid);
        return [sid, [n.x, n.y]];
      }));
      for (const sid of this.selection) this.layer.querySelector(`[data-id="${sid}"]`)?.classList.add('dragging');
      this.root.setPointerCapture(e.pointerId);
      return;
    }

    if (wire) {
      this.selectedLink = Number(wire.parentNode.dataset.link);
      this.selection.clear();
      this.refreshSelection();
      return;
    }

    if (e.shiftKey && e.button === 0) {
      this.mode = 'box';
      const r = this.root.getBoundingClientRect();
      this.boxStart = [e.clientX - r.left, e.clientY - r.top];
      this.marquee.hidden = false;
      this.updateMarquee(this.boxStart);
    } else {
      this.mode = 'pan';
      this.panStart = [e.clientX, e.clientY, this.view.x, this.view.y];
      this.root.classList.add('panning');
    }
    this.root.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    if (!this.mode) {
      return;
    }
    if (this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 3) this.moved = true;
    if (this.mode === 'pan') {
      const [sx, sy, vx, vy] = this.panStart;
      this.view.x = vx + (e.clientX - sx);
      this.view.y = vy + (e.clientY - sy);
      this.applyView();
    } else if (this.mode === 'drag') {
      const [wx, wy] = this.toWorld(e.clientX, e.clientY);
      const dx = wx - this.dragStart[0];
      const dy = wy - this.dragStart[1];
      for (const [id, [ox, oy]] of this.dragOrig) {
        const n = this.node(id);
        n.x = Math.round((ox + dx) / 4) * 4;
        n.y = Math.round((oy + dy) / 4) * 4;
      }
      this.updateNodePositions(this.dragOrig.keys());
    } else if (this.mode === 'wire') {
      this.temp.b = this.toWorld(e.clientX, e.clientY);
      this.root.querySelectorAll('.port.hover').forEach((p) => p.classList.remove('hover'));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port');
      if (over && this.canDrop(over)) over.classList.add('hover');
      this.renderLinks();
    } else if (this.mode === 'box') {
      const r = this.root.getBoundingClientRect();
      this.updateMarquee([e.clientX - r.left, e.clientY - r.top]);
    }
  }

  canDrop(portEl) {
    const nodeEl = portEl.closest('.node');
    if (!nodeEl || !this.temp) return false;
    const id = Number(nodeEl.dataset.id);
    const dir = portEl.dataset.dir;
    if (this.temp.from) return dir === 'in' && id !== this.temp.from.node && !this.reaches(id, this.temp.from.node);
    return dir === 'out' && id !== this.temp.to.node && !this.reaches(this.temp.to.node, id);
  }

  updateMarquee(p) {
    const [x0, y0] = this.boxStart;
    const x = Math.min(x0, p[0]), y = Math.min(y0, p[1]);
    const w = Math.abs(p[0] - x0), h = Math.abs(p[1] - y0);
    Object.assign(this.marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    this.boxEnd = p;
  }

  onUp(e, cancelled = false) {
    const mode = this.mode;
    this.mode = null;
    this.root.classList.remove('panning');
    try { this.root.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (mode === 'pan') {
      if (!this.moved) {
        this.selection.clear();
        this.selectedLink = null;
        this.refreshSelection();
      }
    } else if (mode === 'drag') {
      this.layer.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
      if (this.moved) this.opts.onChange?.({ structural: false, commit: true, moved: true });
    } else if (mode === 'wire') {
      const temp = this.temp;
      this.temp = null;
      this.root.querySelectorAll('.port.hover').forEach((p) => p.classList.remove('hover'));
      const over = cancelled ? null : document.elementFromPoint(e.clientX, e.clientY)?.closest('.port');
      let done = false;
      if (over && this.canDropWith(over, temp)) {
        const id = Number(over.closest('.node').dataset.id);
        if (temp.from) done = this.connect(temp.from, { node: id, port: over.dataset.port });
        else done = this.connect({ node: id, port: over.dataset.port }, temp.to);
      }
      if (done || temp.detached) {
        this.changed(true);
      } else {
        this.renderLinks();
      }
      if (!done && !over && !cancelled && this.moved && !e.target.closest?.('.node')) {
        const [x, y] = this.toWorld(e.clientX, e.clientY);
        this.opts.onRequestSearch?.({ clientX: e.clientX, clientY: e.clientY, x, y, pending: temp.from ? { from: temp.from } : { to: temp.to } });
      }
    } else if (mode === 'box') {
      this.marquee.hidden = true;
      const r = this.root.getBoundingClientRect();
      const a = this.toWorld(this.boxStart[0] + r.left, this.boxStart[1] + r.top);
      const b = this.toWorld(this.boxEnd[0] + r.left, this.boxEnd[1] + r.top);
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
      const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      const hits = [];
      for (const n of this.graph.nodes) {
        const elx = this.layer.querySelector(`[data-id="${n.id}"]`);
        const h = elx ? elx.offsetHeight : 100;
        if (n.x < x1 && n.x + nodeWidth(n) > x0 && n.y < y1 && n.y + h > y0) hits.push(n.id);
      }
      this.select(hits, true);
    }
  }

  canDropWith(portEl, temp) {
    const saved = this.temp;
    this.temp = temp;
    const ok = this.canDrop(portEl);
    this.temp = saved;
    return ok;
  }
}
