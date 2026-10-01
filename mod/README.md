# BlockGraph Models

A small **client-side** Fabric mod for **Minecraft 1.21.11** that lets resource packs give any block or item a real 3D mesh (Wavefront OBJ) instead of boxes. BlockGraph's Models tab writes these packs for you, but you can also write them by hand.

- Client side only: works on any server. Players without the mod see the fallback in your model files (see below), or the normal item or block if they don't have your resource pack either.
- Needs Fabric Loader 0.17.3 or newer and Fabric API.
- Meshes go through the normal block and item renderers (Fabric Renderer API), so they work with Sodium, and Iris shader packs run on them.

## Install

1. Download the jar from the [GitHub Actions build](https://github.com/abdireal/claude/actions/workflows/mod.yml): open the newest green run and download `blockgraph-models-1.21.11` under *Artifacts*. Or build it yourself (below).
2. Put it in `.minecraft/mods` next to Fabric API.
3. Turn on a resource pack that has OBJ models.

## Model file format

A model file opts in with `"fabric:type": "blockgraph:obj"` (or `{ "id": "blockgraph:obj", "optional": true }`, see *Fallback*) and names the mesh with `"obj"`. Everything else is a normal vanilla model: `parent` (for display transforms), `textures`, `display`, `gui_light` and `ambientocclusion` work as usual, so blockstates, item model definitions (`assets/<ns>/items/*.json`) and the `item_model` component all keep working.

`assets/mypack/models/item/katana.json`:

```json
{
  "fabric:type": "blockgraph:obj",
  "obj": "mypack:models/item/katana.obj",
  "parent": "minecraft:item/handheld",
  "gui_light": "front",
  "textures": {
    "blade": "mypack:item/katana_blade",
    "grip": "mypack:item/katana_grip",
    "particle": "mypack:item/katana_blade"
  },
  "blockgraph": {
    "emissive": ["blade"]
  }
}
```

Then point an item at it, for example `assets/minecraft/items/diamond_sword.json`:

```json
{ "model": { "type": "minecraft:model", "model": "mypack:item/katana" } }
```

### Fallback for players without the mod

Without the mod, the file is read as a plain vanilla model, and the mod ignores the vanilla geometry in it. So you can put a fallback in the same file:

- Use `"fabric:type": { "id": "blockgraph:obj", "optional": true }`. Fabric API then loads the file as a vanilla model when the mod is missing, instead of failing.
- For items with an `item/generated` or `item/handheld` parent, add `"layer0": "minecraft:item/diamond_sword"` to `textures`: players without the mod see the normal sprite.
- For blocks, add vanilla `elements` (for example one box around the model).

BlockGraph writes all of this for you.

### The OBJ file

- One block is 0 to 1 on every axis, the same space as a vanilla model's 0 to 16. Items are laid out where their 16×16 sprite would be: the z = 0.5 plane, and for tools the handle at the bottom left and the tip at the top right.
- `usemtl` names pick the texture: a material uses the texture slot with its name, then `texture`, then `particle`. Map other names with `"materials"`.
- Supported: `v` (with optional vertex colours), `vt`, `vn`, `f` in every index form (negative indices too), `usemtl`. Quads stay quads, bigger polygons are split into triangles. `mtllib`, groups and smoothing groups are ignored.
- `"obj": "mypack:item/katana"` (no `.obj`) is short for `mypack:models/item/katana.obj`.

### Options (`"blockgraph"` object, all optional)

| Key | Meaning |
| --- | --- |
| `flip_v` | OBJ textures start at the bottom, Minecraft's at the top. `true` (default) flips V. |
| `materials` | OBJ material name to texture slot, e.g. `{ "Material.001": "blade" }`. |
| `emissive` | OBJ materials drawn at full brightness. |
| `render_layer` | `solid`, `cutout` or `translucent` for block models. Default: the block's own layer. |
| `transform` | `{ "scale": 1, "rotation": [x, y, z], "translation": [x, y, z] }` in blocks and degrees, around the block centre. |

If the OBJ file is missing or broken, the model shows a small cube with the particle texture and the log says why.

## In-game test

`src/gametest` is a small test mod for CI. GitHub Actions ([`game.yml`](../.github/workflows/game.yml)) starts real Minecraft 1.21.11 from the released jars, turns on a resource pack exported by BlockGraph (Sting on the netherite sword, a sample sword on the diamond sword, crystals on the flower pot), checks that every OBJ mesh loaded, and takes screenshots in a flat creative world. A second run adds Sodium, Iris and a BlockGraph shader pack. Start the workflow by hand to have the screenshots committed to `screenshots/`.

```
./gradlew runProductionClientGameTest
```

## Build

```
./gradlew build
```

The jar lands in `build/libs/`. It needs Java 21, and Gradle downloads Minecraft, Fabric Loader and Fabric API (`gradle.properties` has the versions).
