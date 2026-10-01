# BlockGraph

A node-based shader editor for Minecraft. Connect nodes in your browser, watch a live 3D preview, and export a real **Iris** shader pack for **Minecraft 1.21.11 on Fabric**.

It works like Unity Shader Graph: every node is a small piece of GLSL, and the graph is compiled into complete shader programs.

## What you get

- **Two shader graphs.** *Blocks* runs on every block (exports to `gbuffers_terrain` and `gbuffers_water`). *Post FX* runs on the finished screen image (exports to `composite`).
- **Textures tab: a resource pack creator.** Build textures with Blender-style nodes (Brick, Wave, Magic, Musgrave, Voronoi, Noise, White Noise, Gradient), pixel-paint on top (pencil, eraser, fill, colour picker), or upload PNGs (for example textures baked in Blender). Pick which Minecraft texture each one replaces, see it in the live preview under your shader, and export a resource pack (format 75, Minecraft 1.21.11). The **Image Texture** node samples any of them inside a shader, and they ship in the shader pack as Iris custom textures.
- **Models tab: real 3D models for items and blocks.** Import OBJ (with MTL), GLB or glTF files (from Blender: File → Export → glTF 2.0), or start from a sample: **Sting** (Bilbo's sword, replacing the netherite sword), a simple sword or a crystal block. Choose what the model is for (replace an item like `diamond_sword`, a new item id for `/give` and item displays, or replace a block like `flower_pot`), fit it into the block with pose presets, and give each material a texture from the Textures tab, where you paint it with the model's UVs drawn on top. The model shows in the live preview under your Blocks shader, and **Block Type → Custom Models** singles out model blocks in shaders. Models ship in the resource pack and need the small client-side [BlockGraph Models mod](mod/README.md).
- **About 140 nodes, following Unity Shader Graph's library.** Inputs (block texture and LOD, biome tint, light, block type masks, face UV, view direction, screen position, sun and sky, camera, time and weather), Math (basic, advanced, range, round, interpolation, derivatives, random), Trigonometry and waves, Vector and channel (cross, projection, reflection, refract, rotate about axis, sphere mask, swizzle, flip, channel mask), Logic (branch, comparison, and, or, not), Artistic colour (blend with 21 modes, white balance, replace colour, colour mask, channel mixer, invert, colourspace conversion, dither, gradient, blackbody, metal reflectance), Normal (from height, strength, blend), UV (tiling and offset, rotate, twirl, polar, spherize, radial shear), Procedural (noise, gradient noise, Voronoi, checkerboard, ellipse, rectangle, rounded rectangle, polygon) and screen effects.
- **Live preview on every node**, like Unity: a lit ball for block nodes, the real scene for Post FX nodes.
- **Lit output.** The Block Output works like Unity's Master Stack: Color, Alpha, Normal, Smoothness, Metallic, Ambient Occlusion, Emission and Alpha Clip, with Vanilla or Lit (sun shading plus specular) lighting.
- **Custom Function** for your own GLSL, **Sticky Notes**, **Reroute** nodes and collapsible library categories.
- **Vertex Offset.** Wire anything into it to move blocks themselves, for waving leaves and plants or rolling water.
- **In-game settings.** Slider, On/Off and Dropdown Setting nodes become options in Iris → Shader Settings, with `shaders.properties` and language labels written for you.
- **Live preview.** A small Minecraft-style scene in WebGL2 with procedural textures, day/night and rain controls.
- **Presets.** Waving Plants, Toon World, Retro TV, Night Vision, Dreamy Glow, Ocean Waves, Tiny Planet, Comic Outline, Lit & Bumpy and a blank start.
- **View code.** See the exact GLSL each node produces.
- Undo/redo, copy/paste, box select, autosave in the browser, and save/open graph files.

## Run it locally

```
node tools/serve.mjs
```

Then open http://localhost:5173. No install step and no build step. `app/index.html` is written in claude.ai Artifact form (no `<html>` skeleton), and the dev server adds one.

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
- In game, items in hand and on the ground use the shader pack's hand and entity programs, which BlockGraph keeps vanilla-style for now. The Blocks graph covers models used as blocks.

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

- No shadows, reflections or volumetric light yet. Those need extra Iris passes.
- Unity features with no Minecraft equivalent are left out: Sub Graphs, matrix nodes, texture and cubemap asset nodes, parallax mapping, object and reflection probe data.
- Entities, sky, clouds and particles use simple vanilla-style shaders. The graphs cover blocks and the screen.
- The preview imitates Minecraft lighting. In game, your resource pack and the real lightmap are used.
