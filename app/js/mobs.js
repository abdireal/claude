// Mobs the Animations graph can move, with their Minecraft 1.21.11 part names
// (OptiFine CEM / Entity Model Features names) and the vanilla animation the
// game runs before ours.
//
// Geometry is in model pixels like Minecraft's ModelPart: y points down and
// the mob faces -z. Only the live preview draws these boxes. The exported
// .jem files move the game's own parts, so no geometry is shipped.

export const DEG = Math.PI / 180;
const PI = Math.PI;

const box = (from, size, tiles) => ({ from, size, tiles });

function humanoid(t, armW = 4, legW = 4) {
  const half = armW / 2;
  return {
    head: { pivot: [0, 0, 0], boxes: [box([-4, -8, -4], [8, 8, 8], { side: t.skin, front: t.face, top: t.hair || t.skin })] },
    body: { pivot: [0, 0, 0], boxes: [box([-4, 0, -2], [8, 12, 4], { side: t.shirt })] },
    right_arm: { pivot: [-5, 2, 0], boxes: [box([-(armW - 1), -2, -half], [armW, 12, armW], { side: t.arm })] },
    left_arm: { pivot: [5, 2, 0], boxes: [box([-1, -2, -half], [armW, 12, armW], { side: t.arm })] },
    right_leg: { pivot: [-(legW === 4 ? 1.9 : 2), 12, 0], boxes: [box([-legW / 2, 0, -legW / 2], [legW, 12, legW], { side: t.pants })] },
    left_leg: { pivot: [legW === 4 ? 1.9 : 2, 12, 0], boxes: [box([-legW / 2, 0, -legW / 2], [legW, 12, legW], { side: t.pants })] },
  };
}

function quadruped(t, o) {
  const legs = {};
  o.legs.forEach((p, i) => {
    legs[`leg${i + 1}`] = { pivot: p, boxes: [box([-2, 0, -2], [4, o.legH, 4], { side: t.leg || t.body })] };
  });
  return {
    head: { pivot: o.headPivot, boxes: o.head },
    body: { pivot: o.bodyPivot, rot: [PI / 2, 0, 0], boxes: [box(o.bodyFrom, o.bodySize, { side: t.body })] },
    ...legs,
  };
}

// Vanilla animation, simplified from HumanoidModel, ZombieModel, CreeperModel
// and QuadrupedModel. v holds the CEM render parameters; p is the pose.
const RIGS = {
  humanoid(p, v, zombie = false) {
    const c = Math.cos, s = Math.sin;
    p.head.ry = v.head_yaw * DEG;
    p.head.rx = v.head_pitch * DEG;
    const ls = v.limb_swing * 0.6662, sp = v.limb_speed;
    p.right_arm.rx = c(ls + PI) * sp;
    p.left_arm.rx = c(ls) * sp;
    p.right_leg.rx = c(ls) * 1.4 * sp;
    p.left_leg.rx = c(ls + PI) * 1.4 * sp;
    const atk = v.swing_progress;
    if (zombie) {
      const f = s(atk * PI);
      const g = s((1 - (1 - atk) * (1 - atk)) * PI);
      p.right_arm.ry = -(0.1 - f * 0.6);
      p.left_arm.ry = 0.1 - f * 0.6;
      const h = -PI / (v.is_aggressive ? 1.5 : 2.25);
      p.right_arm.rx = h + f * 1.2 - g * 0.4;
      p.left_arm.rx = h + f * 1.2 - g * 0.4;
    } else if (atk > 0) {
      p.body.ry = s(Math.sqrt(atk) * PI * 2) * 0.2;
      p.right_arm.ry += p.body.ry;
      p.left_arm.ry += p.body.ry;
      p.left_arm.rx += p.body.ry;
      let f = 1 - atk;
      f = 1 - f * f * f * f;
      const g = s(f * PI);
      const h = s(atk * PI) * -(p.head.rx - 0.7) * 0.75;
      p.right_arm.rx -= g * 1.2 + h;
      p.right_arm.ry += p.body.ry * 2;
      p.right_arm.rz += s(atk * PI) * -0.4;
    }
    if (v.is_sneaking) {
      p.body.rx = 0.5;
      p.right_arm.rx += 0.4;
      p.left_arm.rx += 0.4;
      p.right_leg.tz += 4;
      p.left_leg.tz += 4;
      p.head.ty += 4.2;
      p.body.ty += 3.2;
      p.left_arm.ty += 3.2;
      p.right_arm.ty += 3.2;
    }
    p.right_arm.rz += c(v.age * 0.09) * 0.05 + 0.05;
    p.left_arm.rz -= c(v.age * 0.09) * 0.05 + 0.05;
    p.right_arm.rx += s(v.age * 0.067) * 0.05;
    p.left_arm.rx -= s(v.age * 0.067) * 0.05;
  },
  zombie(p, v) { RIGS.humanoid(p, v, true); },
  fourLegs(p, v) {
    p.head.ry = v.head_yaw * DEG;
    p.head.rx = v.head_pitch * DEG;
    const ls = v.limb_swing * 0.6662, sp = v.limb_speed;
    p.leg1.rx = Math.cos(ls) * 1.4 * sp;
    p.leg2.rx = Math.cos(ls + PI) * 1.4 * sp;
    p.leg3.rx = Math.cos(ls + PI) * 1.4 * sp;
    p.leg4.rx = Math.cos(ls) * 1.4 * sp;
  },
};

