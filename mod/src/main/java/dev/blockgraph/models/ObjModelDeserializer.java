package dev.blockgraph.models;

import com.google.gson.JsonDeserializationContext;
import com.google.gson.JsonObject;

import net.minecraft.client.renderer.block.model.BlockModel;
import net.minecraft.client.renderer.block.model.ItemTransforms;
import net.minecraft.client.renderer.block.model.TextureSlots;
import net.minecraft.client.resources.model.UnbakedModel;
import net.minecraft.resources.Identifier;
import net.minecraft.util.GsonHelper;

import net.fabricmc.fabric.api.client.model.loading.v1.UnbakedModelDeserializer;

/**
 * Reads a model file with {@code "fabric:type": "blockgraph:obj"}.
 *
 * <pre>{@code
 * {
 *   "fabric:type": "blockgraph:obj",
 *   "obj": "mypack:models/item/katana.obj",
 *   "parent": "minecraft:item/handheld",
 *   "textures": { "texture": "mypack:item/katana", "particle": "mypack:item/katana" },
 *   "gui_light": "side",
 *   "blockgraph": {
 *     "flip_v": true,
 *     "materials": { "Blade": "blade" },
 *     "emissive": ["Glow"],
 *     "render_layer": "cutout",
 *     "transform": { "scale": 1.0, "rotation": [0, 0, 0], "translation": [0, 0, 0] }
 *   }
 * }
 * }</pre>
 *
 * <p>Only the geometry is ours. Parent, textures, display transforms, gui light and ambient
 * occlusion are handed to a vanilla {@link BlockModel}, so they behave exactly like vanilla.
 */
public final class ObjModelDeserializer implements UnbakedModelDeserializer {
	@Override
	public UnbakedModel deserialize(JsonObject json, JsonDeserializationContext context) {
		Identifier mesh = meshLocation(GsonHelper.getAsString(json, "obj"));
		ObjOptions options = ObjOptions.fromJson(json.has("blockgraph") ? GsonHelper.getAsJsonObject(json, "blockgraph") : new JsonObject());

		UnbakedModel.GuiLight guiLight = json.has("gui_light")
				? UnbakedModel.GuiLight.getByName(GsonHelper.getAsString(json, "gui_light"))
				: null;
		Boolean ambientOcclusion = json.has("ambientocclusion") ? GsonHelper.getAsBoolean(json, "ambientocclusion") : null;
		ItemTransforms transforms = json.has("display")
				? context.deserialize(GsonHelper.getAsJsonObject(json, "display"), ItemTransforms.class)
				: null;
		TextureSlots.Data textures = json.has("textures")
				? TextureSlots.parseTextureMap(GsonHelper.getAsJsonObject(json, "textures"))
				: TextureSlots.Data.EMPTY;
		String parent = GsonHelper.getAsString(json, "parent", "");

		return new BlockModel(new ObjGeometry(mesh, options), guiLight, ambientOcclusion, transforms, textures,
				parent.isEmpty() ? null : Identifier.parse(parent));
	}

	/**
	 * {@code "mypack:models/item/katana.obj"} is used as is. The short form {@code "mypack:item/katana"}
	 * means {@code assets/mypack/models/item/katana.obj}.
	 */
	static Identifier meshLocation(String value) {
		Identifier id = Identifier.parse(value);

		if (id.getPath().endsWith(".obj")) {
			return id;
		}

		return Identifier.fromNamespaceAndPath(id.getNamespace(), "models/" + id.getPath() + ".obj");
	}
}
