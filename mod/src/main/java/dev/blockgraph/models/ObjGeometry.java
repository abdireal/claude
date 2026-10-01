package dev.blockgraph.models;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.jspecify.annotations.Nullable;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.block.model.TextureSlots;
import net.minecraft.client.renderer.texture.MissingTextureAtlasSprite;
import net.minecraft.client.renderer.texture.TextureAtlas;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.client.resources.model.Material;
import net.minecraft.client.resources.model.ModelBaker;
import net.minecraft.client.resources.model.ModelDebugName;
import net.minecraft.client.resources.model.ModelState;
import net.minecraft.client.resources.model.QuadCollection;
import net.minecraft.client.resources.model.UnbakedGeometry;
import net.minecraft.core.Direction;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;

import net.fabricmc.fabric.api.renderer.v1.Renderer;
import net.fabricmc.fabric.api.renderer.v1.mesh.MutableMesh;
import net.fabricmc.fabric.api.renderer.v1.mesh.MutableQuadView;
import net.fabricmc.fabric.api.renderer.v1.mesh.QuadEmitter;
import net.fabricmc.fabric.api.renderer.v1.model.MeshBakedGeometry;
import net.fabricmc.fabric.api.renderer.v1.model.ModelBakeSettingsHelper;

/**
 * Bakes an OBJ file into a Fabric Renderer API mesh.
 *
 * <p>The mesh goes through the normal block and item paths, so Sodium draws it in chunks and Iris
 * runs the shader pack's gbuffers programs on it like on any other block or item. Positions are in
 * blocks: 0 to 1 is one block, the same space as a vanilla model's 0 to 16.
 */
public record ObjGeometry(Identifier location, ObjOptions options) implements UnbakedGeometry {
	private static final float EDGE = 1.0e-4f;

	/** How many meshes were baked and how many failed since the game started (for tests and debugging). */
	public static final AtomicInteger BAKED = new AtomicInteger();
	public static final AtomicInteger FAILED = new AtomicInteger();

