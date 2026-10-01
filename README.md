# BlockGraph

A node-based shader editor for Minecraft. Connect nodes in your browser, watch a live 3D preview, and export a real **Iris** shader pack for **Minecraft 1.21.11 on Fabric**.

It works like Unity Shader Graph: every node is a small piece of GLSL, and the graph is compiled into complete shader programs.

## What you get

- **Three shader graphs.** *Blocks* runs on every block (exports to `gbuffers_terrain` and `gbuffers_water`). *Items & Entities* runs on held items, dropped items, item frames, item displays, armour, mobs, players and block entities such as chests, signs, banners, beds, skulls and shulker boxes. *Post FX* runs on the finished screen image (exports to `composite`).
- **Textures tab: a resource pack creator.** Build textures with Blender-style nodes (Brick, Wave, Magic, Musgrave, Voronoi, Noise, White Noise, Gradient), pixel-paint on top (pencil, eraser, fill, colour picker), or upload PNGs (for example textures baked in Blender). Pick which Minecraft texture each one replaces, see it in the live preview under your shader, and export a resource pack (format 75, Minecraft 1.21.11). The **Image Texture** node samples any of them inside a shader, and they ship in the shader pack as Iris custom textures.
- **Models tab: real 3D models for items and blocks.** Import OBJ (with MTL), GLB or glTF files (from Blender: File → Export → glTF 2.0), or start from a sample: **Sting** (Bilbo's sword, replacing the netherite sword), a simple sword or a crystal block. Choose what the model is for (replace an item like `diamond_sword`, a new item id for `/give` and item displays, or replace a block like `flower_pot`), fit it into the block with pose presets, and give each material a texture from the Textures tab, where you paint it with the model's UVs drawn on top. The live preview shows item models in your hand under the Items & Entities graph and block models on the grass under the Blocks graph, where **Block Type → Custom Models** singles them out. Models ship in the resource pack and need the small client-side [BlockGraph Models mod](mod/README.md).
- **Sun shadows.** A real Iris shadow pass (`shadow.vsh`/`shadow.fsh`). Blocks, mobs, players and chests cast shadows onto blocks, water, items, mobs and block entities. Cut-out leaves and plants give dappled shadows, and the Blocks graph's Vertex Offset runs in the shadow pass, so waving plants cast waving shadows. Strength, softness, quality, distance and sun angle are set in the Graph panel and become a *Shadows* page in Iris → Shader Settings.
- **Masks that tell objects apart.** Is Held (first person), Item ID Mask, Held Item Mask, Entity Type Mask and Block Entity Mask. Ready-made groups: swords (and 1.21.11 spears), tools, shields, armour, food, blocks as items, players, hostile mobs, item displays, dropped items, chests, signs, banners, beds, skulls and shulker boxes.
- **About 146 nodes, following Unity Shader Graph's library.** Inputs (block texture and LOD, biome tint, light, block type masks, face UV, view direction, screen position, sun and sky, camera, time and weather), Math (basic, advanced, range, round, interpolation, derivatives, random), Trigonometry and waves, Vector and channel (cross, projection, reflection, refract, rotate about axis, sphere mask, swizzle, flip, channel mask), Logic (branch, comparison, and, or, not), Artistic colour (blend with 21 modes, white balance, replace colour, colour mask, channel mixer, invert, colourspace conversion, dither, gradient, blackbody, metal reflectance), Normal (from height, strength, blend), UV (tiling and offset, rotate, twirl, polar, spherize, radial shear), Procedural (noise, gradient noise, Voronoi, checkerboard, ellipse, rectangle, rounded rectangle, polygon) and screen effects.
- **Live preview on every node**, like Unity: a lit ball for block nodes, the real scene for Post FX nodes.
- **Lit output.** The Block Output and the Item & Entity Output work like Unity's Master Stack: Color, Alpha, Normal, Smoothness, Metallic, Ambient Occlusion, Emission, Alpha Clip and Vertex Offset, with Vanilla or Lit lighting. Lit adds sun shading, a specular highlight and a cheap sky reflection on metallic surfaces, so metal swords and armour shine. Both receive sun shadows (switch off with *Receive sun shadows*), and the **Sun Shadow** node gives you the shadow as a value for stylised looks.
- **Custom Function** for your own GLSL, **Sticky Notes**, **Reroute** nodes and collapsible library categories.
- **Vertex Offset.** Wire anything into it to move blocks themselves, for waving leaves and plants or rolling water.
- **In-game settings.** Slider, On/Off and Dropdown Setting nodes become options in Iris → Shader Settings, with `shaders.properties` and language labels written for you.
- **Live preview.** A small Minecraft-style scene in WebGL2 with procedural textures, day/night and rain controls, and its own shadow map. A held sword and shield, a chest and a zombie (which flashes red when hurt) use the Items & Entities graph.
- **Presets.** Waving Plants, Realistic (PBR + reflections), Shiny Weapons, Toon World, Retro TV, Night Vision, Dreamy Glow, Ocean Waves, Tiny Planet, Comic Outline, Lit & Bumpy and a blank start.
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

## Realistic materials and reflections

- **Material Maps node.** Reads the normal map and specular map that sit next to a texture (LabPBR `name_n.png` and `name_s.png`, which Iris loads). Outputs Normal, Smoothness, Metallic, Emission and AO for a Lit output. Textures without maps read as flat and matte, so it is safe to wire up everywhere.
- **Reflections.** Lit surfaces reflect the sky (blurrier when rough), the ground below and nearby torchlight. In game, a *Reflections* pass (`composite`) then marches each smooth pixel's reflection across the screen and shows the world where it finds it, so polished metal and water mirror what is around them. Rays from the held item ignore the hand.
- **Realistic (PBR + reflections)** preset: Lit blocks and items with Material Maps, mirror-smooth water, and the shiny-weapon mask for vanilla gear without maps. With the Sting sample it shows the engraved, polished steel and bronze from the original Blender file.

| Setting | Iris option | What it does |
| --- | --- | --- |
| Screen reflections | `BG_REFLECTIONS` | Turns the Reflections pass on or off (`program.composite.enabled`). Off keeps the sky reflections |
| Reflection quality | `BG_REFLECTION_STEPS` | Steps per reflection ray, 12 to 48 |

Lit outputs write their normal and smoothness to `colortex1`, the reflection strength to `colortex2` and the sky they reflected to `colortex3`. The Post FX graph now runs in `composite1`.

## 3D grass

Turn on **3D grass** in the Graph panel (under Shadows) and the shader pack gets a geometry shader, `gbuffers_terrain.gsh`, that grows low-poly blades on every grass block near the player: one triangle each, turned towards the camera, coloured by the grass texture and the biome, swaying in the wind (more in rain). 120 blades per block by default, 12 to 160 in the settings; they thin out with distance. No mod needed, but the grass needs OpenGL 4 (the geometry shader runs several times per triangle). Blades, height, wind and distance become a *3D Grass* page in Iris → Shader Settings, where players can also turn it off. The preview grows the same blades.

With the Models mod there are also two low-poly samples under Models → New: a grass tuft that replaces short grass, and a grass block with blades on top. Their blades take the biome colour (*Biome tint* on a material) and sway with the Blocks graph's wind: Block Type → Wave Mask now bends plants from the root and moves model parts that stick out above a grass block, while the block itself stays still. Block Type also has *Grass Block* and *Height in Block* outputs.

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

1. Install Fabric Loader for 1.21.11, then the Iris and Sodium mods.
2. Put the exported `.zip` in `.minecraft/shaderpacks`. Leave it zipped.
3. In game, open Options → Video Settings → Shader Packs (or press `O`), select the pack and press Apply.
4. After exporting a new version, replace the zip and press `R` in game to reload.

The zip also contains `blockgraph-graph.json`. Open it with Presets → Open graph file to keep editing.

## 3D models

Minecraft can only build models out of boxes. The **BlockGraph Models** mod in [`mod/`](mod/README.md) adds real meshes:

- **Client side only.** It changes how things look, not what they are, so it works on any server, vanilla ones included. Players without your resource pack see the normal item or block. Players with the pack but without the mod see a fallback that BlockGraph writes into the pack: the normal item sprite, or a textured box for blocks and shields.
- **Fabric 1.21.11.** It needs Fabric Loader and Fabric API, and works with Sodium and Iris. Model blocks are drawn by the normal block renderer, so your Blocks shader runs on them.
- **Mobs, players and armour.** *Replace a mob* or *Replace armour* in the Models tab: BlockGraph splits your model into the mob's body parts (head, body, arms, legs), so it walks and looks around with the vanilla animation, and packs its textures into one. Armour shows on every humanoid that wears it.
- **Chests, signs, beds, banners, heads and full cubes.** Blocks with a model are drawn from it, never from their block entity renderer, and neighbours keep the faces that touch them, so even stone or dirt can be replaced without holes.
- **Any item or block.** Replace every diamond sword, give a model to any item with the `item_model` component (`/give @p stick[minecraft:item_model="mypack:katana"]`), show it at any size with an item display, or replace a non-full block such as a flower pot or lantern.

To use it:

1. Get the jar from the [mod build](https://github.com/abdireal/claude/actions/workflows/mod.yml) (newest green run, *Artifacts*), or build it with `cd mod && ./gradlew build`.
2. Put it and Fabric API in `.minecraft/mods`.
3. In BlockGraph, export the resource pack (Export → Download resource pack) and turn it on in game.

What models cannot do:

- Add new blocks or items. Those need the server, so models replace how existing ones look.
- Change hitboxes.
- Animate block entities: a chest, sign, bed, banner or head with a model stays still (no opening lid, sign text or banner pattern).
- Animate. Bows, crossbows, compasses and clocks show one model the whole time.
- Material maps: glTF normal, metal/roughness, occlusion and emission maps (and OBJ `map_Bump`, `Pr`, `Pm`, `map_Pr`, `map_Pm`, `Ke`, `map_Ke`) become LabPBR `_n` and `_s` textures next to the model's textures. Each material also has a *Surface* choice (from the file, matte, glossy, polished or brushed metal, gem) for models without maps. A shader reads them with Material Maps.
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
| `app/js/app.js` | App shell: library, inspector, presets, undo, export |
| `app/js/zip.js` | Small ZIP writer for the pack export |

Generated shaders are written to be valid both as GLSL ES 3.00 (preview) and GLSL 330 compatibility (Iris). Every node and preset was checked with `glslangValidator` for both targets.

## Limits of this version

- No coloured shadows through stained glass, screen-space reflections or volumetric light yet.
- Unity features with no Minecraft equivalent are left out: Sub Graphs, matrix nodes, texture and cubemap asset nodes, parallax mapping, object and reflection probe data.
- Sky, clouds, particles, beacon beams and spider eyes use simple vanilla-style shaders. The graphs cover blocks, items, entities, block entities and the screen.
- The sky reflection is a cheap gradient (sky colour above, fog colour at the horizon), not a real reflection of the world.
- The preview imitates Minecraft lighting. In game, your resource pack and the real lightmap are used.
