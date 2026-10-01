// Ready-made graphs. Each preset returns fresh { terrain, post } graphs.

import { NODE_DEFS } from './nodes.js';
import { defaultParams } from './codegen.js';

function graph() {
  return { nodes: [], links: [], nextId: 1 };
}

function add(g, type, x, y, params = {}, defaults = {}) {
  const def = NODE_DEFS[type];
  const node = { id: g.nextId++, type, x, y, params: { ...defaultParams(def), ...params }, defaults };
  g.nodes.push(node);
  return node;
}

function wire(g, a, ap, b, bp) {
  g.links.push({ id: g.nextId++, from: { node: a.id, port: ap }, to: { node: b.id, port: bp } });
}

function slider(g, x, y, name, label, min, max, step, value) {
  return add(g, 'slider', x, y, { name, label, min, max, step, value });
}

// Shared pieces ---------------------------------------------------------------

function texturedBlocks(g, out) {
  const tex = add(g, 'blockTexture', 40, 40);
  const tint = add(g, 'vertexColor', 40, 200);
  const mul = add(g, 'multiply', 300, 70);
  wire(g, tex, 'rgb', mul, 'a');
  wire(g, tint, 'rgb', mul, 'b');
  wire(g, mul, 'out', out, 'color');
  return { tex, tint, mul };
}

function wavingPlants(g, out, y = 340) {
  const type = add(g, 'blockType', 40, y);
  const str = slider(g, 40, y + 160, 'WIND_STRENGTH', 'Wind Strength', 0, 3, 0.1, 1);
  const wind = add(g, 'wind', 320, y + 40);
  wire(g, type, 'wave', wind, 'mask');
  wire(g, str, 'out', wind, 'str');
  wire(g, wind, 'out', out, 'offset');
}

// Presets -----------------------------------------------------------------------