const ZOMBIE_TILES = { skin: 'zSkin', face: 'zFace', shirt: 'zShirt', pants: 'zPants', arm: 'zSkin' };
const PLAYER_TILES = { skin: 'pSkin', face: 'pFace', hair: 'pHair', shirt: 'pShirt', pants: 'pPants', arm: 'pSkin' };
const SKELETON_TILES = { skin: 'bone', face: 'skull', shirt: 'bone', pants: 'bone', arm: 'bone' };

// files: every .jem that gets the same animation (look-alike mobs and the
// extra layers drawn on top, so clothes and wool move with the body).
// extra: real parts without their own box here, children of the main parts.
export const MOBS = {
  zombie: {
    label: 'Zombie', rig: 'zombie', entityId: 30002,
    files: ['zombie', 'husk', 'drowned', 'drowned_outer', 'zombie_villager'],
    also: 'husk, drowned, zombie villager',
    parts: humanoid(ZOMBIE_TILES),
    extra: ['headwear'],
  },
  skeleton: {
    label: 'Skeleton', rig: 'humanoid', entityId: 30002,
    files: ['skeleton', 'stray', 'stray_outer', 'wither_skeleton', 'bogged', 'bogged_outer', 'parched'],
    also: 'stray, wither skeleton, bogged, parched',
    parts: (() => {
      const p = humanoid(SKELETON_TILES, 2, 2);
      p.right_leg.pivot = [-2, 12, 0];
      p.left_leg.pivot = [2, 12, 0];
      return p;
    })(),
    extra: ['headwear'],
  },
  player: {
    label: 'Player', rig: 'humanoid', entityId: 30001,
    files: ['player', 'player_slim'],
    also: 'slim (Alex) skins',
    parts: humanoid(PLAYER_TILES),
    extra: ['headwear', 'jacket', 'right_sleeve', 'left_sleeve', 'right_pants', 'left_pants'],
  },
  creeper: {
    label: 'Creeper', rig: 'fourLegs', entityId: 30002,
    files: ['creeper', 'creeper_charge'],
    also: 'the charged glow',
    parts: {
      head: { pivot: [0, 6, 0], boxes: [box([-4, -8, -4], [8, 8, 8], { side: 'creeper', front: 'creeperFace' })] },
      body: { pivot: [0, 6, 0], boxes: [box([-4, 0, -2], [8, 12, 4], { side: 'creeper' })] },
      leg1: { pivot: [-2, 18, 4], boxes: [box([-2, 0, -2], [4, 6, 4], { side: 'creeper' })] },
      leg2: { pivot: [2, 18, 4], boxes: [box([-2, 0, -2], [4, 6, 4], { side: 'creeper' })] },
      leg3: { pivot: [-2, 18, -4], boxes: [box([-2, 0, -2], [4, 6, 4], { side: 'creeper' })] },
      leg4: { pivot: [2, 18, -4], boxes: [box([-2, 0, -2], [4, 6, 4], { side: 'creeper' })] },
    },
    extra: [],
  },
  pig: {
    label: 'Pig', rig: 'fourLegs', entityId: 0,
    files: ['pig', 'pig_saddle', 'cold_pig', 'warm_pig'],
    also: 'saddles and the cold and warm pigs',
    parts: quadruped({ body: 'pig', leg: 'pig' }, {
      headPivot: [0, 12, -6],
      head: [box([-4, -4, -8], [8, 8, 8], { side: 'pig', front: 'pigFace' }), box([-2, 0, -9], [4, 3, 1], { side: 'pigSnout' })],
      bodyPivot: [0, 11, 2], bodyFrom: [-5, -10, -7], bodySize: [10, 16, 8],
      legs: [[-3, 18, 7], [3, 18, 7], [-3, 18, -5], [3, 18, -5]], legH: 6,
    }),
    extra: [],
  },
  cow: {
    label: 'Cow', rig: 'fourLegs', entityId: 0,
    files: ['cow', 'mooshroom', 'cold_cow', 'warm_cow'],
    also: 'mooshrooms and the cold and warm cows',
    parts: quadruped({ body: 'cow', leg: 'cow' }, {
      headPivot: [0, 4, -8],
      head: [box([-4, -4, -6], [8, 8, 6], { side: 'cow', front: 'cowFace' }), box([-5, -5, -4], [1, 3, 1], { side: 'horn' }), box([4, -5, -4], [1, 3, 1], { side: 'horn' })],
      bodyPivot: [0, 5, 2], bodyFrom: [-6, -10, -7], bodySize: [12, 18, 10],
      legs: [[-4, 12, 7], [4, 12, 7], [-4, 12, -6], [4, 12, -6]], legH: 12,
    }),
    extra: [],
  },
  sheep: {
    label: 'Sheep', rig: 'fourLegs', entityId: 0,
    files: ['sheep', 'sheep_wool'],
    also: 'the wool',
    parts: quadruped({ body: 'wool', leg: 'sheepLeg' }, {
      headPivot: [0, 6, -8],
      head: [box([-3, -4, -6], [6, 6, 8], { side: 'wool', front: 'sheepFace' })],
      bodyPivot: [0, 5, 2], bodyFrom: [-4, -10, -7], bodySize: [8, 16, 6],
      legs: [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]], legH: 12,
    }),
    extra: [],
  },
};

