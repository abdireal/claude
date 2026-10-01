// Node library for BlockGraph.
// Every node turns its inputs into GLSL expressions. The same snippets run in the
// browser preview (WebGL2 / GLSL ES 3.00) and in the exported Iris pack
// (GLSL 330 compatibility), so they must stay valid in both: always write float
// literals with a decimal point and never mix int and float maths.

export const TYPE_RANK = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

export const CATEGORIES = [
  { id: 'Input', label: 'World' },
  { id: 'Screen', label: 'Screen' },
  { id: 'Settings', label: 'Values & settings' },
  { id: 'Math', label: 'Math' },
  { id: 'Vector', label: 'Vector' },
  { id: 'Color', label: 'Color' },
  { id: 'Pattern', label: 'Patterns & motion' },
  { id: 'Effect', label: 'Screen effects' },
  { id: 'Output', label: 'Output' },
];

export const NODE_DEFS = {};

function def(d) {
  d.inputs = d.inputs || [];
  d.outputs = d.outputs || [];
  d.params = d.params || [];
  d.width = d.width || 180;
  NODE_DEFS[d.type] = d;
}

// ---------------------------------------------------------------- World inputs

def({
  type: 'blockTexture', title: 'Block Texture', cat: 'Input', graphs: ['terrain'], fragOnly: true,
  desc: "The block's own texture from the resource pack, sampled at the UV you give it.",
  keywords: 'albedo sample texture atlas gtexture',
  inputs: [{ id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' }],
  outputs: [
    { id: 'rgb', name: 'RGB', type: 'vec3' },
    { id: 'a', name: 'Alpha', type: 'float' },
    { id: 'rgba', name: 'RGBA', type: 'vec4' },
  ],
  gen: ({ I, V }) => ({
    pre: `vec4 ${V}c = bg_sampleBlock(${I.uv});`,
    out: { rgb: `${V}c.rgb`, a: `${V}c.a`, rgba: `${V}c` },
  }),
});

def({
  type: 'uv', title: 'Texture UV', cat: 'Input', graphs: ['terrain'],
  desc: 'Where this pixel sits on the block texture atlas.',
  keywords: 'texcoord coordinates',
  outputs: [{ id: 'uv', name: 'UV', type: 'vec2' }],
  gen: () => ({ out: { uv: 'bg_uv' } }),
});

def({
  type: 'time', title: 'Time', cat: 'Input',
  desc: 'Seconds since the game started. Feed it into Sine for looping motion.',
  keywords: 'frameTimeCounter animate seconds clock',
  outputs: [
    { id: 't', name: 'Seconds', type: 'float' },
    { id: 's', name: 'Sine', type: 'float' },
    { id: 'c', name: 'Cosine', type: 'float' },
  ],
  gen: () => ({ out: { t: 'bg_time', s: 'sin(bg_time)', c: 'cos(bg_time)' } }),
});

def({
  type: 'world', title: 'Day & Weather', cat: 'Input',
  desc: 'Time of day (0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight), a 0–1 daylight amount, and rain strength.',
  keywords: 'worldTime sun night rain weather daylight',
  outputs: [
    { id: 'day', name: 'Time of Day', type: 'float' },
    { id: 'light', name: 'Daylight', type: 'float' },
    { id: 'rain', name: 'Rain', type: 'float' },
  ],
  gen: () => ({ out: { day: 'bg_dayTime', light: 'bg_daylight', rain: 'bg_rain' } }),
});

def({
  type: 'worldPos', title: 'World Position', cat: 'Input', graphs: ['terrain'],
  desc: 'The block-space position of this point in the world. 1 unit = 1 block.',
  keywords: 'position coordinates xyz',
  outputs: [
    { id: 'p', name: 'Position', type: 'vec3' },
    { id: 'xz', name: 'XZ (flat)', type: 'vec2' },
    { id: 'y', name: 'Height', type: 'float' },
  ],
  gen: () => ({ out: { p: 'bg_worldPos', xz: 'bg_worldPos.xz', y: 'bg_worldPos.y' } }),
});

def({
  type: 'normal', title: 'Normal', cat: 'Input', graphs: ['terrain'],
  desc: 'The direction this face points. Up Facing is 1 on top faces and 0 on walls.',
  keywords: 'direction face up',
  outputs: [
    { id: 'n', name: 'Normal', type: 'vec3' },
    { id: 'up', name: 'Up Facing', type: 'float' },
  ],
  gen: () => ({ out: { n: 'bg_normal', up: 'clamp(bg_normal.y, 0.0, 1.0)' } }),
});

def({
  type: 'vertexColor', title: 'Biome Tint', cat: 'Input', graphs: ['terrain'],
  desc: 'The vertex colour Minecraft sends: biome tint for grass, leaves and water, plus vanilla face shading and ambient occlusion.',
  keywords: 'vertex color glcolor biome tint ao',
  outputs: [
    { id: 'rgb', name: 'Tint', type: 'vec3' },
    { id: 'a', name: 'Alpha', type: 'float' },
  ],
  gen: () => ({ out: { rgb: 'bg_vcolor.rgb', a: 'bg_vcolor.a' } }),
});

def({
  type: 'light', title: 'Light', cat: 'Input', graphs: ['terrain'],
  desc: 'Vanilla lighting at this spot: the lightmap colour, plus block light (torches) and sky light as 0–1 values.',
  keywords: 'lightmap torch sky lmcoord brightness',
  outputs: [
    { id: 'rgb', name: 'Light Color', type: 'vec3' },
    { id: 'block', name: 'Block Light', type: 'float' },
    { id: 'sky', name: 'Sky Light', type: 'float' },
  ],
  gen: () => ({ out: { rgb: 'bg_light', block: 'bg_lm.x', sky: 'bg_lm.y' } }),
});

def({
  type: 'blockType', title: 'Block Type', cat: 'Input', graphs: ['terrain'],
  desc: 'Masks that are 1 on certain blocks. Wave Mask covers leaves and the top half of plants, ready for waving.',
  keywords: 'mc_Entity block id leaves plants foliage water mask',
  outputs: [
    { id: 'wave', name: 'Wave Mask', type: 'float' },
    { id: 'leaves', name: 'Leaves', type: 'float' },
    { id: 'plants', name: 'Plants', type: 'float' },
    { id: 'water', name: 'Water', type: 'float' },
  ],
  gen: () => ({
    out: {
      wave: 'clamp(bg_isLeaves + bg_isPlant * bg_plantTop, 0.0, 1.0)',
      leaves: 'bg_isLeaves',
      plants: 'bg_isPlant',
      water: 'bg_isWater',
    },
  }),
});

def({
  type: 'camDistance', title: 'Camera Distance', cat: 'Input', graphs: ['terrain'],
  desc: 'How far this point is from the player, in blocks.',
  keywords: 'distance depth far near',
  outputs: [{ id: 'd', name: 'Blocks', type: 'float' }],
  gen: () => ({ out: { d: 'bg_viewDist' } }),
});

def({
  type: 'fresnel', title: 'Fresnel', cat: 'Input', graphs: ['terrain'],
  desc: 'Bright at grazing angles, dark when you look straight at a face. Good for rim glow and water edges.',
  keywords: 'rim edge glow view angle',
  inputs: [{ id: 'p', name: 'Power', type: 'float', def: 3 }],
  outputs: [{ id: 'f', name: 'Fresnel', type: 'float' }],
  gen: ({ I }) => `pow(1.0 - clamp(dot(bg_normal, bg_viewDir), 0.0, 1.0), ${I.p})`,
});

// --------------------------------------------------------------- Screen inputs

def({
  type: 'sceneColor', title: 'Scene Color', cat: 'Screen', graphs: ['post'],
  desc: 'The finished image of the world. Change the UV to sample somewhere else on screen.',
  keywords: 'colortex0 screen image frame',
  inputs: [{ id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' }],
  outputs: [{ id: 'rgb', name: 'RGB', type: 'vec3' }],
  gen: ({ I }) => ({ out: { rgb: `bg_sampleScene(${I.uv}).rgb` } }),
});

def({
  type: 'screenUV', title: 'Screen UV', cat: 'Screen', graphs: ['post'],
  desc: 'Position on screen from 0 to 1. Centered runs from the middle of the screen and keeps circles round.',
  keywords: 'texcoord screen position center',
  outputs: [
    { id: 'uv', name: 'UV', type: 'vec2' },
    { id: 'c', name: 'Centered', type: 'vec2' },
  ],
  gen: () => ({ out: { uv: 'bg_screenUV', c: '((bg_screenUV - 0.5) * vec2(bg_aspect, 1.0))' } }),
});

def({
  type: 'sceneDepth', title: 'Scene Depth', cat: 'Screen', graphs: ['post'],
  desc: 'How far away the world is at this pixel, in blocks. Sky is 1 where nothing was drawn.',
  keywords: 'depthtex0 distance fog',
  inputs: [{ id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' }],
  outputs: [
    { id: 'd', name: 'Distance', type: 'float' },
    { id: 'sky', name: 'Sky', type: 'float' },
  ],
  gen: ({ I }) => ({ out: { d: `bg_sceneDistance(${I.uv})`, sky: `bg_isSky(${I.uv})` } }),
});

def({
  type: 'screenSize', title: 'Screen Size', cat: 'Screen', graphs: ['post'],
  desc: 'The screen size in pixels, and the size of one pixel in UV units.',
  keywords: 'resolution viewWidth viewHeight texel',
  outputs: [
    { id: 'px', name: 'Pixels', type: 'vec2' },
    { id: 'texel', name: 'One Pixel', type: 'vec2' },
  ],
  gen: () => ({ out: { px: 'bg_resolution', texel: '(1.0 / bg_resolution)' } }),
});

// ------------------------------------------------------------ Values & settings

def({
  type: 'number', title: 'Number', cat: 'Settings',
  desc: 'A fixed number.',
  keywords: 'float constant value',
  params: [{ id: 'value', name: 'Value', kind: 'number', def: 1, step: 0.05 }],
  outputs: [{ id: 'out', name: 'Value', type: 'float' }],
  gen: ({ P, lit }) => lit('float', P.value),
});

def({
  type: 'color', title: 'Color', cat: 'Settings',
  desc: 'A fixed colour.',
  keywords: 'rgb constant tint',
  params: [{ id: 'color', name: 'Color', kind: 'color', def: '#ffb347' }],
  outputs: [{ id: 'rgb', name: 'RGB', type: 'vec3' }],
  gen: ({ P, lit }) => ({ out: { rgb: lit('vec3', hexToLinear(P.color)) } }),
});

def({
  type: 'slider', title: 'Slider Setting', cat: 'Settings', setting: 'slider', width: 200,
  desc: 'A number players can change in-game. It shows up as a slider in Iris → Shader Settings.',
  keywords: 'option parameter define iris menu property exposed',
  params: [
    { id: 'name', name: 'Setting ID', kind: 'ident', def: 'MY_SETTING' },
    { id: 'label', name: 'Label in Iris', kind: 'text', def: 'My Setting' },
    { id: 'min', name: 'Min', kind: 'number', def: 0, step: 0.1 },
    { id: 'max', name: 'Max', kind: 'number', def: 1, step: 0.1 },
    { id: 'step', name: 'Step', kind: 'number', def: 0.05, step: 0.01 },
    { id: 'value', name: 'Default', kind: 'number', def: 0.5, step: 0.05 },
  ],
  outputs: [{ id: 'out', name: 'Value', type: 'float' }],
  gen: ({ P, settings, node }) => {
    settings.set(P.name, { kind: 'slider', node: node.id, ...P });
    return P.name;
  },
});

def({
  type: 'toggle', title: 'On/Off Setting', cat: 'Settings', setting: 'toggle', width: 200,
  desc: 'A switch players can flip in-game. Gives 1 when on and 0 when off. Shows up as ON/OFF in Iris → Shader Settings.',
  keywords: 'option boolean switch define iris menu exposed',
  params: [
    { id: 'name', name: 'Setting ID', kind: 'ident', def: 'MY_TOGGLE' },
    { id: 'label', name: 'Label in Iris', kind: 'text', def: 'My Toggle' },
    { id: 'value', name: 'On by default', kind: 'bool', def: true },
  ],
  outputs: [{ id: 'out', name: 'On = 1', type: 'float' }],
  gen: ({ P, settings, node }) => {
    settings.set(P.name, { kind: 'toggle', node: node.id, ...P });
    return 'TG_' + P.name;
  },
});

// ------------------------------------------------------------------------ Math

function binary(type, title, desc, op, defB = 0, keywords = '') {
  def({
    type, title, cat: 'Math', desc, keywords, width: 150,
    inputs: [
      { id: 'a', name: 'A', type: 'dyn', def: 0 },
      { id: 'b', name: 'B', type: 'dyn', def: defB },
    ],
    outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
    gen: ({ I }) => op(I.a, I.b),
  });
}
binary('add', 'Add', 'A + B. Adds numbers, or mixes light into a colour.', (a, b) => `(${a} + ${b})`, 0, 'plus sum');
binary('subtract', 'Subtract', 'A − B.', (a, b) => `(${a} - ${b})`, 0, 'minus difference');
binary('multiply', 'Multiply', 'A × B. Tints colours, scales values, masks things out with 0.', (a, b) => `(${a} * ${b})`, 1, 'times scale tint mask');
binary('divide', 'Divide', 'A ÷ B.', (a, b) => `(${a} / ${b})`, 1, 'over ratio');
binary('power', 'Power', 'A to the power of B. Higher powers make bright parts sharper.', (a, b) => `pow(max(${a}, 0.0), ${b})`, 2, 'exponent pow curve');
binary('min', 'Minimum', 'The smaller of A and B.', (a, b) => `min(${a}, ${b})`, 1, 'smallest');
binary('max', 'Maximum', 'The larger of A and B.', (a, b) => `max(${a}, ${b})`, 0, 'largest');

function unary(type, title, desc, op, keywords = '') {
  def({
    type, title, cat: 'Math', desc, keywords, width: 150,
    inputs: [{ id: 'x', name: 'In', type: 'dyn', def: 0 }],
    outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
    gen: ({ I }) => op(I.x),
  });
}
unary('oneMinus', 'One Minus', '1 − In. Inverts masks and colours.', (x) => `(1.0 - ${x})`, 'invert flip');
unary('abs', 'Absolute', 'Drops the minus sign.', (x) => `abs(${x})`, 'abs positive');
unary('fract', 'Fraction', 'Keeps only the part after the decimal point. Turns a ramp into a repeating sawtooth.', (x) => `fract(${x})`, 'repeat sawtooth frac');
unary('floor', 'Floor', 'Rounds down to a whole number. Good for steps and pixel snapping.', (x) => `floor(${x})`, 'round down');
unary('sine', 'Sine', 'A smooth wave between −1 and 1.', (x) => `sin(${x})`, 'sin wave oscillate');
unary('cosine', 'Cosine', 'Sine shifted by a quarter turn.', (x) => `cos(${x})`, 'cos wave');
unary('saturate', 'Saturate', 'Clamps between 0 and 1.', (x) => `clamp(${x}, 0.0, 1.0)`, 'clamp01 limit');
unary('negate', 'Negate', 'Flips the sign: −In.', (x) => `(-${x})`, 'minus invert sign');

def({
  type: 'lerp', title: 'Mix', cat: 'Math', width: 160,
  desc: 'Blends from A to B. T = 0 gives A, T = 1 gives B. Plug a mask into T.',
  keywords: 'lerp blend interpolate mix',
  inputs: [
    { id: 'a', name: 'A', type: 'dyn', def: 0 },
    { id: 'b', name: 'B', type: 'dyn', def: 1 },
    { id: 't', name: 'T', type: 'dynOrFloat', def: 0.5 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `mix(${I.a}, ${I.b}, ${I.t})`,
});

def({
  type: 'clamp', title: 'Clamp', cat: 'Math', width: 160,
  desc: 'Keeps the value between Min and Max.',
  keywords: 'limit range',
  inputs: [
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
    { id: 'lo', name: 'Min', type: 'float', def: 0 },
    { id: 'hi', name: 'Max', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `clamp(${I.x}, ${I.lo}, ${I.hi})`,
});

def({
  type: 'step', title: 'Step', cat: 'Math', width: 160,
  desc: 'Hard cut: 0 below Edge, 1 above it.',
  keywords: 'threshold cutoff hard',
  inputs: [
    { id: 'e', name: 'Edge', type: 'float', def: 0.5 },
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `step(${I.e}, ${I.x})`,
});

def({
  type: 'smoothstep', title: 'Smoothstep', cat: 'Math', width: 170,
  desc: 'Soft cut: fades from 0 to 1 between Edge 1 and Edge 2.',
  keywords: 'soft threshold fade ramp',
  inputs: [
    { id: 'e0', name: 'Edge 1', type: 'float', def: 0 },
    { id: 'e1', name: 'Edge 2', type: 'float', def: 1 },
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `smoothstep(${I.e0}, ${I.e1}, ${I.x})`,
});

def({
  type: 'remap', title: 'Remap', cat: 'Math', width: 170,
  desc: 'Moves a value from one range to another, like 0–1 into 0.2–0.8.',
  keywords: 'range map scale fit',
  inputs: [
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
    { id: 'a', name: 'From Min', type: 'float', def: 0 },
    { id: 'b', name: 'From Max', type: 'float', def: 1 },
    { id: 'c', name: 'To Min', type: 'float', def: 0 },
    { id: 'd', name: 'To Max', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `(${I.c} + (${I.x} - ${I.a}) * ((${I.d} - ${I.c}) / (${I.b} - ${I.a})))`,
});

// ---------------------------------------------------------------------- Vector

def({
  type: 'split', title: 'Split', cat: 'Vector', width: 150,
  desc: 'Pulls a vector apart into single numbers.',
  keywords: 'separate channels xyzw rgba components',
  inputs: [{ id: 'v', name: 'In', type: 'vec4', def: [0, 0, 0, 0] }],
  outputs: [
    { id: 'x', name: 'R / X', type: 'float' },
    { id: 'y', name: 'G / Y', type: 'float' },
    { id: 'z', name: 'B / Z', type: 'float' },
    { id: 'w', name: 'A / W', type: 'float' },
  ],
  gen: ({ I, V }) => ({
    pre: `vec4 ${V}v = ${I.v};`,
    out: { x: `${V}v.x`, y: `${V}v.y`, z: `${V}v.z`, w: `${V}v.w` },
  }),
});

def({
  type: 'combine', title: 'Combine', cat: 'Vector', width: 160,
  desc: 'Builds a vector or colour from single numbers.',
  keywords: 'join merge vector make rgb xyz',
  inputs: [
    { id: 'x', name: 'R / X', type: 'float', def: 0 },
    { id: 'y', name: 'G / Y', type: 'float', def: 0 },
    { id: 'z', name: 'B / Z', type: 'float', def: 0 },
    { id: 'w', name: 'A / W', type: 'float', def: 1 },
  ],
  outputs: [
    { id: 'v3', name: 'XYZ', type: 'vec3' },
    { id: 'v2', name: 'XY', type: 'vec2' },
    { id: 'v4', name: 'XYZW', type: 'vec4' },
  ],
  gen: ({ I }) => ({
    out: {
      v3: `vec3(${I.x}, ${I.y}, ${I.z})`,
      v2: `vec2(${I.x}, ${I.y})`,
      v4: `vec4(${I.x}, ${I.y}, ${I.z}, ${I.w})`,
    },
  }),
});

def({
  type: 'dot', title: 'Dot Product', cat: 'Vector', width: 160,
  desc: 'How much two directions point the same way: 1 = same, 0 = sideways, −1 = opposite.',
  keywords: 'dot angle facing',
  inputs: [
    { id: 'a', name: 'A', type: 'vec3', def: [0, 1, 0] },
    { id: 'b', name: 'B', type: 'vec3', def: [0, 1, 0] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `dot(${I.a}, ${I.b})`,
});

def({
  type: 'length', title: 'Length', cat: 'Vector', width: 150,
  desc: 'How long a vector is.',
  keywords: 'magnitude size',
  inputs: [{ id: 'x', name: 'In', type: 'dyn', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `length(${I.x})`,
});

def({
  type: 'distance', title: 'Distance', cat: 'Vector', width: 160,
  desc: 'How far apart two points are.',
  keywords: 'between gap',
  inputs: [
    { id: 'a', name: 'A', type: 'dyn', def: 0 },
    { id: 'b', name: 'B', type: 'dyn', def: 0 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `distance(${I.a}, ${I.b})`,
});

def({
  type: 'normalize', title: 'Normalize', cat: 'Vector', width: 150,
  desc: 'Keeps the direction, sets the length to 1.',
  keywords: 'unit direction',
  inputs: [{ id: 'x', name: 'In', type: 'vec3', def: [0, 1, 0] }],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `normalize(${I.x})`,
});

// ----------------------------------------------------------------------- Color

def({
  type: 'grayscale', title: 'Grayscale', cat: 'Color', width: 160,
  desc: 'Brightness of a colour as seen by the eye.',
  keywords: 'luminance luma black white desaturate',
  inputs: [{ id: 'c', name: 'Color', type: 'vec3', def: [1, 1, 1] }],
  outputs: [
    { id: 'gray', name: 'Gray', type: 'vec3' },
    { id: 'luma', name: 'Brightness', type: 'float' },
  ],
  gen: ({ I, V }) => ({
    pre: `float ${V}l = bg_luma(${I.c});`,
    out: { gray: `vec3(${V}l)`, luma: `${V}l` },
  }),
});

def({
  type: 'saturation', title: 'Saturation', cat: 'Color', width: 170,
  desc: '0 = black and white, 1 = unchanged, above 1 = more vivid.',
  keywords: 'vibrance vivid colorful desaturate',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', def: [1, 1, 1] },
    { id: 'amt', name: 'Amount', type: 'float', def: 1.2 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `vec3 ${V}c = ${I.c};`,
    out: { out: `max(mix(vec3(bg_luma(${V}c)), ${V}c, ${I.amt}), 0.0)` },
  }),
});

def({
  type: 'contrast', title: 'Contrast', cat: 'Color', width: 170,
  desc: 'Pushes darks darker and brights brighter around middle grey.',
  keywords: 'punch levels',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', def: [1, 1, 1] },
    { id: 'amt', name: 'Amount', type: 'float', def: 1.15 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `max((${I.c} - 0.5) * ${I.amt} + 0.5, 0.0)`,
});

def({
  type: 'hueShift', title: 'Hue Shift', cat: 'Color', width: 170,
  desc: 'Rotates colours around the colour wheel. 0.5 swaps colours for their opposites.',
  keywords: 'hsv rainbow rotate',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', def: [1, 0, 0] },
    { id: 's', name: 'Shift', type: 'float', def: 0.1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `vec3 ${V}h = bg_rgb2hsv(${I.c});`,
    out: { out: `bg_hsv2rgb(vec3(fract(${V}h.x + ${I.s}), ${V}h.yz))` },
  }),
});

def({
  type: 'posterize', title: 'Posterize', cat: 'Color', width: 170,
  desc: 'Cuts a smooth range into a few flat steps. The classic toon look.',
  keywords: 'toon cel steps quantize banding',
  inputs: [
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
    { id: 's', name: 'Steps', type: 'float', def: 4 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `(floor(${I.x} * ${I.s} + 0.5) / ${I.s})`,
});

def({
  type: 'blend', title: 'Blend', cat: 'Color', width: 180,
  desc: 'Layers one colour on another like a paint program layer.',
  keywords: 'overlay screen multiply layer photoshop',
  params: [{ id: 'mode', name: 'Mode', kind: 'select', def: 'overlay', options: ['overlay', 'screen', 'multiply', 'add', 'soft light'] }],
  inputs: [
    { id: 'base', name: 'Base', type: 'vec3', def: [0.5, 0.5, 0.5] },
    { id: 'layer', name: 'Layer', type: 'vec3', def: [1, 1, 1] },
    { id: 'o', name: 'Opacity', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, P, V }) => {
    const b = `${V}b`, l = `${V}l`;
    const modes = {
      overlay: `mix(2.0 * ${b} * ${l}, 1.0 - 2.0 * (1.0 - ${b}) * (1.0 - ${l}), step(0.5, ${b}))`,
      screen: `(1.0 - (1.0 - ${b}) * (1.0 - ${l}))`,
      multiply: `(${b} * ${l})`,
      add: `(${b} + ${l})`,
      'soft light': `((1.0 - 2.0 * ${l}) * ${b} * ${b} + 2.0 * ${l} * ${b})`,
    };
    return {
      pre: `vec3 ${b} = ${I.base}; vec3 ${l} = ${I.layer};`,
      out: { out: `mix(${b}, ${modes[P.mode] || modes.overlay}, ${I.o})` },
    };
  },
});

// ----------------------------------------------------------- Patterns & motion

def({
  type: 'noise', title: 'Noise', cat: 'Pattern', width: 180,
  desc: 'Smooth random clouds between 0 and 1. More detail layers add finer bumps.',
  keywords: 'perlin value random fbm clouds',
  params: [{ id: 'oct', name: 'Detail layers', kind: 'select', def: '3', options: ['1', '2', '3', '4'] }],
  inputs: [
    { id: 'p', name: 'Position', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Noise', type: 'float' }],
  gen: ({ I, P }) => `bg_fbm3(${I.p} * ${I.s}, ${parseInt(P.oct, 10) || 3})`,
});

def({
  type: 'checker', title: 'Checkerboard', cat: 'Pattern', width: 170,
  desc: 'Alternating 0 and 1 squares.',
  keywords: 'grid squares tiles',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' },
    { id: 's', name: 'Scale', type: 'float', def: 8 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}q = floor(${I.uv} * ${I.s});`,
    out: { out: `mod(${V}q.x + ${V}q.y, 2.0)` },
  }),
});

def({
  type: 'wave', title: 'Wave', cat: 'Pattern', width: 180,
  desc: 'A sine wave that travels across the world over time. Outputs −1 to 1.',
  keywords: 'ripple ocean sine moving animate',
  inputs: [
    { id: 'p', name: 'Position', type: 'vec3', bind: 'pos' },
    { id: 'speed', name: 'Speed', type: 'float', def: 1.5 },
    { id: 'freq', name: 'Frequency', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Wave', type: 'float' }],
  gen: ({ I, V }) => ({
    pre: `vec3 ${V}p = ${I.p};`,
    out: { out: `sin(bg_time * ${I.speed} + (${V}p.x + ${V}p.z * 0.7) * ${I.freq})` },
  }),
});

def({
  type: 'wind', title: 'Wind Sway', cat: 'Pattern', graphs: ['terrain'], width: 180,
  desc: 'A ready-made gentle wind offset. Plug it into Vertex Offset and mask it with Block Type → Wave Mask.',
  keywords: 'waving leaves plants grass foliage wind sway vertex',
  inputs: [
    { id: 'str', name: 'Strength', type: 'float', def: 1 },
    { id: 'speed', name: 'Speed', type: 'float', def: 1.6 },
    { id: 'mask', name: 'Mask', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Offset', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `float ${V}t = bg_time * ${I.speed}; vec3 ${V}p = bg_worldPos;`,
    out: {
      out: `vec3(sin(${V}t + ${V}p.x * 0.8 + ${V}p.z * 0.3) + 0.4 * sin(${V}t * 2.3 + ${V}p.z), 0.0, cos(${V}t * 0.9 + ${V}p.z * 0.7 + ${V}p.x * 0.2) + 0.4 * cos(${V}t * 1.9 + ${V}p.x)) * (0.05 * ${I.str} * ${I.mask})`,
    },
  }),
});

// ------------------------------------------------------------- Screen effects

def({
  type: 'vignette', title: 'Vignette', cat: 'Effect', graphs: ['post'], width: 180,
  desc: 'Darkens the corners of the screen.',
  keywords: 'corners dark edges frame',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', bind: 'scene' },
    { id: 's', name: 'Strength', type: 'float', def: 0.4 },
    { id: 'f', name: 'Falloff', type: 'float', def: 2.5 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `float ${V}d = length(bg_screenUV - 0.5) * 1.4142;`,
    out: { out: `(${I.c} * clamp(1.0 - ${I.s} * pow(${V}d, ${I.f}), 0.0, 1.0))` },
  }),
});

def({
  type: 'pixelate', title: 'Pixelate UV', cat: 'Effect', graphs: ['post'], width: 180,
  desc: 'Snaps screen UVs to big pixels. Feed it into Scene Color → UV.',
  keywords: 'retro pixel mosaic lowres',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' },
    { id: 's', name: 'Pixel Size', type: 'float', def: 4 },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `float ${V}s = max(${I.s}, 1.0);`,
    out: { out: `((floor(${I.uv} * bg_resolution / ${V}s) + 0.5) * ${V}s / bg_resolution)` },
  }),
});

def({
  type: 'chroma', title: 'Chromatic Aberration', cat: 'Effect', graphs: ['post'], width: 200,
  desc: 'Splits red and blue apart towards the edges, like a cheap camera lens.',
  keywords: 'rgb split lens glitch',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' },
    { id: 'amt', name: 'Amount', type: 'float', def: 1.5 },
  ],
  outputs: [{ id: 'out', name: 'Color', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}uv = ${I.uv}; vec2 ${V}o = (${V}uv - 0.5) * (${I.amt} * 0.01);`,
    out: {
      out: `vec3(bg_sampleScene(${V}uv + ${V}o).r, bg_sampleScene(${V}uv).g, bg_sampleScene(${V}uv - ${V}o).b)`,
    },
  }),
});

def({
  type: 'scanlines', title: 'Scanlines', cat: 'Effect', graphs: ['post'], width: 180,
  desc: 'Horizontal lines like an old CRT television.',
  keywords: 'crt tv retro lines',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', bind: 'scene' },
    { id: 'i', name: 'Intensity', type: 'float', def: 0.25 },
    { id: 'n', name: 'Line Count', type: 'float', def: 240 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `(${I.c} * (1.0 - ${I.i} * (0.5 + 0.5 * sin(bg_screenUV.y * ${I.n} * 6.2831853))))`,
});

def({
  type: 'blur', title: 'Blur', cat: 'Effect', graphs: ['post'], width: 170,
  desc: 'A soft 9-sample blur of the scene.',
  keywords: 'soft smooth box',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' },
    { id: 'r', name: 'Radius', type: 'float', def: 2 },
  ],
  outputs: [{ id: 'out', name: 'Color', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: [
      `vec3 ${V}acc = vec3(0.0); vec2 ${V}uv = ${I.uv}; vec2 ${V}px = ${I.r} / bg_resolution;`,
      `for (int ${V}i = -1; ${V}i <= 1; ${V}i++) { for (int ${V}j = -1; ${V}j <= 1; ${V}j++) {`,
      `  ${V}acc += bg_sampleScene(${V}uv + vec2(float(${V}i), float(${V}j)) * ${V}px).rgb; } }`,
    ].join('\n'),
    out: { out: `(${V}acc / 9.0)` },
  }),
});

def({
  type: 'glow', title: 'Glow', cat: 'Effect', graphs: ['post'], width: 180,
  desc: 'A cheap bloom: the bright parts of the scene, spread out. Add it on top of Scene Color.',
  keywords: 'bloom bright light halo',
  inputs: [
    { id: 't', name: 'Threshold', type: 'float', def: 0.7 },
    { id: 'r', name: 'Radius', type: 'float', def: 6 },
    { id: 'i', name: 'Intensity', type: 'float', def: 0.8 },
  ],
  outputs: [{ id: 'out', name: 'Glow', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: [
      `vec3 ${V}acc = vec3(0.0); vec2 ${V}px = ${I.r} / bg_resolution;`,
      `for (int ${V}k = 0; ${V}k < 12; ${V}k++) {`,
      `  float ${V}a = float(${V}k) * 0.5235988; float ${V}rr = (${V}k < 6) ? 1.0 : 2.2;`,
      `  vec3 ${V}s = bg_sampleScene(bg_screenUV + vec2(cos(${V}a), sin(${V}a)) * ${V}px * ${V}rr).rgb;`,
      `  ${V}acc += max(${V}s - ${I.t}, 0.0); }`,
    ].join('\n'),
    out: { out: `(${V}acc / 12.0 * ${I.i} * 2.0)` },
  }),
});

def({
  type: 'fog', title: 'Depth Fog', cat: 'Effect', graphs: ['post'], width: 180,
  desc: 'Fades far-away terrain into a colour. The sky is left alone.',
  keywords: 'mist haze distance atmosphere',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', bind: 'scene' },
    { id: 'fc', name: 'Fog Color', type: 'vec3', def: [0.72, 0.8, 0.95], color: true },
    { id: 'a', name: 'Start', type: 'float', def: 8 },
    { id: 'b', name: 'End', type: 'float', def: 40 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `mix(${I.c}, ${I.fc}, smoothstep(${I.a}, ${I.b}, bg_sceneDistance(bg_screenUV)) * (1.0 - bg_isSky(bg_screenUV)))`,
});

def({
  type: 'grain', title: 'Film Grain', cat: 'Effect', graphs: ['post'], width: 170,
  desc: 'Flickering noise over the image, like film or night-vision goggles.',
  keywords: 'noise film static',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', bind: 'scene' },
    { id: 'amt', name: 'Amount', type: 'float', def: 0.06 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `(${I.c} + (bg_hash12(floor(bg_screenUV * bg_resolution) + floor(fract(bg_time * 3.0) * 97.0)) - 0.5) * ${I.amt})`,
});

// ---------------------------------------------------------------------- Output

def({
  type: 'terrainOutput', title: 'Block Output', cat: 'Output', graphs: ['terrain'], isOutput: true, width: 210,
  desc: 'What every block finally looks like. Final colour = Color × Light + Color × Emission. Vertex Offset moves the block itself.',
  inputs: [
    { id: 'color', name: 'Color', type: 'vec3', bind: 'albedo' },
    { id: 'alpha', name: 'Alpha', type: 'float', bind: 'alpha' },
    { id: 'light', name: 'Light', type: 'vec3', bind: 'light' },
    { id: 'emission', name: 'Emission', type: 'float', def: 0 },
    { id: 'offset', name: 'Vertex Offset', type: 'vec3', def: [0, 0, 0], stage: 'vertex' },
  ],
  params: [{ id: 'fog', name: 'Vanilla distance fog', kind: 'bool', def: true }],
  gen: () => ({ out: {} }),
});

def({
  type: 'postOutput', title: 'Screen Output', cat: 'Output', graphs: ['post'], isOutput: true, width: 190,
  desc: 'The final picture that reaches the screen.',
  inputs: [{ id: 'color', name: 'Color', type: 'vec3', bind: 'scene' }],
  gen: () => ({ out: {} }),
});

// --------------------------------------------------------------------- Helpers

// Colour pickers work in sRGB; shaders work in linear-ish values. Minecraft's
// pipeline is not linear, so we keep the picked colour as-is (0–1 per channel).
export function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000);
}

export function rgbToHex(rgb) {
  const c = (v) => Math.max(0, Math.min(255, Math.round((+v || 0) * 255))).toString(16).padStart(2, '0');
  return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2]);
}

// Which builtin a "bind" input falls back to, per graph kind.
export const BINDS = {
  terrain: {
    uv: { expr: 'bg_uv', type: 'vec2', label: 'Texture UV' },
    pos: { expr: 'bg_worldPos', type: 'vec3', label: 'World Pos' },
    albedo: { expr: '(bg_sampleBlock(bg_uv).rgb * bg_vcolor.rgb)', type: 'vec3', label: 'Texture × Tint', fragOnly: true },
    alpha: { expr: '(bg_sampleBlock(bg_uv).a * bg_vcolor.a)', type: 'float', label: 'Texture Alpha', fragOnly: true },
    light: { expr: 'bg_light', type: 'vec3', label: 'Vanilla Light' },
  },
  post: {
    uv: { expr: 'bg_screenUV', type: 'vec2', label: 'Screen UV' },
    pos: { expr: 'vec3(bg_screenUV * vec2(bg_aspect, 1.0) * 8.0, 0.0)', type: 'vec3', label: 'Screen Pos' },
    scene: { expr: 'bg_sampleScene(bg_screenUV).rgb', type: 'vec3', label: 'Scene Color' },
  },
};

// Shared GLSL helper functions, valid in GLSL ES 3.00 and GLSL 330.
export const GLSL_HELPERS = `
float bg_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float bg_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bg_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float bg_noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(bg_hash13(i), bg_hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(bg_hash13(i + vec3(0.0, 1.0, 0.0)), bg_hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(bg_hash13(i + vec3(0.0, 0.0, 1.0)), bg_hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(bg_hash13(i + vec3(0.0, 1.0, 1.0)), bg_hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float bg_fbm3(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    sum += bg_noise3(p) * amp;
    norm += amp;
    p = p * 2.03 + vec3(17.1, 9.2, 4.7);
    amp *= 0.5;
  }
  return sum / norm;
}
vec3 bg_rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 bg_hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;