export const PRESETS = [
  {
    id: 'waving',
    name: 'Waving Plants',
    blurb: 'Leaves and grass sway in the wind, with a richer, softly vignetted image.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);
      wavingPlants(terrain, out);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 60);
      const satAmt = slider(post, 40, 190, 'SATURATION', 'Saturation', 0, 2, 0.05, 1.15);
      const sat = add(post, 'saturation', 320, 70);
      const vigAmt = slider(post, 320, 230, 'VIGNETTE', 'Vignette', 0, 1, 0.05, 0.35);
      const vig = add(post, 'vignette', 600, 90);
      const outp = add(post, 'postOutput', 860, 110);
      wire(post, scene, 'rgb', sat, 'c');
      wire(post, satAmt, 'out', sat, 'amt');
      wire(post, sat, 'out', vig, 'c');
      wire(post, vigAmt, 'out', vig, 's');
      wire(post, vig, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'toon',
    name: 'Toon World',
    blurb: 'Flat colour bands and stepped lighting, like a cel-shaded cartoon.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 900, 120);
      const { mul } = texturedBlocks(terrain, out);
      terrain.links = terrain.links.filter((l) => !(l.from.node === mul.id && l.to.node === out.id));
      const steps = slider(terrain, 300, 230, 'TOON_STEPS', 'Toon Steps', 2, 8, 1, 4);
      const post1 = add(terrain, 'posterize', 600, 60);
      wire(terrain, mul, 'out', post1, 'x');
      wire(terrain, steps, 'out', post1, 's');
      wire(terrain, post1, 'out', out, 'color');
      const light = add(terrain, 'light', 300, 380);
      const post2 = add(terrain, 'posterize', 600, 360, {}, { s: 3 });
      wire(terrain, light, 'rgb', post2, 'x');
      wire(terrain, post2, 'out', out, 'light');
      wavingPlants(terrain, out, 560);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 60);
      const con = add(post, 'contrast', 300, 60, {}, { amt: 1.2 });
      const sat = add(post, 'saturation', 560, 60, {}, { amt: 1.35 });
      const outp = add(post, 'postOutput', 820, 80);
      wire(post, scene, 'rgb', con, 'c');
      wire(post, con, 'out', sat, 'c');
      wire(post, sat, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'retro',
    name: 'Retro TV',
    blurb: 'Chunky pixels, colour fringing and scanlines, like an old CRT.',
    build() {
      const terrain = graph();
      add(terrain, 'terrainOutput', 360, 120);

      const post = graph();
      const size = slider(post, 40, 40, 'PIXEL_SIZE', 'Pixel Size', 1, 12, 1, 4);
      const pix = add(post, 'pixelate', 300, 40);
      const ca = add(post, 'chroma', 560, 40, {}, { amt: 0.9 });
      const scan = add(post, 'scanlines', 820, 40, {}, { i: 0.3, n: 220 });
      const vig = add(post, 'vignette', 820, 220, {}, { s: 0.55 });
      const grain = add(post, 'grain', 1080, 160);
      const outp = add(post, 'postOutput', 1320, 160);
      wire(post, size, 'out', pix, 's');
      wire(post, pix, 'out', ca, 'uv');
      wire(post, ca, 'out', scan, 'c');
      wire(post, scan, 'out', vig, 'c');
      wire(post, vig, 'out', grain, 'c');
      wire(post, grain, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'night',
    name: 'Night Vision',
    blurb: 'Green goggles with film grain. An On/Off setting lets players switch it in-game.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 80);
      const gray = add(post, 'grayscale', 300, 160);
      const green = add(post, 'color', 300, 320, { color: '#5dff7e' });
      const tint = add(post, 'multiply', 560, 200, {}, {});
      const boost = add(post, 'multiply', 780, 200, {}, { b: 1.8 });
      const grain = add(post, 'grain', 1000, 200, {}, { amt: 0.09 });
      const vig = add(post, 'vignette', 1240, 200, {}, { s: 0.75, f: 2 });
      const on = add(post, 'toggle', 1000, 40, { name: 'NIGHT_VISION', label: 'Night Vision', value: true });
      const mix = add(post, 'lerp', 1480, 80);
      const outp = add(post, 'postOutput', 1720, 100);
      wire(post, scene, 'rgb', gray, 'c');
      wire(post, gray, 'luma', tint, 'a');
      wire(post, green, 'rgb', tint, 'b');
      wire(post, tint, 'out', boost, 'a');
      wire(post, boost, 'out', grain, 'c');
      wire(post, grain, 'out', vig, 'c');
      wire(post, scene, 'rgb', mix, 'a');
      wire(post, vig, 'out', mix, 'b');
      wire(post, on, 'out', mix, 't');
      wire(post, mix, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'dreamy',
    name: 'Dreamy Glow',
    blurb: 'Soft bloom around bright blocks, warm colours and a pastel tint.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 640, 120);
      texturedBlocks(terrain, out);
      wavingPlants(terrain, out);

      const post = graph();
      const scene = add(post, 'sceneColor', 40, 40);
      const glowAmt = slider(post, 40, 180, 'GLOW', 'Glow', 0, 2, 0.05, 0.9);
      const glow = add(post, 'glow', 300, 160, {}, { t: 0.6, r: 7 });
      const addN = add(post, 'add', 560, 80);
      const tintC = add(post, 'color', 560, 260, { color: '#ffd6e8' });
      const blend = add(post, 'blend', 800, 80, { mode: 'soft light' }, { o: 0.6 });
      const sat = add(post, 'saturation', 1060, 80, {}, { amt: 1.15 });
      const outp = add(post, 'postOutput', 1310, 100);
      wire(post, glowAmt, 'out', glow, 'i');
      wire(post, scene, 'rgb', addN, 'a');
      wire(post, glow, 'out', addN, 'b');
      wire(post, addN, 'out', blend, 'base');
      wire(post, tintC, 'rgb', blend, 'layer');
      wire(post, blend, 'out', sat, 'c');
      wire(post, sat, 'out', outp, 'color');
      return { terrain, post };
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Waves',
    blurb: 'Water surfaces rise and fall, with bright rims where you look across them.',
    build() {
      const terrain = graph();
      const out = add(terrain, 'terrainOutput', 980, 120);
      const { mul } = texturedBlocks(terrain, out);
      terrain.links = terrain.links.filter((l) => !(l.from.node === mul.id && l.to.node === out.id));
      const type = add(terrain, 'blockType', 40, 360);
      const fres = add(terrain, 'fresnel', 300, 240, {}, { p: 4 });
      const rim = add(terrain, 'multiply', 540, 240);
      const lerp = add(terrain, 'lerp', 760, 80);
      const white = add(terrain, 'color', 540, 380, { color: '#dff4ff' });
      wire(terrain, fres, 'f', rim, 'a');
      wire(terrain, type, 'water', rim, 'b');
      wire(terrain, mul, 'out', lerp, 'a');
      wire(terrain, white, 'rgb', lerp, 'b');
      wire(terrain, rim, 'out', lerp, 't');
      wire(terrain, lerp, 'out', out, 'color');

      const wave = add(terrain, 'wave', 40, 560, {}, { speed: 2, freq: 1.3 });
      const height = slider(terrain, 40, 760, 'WAVE_HEIGHT', 'Wave Height', 0, 0.3, 0.01, 0.08);
      const amp = add(terrain, 'multiply', 320, 580);
      const mask = add(terrain, 'multiply', 540, 580);
      const vec = add(terrain, 'combine', 760, 560);
      wire(terrain, wave, 'out', amp, 'a');
      wire(terrain, height, 'out', amp, 'b');
      wire(terrain, amp, 'out', mask, 'a');
      wire(terrain, type, 'water', mask, 'b');
      wire(terrain, mask, 'out', vec, 'y');
      wire(terrain, vec, 'v3', out, 'offset');

      const post = graph();
      add(post, 'postOutput', 360, 100);
      return { terrain, post };
    },
  },
  {
    id: 'vanilla',
    name: 'Blank (vanilla look)',
    blurb: 'Just the two output nodes. Start from scratch.',
    build() {
      const terrain = graph();
      add(terrain, 'terrainOutput', 360, 120);
      const post = graph();
      add(post, 'postOutput', 360, 100);
      return { terrain, post };
    },
  },
];
