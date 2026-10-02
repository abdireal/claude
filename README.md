# BlockGraph

A node-based shader editor for Minecraft. Connect nodes in your browser, watch a live 3D preview, and export a real **Iris** shader pack for **Minecraft 1.21.11 on Fabric**.

It works like Unity Shader Graph: every node is a small piece of GLSL, and the graph is compiled into complete shader programs.

## What you get

- **Three shader graphs.** *Blocks* runs on every block (exports to `gbuffers_terrain` and `gbuffers_water`). *Items & Entities* runs on held items, dropped items, item frames, item displays, armour, mobs, players and block entities such as chests, signs, banners, beds, skulls and shulker boxes. *Post FX* runs on the finished screen image (exports to `composite`).
- **Textures tab: a resource pack creator.** Build textures with Blender-style nodes (Brick, Wave, Magic, Musgrave, Voronoi, Noise, White Noise, Gradient), pixel-paint on top (pencil, eraser, fill, colour picker), or upload PNGs (for example textures baked in Blender). Pick which Minecraft texture each one replaces, see it in the live preview under your shader, and export a resource pack (format 75, Minecraft 1.21.11). The **Image Texture** node samples any of them inside a shader, and they ship in the shader pack as Iris custom textures.
- **Models tab: real 3D models for items and blocks.** Import OBJ (with MTL), GLB or glTF files (from Blender: File → Export → glTF 2.0), or start from a sample: **Sting** (Bilbo's sword, replacing the netherite sword), a simple sword or a crystal block. Choose what the model is for (replace an item like `diamond_sword`, a new item id for `/give` and item displays, or replace a block like `flower_pot`), fit it into the block with pose presets, and give each material a texture from the Textures tab, where you paint it with the model's UVs drawn on top. The live preview shows item models in your hand under the Items & Entities graph and block models on the grass under the Blocks graph, where **Block Type → Custom Models** singles them out. Models ship in the resource pack and need the small client-side [BlockGraph Models mod](mod/README.md).
- **Mob animations.** An *Animations* tab remakes how mobs move, like the Fresh Animations pack: walk cycles, breathing, attack lunges, flinching when hit. Nodes read the mob (walk cycle, head look, attack, hurt, states like sneaking or swimming) and shape motion (Wave, Keyframes, Ease, Smooth, Timer, maths and logic), then **Animate Part** rotates, moves, scales or hides a body part. It exports Entity Model Features `.jem` files in the resource pack, and the preview plays the same animation on a zombie, player, skeleton, creeper, pig, cow or sheep with Attack, Hurt, Jump and Sneak buttons.
- **Sun shadows.** A real Iris shadow pass (`shadow.vsh`/`shadow.fsh`). Blocks, mobs, players and chests cast shadows onto blocks, water, items, mobs and block entities. Cut-out leaves and plants give dappled shadows, and the Blocks graph's Vertex Offset runs in the shadow pass, so waving plants cast waving shadows. Strength, softness, quality, distance and sun angle are set in the Graph panel and become a *Shadows* page in Iris → Shader Settings.
- **Masks that tell objects apart.** Is Held (first person), Item ID Mask, Held Item Mask, Entity Type Mask and Block Entity Mask. Ready-made groups: swords (and 1.21.11 spears), tools, shields, armour, food, blocks as items, players, hostile mobs, item displays, dropped items, chests, signs, banners, beds, skulls and shulker boxes.
- **About 146 nodes, following Unity Shader Graph's library.** Inputs (block texture and LOD, biome tint, light, block type masks, face UV, view direction, screen position, sun and sky, camera, time and weather), Math (basic, advanced, range, round, interpolation, derivatives, random), Trigonometry and waves, Vector and channel (cross, projection, reflection, refract, rotate about axis, sphere mask, swizzle, flip, channel mask), Logic (branch, comparison, and, or, not), Artistic colour (blend with 21 modes, white balance, replace colour, colour mask, channel mixer, invert, colourspace conversion, dither, gradient, blackbody, metal reflectance), Normal (from height, strength, blend), UV (tiling and offset, rotate, twirl, polar, spherize, radial shear), Procedural (noise, gradient noise, Voronoi, checkerboard, ellipse, rectangle, rounded rectangle, polygon) and screen effects.
- **Live preview on every node**, like Unity: a lit ball for block nodes, the real scene for Post FX nodes.
- **Lit output.** The Block Output and the Item & Entity Output work like Unity's Master Stack: Color, Alpha, Normal, Smoothness, Metallic, Ambient Occlusion, Emission, Alpha Clip and Vertex Offset, with Vanilla or Lit lighting. Lit adds sun shading, a specular highlight and a cheap sky reflection on metallic surfaces, so metal swords and armour shine. Both receive sun shadows (switch off with *Receive sun shadows*), and the **Sun Shadow** node gives you the shadow as a value for stylised looks.
- **Custom Function** for your own GLSL, **Sticky Notes**, **Reroute** nodes and collapsible library categories.
- **Vertex Offset.** Wire anything into it to move blocks themselves, for waving leaves and plants or rolling water.
- **In-game settings.** Slider, On/Off and Dropdown Setting nodes become options in Iris → Shader Settings, with `shaders.properties` and language labels written for you.
- **Live preview.** A small Minecraft-style scene in WebGL2 with procedural textures, day/night and rain controls, and its own shadow map. A held sword and shield, a chest and a zombie (which flashes red when hurt) use the Items & Entities graph.
- **Presets.** Waving Plants, Shiny Weapons, Toon World, Retro TV, Night Vision, Dreamy Glow, Ocean Waves, Tiny Planet, Comic Outline, Lit & Bumpy and a blank start.
- **View code.** See the exact GLSL each node produces.
- Undo/redo, copy/paste, box select, autosave in the browser, and save/open graph files.

## Run it locally

```
node tools/serve.mjs
```

Then open http://localhost:5173. No install step and no build step. `app/index.html` is written in claude.ai Artifact form (no `<html>` skeleton), and the dev server adds one.

## The Items & Entities graph

Its output compiles into six Iris programs:

| Program | What it draws |
| --- | --- |
| `gbuffers_hand`, `gbuffers_hand_water` | Items in your own hands in first person (opaque and translucent) |
| `gbuffers_entities`, `gbuffers_entities_translucent` | Mobs, players, worn armour, dropped items, item frames, item displays |
| `gbuffers_block`, `gbuffers_block_translucent` | Block entities: chests, signs, banners, beds, skulls, shulker boxes |

- The enchantment glint keeps working through its own `gbuffers_armor_glint` program.
- The hurt and creeper flash (`entityColor`) is mixed into Color for you.
- The masks read `currentRenderedItemId`, `heldItemId`, `heldItemId2`, `entityId` and `blockEntityId`. The pack writes the matching `item.properties` and `entity.properties`, and adds the block entity groups to `block.properties`. A block held as an item uses its block ID, which is what *Blocks as items* checks.
- **Models made with the BlockGraph Models mod.** OBJ meshes are drawn through the normal item and block paths, so they get these shaders too. The entity programs only use standard vertex data (position, UV, lightmap, colour and normal) and normalize safely, so meshes without `mc_Entity`, `mc_midTexCoord` or with zero-length normals still render. On terrain, missing `mc_Entity` and `mc_midTexCoord` read as 0, so modelled blocks simply don't wave.

The **Shiny Weapons** preset shows it off: swords, tools, armour and shields are masked with Item ID Mask, their bright (metal) pixels get high Smoothness and Metallic, and Lit lighting makes them catch the sun and reflect the sky. A *Weapon Shine* slider appears in Iris → Shader Settings.

## Mob animations

The Animations graph compiles to OptiFine CEM animation expressions, which the **Entity Model Features** (EMF) mod runs on Fabric. Install EMF and **Entity Texture Features** (ETF, which EMF needs) for 1.21.11 next to Iris and Sodium, and turn on the resource pack from Export.

- Each animated mob gets a `.jem` in `assets/minecraft/optifine/cem/`. It holds one empty part attached to the mob's model, carrying the animation lines, so the game keeps its own geometry and textures. Only the parts you animate change.
- **Add to vanilla** keeps Minecraft's own motion (`head.rx = head.rx + …`) and adds yours. **Replace vanilla** sets the rotation from the rest pose instead.
- Angles are in degrees and moves in pixels (16 per block). Rotate X nods forward, Y turns and Z tilts. Move up, forward and right are positive.
- Look-alikes and layers get the same file, so clothes and wool move with the body:

| Mob | Files |
| --- | --- |
| Zombie | zombie, husk, drowned, drowned_outer, zombie_villager |
| Skeleton | skeleton, stray, stray_outer, wither_skeleton, bogged, bogged_outer, parched |
| Player | player, player_slim (EMF only) |
| Creeper | creeper, creeper_charge |
| Pig | pig, pig_saddle, cold_pig, warm_pig |
| Cow | cow, mooshroom, cold_cow, warm_cow |
| Sheep | sheep, sheep_wool |

- Smooth and Timer keep state between frames in `var.*` entity variables. Vanilla Pose reads a part before any of your lines run.
- Ease, Keyframes, Move Direction and some states (jumping, swimming, climbing, blocking) use EMF additions to the OptiFine format.
- Every node shows its value over a short clip (walking, then an attack and a hit). The preview runs the exported expressions through its own interpreter, so it plays what the game will play.
- Presets: Lively Zombies, Breathing Idle, Happy Pigs and Bouncy Creepers. Shader presets leave your animations alone.

## Shadows

| Setting | Iris option | What it does |
| --- | --- | --- |
| Sun shadows | `BG_SHADOWS` | Turns the shadow pass on or off (`program.shadow.enabled`), so off costs no FPS |
| Strength | `BG_SHADOW_STRENGTH` | How dark shadows get. Only sunlight is blocked; torchlight is untouched |
| Softness | `BG_SHADOW_SOFTNESS` | Blur on shadow edges, in shadow map pixels (4×4 PCF) |
| Quality | `shadowMapResolution` | Shadow map size, 512 to 4096 |
| Distance | `shadowDistance` | How far from the player shadows reach, 32 to 256 blocks |
| Sun angle | `sunPathRotation` | Tilts the sun's path so noon shadows fall to one side |

- The shadow map is distorted toward the player, so nearby shadows are sharp. The depth bias grows with distance to match.
- Shadows are read from `shadowtex1`, so water and stained glass don't cast solid shadows.
- Faces turned away from the sun count as shadowed. Shadows fade with rain and at night.
- Vanilla lighting darkens the skylight in shadow. Lit lighting removes the direct sun and its highlight but keeps sky fill, so shadows never go fully black.
- Mobs and block entities use the Blocks graph's Vertex Offset in the shadow pass too (it usually masks itself to plants, so they stay still).

## Install an exported pack

1. Install Fabric Loader for 1.21.11, then the Iris and Sodium mods. For mob animations, also Entity Model Features and Entity Texture Features.
2. Put the exported `.zip` in `.minecraft/shaderpacks`. Leave it zipped.
3. In game, open Options → Video Settings → Shader Packs (or press `O`), select the pack and press Apply.
4. After exporting a new version, replace the zip and press `R` in game to reload.

The zip also contains `blockgraph-graph.json`. Open it with Presets → Open graph file to keep editing.

## 3D models

Minecraft can only build models out of boxes. The **BlockGraph Models** mod in [`mod/`](mod/README.md) adds real meshes:

- **Client side only.** It changes how things look, not what they are, so it works on any server, vanilla ones included. Players without your resource pack see the normal item or block. Players with the pack but without the mod see a fallback that BlockGraph writes into the pack: the normal item sprite, or a textured box for blocks and shields.
- **Fabric 1.21.11.** It needs Fabric Loader and Fabric API, and works with Sodium and Iris. Model blocks are drawn by the normal block renderer, so your Blocks shader runs on them.
- **Any item or block.** Replace every diamond sword, give a model to any item with the `item_model` component (`/give @p stick[minecraft:item_model="mypack:katana"]`), show it at any size with an item display, or replace a non-full block such as a flower pot or lantern.

To use it:

1. Get the jar from the [mod build](https://github.com/abdireal/claude/actions/workflows/mod.yml) (newest green run, *Artifacts*), or build it with `cd mod && ./gradlew build`.
2. Put it and Fabric API in `.minecraft/mods`.
3. In BlockGraph, export the resource pack (Export → Download resource pack) and turn it on in game.

What models cannot do:

- Add new blocks or items. Those need the server, so models replace how existing ones look.
- Change hitboxes, or blocks drawn by block entity renderers (chests, signs, beds, banners, heads).
- Animate. Bows, crossbows, compasses and clocks show one model the whole time.
- Replacing a full cube (like stone) leaves holes, because neighbouring blocks hide their faces against it. Use non-full blocks.
- Shaders: item models (in hand, on the ground, in item displays) go through the Items & Entities graph, and block models through the Blocks graph, where **Block Type → Custom Models** singles them out. The live preview shows item models in your hand and block models on the grass.

## How it is built

| File | Job |
| --- | --- |
| `app/js/nodes.js` | Node definitions and the GLSL each one emits |
| `app/js/codegen.js` | Type inference and graph-to-GLSL compiler (vertex and fragment stages) |
| `app/js/targets.js` | Wraps compiled code into WebGL2 preview shaders and Iris pack files |
| `app/js/preview.js` | WebGL2 renderer, procedural block textures and the preview scene |
| `app/js/editor.js` | The node canvas: dragging, wiring, panning, zooming, selection |
| `app/js/textures.js` | Textures tab: baking, pixel paint, uploads, resource pack export |
| `app/js/models.js` | Models tab: import, fitting, materials, preview, model export |
| `app/js/meshes.js` | OBJ, MTL, glTF and GLB reading, fitting maths, OBJ export, sample models |
| `app/js/modelview.js` | The 3D model view in the Models tab |
| `app/samples/` | Sample models (`sting.glb`: Bilbo's Sting, from a Blender file, with its normal, roughness and emission detail baked into 512 px colour textures) |
| `mod/` | The BlockGraph Models Fabric mod (Java, built by GitHub Actions) |
| `app/js/anim.js` | Animations graph: CEM expression compiler, the preview's CEM interpreter, `.jem` export |
| `app/js/mobs.js` | Mob part names, preview geometry and the vanilla walk, attack and sneak poses |
| `app/js/app.js` | App shell: library, inspector, presets, undo, export |
| `app/js/zip.js` | Small ZIP writer for the pack export |

Generated shaders are written to be valid both as GLSL ES 3.00 (preview) and GLSL 330 compatibility (Iris). Every node and preset was checked with `glslangValidator` for both targets.

## Limits of this version

- No coloured shadows through stained glass, screen-space reflections or volumetric light yet.
- Animations move the parts a mob already has. New body shapes need a model editor such as Blockbench. The preview's mobs are close to, not exactly, the game's models, and it shows seven mobs.
- Unity features with no Minecraft equivalent are left out: Sub Graphs, matrix nodes, texture and cubemap asset nodes, parallax mapping, object and reflection probe data.
- Sky, clouds, particles, beacon beams and spider eyes use simple vanilla-style shaders. The graphs cover blocks, items, entities, block entities and the screen.
- The sky reflection is a cheap gradient (sky colour above, fog colour at the horizon), not a real reflection of the world.
- The preview imitates Minecraft lighting. In game, your resource pack and the real lightmap are used.