	/** Every geometry this class baked, so a baked block model can be recognised as an OBJ model. */
	private static final Set<QuadCollection> OURS = Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<>()));

	public static boolean isObjGeometry(QuadCollection quads) {
		return quads != null && OURS.contains(quads);
	}

	@Override
	public QuadCollection bake(TextureSlots textures, ModelBaker baker, ModelState settings, ModelDebugName name) {
		MutableMesh builder = Renderer.get().mutableMesh();
		QuadEmitter emitter = builder.emitter();
		emitter.pushTransform(ModelBakeSettingsHelper.asQuadTransform(settings, baker.sprites()));

		ObjMesh mesh;

		try {
			mesh = load(location);
		} catch (IOException e) {
			FAILED.incrementAndGet();
			BlockGraphModels.LOGGER.error("{}: could not load mesh {}: {}", name.debugName(), location, e.getMessage());
			emitErrorCube(emitter, sprite(textures, baker, name, ""));
			return remember(new MeshBakedGeometry(builder.immutableCopy()));
		}

		Matrix4f transform = options.transform();
		Matrix3f normalTransform = options.normalTransform();
		Map<String, TextureAtlasSprite> sprites = new HashMap<>();
		Vector3f[] corners = {new Vector3f(), new Vector3f(), new Vector3f(), new Vector3f()};
		Vector3f normal = new Vector3f();

		for (ObjMesh.Face face : mesh.faces) {
			TextureAtlasSprite sprite = sprites.computeIfAbsent(face.material(), material -> sprite(textures, baker, name, material));
			ObjMesh.Corner[] c = face.corners();

			// Minecraft draws quads. A triangle repeats its last corner.
			for (int i = 0; i < 4; i++) {
				ObjMesh.Corner corner = c[Math.min(i, c.length - 1)];
				float[] p = mesh.positions.get(corner.position());
				transform.transformPosition(p[0], p[1], p[2], corners[i]);
				emitter.pos(i, corners[i]);

				if (corner.uv() >= 0) {
					float[] uv = mesh.uvs.get(corner.uv());
					float v = options.flipV() ? 1 - uv[1] : uv[1];
					// Outside 0..1 would read the neighbouring textures in the atlas.
					emitter.uv(i, clamp01(uv[0]), clamp01(v));
				} else {
					emitter.uv(i, 0.5f, 0.5f);
				}

				if (corner.normal() >= 0) {
					float[] n = mesh.normals.get(corner.normal());
					normalTransform.transform(n[0], n[1], n[2], normal);

					if (normal.lengthSquared() > 1.0e-12f) {
						normal.normalize();
						emitter.normal(i, normal);
					}
				}

				if (mesh.hasColors) {
					float[] col = mesh.colors.get(corner.position());

					if (col != null) {
						emitter.color(i, argb(col));
					}
				}
			}

			emitter.spriteBake(sprite, MutableQuadView.BAKE_NORMALIZED);
			emitter.cullFace(cullFace(corners));

			if (options.emissive().contains(face.material())) {
				emitter.emissive(true);
			}

			if (options.renderLayer() != null) {
				emitter.renderLayer(options.renderLayer());
			}

			emitter.emit();
		}

		BAKED.incrementAndGet();
		return remember(new MeshBakedGeometry(builder.immutableCopy()));
	}

	private static QuadCollection remember(QuadCollection quads) {
		OURS.add(quads);
		return quads;
	}

	/** Reads an OBJ file from the resource packs. */
	public static ObjMesh load(Identifier location) throws IOException {
		return load(Minecraft.getInstance().getResourceManager(), location);
	}

	public static ObjMesh load(ResourceManager manager, Identifier location) throws IOException {
		Optional<Resource> resource = manager.getResource(location);

		if (resource.isEmpty()) {
			throw new IOException("file not found in any resource pack (expected assets/" + location.getNamespace() + "/" + location.getPath() + ")");
		}

		try (BufferedReader reader = resource.get().openAsReader()) {
			return ObjMesh.parse(reader);
		}
	}

	/** Finds the texture for an OBJ material: the mapped slot, a slot named like it, then texture, then particle. */
	private TextureAtlasSprite sprite(TextureSlots textures, ModelBaker baker, ModelDebugName name, String material) {
		Material found = null;
		String mapped = options.materials().get(material);

		if (mapped != null) {
			found = textures.getMaterial(mapped);
		}

		if (found == null && !material.isEmpty()) {
			found = textures.getMaterial(material);
		}

		if (found == null) {
			found = textures.getMaterial("texture");
		}

		if (found == null) {
			found = textures.getMaterial("particle");
		}

		if (found == null) {
			BlockGraphModels.LOGGER.warn("{}: no texture for OBJ material \"{}\". Add a \"texture\" entry to \"textures\".", name.debugName(), material);
			found = new Material(TextureAtlas.LOCATION_BLOCKS, MissingTextureAtlasSprite.getLocation());
		}

		return baker.sprites().get(found, name);
	}

	/** Faces lying flat on the side of the block can be hidden by a neighbouring full block. */
	private static @Nullable Direction cullFace(Vector3f[] c) {
		Vector3f n = new Vector3f(c[2]).sub(c[0]).cross(new Vector3f(c[3]).sub(c[1]));

		if (n.lengthSquared() < 1.0e-12f) {
			return null;
		}

		n.normalize();

		if (allNear(c, 0, 0) && n.x < -0.99f) return Direction.WEST;
		if (allNear(c, 0, 1) && n.x > 0.99f) return Direction.EAST;
		if (allNear(c, 1, 0) && n.y < -0.99f) return Direction.DOWN;
		if (allNear(c, 1, 1) && n.y > 0.99f) return Direction.UP;
		if (allNear(c, 2, 0) && n.z < -0.99f) return Direction.NORTH;
		if (allNear(c, 2, 1) && n.z > 0.99f) return Direction.SOUTH;
		return null;
	}

	private static boolean allNear(Vector3f[] c, int axis, float value) {
		for (Vector3f v : c) {
			if (Math.abs(v.get(axis) - value) > EDGE) {
				return false;
			}
		}

		return true;
	}

	/** A small cube in the middle of the block, so a broken mesh is easy to spot in game. */
	private static void emitErrorCube(QuadEmitter emitter, TextureAtlasSprite sprite) {
		for (Direction d : Direction.values()) {
			emitter.square(d, 0.3f, 0.3f, 0.7f, 0.7f, 0.3f);
			emitter.spriteBake(sprite, MutableQuadView.BAKE_LOCK_UV);
			emitter.emit();
		}
	}

	private static float clamp01(float v) {
		return Math.max(0, Math.min(1, v));
	}

	private static int argb(float[] rgb) {
		int r = Math.round(clamp01(rgb[0]) * 255);
		int g = Math.round(clamp01(rgb[1]) * 255);
		int b = Math.round(clamp01(rgb[2]) * 255);
		return 0xFF000000 | r << 16 | g << 8 | b;
	}
}
