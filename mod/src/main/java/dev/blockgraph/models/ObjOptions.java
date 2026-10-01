package dev.blockgraph.models;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.jspecify.annotations.Nullable;

import net.minecraft.client.renderer.chunk.ChunkSectionLayer;
import net.minecraft.util.GsonHelper;

/**
 * The {@code "blockgraph"} object of an OBJ model file.
 *
 * @param flipV       OBJ textures start at the bottom, Minecraft's at the top. True flips V (the default).
 * @param materials   OBJ material name to texture slot. Unlisted materials use a slot with the same name,
 *                    then {@code texture}, then {@code particle}.
 * @param emissive    OBJ materials drawn at full brightness, like glowing parts.
 * @param tinted      OBJ materials coloured like the block's or item's own tint: grass and leaves by biome,
 *                    water by biome, and so on ({@code "*"}: every material).
 * @param renderLayer chunk layer for block models ({@code solid}, {@code cutout}, {@code translucent}), or null for the block's own.
 * @param transform   applied to every vertex, in blocks, around the block centre.
 */
public record ObjOptions(boolean flipV, Map<String, String> materials, Set<String> emissive, Set<String> tinted,
		@Nullable ChunkSectionLayer renderLayer, Matrix4f transform) {
	public static ObjOptions fromJson(JsonObject json) {
		boolean flipV = GsonHelper.getAsBoolean(json, "flip_v", true);

		Map<String, String> materials = new HashMap<>();

		if (json.has("materials")) {
			for (Map.Entry<String, JsonElement> e : GsonHelper.getAsJsonObject(json, "materials").entrySet()) {
				materials.put(e.getKey(), e.getValue().getAsString());
			}
		}

		Set<String> emissive = new HashSet<>();

		if (json.has("emissive")) {
			for (JsonElement e : GsonHelper.getAsJsonArray(json, "emissive")) {
				emissive.add(e.getAsString());
			}
		}

		// "tint": true for every material, or a list of material names.
		Set<String> tinted = new HashSet<>();

		if (json.has("tint")) {
			JsonElement t = json.get("tint");

			if (t.isJsonArray()) {
				for (JsonElement e : t.getAsJsonArray()) {
					tinted.add(e.getAsString());
				}
			} else if (t.getAsBoolean()) {
				tinted.add("*");
			}
		}

		ChunkSectionLayer layer = null;

		if (json.has("render_layer")) {
			String name = GsonHelper.getAsString(json, "render_layer").toUpperCase(Locale.ROOT);

			try {
				layer = ChunkSectionLayer.valueOf(name);
			} catch (IllegalArgumentException e) {
				BlockGraphModels.LOGGER.warn("Unknown render_layer \"{}\", using the block's own layer", name);
			}
		}

		Matrix4f transform = new Matrix4f();

		if (json.has("transform")) {
			JsonObject t = GsonHelper.getAsJsonObject(json, "transform");
			Vector3f scale = vec(t, "scale", 1);
			Vector3f rotation = vec(t, "rotation", 0);
			Vector3f translation = vec(t, "translation", 0);
			transform.translate(0.5f + translation.x, 0.5f + translation.y, 0.5f + translation.z)
					.rotateXYZ((float) Math.toRadians(rotation.x), (float) Math.toRadians(rotation.y), (float) Math.toRadians(rotation.z))
					.scale(scale)
					.translate(-0.5f, -0.5f, -0.5f);
		}

		return new ObjOptions(flipV, Map.copyOf(materials), Set.copyOf(emissive), Set.copyOf(tinted), layer, transform);
	}

	public boolean isTinted(String material) {
		return tinted.contains("*") || tinted.contains(material);
	}

	public Matrix3f normalTransform() {
		return transform.normal(new Matrix3f());
	}

	/** A number gives the same value on all three axes, an array gives each axis. */
	private static Vector3f vec(JsonObject json, String key, float fallback) {
		if (!json.has(key)) {
			return new Vector3f(fallback);
		}

		JsonElement e = json.get(key);

		if (e.isJsonArray()) {
			JsonArray a = e.getAsJsonArray();
			return new Vector3f(a.get(0).getAsFloat(), a.get(1).getAsFloat(), a.get(2).getAsFloat());
		}

		return new Vector3f(e.getAsFloat());
	}
}