export const MOB_IDS = Object.keys(MOBS);
export const MOB_LABELS = MOB_IDS.map((id) => MOBS[id].label);
export const mobByLabel = (label) => MOB_IDS.find((id) => MOBS[id].label === label) || null;

// Every part a mob's .jem can name: the boxed parts, then the layers.
export function partNames(mob) {
  const m = MOBS[mob];
  return m ? [...Object.keys(m.parts), ...m.extra] : [];
}

// The union of all part names, for nodes that don't know their mob.
export const ALL_PARTS = [...new Set(MOB_IDS.flatMap(partNames))];

// Rest pose of a part: pivot and rotation before any animation. Layers are
// children of their main part in 1.21, so they rest at 0.
export function restPose(mob, part) {
  const p = MOBS[mob]?.parts[part];
  const [rx, ry, rz] = p?.rot || [0, 0, 0];
  const [tx, ty, tz] = p?.pivot || [0, 0, 0];
  return { tx, ty, tz, rx, ry, rz, sx: 1, sy: 1, sz: 1, visible: true };
}

export function freshPose(mob) {
  const pose = {};
  for (const part of partNames(mob)) pose[part] = restPose(mob, part);
  return pose;
}

// The game's own animation for this frame (before the graph's animation).
export function vanillaPose(mob, v) {
  const pose = freshPose(mob);
  RIGS[MOBS[mob].rig](pose, v);
  return pose;
}
