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
  { id: 'Trig', label: 'Trigonometry & waves' },
  { id: 'Vector', label: 'Vector & channel' },
  { id: 'Logic', label: 'Logic' },
  { id: 'Color', label: 'Color (artistic)' },
  { id: 'Normal', label: 'Normal' },
  { id: 'UV', label: 'UV' },
  { id: 'Pattern', label: 'Procedural & motion' },
  { id: 'Effect', label: 'Screen effects' },
  { id: 'Utility', label: 'Utility' },
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
  type: 'blockTexture', title: 'Block Texture', cat: 'Input', graphs: ['terrain', 'entity'], fragOnly: true,
  desc: "The texture being drawn, sampled at the UV you give it: the block's texture in the Blocks graph, the item or mob texture in the Items & Entities graph.",
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
  type: 'uv', title: 'Texture UV', cat: 'Input', graphs: ['terrain', 'entity'],
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
  type: 'worldPos', title: 'World Position', cat: 'Input', graphs: ['terrain', 'entity'],
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
  type: 'normal', title: 'Normal', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'The direction this face points. Up Facing is 1 on top faces and 0 on walls.',
  keywords: 'direction face up',
  outputs: [
    { id: 'n', name: 'Normal', type: 'vec3' },
    { id: 'up', name: 'Up Facing', type: 'float' },
  ],
  gen: () => ({ out: { n: 'bg_normal', up: 'clamp(bg_normal.y, 0.0, 1.0)' } }),
});

def({
  type: 'vertexColor', title: 'Biome Tint', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'The vertex colour Minecraft sends: biome tint for grass, leaves and water, plus vanilla face shading and ambient occlusion.',
  keywords: 'vertex color glcolor biome tint ao',
  outputs: [
    { id: 'rgb', name: 'Tint', type: 'vec3' },
    { id: 'a', name: 'Alpha', type: 'float' },
  ],
  gen: () => ({ out: { rgb: 'bg_vcolor.rgb', a: 'bg_vcolor.a' } }),
});

def({
  type: 'light', title: 'Light', cat: 'Input', graphs: ['terrain', 'entity'],
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
  desc: 'Masks that are 1 on certain blocks. Wave Mask covers leaves and the top half of plants, ready for waving. Custom Models is 1 on blocks that use a 3D model from the Models tab.',
  keywords: 'mc_Entity block id leaves plants foliage water mask model mesh obj custom',
  outputs: [
    { id: 'wave', name: 'Wave Mask', type: 'float' },
    { id: 'leaves', name: 'Leaves', type: 'float' },
    { id: 'plants', name: 'Plants', type: 'float' },
    { id: 'water', name: 'Water', type: 'float' },
    { id: 'model', name: 'Custom Models', type: 'float' },
  ],
  gen: () => ({
    out: {
      wave: 'clamp(bg_isLeaves + bg_isPlant * bg_plantTop, 0.0, 1.0)',
      leaves: 'bg_isLeaves',
      plants: 'bg_isPlant',
      water: 'bg_isWater',
      model: 'bg_isModel',
    },
  }),
});

def({
  type: 'camDistance', title: 'Camera Distance', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'How far this point is from the player, in blocks.',
  keywords: 'distance depth far near',
  outputs: [{ id: 'd', name: 'Blocks', type: 'float' }],
  gen: () => ({ out: { d: 'bg_viewDist' } }),
});

def({
  type: 'fresnel', title: 'Fresnel', cat: 'Input', graphs: ['terrain', 'entity'],
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

function binary(type, title, desc, op, defB = 0, keywords = '', extra = {}) {
  def({
    type, title, cat: 'Math', desc, keywords, width: 150, ...extra,
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

function unary(type, title, desc, op, keywords = '', extra = {}) {
  def({
    type, title, cat: 'Math', desc, keywords, width: 150, ...extra,
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
  keywords: 'join merge vector make rgb xyz vector2 vector3 vector4 float2 float3 float4',
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
  desc: 'Layers one colour on another like a paint program layer. All 21 of Unity\u2019s blend modes.',
  keywords: 'overlay screen multiply layer photoshop burn dodge difference exclusion lighten darken',
  params: [{
    id: 'mode', name: 'Mode', kind: 'select', def: 'overlay',
    options: ['overlay', 'screen', 'multiply', 'add', 'soft light', 'burn', 'darken', 'difference', 'dodge', 'divide', 'exclusion', 'hard light', 'hard mix', 'lighten', 'linear burn', 'linear light', 'negation', 'pin light', 'subtract', 'vivid light', 'overwrite'],
  }],
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
      burn: `(1.0 - (1.0 - ${l}) / max(${b}, vec3(1e-5)))`,
      darken: `min(${l}, ${b})`,
      difference: `abs(${l} - ${b})`,
      dodge: `(${b} / max(1.0 - ${l}, vec3(1e-5)))`,
      divide: `(${b} / (${l} + 1e-5))`,
      exclusion: `(${l} + ${b} - 2.0 * ${l} * ${b})`,
      'hard light': `mix(1.0 - 2.0 * (1.0 - ${b}) * (1.0 - ${l}), 2.0 * ${b} * ${l}, step(${l}, vec3(0.5)))`,
      'hard mix': `step(1.0 - ${b}, ${l})`,
      lighten: `max(${l}, ${b})`,
      'linear burn': `(${b} + ${l} - 1.0)`,
      'linear light': `mix(max(${b} + 2.0 * ${l} - 1.0, 0.0), min(${b} + 2.0 * (${l} - 0.5), 1.0), step(0.5, ${l}))`,
      negation: `(1.0 - abs(1.0 - ${l} - ${b}))`,
      'pin light': `mix(min(2.0 * ${b}, ${l}), max(2.0 * (${b} - 0.5), ${l}), step(0.5, ${l}))`,
      subtract: `(${b} - ${l})`,
      'vivid light': `mix(1.0 - (1.0 - ${l}) / max(2.0 * ${b}, vec3(1e-5)), ${l} / max(2.0 * (1.0 - ${b}), vec3(1e-5)), step(0.5, ${b}))`,
      overwrite: `${l}`,
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
  desc: 'Alternating 0 and 1 squares. On blocks it uses Face UV, so Scale 2 gives four squares per face.',
  keywords: 'grid squares tiles checkerboard',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 's', name: 'Scale', type: 'float', def: 2 },
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
  type: 'wind', title: 'Wind Sway', cat: 'Pattern', graphs: ['terrain', 'entity'], width: 180,
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

// =============================================================================
// Unity Shader Graph parity. The nodes below mirror Shader Graph's node library
// (Input, Math, Trigonometry, Vector, Channel, Logic, Artistic, Normal, UV,
// Procedural and Utility), adapted to Minecraft and GLSL.
// =============================================================================

const lit3 = (v) => `vec3(${v.map((x) => (Number.isInteger(x) ? x.toFixed(1) : String(x))).join(', ')})`;

// ------------------------------------------------------------ More inputs

def({
  type: 'faceUV', title: 'Face UV', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'Runs 0 to 1 across every block face, worked out from the world position. Use it for per-block shapes, borders and patterns.',
  keywords: 'local uv block face tile per block square',
  outputs: [{ id: 'uv', name: 'UV', type: 'vec2' }],
  gen: () => ({ out: { uv: 'bg_faceUV' } }),
});

def({
  type: 'viewDir', title: 'View Direction', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'The direction from this point towards the camera.',
  keywords: 'eye camera vector view',
  outputs: [{ id: 'v', name: 'Direction', type: 'vec3' }],
  gen: () => ({ out: { v: 'bg_viewDir' } }),
});

def({
  type: 'screenPos', title: 'Screen Position', cat: 'Input', graphs: ['terrain', 'entity'], fragOnly: true,
  desc: 'Where this pixel lands on screen, from 0 to 1. Pixels gives the raw pixel coordinate.',
  keywords: 'screen space position pixel fragcoord',
  outputs: [
    { id: 'uv', name: 'UV', type: 'vec2' },
    { id: 'px', name: 'Pixels', type: 'vec2' },
  ],
  gen: () => ({ out: { uv: '(gl_FragCoord.xy / bg_resolution)', px: 'gl_FragCoord.xy' } }),
});

def({
  type: 'frontFace', title: 'Is Front Face', cat: 'Input', graphs: ['terrain', 'entity'], fragOnly: true,
  desc: '1 on the side of a face that points at you, 0 on its back. Handy for two-sided plants and glass.',
  keywords: 'backface side two sided gl_FrontFacing',
  outputs: [{ id: 'out', name: 'Front', type: 'float' }],
  gen: () => '(gl_FrontFacing ? 1.0 : 0.0)',
});

def({
  type: 'sunSky', title: 'Sun & Sky', cat: 'Input',
  desc: 'The direction to the sun in the world (Unity calls it Main Light Direction), plus the current sky and fog colours.',
  keywords: 'main light direction sun moon sky fog ambient color',
  outputs: [
    { id: 'sun', name: 'Sun Direction', type: 'vec3' },
    { id: 'sky', name: 'Sky Color', type: 'vec3' },
    { id: 'fog', name: 'Fog Color', type: 'vec3' },
  ],
  gen: () => ({ out: { sun: 'bg_sunDir', sky: 'bg_skyColor', fog: 'bg_fogColor' } }),
});

def({
  type: 'camera', title: 'Camera', cat: 'Input',
  desc: 'Where the player camera is in the world and which way it looks.',
  keywords: 'eye position forward player view',
  outputs: [
    { id: 'pos', name: 'Position', type: 'vec3' },
    { id: 'fwd', name: 'Forward', type: 'vec3' },
  ],
  gen: () => ({ out: { pos: 'bg_camPos', fwd: 'bg_camFwd' } }),
});

def({
  type: 'blockTextureLod', title: 'Block Texture LOD', cat: 'Input', graphs: ['terrain', 'entity'],
  desc: 'Samples the block texture at a chosen mip level, like Sample Texture 2D LOD. Higher levels are blurrier. Also works in Vertex Offset.',
  keywords: 'mip level lod sample texture blur',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'uv' },
    { id: 'lod', name: 'Level', type: 'float', def: 0 },
  ],
  outputs: [
    { id: 'rgb', name: 'RGB', type: 'vec3' },
    { id: 'a', name: 'Alpha', type: 'float' },
  ],
  gen: ({ I, V }) => ({ pre: `vec4 ${V}c = bg_sampleBlockLod(${I.uv}, ${I.lod});`, out: { rgb: `${V}c.rgb`, a: `${V}c.a` } }),
});

def({
  type: 'constant', title: 'Constant', cat: 'Settings', width: 160,
  desc: 'A maths constant: π, τ (2π), φ (golden ratio), e or √2.',
  keywords: 'pi tau phi e sqrt2 constant math',
  params: [{ id: 'which', name: 'Constant', kind: 'select', def: 'PI', options: ['PI', 'TAU', 'PHI', 'E', 'SQRT2'] }],
  outputs: [{ id: 'out', name: 'Value', type: 'float' }],
  gen: ({ P }) => ({ PI: '3.14159265', TAU: '6.28318531', PHI: '1.61803399', E: '2.71828183', SQRT2: '1.41421356' })[P.which] || '3.14159265',
});

def({
  type: 'choice', title: 'Dropdown Setting', cat: 'Settings', setting: 'choice', width: 200,
  desc: 'A list of named choices players pick from in Iris → Shader Settings, like a Unity Enum keyword. Outputs the index: 0, 1, 2…',
  keywords: 'enum keyword option dropdown select list quality iris menu exposed',
  params: [
    { id: 'name', name: 'Setting ID', kind: 'ident', def: 'MY_CHOICE' },
    { id: 'label', name: 'Label in Iris', kind: 'text', def: 'My Choice' },
    { id: 'options', name: 'Choices', kind: 'list', def: 'Low, Medium, High' },
    { id: 'value', name: 'Default', kind: 'number', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Index', type: 'float' }],
  gen: ({ P, settings, node }) => {
    settings.set(P.name, { kind: 'choice', node: node.id, ...P });
    return `float(${P.name})`;
  },
});

// ------------------------------------------------------------ More math

unary('exp', 'Exponential', 'e raised to the power of In. Grows very fast.', (x) => `exp(${x})`, 'exponent exp2 power');
unary('log', 'Log', 'Natural logarithm. The opposite of Exponential.', (x) => `log(max(${x}, 1e-6))`, 'logarithm ln log2');
unary('sqrt', 'Square Root', 'The number that, times itself, gives In.', (x) => `sqrt(max(${x}, 0.0))`, 'root');
unary('rsqrt', 'Reciprocal Square Root', '1 ÷ √In. Common in lighting maths.', (x) => `inversesqrt(max(${x}, 1e-6))`, 'inverse sqrt');
unary('reciprocal', 'Reciprocal', '1 ÷ In.', (x) => `(1.0 / ${x})`, 'inverse one over');
unary('ceil', 'Ceiling', 'Rounds up to the next whole number.', (x) => `ceil(${x})`, 'round up');
unary('round', 'Round', 'Rounds to the nearest whole number.', (x) => `floor(${x} + 0.5)`, 'nearest');
unary('sign', 'Sign', '−1 when negative, 0 at zero, 1 when positive.', (x) => `sign(${x})`, 'positive negative');
unary('trunc', 'Truncate', 'Drops the fraction, rounding towards zero.', (x) => `trunc(${x})`, 'integer part');
unary('ddx', 'DDX', 'How fast In changes from one pixel to the next, sideways. Pixels only.', (x) => `dFdx(${x})`, 'derivative partial screen', { fragOnly: true });
unary('ddy', 'DDY', 'How fast In changes from one pixel to the next, up and down. Pixels only.', (x) => `dFdy(${x})`, 'derivative partial screen', { fragOnly: true });
unary('ddxy', 'DDXY', 'Total pixel-to-pixel change of In (fwidth). Used for crisp anti-aliased edges. Pixels only.', (x) => `fwidth(${x})`, 'derivative fwidth antialias', { fragOnly: true });
binary('modulo', 'Modulo', 'The remainder of A ÷ B. Makes values repeat.', (a, b) => `mod(${a}, ${b})`, 1, 'mod remainder repeat');

def({
  type: 'inverseLerp', title: 'Inverse Lerp', cat: 'Math', width: 160,
  desc: 'Where T sits between A and B: 0 at A, 1 at B. The opposite of Mix.',
  keywords: 'unlerp inverse interpolate percent',
  inputs: [
    { id: 'a', name: 'A', type: 'dyn', def: 0 },
    { id: 'b', name: 'B', type: 'dyn', def: 1 },
    { id: 't', name: 'T', type: 'dyn', def: 0.5 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `((${I.t} - ${I.a}) / (${I.b} - ${I.a}))`,
});

def({
  type: 'randomRange', title: 'Random Range', cat: 'Math', width: 170,
  desc: 'A random number between Min and Max for each seed. Floor the world position first to get one value per block.',
  keywords: 'random hash rand',
  inputs: [
    { id: 'seed', name: 'Seed', type: 'vec3', bind: 'pos' },
    { id: 'lo', name: 'Min', type: 'float', def: 0 },
    { id: 'hi', name: 'Max', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `mix(${I.lo}, ${I.hi}, bg_hash13(${I.seed} * 1.37 + 0.123))`,
});

// ------------------------------------------------- Trigonometry & waves

function trig(type, title, desc, op, keywords, extra = {}) {
  unary(type, title, desc, op, keywords, { cat: 'Trig', ...extra });
}
NODE_DEFS.sine.cat = 'Trig';
NODE_DEFS.cosine.cat = 'Trig';
trig('tan', 'Tangent', 'sin ÷ cos. Shoots to infinity every half turn.', (x) => `tan(${x})`, 'tan');
trig('asin', 'Arcsine', 'The angle whose sine is In.', (x) => `asin(clamp(${x}, -1.0, 1.0))`, 'arcsin inverse');
trig('acos', 'Arccosine', 'The angle whose cosine is In.', (x) => `acos(clamp(${x}, -1.0, 1.0))`, 'arccos inverse');
trig('atan', 'Arctangent', 'The angle whose tangent is In.', (x) => `atan(${x})`, 'arctan inverse');
trig('degToRad', 'Degrees to Radians', 'Turns degrees into radians. 180° becomes π.', (x) => `radians(${x})`, 'angle convert');
trig('radToDeg', 'Radians to Degrees', 'Turns radians into degrees. π becomes 180°.', (x) => `degrees(${x})`, 'angle convert');
trig('squareWave', 'Square Wave', 'Flips between 1 and −1 every half step.', (x) => `(1.0 - 2.0 * floor(fract(${x}) + 0.5))`, 'pulse square');
trig('triangleWave', 'Triangle Wave', 'Rises and falls in straight lines between −1 and 1.', (x) => `(2.0 * abs(2.0 * (${x} - floor(0.5 + ${x}))) - 1.0)`, 'zigzag triangle');
trig('sawtoothWave', 'Sawtooth Wave', 'Climbs from −1 to 1, then snaps back.', (x) => `(2.0 * (${x} - floor(0.5 + ${x})))`, 'saw ramp');

def({
  type: 'atan2', title: 'Arctangent2', cat: 'Trig', width: 160,
  desc: 'The angle of the point (B, A). Great for spinning and radial patterns.',
  keywords: 'atan2 angle direction',
  inputs: [
    { id: 'a', name: 'A (y)', type: 'dyn', def: 0 },
    { id: 'b', name: 'B (x)', type: 'dyn', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `atan(${I.a}, ${I.b})`,
});

def({
  type: 'hyperbolic', title: 'Hyperbolic', cat: 'Trig', width: 160,
  desc: 'Hyperbolic sine, cosine or tangent. Tanh is a smooth S-curve that squashes any number into −1 to 1.',
  keywords: 'sinh cosh tanh',
  params: [{ id: 'fn', name: 'Function', kind: 'select', def: 'tanh', options: ['sinh', 'cosh', 'tanh'] }],
  inputs: [{ id: 'x', name: 'In', type: 'dyn', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I, P }) => `${['sinh', 'cosh', 'tanh'].includes(P.fn) ? P.fn : 'tanh'}(${I.x})`,
});

def({
  type: 'noiseSineWave', title: 'Noise Sine Wave', cat: 'Trig', width: 170,
  desc: 'A sine wave with a little random wobble added between Min and Max.',
  keywords: 'jitter wobble sine noise',
  inputs: [
    { id: 'x', name: 'In', type: 'dyn', def: 0 },
    { id: 'lo', name: 'Min', type: 'float', def: -0.5 },
    { id: 'hi', name: 'Max', type: 'float', def: 0.5 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I, V, T }) => ({
    pre: `${T} ${V}s = sin(${I.x}); ${T} ${V}r = fract(sin((${V}s - sin(${I.x} + 1.0)) * 91.1312) * 43758.5453);`,
    out: { out: `(${V}s + (${I.lo} + (${I.hi} - ${I.lo}) * ${V}r))` },
  }),
});

// ------------------------------------------------- Vector & channel

def({
  type: 'cross', title: 'Cross Product', cat: 'Vector', width: 160,
  desc: 'A direction at right angles to both A and B.',
  keywords: 'perpendicular cross',
  inputs: [
    { id: 'a', name: 'A', type: 'vec3', def: [1, 0, 0] },
    { id: 'b', name: 'B', type: 'vec3', def: [0, 1, 0] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `cross(${I.a}, ${I.b})`,
});

def({
  type: 'projection', title: 'Projection', cat: 'Vector', width: 160,
  desc: 'The part of A that points along B.',
  keywords: 'project shadow along',
  inputs: [
    { id: 'a', name: 'A', type: 'vec3', def: [1, 1, 0] },
    { id: 'b', name: 'B', type: 'vec3', def: [0, 1, 0] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({ pre: `vec3 ${V}b = ${I.b};`, out: { out: `(${V}b * (dot(${I.a}, ${V}b) / max(dot(${V}b, ${V}b), 1e-6)))` } }),
});

def({
  type: 'rejection', title: 'Rejection', cat: 'Vector', width: 160,
  desc: 'The part of A that is at right angles to B. A minus its Projection.',
  keywords: 'perpendicular remove reject',
  inputs: [
    { id: 'a', name: 'A', type: 'vec3', def: [1, 1, 0] },
    { id: 'b', name: 'B', type: 'vec3', def: [0, 1, 0] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({ pre: `vec3 ${V}a = ${I.a}; vec3 ${V}b = ${I.b};`, out: { out: `(${V}a - ${V}b * (dot(${V}a, ${V}b) / max(dot(${V}b, ${V}b), 1e-6)))` } }),
});

def({
  type: 'reflect', title: 'Reflection', cat: 'Vector', width: 160,
  desc: 'Bounces the In direction off a surface with the given normal, like a mirror.',
  keywords: 'mirror bounce reflect',
  inputs: [
    { id: 'i', name: 'In', type: 'vec3', def: [0, -1, 0] },
    { id: 'n', name: 'Normal', type: 'vec3', bind: 'normal' },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `reflect(${I.i}, normalize(${I.n}))`,
});

def({
  type: 'refract', title: 'Refract', cat: 'Vector', width: 180,
  desc: 'Bends the In direction as it passes through glass or water. IOR 1 is air, 1.33 is water, 1.5 is glass.',
  keywords: 'glass water bend ior',
  inputs: [
    { id: 'i', name: 'In', type: 'vec3', def: [0, -1, 0] },
    { id: 'n', name: 'Normal', type: 'vec3', bind: 'normal' },
    { id: 'src', name: 'IOR Source', type: 'float', def: 1 },
    { id: 'dst', name: 'IOR Medium', type: 'float', def: 1.33 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `refract(normalize(${I.i}), normalize(${I.n}), ${I.src} / max(${I.dst}, 1e-4))`,
});

def({
  type: 'rotateAxis', title: 'Rotate About Axis', cat: 'Vector', width: 180,
  desc: 'Spins a direction or position around an axis.',
  keywords: 'rotate spin turn axis angle',
  params: [{ id: 'unit', name: 'Angle unit', kind: 'select', def: 'degrees', options: ['degrees', 'radians'] }],
  inputs: [
    { id: 'v', name: 'In', type: 'vec3', def: [1, 0, 0] },
    { id: 'axis', name: 'Axis', type: 'vec3', def: [0, 1, 0] },
    { id: 'angle', name: 'Angle', type: 'float', def: 45 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, P }) => `bg_rotateAxis(${I.v}, ${I.axis}, ${P.unit === 'radians' ? I.angle : `radians(${I.angle})`})`,
});

def({
  type: 'sphereMask', title: 'Sphere Mask', cat: 'Vector', width: 180,
  desc: '1 inside a sphere around Center, fading to 0 outside. Hardness sets how sharp the edge is.',
  keywords: 'radius distance falloff circle mask',
  inputs: [
    { id: 'p', name: 'Coords', type: 'vec3', bind: 'pos' },
    { id: 'c', name: 'Center', type: 'vec3', def: [0, 64, 0] },
    { id: 'r', name: 'Radius', type: 'float', def: 8 },
    { id: 'h', name: 'Hardness', type: 'float', def: 0.8 },
  ],
  outputs: [{ id: 'out', name: 'Mask', type: 'float' }],
  gen: ({ I }) => `(1.0 - clamp((distance(${I.p}, ${I.c}) - ${I.r}) / max(1.0 - ${I.h}, 1e-4) / max(${I.r}, 1e-4), 0.0, 1.0))`,
});

def({
  type: 'swizzle', title: 'Swizzle', cat: 'Vector', width: 160,
  desc: 'Reorders or repeats channels. "zyx" reverses a vector, "xxx" copies X into all three, "rg" keeps red and green.',
  keywords: 'reorder channels xyzw rgba shuffle',
  params: [{ id: 'mask', name: 'Mask', kind: 'swizzle', def: 'zyx' }],
  inputs: [{ id: 'v', name: 'In', type: 'vec4', def: [0, 0, 0, 0] }],
  outputs: [{ id: 'out', name: 'Out', type: (P) => ['float', 'vec2', 'vec3', 'vec4'][swizzleMask(P.mask).length - 1] }],
  gen: ({ I, P }) => `(${I.v}).${swizzleMask(P.mask)}`,
});

export function swizzleMask(m) {
  const map = { r: 'x', g: 'y', b: 'z', a: 'w', x: 'x', y: 'y', z: 'z', w: 'w' };
  const out = String(m || '').toLowerCase().split('').map((c) => map[c]).filter(Boolean).join('').slice(0, 4);
  return out || 'x';
}

def({
  type: 'flip', title: 'Flip', cat: 'Vector', width: 160,
  desc: 'Turns the chosen channels negative.',
  keywords: 'negate invert channel sign',
  params: [{ id: 'which', name: 'Flip', kind: 'select', def: 'x', options: ['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz', 'xyzw'] }],
  inputs: [{ id: 'v', name: 'In', type: 'dyn', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I, P, T }) => {
    const n = TYPE_RANK[T];
    const s = 'xyzw'.slice(0, n).split('').map((c) => (String(P.which).includes(c) ? '-1.0' : '1.0'));
    return n === 1 ? `(${I.v} * ${s[0]})` : `(${I.v} * ${T}(${s.join(', ')}))`;
  },
});

def({
  type: 'channelMask', title: 'Channel Mask', cat: 'Vector', width: 170,
  desc: 'Keeps only the chosen channels and sets the rest to 0.',
  keywords: 'keep channel rgba isolate',
  params: [{ id: 'keep', name: 'Keep', kind: 'select', def: 'R', options: ['R', 'G', 'B', 'A', 'RG', 'RB', 'GB', 'RGB', 'RGBA'] }],
  inputs: [{ id: 'v', name: 'In', type: 'dyn', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I, P, T }) => {
    const n = TYPE_RANK[T];
    const s = 'RGBA'.slice(0, n).split('').map((c) => (String(P.keep).includes(c) ? '1.0' : '0.0'));
    return n === 1 ? `(${I.v} * ${s[0]})` : `(${I.v} * ${T}(${s.join(', ')}))`;
  },
});

// ----------------------------------------------------------------- Logic

def({
  type: 'branch', title: 'Branch', cat: 'Logic', width: 160,
  desc: 'Picks True when the Predicate is on (above 0.5), otherwise False. Like an if/else.',
  keywords: 'if else condition switch select',
  inputs: [
    { id: 'p', name: 'Predicate', type: 'float', def: 1 },
    { id: 't', name: 'True', type: 'dyn', def: 1 },
    { id: 'f', name: 'False', type: 'dyn', def: 0 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `mix(${I.f}, ${I.t}, step(0.5, ${I.p}))`,
});

def({
  type: 'comparison', title: 'Comparison', cat: 'Logic', width: 170,
  desc: 'Compares A and B. Gives 1 when the comparison is true, 0 when it is false.',
  keywords: 'compare equal less greater if test',
  params: [{ id: 'op', name: 'Test', kind: 'select', def: 'A > B', options: ['A = B', 'A ≠ B', 'A < B', 'A ≤ B', 'A > B', 'A ≥ B'] }],
  inputs: [
    { id: 'a', name: 'A', type: 'float', def: 0 },
    { id: 'b', name: 'B', type: 'float', def: 0.5 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I, P }) => {
    const ops = { 'A = B': '==', 'A ≠ B': '!=', 'A < B': '<', 'A ≤ B': '<=', 'A > B': '>', 'A ≥ B': '>=' };
    return `((${I.a} ${ops[P.op] || '>'} ${I.b}) ? 1.0 : 0.0)`;
  },
});

def({
  type: 'and', title: 'And', cat: 'Logic', width: 140,
  desc: '1 only when both A and B are on (above 0.5).',
  keywords: 'both logic boolean',
  inputs: [{ id: 'a', name: 'A', type: 'float', def: 1 }, { id: 'b', name: 'B', type: 'float', def: 1 }],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `(step(0.5, ${I.a}) * step(0.5, ${I.b}))`,
});

def({
  type: 'or', title: 'Or', cat: 'Logic', width: 140,
  desc: '1 when A or B (or both) are on.',
  keywords: 'either logic boolean',
  inputs: [{ id: 'a', name: 'A', type: 'float', def: 0 }, { id: 'b', name: 'B', type: 'float', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `max(step(0.5, ${I.a}), step(0.5, ${I.b}))`,
});

def({
  type: 'not', title: 'Not', cat: 'Logic', width: 140,
  desc: 'Flips on and off.',
  keywords: 'invert logic boolean',
  inputs: [{ id: 'x', name: 'In', type: 'float', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  gen: ({ I }) => `(1.0 - step(0.5, ${I.x}))`,
});

// ------------------------------------------------------- Color (artistic)

def({
  type: 'whiteBalance', title: 'White Balance', cat: 'Color', width: 180,
  desc: 'Warms or cools the colour (Temperature) and shifts it green or magenta (Tint). −1 to 1, using Unity’s maths.',
  keywords: 'temperature tint warm cool grading',
  inputs: [
    { id: 'c', name: 'Color', type: 'vec3', def: [1, 1, 1] },
    { id: 't', name: 'Temperature', type: 'float', def: 0.2 },
    { id: 'n', name: 'Tint', type: 'float', def: 0 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I }) => `bg_whiteBalance(${I.c}, ${I.t}, ${I.n})`,
});

def({
  type: 'replaceColor', title: 'Replace Color', cat: 'Color', width: 190,
  desc: 'Swaps one colour for another. Range widens the match, Fuzziness softens its edge.',
  keywords: 'swap recolor key change',
  inputs: [
    { id: 'c', name: 'In', type: 'vec3', def: [1, 1, 1] },
    { id: 'from', name: 'From', type: 'vec3', def: [0.4, 0.6, 0.25], color: true },
    { id: 'to', name: 'To', type: 'vec3', def: [0.85, 0.35, 0.2], color: true },
    { id: 'range', name: 'Range', type: 'float', def: 0.2 },
    { id: 'fuzz', name: 'Fuzziness', type: 'float', def: 0.1 },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({
    pre: `vec3 ${V}c = ${I.c};`,
    out: { out: `mix(${I.to}, ${V}c, clamp((distance(${I.from}, ${V}c) - ${I.range}) / max(${I.fuzz}, 1e-5), 0.0, 1.0))` },
  }),
});

def({
  type: 'colorMask', title: 'Color Mask', cat: 'Color', width: 180,
  desc: '1 where the input is close to the mask colour, 0 elsewhere.',
  keywords: 'select key pick color',
  inputs: [
    { id: 'c', name: 'In', type: 'vec3', def: [1, 1, 1] },
    { id: 'm', name: 'Mask Color', type: 'vec3', def: [0.4, 0.6, 0.25], color: true },
    { id: 'range', name: 'Range', type: 'float', def: 0.2 },
    { id: 'fuzz', name: 'Fuzziness', type: 'float', def: 0.1 },
  ],
  outputs: [{ id: 'out', name: 'Mask', type: 'float' }],
  gen: ({ I }) => `clamp(1.0 - (distance(${I.m}, ${I.c}) - ${I.range}) / max(${I.fuzz}, 1e-5), 0.0, 1.0)`,
});

def({
  type: 'channelMixer', title: 'Channel Mixer', cat: 'Color', width: 180,
  desc: 'Builds each output channel from a mix of the input red, green and blue. Set the mixes in the inspector.',
  keywords: 'mixer swap channels grading',
  inputs: [
    { id: 'c', name: 'In', type: 'vec3', def: [1, 1, 1] },
    { id: 'r', name: 'Red Out', type: 'vec3', def: [1, 0, 0] },
    { id: 'g', name: 'Green Out', type: 'vec3', def: [0, 1, 0] },
    { id: 'b', name: 'Blue Out', type: 'vec3', def: [0, 0, 1] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, V }) => ({ pre: `vec3 ${V}c = ${I.c};`, out: { out: `vec3(dot(${V}c, ${I.r}), dot(${V}c, ${I.g}), dot(${V}c, ${I.b}))` } }),
});

def({
  type: 'invertColors', title: 'Invert Colors', cat: 'Color', width: 170,
  desc: 'Turns the chosen channels into their opposite, like a photo negative.',
  keywords: 'negative invert one minus',
  params: [{ id: 'which', name: 'Invert', kind: 'select', def: 'RGB', options: ['RGB', 'R', 'G', 'B', 'RG', 'GB', 'RB'] }],
  inputs: [{ id: 'c', name: 'In', type: 'vec3', def: [1, 1, 1] }],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, P, V }) => {
    const m = 'RGB'.split('').map((c) => (String(P.which).includes(c) ? '1.0' : '0.0'));
    return { pre: `vec3 ${V}c = ${I.c};`, out: { out: `mix(${V}c, 1.0 - ${V}c, vec3(${m.join(', ')}))` } };
  },
});

def({
  type: 'colorspace', title: 'Colorspace Conversion', cat: 'Color', width: 200,
  desc: 'Converts between RGB, Linear and HSV. In HSV, X is hue, Y saturation and Z brightness.',
  keywords: 'hsv linear srgb gamma convert',
  params: [
    { id: 'from', name: 'From', kind: 'select', def: 'RGB', options: ['RGB', 'Linear', 'HSV'] },
    { id: 'to', name: 'To', kind: 'select', def: 'HSV', options: ['RGB', 'Linear', 'HSV'] },
  ],
  inputs: [{ id: 'c', name: 'In', type: 'vec3', def: [1, 0.5, 0.2] }],
  outputs: [{ id: 'out', name: 'Out', type: 'vec3' }],
  gen: ({ I, P }) => {
    const f = P.from, t = P.to, c = I.c;
    if (f === t) return c;
    if (f === 'RGB' && t === 'Linear') return `bg_toLinear(${c})`;
    if (f === 'Linear' && t === 'RGB') return `bg_toSRGB(${c})`;
    if (f === 'RGB' && t === 'HSV') return `bg_rgb2hsv(${c})`;
    if (f === 'HSV' && t === 'RGB') return `bg_hsv2rgb(${c})`;
    if (f === 'Linear' && t === 'HSV') return `bg_rgb2hsv(bg_toSRGB(${c}))`;
    return `bg_toLinear(bg_hsv2rgb(${c}))`;
  },
});

def({
  type: 'dither', title: 'Dither', cat: 'Color', width: 160, fragOnly: true,
  desc: 'Subtracts an ordered 4×4 dither pattern. Feed it into Alpha for see-through fades without sorting problems.',
  keywords: 'bayer screen door transparency fade',
  inputs: [{ id: 'x', name: 'In', type: 'dyn', def: 0.5 }],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => `(${I.x} - bg_bayer4(gl_FragCoord.xy))`,
});

def({
  type: 'metal', title: 'Metal Reflectance', cat: 'Color', width: 180,
  desc: 'Measured colours of real metals. Plug into Color with Metallic at 1 on the Block Output.',
  keywords: 'pbr metallic gold iron copper silver',
  params: [{ id: 'm', name: 'Metal', kind: 'select', def: 'Gold', options: ['Iron', 'Silver', 'Aluminium', 'Gold', 'Copper', 'Chromium', 'Nickel', 'Titanium', 'Cobalt', 'Platinum'] }],
  outputs: [{ id: 'rgb', name: 'Color', type: 'vec3' }],
  gen: ({ P }) => {
    const M = {
      Iron: [0.56, 0.57, 0.58], Silver: [0.972, 0.96, 0.915], Aluminium: [0.913, 0.921, 0.925], Gold: [1.0, 0.766, 0.336],
      Copper: [0.955, 0.637, 0.538], Chromium: [0.55, 0.556, 0.554], Nickel: [0.66, 0.609, 0.526], Titanium: [0.542, 0.497, 0.449],
      Cobalt: [0.662, 0.655, 0.634], Platinum: [0.672, 0.637, 0.585],
    };
    return { out: { rgb: lit3(M[P.m] || M.Gold) } };
  },
});

def({
  type: 'blackbody', title: 'Blackbody', cat: 'Color', width: 170,
  desc: 'The colour something glows at a temperature in Kelvin: 1500 is ember red, 6500 is white, 12000 is blue.',
  keywords: 'temperature kelvin fire heat glow',
  inputs: [{ id: 't', name: 'Kelvin', type: 'float', def: 2500 }],
  outputs: [{ id: 'rgb', name: 'Color', type: 'vec3' }],
  gen: ({ I }) => ({ out: { rgb: `bg_blackbody(${I.t})` } }),
});

def({
  type: 'gradient', title: 'Gradient', cat: 'Color', width: 200,
  desc: 'Maps 0–1 onto a colour ramp, like Unity’s Gradient and Sample Gradient nodes. Edit the stops in the inspector.',
  keywords: 'ramp colour map lut sample gradient',
  params: [
    { id: 'stops', name: 'Stops', kind: 'gradient', def: [{ c: '#1d1b5e', t: 0 }, { c: '#d6493b', t: 0.5 }, { c: '#ffe08a', t: 1 }] },
    { id: 'mode', name: 'Mode', kind: 'select', def: 'blend', options: ['blend', 'fixed'] },
  ],
  inputs: [{ id: 't', name: 'T', type: 'float', def: 0.5 }],
  outputs: [{ id: 'rgb', name: 'Color', type: 'vec3' }],
  gen: ({ I, P, V }) => {
    const stops = normStops(P.stops);
    const lines = [`float ${V}t = clamp(${I.t}, 0.0, 1.0);`, `vec3 ${V}g = ${lit3(hexToLinear(stops[0].c))};`];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1].t, b = stops[i].t;
      const col = lit3(hexToLinear(stops[i].c));
      const k = P.mode === 'fixed'
        ? `step(${fnum(b)}, ${V}t)`
        : `clamp((${V}t - ${fnum(a)}) / ${fnum(Math.max(b - a, 1e-4))}, 0.0, 1.0)`;
      lines.push(`${V}g = mix(${V}g, ${col}, ${k});`);
    }
    return { pre: lines.join('\n'), out: { rgb: `${V}g` } };
  },
});

export function normStops(stops) {
  const list = (Array.isArray(stops) ? stops : []).filter((s) => s && /^#[0-9a-f]{6}$/i.test(s.c)).map((s) => ({ c: s.c, t: Math.max(0, Math.min(1, Number(s.t) || 0)) }));
  if (!list.length) return [{ c: '#000000', t: 0 }, { c: '#ffffff', t: 1 }];
  return list.sort((a, b) => a.t - b.t).slice(0, 8);
}

function fnum(n) {
  let s = String(Math.round(Number(n) * 10000) / 10000);
  if (!/[.e]/.test(s)) s += '.0';
  return s;
}

// ------------------------------------------------------------------ Normal

def({
  type: 'normalFromHeight', title: 'Normal From Height', cat: 'Normal', graphs: ['terrain', 'entity'], fragOnly: true, width: 190,
  desc: 'Turns a height pattern (like Noise) into bumps the light can catch. Plug into Block Output → Normal with Lit lighting on.',
  keywords: 'bump height map normal map derivative',
  inputs: [
    { id: 'h', name: 'Height', type: 'float', def: 0 },
    { id: 's', name: 'Strength', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'n', name: 'Normal', type: 'vec3' }],
  gen: ({ I }) => `bg_bumpNormal(${I.h}, ${I.s}, bg_normal, bg_worldPos)`,
});

def({
  type: 'normalStrength', title: 'Normal Strength', cat: 'Normal', graphs: ['terrain', 'entity'], width: 180,
  desc: 'Makes bumps stronger or weaker. 0 gives the flat face normal, 1 keeps the input.',
  keywords: 'bump intensity flatten',
  inputs: [
    { id: 'n', name: 'Normal', type: 'vec3', bind: 'normal' },
    { id: 's', name: 'Strength', type: 'float', def: 0.5 },
  ],
  outputs: [{ id: 'out', name: 'Normal', type: 'vec3' }],
  gen: ({ I }) => `normalize(mix(bg_normal, ${I.n}, ${I.s}))`,
});

def({
  type: 'normalBlend', title: 'Normal Blend', cat: 'Normal', graphs: ['terrain', 'entity'], width: 170,
  desc: 'Combines the bumps of two normals into one.',
  keywords: 'combine bumps detail',
  inputs: [
    { id: 'a', name: 'A', type: 'vec3', bind: 'normal' },
    { id: 'b', name: 'B', type: 'vec3', bind: 'normal' },
  ],
  outputs: [{ id: 'out', name: 'Normal', type: 'vec3' }],
  gen: ({ I }) => `normalize(${I.a} + ${I.b} - bg_normal)`,
});

// ---------------------------------------------------------------------- UV

def({
  type: 'tilingOffset', title: 'Tiling And Offset', cat: 'UV', width: 180,
  desc: 'Repeats (Tiling) and slides (Offset) a UV.',
  keywords: 'tile repeat scroll scale uv',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 't', name: 'Tiling', type: 'vec2', def: [1, 1] },
    { id: 'o', name: 'Offset', type: 'vec2', def: [0, 0] },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I }) => `(${I.uv} * ${I.t} + ${I.o})`,
});

def({
  type: 'rotateUV', title: 'Rotate', cat: 'UV', width: 170,
  desc: 'Spins a UV around a center point. Rotation is in radians.',
  keywords: 'spin turn uv rotate',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 'c', name: 'Center', type: 'vec2', def: [0.5, 0.5] },
    { id: 'r', name: 'Rotation', type: 'float', def: 0.785 },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}d = ${I.uv} - ${I.c}; float ${V}s = sin(${I.r}); float ${V}k = cos(${I.r});`,
    out: { out: `(vec2(${V}d.x * ${V}k + ${V}d.y * ${V}s, -${V}d.x * ${V}s + ${V}d.y * ${V}k) + ${I.c})` },
  }),
});

def({
  type: 'twirl', title: 'Twirl', cat: 'UV', width: 170,
  desc: 'Swirls a UV around a center, like a whirlpool. Try it on Scene Color in Post FX.',
  keywords: 'swirl spiral vortex whirlpool',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 'c', name: 'Center', type: 'vec2', def: [0.5, 0.5] },
    { id: 's', name: 'Strength', type: 'float', def: 6 },
    { id: 'o', name: 'Offset', type: 'vec2', def: [0, 0] },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}d = ${I.uv} - ${I.c}; float ${V}a = ${I.s} * length(${V}d);`,
    out: { out: `(vec2(cos(${V}a) * ${V}d.x - sin(${V}a) * ${V}d.y, sin(${V}a) * ${V}d.x + cos(${V}a) * ${V}d.y) + ${I.c} + ${I.o})` },
  }),
});

def({
  type: 'polar', title: 'Polar Coordinates', cat: 'UV', width: 190,
  desc: 'Turns a UV into distance from the center (X) and angle around it (Y). Makes rings and spokes.',
  keywords: 'radial circle angle rings',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 'c', name: 'Center', type: 'vec2', def: [0.5, 0.5] },
    { id: 'rs', name: 'Radial Scale', type: 'float', def: 1 },
    { id: 'ls', name: 'Length Scale', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}d = ${I.uv} - ${I.c};`,
    out: { out: `vec2(length(${V}d) * 2.0 * ${I.rs}, atan(${V}d.x, ${V}d.y) * 0.15915494 * ${I.ls})` },
  }),
});

def({
  type: 'spherize', title: 'Spherize', cat: 'UV', width: 170,
  desc: 'Bulges a UV out from the center like a fisheye lens.',
  keywords: 'fisheye bulge lens warp',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 'c', name: 'Center', type: 'vec2', def: [0.5, 0.5] },
    { id: 's', name: 'Strength', type: 'vec2', def: [10, 10] },
    { id: 'o', name: 'Offset', type: 'vec2', def: [0, 0] },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}uv = ${I.uv}; vec2 ${V}d = ${V}uv - ${I.c}; float ${V}d2 = dot(${V}d, ${V}d);`,
    out: { out: `(${V}uv + ${V}d * (${V}d2 * ${V}d2 * ${I.s}) + ${I.o})` },
  }),
});

def({
  type: 'radialShear', title: 'Radial Shear', cat: 'UV', width: 170,
  desc: 'Twists a UV sideways more and more towards the edges.',
  keywords: 'warp twist shear',
  inputs: [
    { id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' },
    { id: 'c', name: 'Center', type: 'vec2', def: [0.5, 0.5] },
    { id: 's', name: 'Strength', type: 'vec2', def: [10, 10] },
    { id: 'o', name: 'Offset', type: 'vec2', def: [0, 0] },
  ],
  outputs: [{ id: 'out', name: 'UV', type: 'vec2' }],
  gen: ({ I, V }) => ({
    pre: `vec2 ${V}uv = ${I.uv}; vec2 ${V}d = ${V}uv - ${I.c}; float ${V}d2 = dot(${V}d, ${V}d);`,
    out: { out: `(${V}uv + vec2(${V}d.y, -${V}d.x) * (${V}d2 * ${I.s}) + ${I.o})` },
  }),
});

// -------------------------------------------------------------- Procedural

def({
  type: 'gradientNoise', title: 'Gradient Noise', cat: 'Pattern', width: 180,
  desc: 'Smooth Perlin-style noise from 0 to 1. Softer and less blocky than Noise.',
  keywords: 'perlin gradient noise smooth',
  inputs: [
    { id: 'p', name: 'Position', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
  ],
  outputs: [{ id: 'out', name: 'Noise', type: 'float' }],
  gen: ({ I }) => `bg_gradNoise3(${I.p} * ${I.s})`,
});

def({
  type: 'voronoi', title: 'Voronoi', cat: 'Pattern', width: 180,
  desc: 'Cell pattern like cracked mud or crystals. Distance is 0 at each cell centre; Cells gives each cell its own random value.',
  keywords: 'cells worley crystal crack cellular',
  inputs: [
    { id: 'p', name: 'Position', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Cell Density', type: 'float', def: 1 },
    { id: 'j', name: 'Randomness', type: 'float', def: 1 },
  ],
  outputs: [
    { id: 'd', name: 'Distance', type: 'float' },
    { id: 'cells', name: 'Cells', type: 'float' },
  ],
  gen: ({ I, V }) => ({ pre: `vec2 ${V}v = bg_voronoi3(${I.p} * ${I.s}, ${I.j});`, out: { d: `${V}v.x`, cells: `${V}v.y` } }),
});

function shape(type, title, desc, extraInputs, body, keywords) {
  def({
    type, title, cat: 'Pattern', width: 180, fragOnly: true, desc, keywords,
    inputs: [{ id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' }, ...extraInputs],
    outputs: [{ id: 'out', name: 'Out', type: 'float' }],
    gen: body,
  });
}

shape('ellipse', 'Ellipse', 'A soft-edged ellipse in the middle of the UV. Width and height of 1 fill it.', [
  { id: 'w', name: 'Width', type: 'float', def: 0.6 },
  { id: 'h', name: 'Height', type: 'float', def: 0.6 },
], ({ I, V }) => ({
  pre: `float ${V}d = length((${I.uv} * 2.0 - 1.0) / vec2(${I.w}, ${I.h}));`,
  out: { out: `clamp((1.0 - ${V}d) / max(fwidth(${V}d), 1e-5), 0.0, 1.0)` },
}), 'circle oval shape');

shape('rectangle', 'Rectangle', 'A crisp rectangle in the middle of the UV. Great for block borders.', [
  { id: 'w', name: 'Width', type: 'float', def: 0.8 },
  { id: 'h', name: 'Height', type: 'float', def: 0.8 },
], ({ I, V }) => ({
  pre: `vec2 ${V}d = abs(${I.uv} * 2.0 - 1.0) - vec2(${I.w}, ${I.h}); ${V}d = 1.0 - ${V}d / max(fwidth(${V}d), vec2(1e-5));`,
  out: { out: `clamp(min(${V}d.x, ${V}d.y), 0.0, 1.0)` },
}), 'square box border frame shape');

shape('roundedRect', 'Rounded Rectangle', 'A rectangle with rounded corners.', [
  { id: 'w', name: 'Width', type: 'float', def: 0.8 },
  { id: 'h', name: 'Height', type: 'float', def: 0.8 },
  { id: 'r', name: 'Radius', type: 'float', def: 0.2 },
], ({ I, V }) => ({
  pre: `float ${V}r = max(min(min(abs(${I.r} * 2.0), abs(${I.w})), abs(${I.h})), 1e-5); vec2 ${V}q = abs(${I.uv} * 2.0 - 1.0) - vec2(${I.w}, ${I.h}) + ${V}r; float ${V}d = length(max(vec2(0.0), ${V}q)) / ${V}r;`,
  out: { out: `clamp((1.0 - ${V}d) / max(fwidth(${V}d), 1e-5), 0.0, 1.0)` },
}), 'rounded box shape');

shape('polygon', 'Polygon', 'A regular polygon: 3 sides for a triangle, 6 for a hexagon.', [
  { id: 'n', name: 'Sides', type: 'float', def: 6 },
  { id: 'w', name: 'Width', type: 'float', def: 0.7 },
  { id: 'h', name: 'Height', type: 'float', def: 0.7 },
], ({ I, V }) => ({
  pre: [
    `float ${V}n = max(${I.n}, 3.0); float ${V}c = cos(3.14159265 / ${V}n);`,
    `vec2 ${V}uv = (${I.uv} * 2.0 - 1.0) / vec2(${I.w} * ${V}c, ${I.h} * ${V}c); ${V}uv.y *= -1.0;`,
    `float ${V}p = atan(${V}uv.x, ${V}uv.y); float ${V}r = 6.28318531 / ${V}n;`,
    `float ${V}d = cos(floor(0.5 + ${V}p / ${V}r) * ${V}r - ${V}p) * length(${V}uv);`,
  ].join('\n'),
  out: { out: `clamp((1.0 - ${V}d) / max(fwidth(${V}d), 1e-5), 0.0, 1.0)` },
}), 'hexagon triangle star shape');

// ---------------------------------------------------- Blender texture nodes
// Blender's procedural textures (Brick, Wave, Magic, Musgrave, White Noise).
// They work in every graph, and are the main tools of the Textures tab.

def({
  type: 'brick', title: 'Brick Texture', cat: 'Pattern', width: 200,
  desc: 'Rows of bricks with mortar between them, like Blender’s Brick Texture. Each brick gets a random mix of Color 1 and Color 2.',
  keywords: 'bricks wall tiles mortar blender',
  inputs: [
    { id: 'uv', name: 'Vector', type: 'vec2', bind: 'faceuv' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
    { id: 'm', name: 'Mortar Size', type: 'float', def: 0.06 },
    { id: 'bw', name: 'Brick Width', type: 'float', def: 0.5 },
    { id: 'rh', name: 'Row Height', type: 'float', def: 0.25 },
    { id: 'off', name: 'Offset', type: 'float', def: 0.5 },
    { id: 'c1', name: 'Color 1', type: 'vec3', def: [0.62, 0.3, 0.22], color: true },
    { id: 'c2', name: 'Color 2', type: 'vec3', def: [0.5, 0.22, 0.16], color: true },
    { id: 'mc', name: 'Mortar', type: 'vec3', def: [0.72, 0.69, 0.63], color: true },
  ],
  outputs: [
    { id: 'rgb', name: 'Color', type: 'vec3' },
    { id: 'fac', name: 'Fac (mortar)', type: 'float' },
  ],
  gen: ({ I, V }) => ({
    pre: [
      `vec2 ${V}p = ${I.uv} * ${I.s}; float ${V}bw = max(${I.bw}, 1e-3); float ${V}rh = max(${I.rh}, 1e-3);`,
      `float ${V}row = floor(${V}p.y / ${V}rh); float ${V}x = ${V}p.x / ${V}bw + ${I.off} * mod(${V}row, 2.0);`,
      `vec2 ${V}cell = vec2(floor(${V}x), ${V}row); vec2 ${V}lu = vec2(fract(${V}x), fract(${V}p.y / ${V}rh));`,
      `float ${V}edge = min(min(${V}lu.x, 1.0 - ${V}lu.x) * ${V}bw, min(${V}lu.y, 1.0 - ${V}lu.y) * ${V}rh);`,
      `float ${V}mort = 1.0 - step(${I.m} * 0.5, ${V}edge);`,
    ].join('\n'),
    out: {
      rgb: `mix(mix(${I.c1}, ${I.c2}, bg_hash12(${V}cell + 17.0)), ${I.mc}, ${V}mort)`,
      fac: `${V}mort`,
    },
  }),
});

def({
  type: 'waveTexture', title: 'Wave Texture', cat: 'Pattern', width: 200,
  desc: 'Stripes (Bands) or circles (Rings), optionally warped by noise. Like Blender’s Wave Texture, good for wood, marble and sand ripples.',
  keywords: 'stripes bands rings wood marble blender wave',
  params: [
    { id: 'kind', name: 'Type', kind: 'select', def: 'bands', options: ['bands', 'rings'] },
    { id: 'dir', name: 'Direction', kind: 'select', def: 'diagonal', options: ['x', 'y', 'z', 'diagonal'] },
    { id: 'profile', name: 'Profile', kind: 'select', def: 'sine', options: ['sine', 'saw', 'triangle'] },
  ],
  inputs: [
    { id: 'p', name: 'Vector', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
    { id: 'd', name: 'Distortion', type: 'float', def: 2 },
    { id: 'ds', name: 'Detail Scale', type: 'float', def: 1 },
  ],
  outputs: [
    { id: 'rgb', name: 'Color', type: 'vec3' },
    { id: 'fac', name: 'Fac', type: 'float' },
  ],
  gen: ({ I, P, V }) => {
    const p = `${V}p`;
    const bands = { x: `${p}.x * 20.0`, y: `${p}.y * 20.0`, z: `${p}.z * 20.0`, diagonal: `(${p}.x + ${p}.y + ${p}.z) * 10.0` };
    const rings = { x: `length(${p}.yz) * 20.0`, y: `length(${p}.xz) * 20.0`, z: `length(${p}.xy) * 20.0`, diagonal: `length(${p}) * 20.0` };
    const n = (P.kind === 'rings' ? rings : bands)[P.dir] || bands.diagonal;
    const prof = {
      sine: `(0.5 + 0.5 * sin(${V}n - 1.5707963))`,
      saw: `fract(${V}n * 0.15915494)`,
      triangle: `(abs(fract(${V}n * 0.15915494 + 0.5) - 0.5) * 2.0)`,
    }[P.profile] || `(0.5 + 0.5 * sin(${V}n - 1.5707963))`;
    return {
      pre: `vec3 ${p} = (${I.p} + 1e-6) * ${I.s}; float ${V}n = ${n} + ${I.d} * (bg_fbm3(${p} * ${I.ds}, 3) * 2.0 - 1.0); float ${V}f = ${prof};`,
      out: { rgb: `vec3(${V}f)`, fac: `${V}f` },
    };
  },
});

def({
  type: 'magic', title: 'Magic Texture', cat: 'Pattern', width: 190,
  desc: 'Blender’s psychedelic swirl texture. More depth adds more swirls. Try it through Blackbody or a Gradient for lava and magic effects.',
  keywords: 'psychedelic swirl trippy magic lava blender',
  params: [{ id: 'depth', name: 'Depth', kind: 'select', def: '2', options: ['1', '2', '3', '4', '5', '6'] }],
  inputs: [
    { id: 'p', name: 'Vector', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
    { id: 'd', name: 'Distortion', type: 'float', def: 1 },
  ],
  outputs: [
    { id: 'rgb', name: 'Color', type: 'vec3' },
    { id: 'fac', name: 'Fac', type: 'float' },
  ],
  gen: ({ I, P, V }) => {
    const n = Math.max(1, Math.min(6, parseInt(P.depth, 10) || 2));
    const x = `${V}x`, y = `${V}y`, z = `${V}z`, d = `${V}d`;
    const steps = [
      `${x} *= ${d}; ${y} *= ${d}; ${z} *= ${d}; ${y} = -cos(${x} - ${y} + ${z}); ${y} *= ${d};`,
      `${x} = cos(${x} - ${y} - ${z}); ${x} *= ${d};`,
      `${z} = sin(-${x} - ${y} - ${z}); ${z} *= ${d};`,
      `${x} = -cos(-${x} + ${y} - ${z}); ${x} *= ${d};`,
      `${y} = -sin(-${x} + ${y} + ${z}); ${y} *= ${d};`,
      `${y} = -cos(-${x} + ${y} + ${z}); ${y} *= ${d};`,
    ];
    return {
      pre: [
        `vec3 ${V}p = ${I.p} * ${I.s} * 5.0; float ${d} = ${I.d};`,
        `float ${x} = sin((${V}p.x + ${V}p.y + ${V}p.z) * 5.0);`,
        `float ${y} = cos((-${V}p.x + ${V}p.y - ${V}p.z) * 5.0);`,
        `float ${z} = -cos((-${V}p.x - ${V}p.y + ${V}p.z) * 5.0);`,
        ...steps.slice(0, n),
        `if (abs(${d}) > 1e-5) { ${x} /= 2.0 * ${d}; ${y} /= 2.0 * ${d}; ${z} /= 2.0 * ${d}; }`,
        `vec3 ${V}c = clamp(vec3(0.5 - ${x}, 0.5 - ${y}, 0.5 - ${z}), 0.0, 1.0);`,
      ].join('\n'),
      out: { rgb: `${V}c`, fac: `((${V}c.x + ${V}c.y + ${V}c.z) / 3.0)` },
    };
  },
});

def({
  type: 'musgrave', title: 'Musgrave Texture', cat: 'Pattern', width: 200,
  desc: 'Layered fractal noise (fBm) with Blender’s controls. Detail adds layers, Dimension sets how rough they are, Lacunarity how fast they shrink.',
  keywords: 'fbm fractal noise rock terrain blender musgrave',
  inputs: [
    { id: 'p', name: 'Vector', type: 'vec3', bind: 'pos' },
    { id: 's', name: 'Scale', type: 'float', def: 1 },
    { id: 'det', name: 'Detail', type: 'float', def: 4 },
    { id: 'dim', name: 'Dimension', type: 'float', def: 1 },
    { id: 'lac', name: 'Lacunarity', type: 'float', def: 2 },
  ],
  outputs: [{ id: 'fac', name: 'Fac', type: 'float' }],
  gen: ({ I }) => `bg_musgrave(${I.p} * ${I.s}, ${I.det}, ${I.dim}, ${I.lac})`,
});

def({
  type: 'whiteNoise', title: 'White Noise', cat: 'Pattern', width: 180,
  desc: 'A random value and colour for every input position, like TV static. In the Textures tab every pixel gets its own value.',
  keywords: 'random static hash pixel noise blender',
  inputs: [{ id: 'p', name: 'Vector', type: 'vec3', bind: 'pos' }],
  outputs: [
    { id: 'v', name: 'Value', type: 'float' },
    { id: 'rgb', name: 'Color', type: 'vec3' },
  ],
  gen: ({ I, V }) => ({ pre: `vec3 ${V}p = ${I.p} * 7.13;`, out: { v: `bg_hash13(${V}p)`, rgb: `bg_hash33(${V}p)` } }),
});

// ----------------------------------------------------------- Image texture

// The app keeps this list in sync with the textures in the Textures tab, so
// Image Texture nodes can tell whether the texture they point at exists.
export const TEXTURE_REGISTRY = { list: [] };
export const texSampler = (id) => `bg_tex_${String(id).replace(/[^A-Za-z0-9_]/g, '')}`;

def({
  type: 'imageTexture', title: 'Image Texture', cat: 'Input', width: 200, texturePicker: true,
  desc: 'Samples a texture from the Textures tab: one you built with nodes, or a PNG you uploaded (from Blender, for example). It ships inside your shader pack.',
  keywords: 'image texture png upload sample texture2d blender bake custom',
  params: [{ id: 'tex', name: 'Texture', kind: 'texture', def: '' }],
  inputs: [{ id: 'uv', name: 'UV', type: 'vec2', bind: 'faceuv' }],
  outputs: [
    { id: 'rgb', name: 'RGB', type: 'vec3' },
    { id: 'a', name: 'Alpha', type: 'float' },
    { id: 'rgba', name: 'RGBA', type: 'vec4' },
  ],
  gen: ({ I, P, V, stage, kind }) => {
    const tex = TEXTURE_REGISTRY.list.find((t) => t.id === P.tex);
    if (!tex || (kind === 'texture' && tex.kind !== 'image')) {
      return { pre: `vec4 ${V}c = vec4(1.0, 0.0, 1.0, 1.0);`, out: { rgb: `${V}c.rgb`, a: `${V}c.a`, rgba: `${V}c` } };
    }
    const s = texSampler(tex.id);
    const sample = stage === 'vertex' ? `textureLod(${s}, ${I.uv}, 0.0)` : `texture(${s}, ${I.uv})`;
    return {
      fn: { key: s, code: `uniform sampler2D ${s};` },
      pre: `vec4 ${V}c = ${sample};`,
      out: { rgb: `${V}c.rgb`, a: `${V}c.a`, rgba: `${V}c` },
    };
  },
});

// ------------------------------------------------------ Texture graph only

def({
  type: 'texCoord', title: 'Texture Coordinate', cat: 'Input', graphs: ['texture'],
  desc: 'Where this pixel sits in the texture you are making: UV runs 0–1, Pixel counts whole pixels (0–15 for a 16×16 texture).',
  keywords: 'uv pixel coordinate texture generated',
  outputs: [
    { id: 'uv', name: 'UV', type: 'vec2' },
    { id: 'px', name: 'Pixel', type: 'vec2' },
    { id: 'size', name: 'Size', type: 'vec2' },
  ],
  gen: () => ({ out: { uv: 'bg_uv', px: 'floor(bg_pixel)', size: 'bg_texSize' } }),
});

// ------------------------------------------------- Items, entities, IDs
// IDs written to item.properties / entity.properties / block.properties.
// Block IDs stay in 10000–19999 and item IDs in 20000–29999, because Iris
// gives block items their block.properties ID in currentRenderedItemId.

const MATS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'];
const ARMOR_MATS = ['leather', 'chainmail', 'copper', 'iron', 'golden', 'diamond', 'netherite'];
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const cross = (a, b) => a.flatMap((x) => b.map((y) => `${x}_${y}`));

export const ID_GROUPS = {
  items: {
    // Spears arrived in 1.21.11 (Mounts of Mayhem) and count as swords here.
    swords: { id: 20001, label: 'Swords', names: cross(MATS, ['sword', 'spear']) },
    tools: { id: 20002, label: 'Tools', names: [...cross(MATS, ['pickaxe', 'axe', 'shovel', 'hoe']), 'shears', 'flint_and_steel', 'fishing_rod', 'brush'] },
    shields: { id: 20003, label: 'Shields', names: ['shield'] },
    armor: {
      id: 20004, label: 'Armor',
      names: [...cross(ARMOR_MATS, ['helmet', 'chestplate', 'leggings', 'boots']), 'turtle_helmet', 'elytra', 'wolf_armor',
        'leather_horse_armor', 'copper_horse_armor', 'iron_horse_armor', 'golden_horse_armor', 'diamond_horse_armor', 'netherite_horse_armor',
        ...cross(['copper', 'iron', 'golden', 'diamond', 'netherite'], ['nautilus_armor'])],
    },
    food: {
      id: 20005, label: 'Food',
      names: ['apple', 'golden_apple', 'enchanted_golden_apple', 'bread', 'beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken',
        'cooked_chicken', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'cod', 'cooked_cod', 'salmon', 'cooked_salmon', 'tropical_fish',
        'pufferfish', 'carrot', 'golden_carrot', 'potato', 'baked_potato', 'poisonous_potato', 'beetroot', 'beetroot_soup', 'mushroom_stew',
        'rabbit_stew', 'suspicious_stew', 'cookie', 'pumpkin_pie', 'melon_slice', 'glistering_melon_slice', 'sweet_berries', 'glow_berries',
        'honey_bottle', 'dried_kelp', 'chorus_fruit', 'rotten_flesh', 'spider_eye'],
    },
  },
  entities: {
    players: { id: 30001, label: 'Players', names: ['player'] },
    hostile: {
      id: 30002, label: 'Hostile mobs',
      names: ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_nautilus', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'creeper', 'spider',
        'cave_spider', 'enderman', 'endermite', 'silverfish', 'witch', 'slime', 'magma_cube', 'blaze', 'ghast', 'phantom', 'pillager',
        'vindicator', 'evoker', 'illusioner', 'ravager', 'vex', 'guardian', 'elder_guardian', 'shulker', 'hoglin', 'zoglin', 'piglin_brute',
        'warden', 'breeze', 'creaking', 'wither', 'ender_dragon'],
    },
    displays: { id: 30003, label: 'Item displays', names: ['item_display', 'block_display', 'item_frame', 'glow_item_frame'] },
    dropped: { id: 30004, label: 'Dropped items', names: ['item'] },
  },
  blockEntities: {
    chests: {
      id: 10101, label: 'Chests',
      names: ['chest', 'trapped_chest', 'ender_chest', 'copper_chest', 'exposed_copper_chest', 'weathered_copper_chest', 'oxidized_copper_chest',
        'waxed_copper_chest', 'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest', 'waxed_oxidized_copper_chest'],
    },
    signs: { id: 10102, label: 'Signs', names: cross(WOODS, ['sign', 'wall_sign', 'hanging_sign', 'wall_hanging_sign']) },
    banners: { id: 10103, label: 'Banners', names: cross(COLORS, ['banner', 'wall_banner']) },
    beds: { id: 10104, label: 'Beds', names: cross(COLORS, ['bed']) },
    skulls: {
      id: 10105, label: 'Heads & skulls',
      names: cross(['skeleton', 'wither_skeleton'], ['skull', 'wall_skull']).concat(cross(['zombie', 'player', 'creeper', 'dragon', 'piglin'], ['head', 'wall_head'])),
    },
    shulkers: { id: 10106, label: 'Shulker boxes', names: ['shulker_box', ...cross(COLORS, ['shulker_box'])] },
  },
  // Common building blocks get an ID too, so they count as "blocks as items".
  buildingBlocks: {
    id: 10050,
    names: ['stone', 'cobblestone', 'mossy_cobblestone', 'dirt', 'grass_block', 'sand', 'red_sand', 'gravel', 'clay', 'glass', 'bricks',
      'stone_bricks', 'smooth_stone', 'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'andesite', 'diorite', 'granite', 'netherrack',
      'obsidian', 'glowstone', 'sandstone', 'red_sandstone', 'terracotta', 'quartz_block', 'snow_block', 'ice', 'packed_ice',
      ...cross(WOODS.filter((w) => !['bamboo', 'crimson', 'warped'].includes(w)), ['planks', 'log']), 'bamboo_planks', 'crimson_planks', 'warped_planks',
      'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'lapis_ore', 'redstone_ore', 'coal_block', 'iron_block',
      'copper_block', 'gold_block', 'diamond_block', 'emerald_block'],
  },
};

const groupOptions = (g) => Object.values(g).map((x) => x.label);
const groupByLabel = (g, label) => Object.values(g).find((x) => x.label === label);
const ITEM_OPTIONS = [...groupOptions(ID_GROUPS.items), 'Blocks as items'];
const itemTest = (v, label) => {
  if (label === 'Blocks as items') return `((${v} >= 10000 && ${v} < 20000) ? 1.0 : 0.0)`;
  const g = groupByLabel(ID_GROUPS.items, label) || ID_GROUPS.items.swords;
  return `(${v} == ${g.id} ? 1.0 : 0.0)`;
};

def({
  type: 'isHeld', title: 'Is Held (first person)', cat: 'Input', graphs: ['entity'], width: 190,
  desc: '1 for the items in your own hands in first person (gbuffers_hand), 0 for everything else in this graph.',
  keywords: 'hand first person held item viewmodel',
  outputs: [{ id: 'out', name: 'Held', type: 'float' }],
  gen: () => 'bg_isHeld',
});

def({
  type: 'itemMask', title: 'Item ID Mask', cat: 'Input', graphs: ['entity'], width: 190,
  desc: 'Is the item being drawn in this group? Works for held items, item frames, dropped items, armour stands and worn armour (currentRenderedItemId).',
  keywords: 'item id sword tool armor food currentRenderedItemId item.properties',
  params: [{ id: 'group', name: 'Group', kind: 'select', def: 'Swords', options: ITEM_OPTIONS }],
  outputs: [
    { id: 'mask', name: 'Mask', type: 'float' },
    { id: 'id', name: 'Raw ID', type: 'float' },
  ],
  gen: ({ P }) => ({ out: { mask: itemTest('bg_itemId', P.group), id: 'float(bg_itemId)' } }),
});

def({
  type: 'heldItemMask', title: 'Held Item Mask', cat: 'Input', graphs: ['terrain', 'post', 'entity'], width: 190,
  desc: 'Is the player holding an item from this group? Works in every graph, so blocks or the whole screen can react to what you hold (heldItemId, heldItemId2).',
  keywords: 'held item hand main off holding heldItemId',
  params: [
    { id: 'group', name: 'Group', kind: 'select', def: 'Swords', options: ITEM_OPTIONS },
    { id: 'hand', name: 'Hand', kind: 'select', def: 'Either hand', options: ['Main hand', 'Off hand', 'Either hand'] },
  ],
  outputs: [{ id: 'mask', name: 'Mask', type: 'float' }],
  gen: ({ P }) => {
    const main = itemTest('bg_heldItemId', P.group);
    const off = itemTest('bg_heldItemId2', P.group);
    if (P.hand === 'Main hand') return main;
    if (P.hand === 'Off hand') return off;
    return `max(${main}, ${off})`;
  },
});

def({
  type: 'entityMask', title: 'Entity Type Mask', cat: 'Input', graphs: ['entity'], width: 190,
  desc: 'Is the entity being drawn in this group (entity.properties)? Is Entity is 1 for anything drawn by gbuffers_entities.',
  keywords: 'entity mob player zombie hostile display entityId entity.properties',
  params: [{ id: 'group', name: 'Group', kind: 'select', def: 'Hostile mobs', options: groupOptions(ID_GROUPS.entities) }],
  outputs: [
    { id: 'mask', name: 'Mask', type: 'float' },
    { id: 'any', name: 'Is Entity', type: 'float' },
  ],
  gen: ({ P }) => {
    const g = groupByLabel(ID_GROUPS.entities, P.group) || ID_GROUPS.entities.hostile;
    return { out: { mask: `(bg_entityId == ${g.id} ? 1.0 : 0.0)`, any: 'bg_isEntity' } };
  },
});

def({
  type: 'blockEntityMask', title: 'Block Entity Mask', cat: 'Input', graphs: ['entity'], width: 190,
  desc: 'Is the block entity being drawn in this group (blockEntityId)? Is Block Entity is 1 for anything drawn by gbuffers_block.',
  keywords: 'block entity chest sign banner bed skull shulker blockEntityId',
  params: [{ id: 'group', name: 'Group', kind: 'select', def: 'Chests', options: groupOptions(ID_GROUPS.blockEntities) }],
  outputs: [
    { id: 'mask', name: 'Mask', type: 'float' },
    { id: 'any', name: 'Is Block Entity', type: 'float' },
  ],
  gen: ({ P }) => {
    const g = groupByLabel(ID_GROUPS.blockEntities, P.group) || ID_GROUPS.blockEntities.chests;
    return { out: { mask: `(bg_blockEntityId == ${g.id} ? 1.0 : 0.0)`, any: 'bg_isBlockEntity' } };
  },
});

// ----------------------------------------------------------------- Utility

def({
  type: 'customFunction', title: 'Custom Function', cat: 'Utility', width: 200,
  desc: 'Write your own GLSL, like Unity’s Custom Function node. Inputs arrive as vec4 a, b, c, d plus float time. Return a value of the output type.',
  keywords: 'code glsl hlsl script custom expression function',
  params: [
    { id: 'outType', name: 'Output type', kind: 'select', def: 'vec3', options: ['float', 'vec2', 'vec3', 'vec4'] },
    { id: 'code', name: 'Code', kind: 'code', def: '// a, b, c, d are vec4. time is in seconds.\nfloat pulse = 0.5 + 0.5 * sin(time * 3.0 + b.x);\nreturn a.rgb * pulse;' },
  ],
  inputs: [
    { id: 'a', name: 'a', type: 'vec4', def: [1, 1, 1, 1] },
    { id: 'b', name: 'b', type: 'vec4', def: [0, 0, 0, 0] },
    { id: 'c', name: 'c', type: 'vec4', def: [0, 0, 0, 0] },
    { id: 'd', name: 'd', type: 'vec4', def: [0, 0, 0, 0] },
  ],
  outputs: [{ id: 'out', name: 'Out', type: (P) => (['float', 'vec2', 'vec3', 'vec4'].includes(P.outType) ? P.outType : 'vec3') }],
  gen: ({ I, P, node }) => {
    const t = ['float', 'vec2', 'vec3', 'vec4'].includes(P.outType) ? P.outType : 'vec3';
    const fn = `bg_custom_${node.id}`;
    return {
      fn: { key: fn, code: `${t} ${fn}(vec4 a, vec4 b, vec4 c, vec4 d, float time) {\n${String(P.code || `return ${t}(0.0);`)}\n}` },
      out: { out: `${fn}(${I.a}, ${I.b}, ${I.c}, ${I.d}, bg_time)` },
    };
  },
});

def({
  type: 'reroute', title: 'Reroute', cat: 'Utility', width: 120, noPreview: true,
  desc: 'Passes a value straight through. Use it to tidy long wires.',
  keywords: 'redirect elbow wire tidy pass',
  inputs: [{ id: 'x', name: 'In', type: 'dyn', def: 0 }],
  outputs: [{ id: 'out', name: 'Out', type: 'dyn' }],
  gen: ({ I }) => I.x,
});

def({
  type: 'note', title: 'Sticky Note', cat: 'Utility', isNote: true, width: 220, noPreview: true,
  desc: 'A note to explain your graph. It does nothing to the shader.',
  keywords: 'comment sticky text label annotation',
  params: [{ id: 'text', name: 'Text', kind: 'note', def: 'Write a note here.' }],
  gen: () => ({ out: {} }),
});

// ---------------------------------------------------------------------- Output

def({
  type: 'terrainOutput', title: 'Block Output', cat: 'Output', graphs: ['terrain'], isOutput: true, width: 220,
  desc: 'What every block finally looks like, like Unity’s Master Stack. Vanilla: Color × Light × AO + Color × Emission. Lit also adds sun shading and a specular highlight from Normal, Smoothness and Metallic.',
  inputs: [
    { id: 'color', name: 'Color', type: 'vec3', bind: 'albedo' },
    { id: 'alpha', name: 'Alpha', type: 'float', bind: 'alpha' },
    { id: 'light', name: 'Light', type: 'vec3', bind: 'light' },
    { id: 'emission', name: 'Emission', type: 'float', def: 0 },
    { id: 'normal', name: 'Normal', type: 'vec3', bind: 'normal' },
    { id: 'smooth', name: 'Smoothness', type: 'float', def: 0 },
    { id: 'metal', name: 'Metallic', type: 'float', def: 0 },
    { id: 'ao', name: 'Ambient Occlusion', type: 'float', def: 1 },
    { id: 'clip', name: 'Alpha Clip', type: 'float', def: 0.1 },
    { id: 'offset', name: 'Vertex Offset', type: 'vec3', def: [0, 0, 0], stage: 'vertex' },
  ],
  params: [
    { id: 'lighting', name: 'Lighting', kind: 'select', def: 'Vanilla', options: ['Vanilla', 'Lit'] },
    { id: 'fog', name: 'Vanilla distance fog', kind: 'bool', def: true },
  ],
  gen: () => ({ out: {} }),
});

def({
  type: 'entityOutput', title: 'Item & Entity Output', cat: 'Output', graphs: ['entity'], isOutput: true, width: 230,
  desc: 'What held items, mobs, players, armour, dropped items, item frames and block entities look like. Same slots as the Block Output. The hurt and creeper flash (entityColor) is added for you.',
  inputs: NODE_DEFS.terrainOutput.inputs.map((p) => ({ ...p })),
  params: NODE_DEFS.terrainOutput.params.map((p) => ({ ...p })),
  gen: () => ({ out: {} }),
});

def({
  type: 'postOutput', title: 'Screen Output', cat: 'Output', graphs: ['post'], isOutput: true, width: 190,
  desc: 'The final picture that reaches the screen.',
  inputs: [{ id: 'color', name: 'Color', type: 'vec3', bind: 'scene' }],
  gen: () => ({ out: {} }),
});

def({
  type: 'textureOutput', title: 'Texture Output', cat: 'Output', graphs: ['texture'], isOutput: true, width: 190,
  desc: 'The finished texture. Its pixels go into your resource pack, and into your shader through Image Texture.',
  inputs: [
    { id: 'color', name: 'Color', type: 'vec3', def: [0.5, 0.5, 0.5] },
    { id: 'alpha', name: 'Alpha', type: 'float', def: 1 },
  ],
  gen: () => ({ out: {} }),
});

// Nodes that read the live world (time, weather, camera) or make in-game
// settings make no sense inside a baked texture.
for (const t of ['time', 'world', 'sunSky', 'camera', 'wave', 'slider', 'toggle', 'choice']) NODE_DEFS[t].noTexture = true;

// Can this node be used in a graph of this kind ('terrain', 'post' or 'texture')?
export function allowedIn(def, kind) {
  if (!def || def.isOutput) return false;
  if (def.graphs) return def.graphs.includes(kind);
  return kind !== 'texture' || !def.noTexture;
}

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
    faceuv: { expr: 'bg_faceUV', type: 'vec2', label: 'Face UV' },
    pos: { expr: 'bg_worldPos', type: 'vec3', label: 'World Pos' },
    normal: { expr: 'bg_normal', type: 'vec3', label: 'Surface Normal' },
    albedo: { expr: '(bg_sampleBlock(bg_uv).rgb * bg_vcolor.rgb)', type: 'vec3', label: 'Texture × Tint', fragOnly: true },
    alpha: { expr: '(bg_sampleBlock(bg_uv).a * bg_vcolor.a)', type: 'float', label: 'Texture Alpha', fragOnly: true },
    light: { expr: 'bg_light', type: 'vec3', label: 'Vanilla Light' },
  },
  entity: null,
  texture: {
    uv: { expr: 'bg_uv', type: 'vec2', label: 'Texture UV' },
    faceuv: { expr: 'bg_uv', type: 'vec2', label: 'Texture UV' },
    pos: { expr: 'vec3(bg_uv * 4.0, 0.0)', type: 'vec3', label: 'UV × 4' },
    normal: { expr: 'vec3(0.0, 0.0, 1.0)', type: 'vec3', label: 'Flat' },
  },
  post: {
    uv: { expr: 'bg_screenUV', type: 'vec2', label: 'Screen UV' },
    faceuv: { expr: 'bg_screenUV', type: 'vec2', label: 'Screen UV' },
    pos: { expr: 'vec3(bg_screenUV * vec2(bg_aspect, 1.0) * 8.0, 0.0)', type: 'vec3', label: 'Screen Pos' },
    normal: { expr: 'vec3(0.0, 0.0, 1.0)', type: 'vec3', label: 'Facing Camera' },
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
vec3 bg_hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float bg_gradDot(vec3 i, vec3 f, vec3 o) {
  return dot(bg_hash33(i + o) * 2.0 - 1.0, f - o);
}
float bg_gradNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float x00 = mix(bg_gradDot(i, f, vec3(0.0, 0.0, 0.0)), bg_gradDot(i, f, vec3(1.0, 0.0, 0.0)), u.x);
  float x10 = mix(bg_gradDot(i, f, vec3(0.0, 1.0, 0.0)), bg_gradDot(i, f, vec3(1.0, 1.0, 0.0)), u.x);
  float x01 = mix(bg_gradDot(i, f, vec3(0.0, 0.0, 1.0)), bg_gradDot(i, f, vec3(1.0, 0.0, 1.0)), u.x);
  float x11 = mix(bg_gradDot(i, f, vec3(0.0, 1.0, 1.0)), bg_gradDot(i, f, vec3(1.0, 1.0, 1.0)), u.x);
  return clamp(mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 0.9 + 0.5, 0.0, 1.0);
}
vec2 bg_voronoi3(vec3 p, float jitter) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 8.0;
  float cell = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = bg_hash33(i + o);
        vec3 r = o + h * jitter - f;
        float d = dot(r, r);
        if (d < best) { best = d; cell = h.x; }
      }
    }
  }
  return vec2(sqrt(best), cell);
}
vec3 bg_blackbody(float t) {
  t = max(t, 1.0);
  vec3 c = vec3(255.0);
  c.x = 56100000.0 * pow(t, -1.5) + 148.0;
  c.y = t > 6500.0 ? 35200000.0 * pow(t, -1.5) + 184.0 : 100.04 * log(t) - 623.6;
  c.z = 194.18 * log(t) - 1448.6;
  c = clamp(c, 0.0, 255.0) / 255.0;
  if (t < 1000.0) c *= t / 1000.0;
  return c;
}
float bg_bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bg_bayer4(vec2 a) {
  return bg_bayer2(0.5 * a) * 0.25 + bg_bayer2(a);
}
vec3 bg_toLinear(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 bg_toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 bg_whiteBalance(vec3 c, float temperature, float tint) {
  float t1 = temperature * 10.0 / 6.0;
  float t2 = tint * 10.0 / 6.0;
  float x = 0.31271 - t1 * (t1 < 0.0 ? 0.1 : 0.05);
  float y = 2.87 * x - 3.0 * x * x - 0.27509507 + t2 * 0.05;
  float X = x / y;
  float Z = (1.0 - x - y) / y;
  vec3 w2 = vec3(0.7328 * X + 0.4296 - 0.1624 * Z, -0.7036 * X + 1.6975 + 0.0061 * Z, 0.0030 * X + 0.0136 + 0.9834 * Z);
  vec3 balance = vec3(0.949237, 1.03542, 1.08728) / w2;
  vec3 lms = vec3(
    dot(vec3(0.390405, 0.549941, 0.00892632), c),
    dot(vec3(0.0708416, 0.963172, 0.00135775), c),
    dot(vec3(0.0231082, 0.128021, 0.936245), c)) * balance;
  return vec3(
    dot(vec3(2.85847, -1.62879, -0.024891), lms),
    dot(vec3(-0.210182, 1.1582, 0.000324281), lms),
    dot(vec3(-0.041812, -0.118169, 1.06867), lms));
}
vec3 bg_rotateAxis(vec3 v, vec3 axis, float a) {
  axis = normalize(axis);
  float s = sin(a);
  float k = cos(a);
  return v * k + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - k);
}
float bg_musgrave(vec3 p, float detail, float dim, float lac) {
  float value = 0.0;
  float pwr = 1.0;
  float pwHL = pow(max(lac, 1.01), -dim);
  float oct = clamp(detail, 1.0, 8.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= floor(oct)) break;
    value += (bg_gradNoise3(p) * 2.0 - 1.0) * pwr;
    pwr *= pwHL;
    p *= lac;
  }
  float rmd = oct - floor(oct);
  value += rmd * (bg_gradNoise3(p) * 2.0 - 1.0) * pwr;
  return clamp(value * 0.6 + 0.5, 0.0, 1.0);
}
vec3 bg_safeNormalize(vec3 v) {
  float l = dot(v, v);
  return l > 1e-12 ? v * inversesqrt(l) : vec3(0.0, 1.0, 0.0);
}
vec2 bg_faceUVOf(vec3 p, vec3 n) {
  vec3 a = abs(n);
  vec2 f = a.y > 0.5 ? p.xz : (a.x > 0.5 ? vec2(p.z, -p.y) : vec2(p.x, -p.y));
  return fract(f);
}
`;

// Helpers that use screen derivatives. They only compile in pixel (fragment)
// shaders, so they are kept apart from the shared helpers above.
export const GLSL_FRAG_HELPERS = `
vec3 bg_bumpNormal(float h, float strength, vec3 n, vec3 p) {
  vec3 dpdx = dFdx(p);
  vec3 dpdy = dFdy(p);
  float dhdx = dFdx(h) * strength;
  float dhdy = dFdy(h) * strength;
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}
`;

BINDS.entity = BINDS.terrain;
