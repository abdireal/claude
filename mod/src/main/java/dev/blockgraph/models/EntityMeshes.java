package dev.blockgraph.models;

import java.io.Reader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.jspecify.annotations.Nullable;

import com.mojang.blaze3d.vertex.PoseStack;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.state.HumanoidRenderState;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.util.GsonHelper;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

import net.fabricmc.fabric.api.client.rendering.v1.ArmorRenderer;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;

import dev.blockgraph.models.mixin.ModelPartAccessor;

/**
 * 3D models for mobs, players and worn armour.
 *
 * <p>A resource pack lists them in {@code assets/<namespace>/blockgraph/entities/*.json}:
 * <pre>
 * {"entity": "minecraft:zombie", "model": "mypack:models/entity/knight.obj", "texture": "mypack:textures/entity/knight.png"}
 * {"item": "minecraft:diamond_helmet", "model": "mypack:models/entity/crown.obj", "texture": "mypack:textures/entity/crown.png"}
 * </pre>
 *
 * <p>The OBJ is in "feet space": blocks, Y up, the origin on the ground between the feet, the front
 * towards +Z. Objects or groups named after the vanilla model's parts ({@code head}, {@code body},
 * {@code right_arm}, {@code left_leg}, {@code right_hind_leg}, ...) are fastened to those parts, so
 * they turn and swing with the vanilla animation. Faces in any other group ride on the whole body.
 * A mob's own cubes, and layers drawn on its body (eyes, charge, ...), are hidden; its texture is
 * the model's texture. An armour model replaces that item's armour on every humanoid (players,
 * zombies, skeletons, ...), with its parts on the wearer's head, body, arms and legs.
 */
public final class EntityMeshes {
	/** Added to every {@link ModelPart} by {@code ModelPartMixin}. */
	public interface PartTag {
		void blockgraph$tag(@Nullable PartMesh mesh, boolean hideCubes);
	}

	private record Config(Identifier file, ObjMesh mesh, Identifier texture) { }

	private record Skin(RenderType cutout, RenderType translucent, RenderType outline) { }

	private record Armor(Model<Object> model, RenderType type) { }

	/** Feet space to entity model space: Y down, front towards -Z, ground at 1.501 (LivingEntityRenderer's offset). */
	private static final Matrix4f FEET_TO_MODEL = new Matrix4f().translate(0, 1.501f, 0).scale(1, -1, -1);

	/** Pivots of the humanoid model's parts, in pixels: where armour pieces hang. */
	private static final Map<String, Vector3f> HUMANOID = new LinkedHashMap<>();

	static {
		HUMANOID.put("head", new Vector3f(0, 0, 0));
		HUMANOID.put("body", new Vector3f(0, 0, 0));
		HUMANOID.put("right_arm", new Vector3f(-5, 2, 0));
		HUMANOID.put("left_arm", new Vector3f(5, 2, 0));
		HUMANOID.put("right_leg", new Vector3f(-1.9f, 12, 0));
		HUMANOID.put("left_leg", new Vector3f(1.9f, 12, 0));
	}

	private static final Map<EntityType<?>, Config> ENTITIES = new HashMap<>();
	private static final Map<Item, Armor> ARMOR = new HashMap<>();
	private static final Map<Object, Skin> RENDERERS = Collections.synchronizedMap(new WeakHashMap<>());
	private static final Set<Object> REPLACED = Collections.newSetFromMap(Collections.synchronizedMap(new WeakHashMap<>()));
	private static final Set<RenderType> OURS = Collections.newSetFromMap(Collections.synchronizedMap(new IdentityHashMap<>()));

	private EntityMeshes() {
	}

	static void register() {
		LivingEntityFeatureRendererRegistrationCallback.EVENT.register((type, renderer, helper, context) -> onRenderer(type, renderer));
	}

	/** Reads every model list of the resource packs. Runs before the entity renderers are made again. */
	public static void reload(ResourceManager manager) {
		ENTITIES.clear();
		ARMOR.clear();
		RENDERERS.clear();
		REPLACED.clear();
		OURS.clear();

		Map<Identifier, Resource> files = manager.listResources("blockgraph/entities", id -> id.getPath().endsWith(".json"));

		for (Map.Entry<Identifier, Resource> file : files.entrySet()) {
			try (Reader reader = file.getValue().openAsReader()) {
				JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();
				Identifier model = Identifier.parse(GsonHelper.getAsString(json, "model"));
				Identifier texture = Identifier.parse(GsonHelper.getAsString(json, "texture"));
				Config config = new Config(file.getKey(), ObjGeometry.load(manager, model), texture);

				if (json.has("entity")) {
					Identifier id = Identifier.parse(GsonHelper.getAsString(json, "entity"));
					BuiltInRegistries.ENTITY_TYPE.getOptional(id).ifPresentOrElse(
							type -> ENTITIES.put(type, config),
							() -> BlockGraphModels.LOGGER.warn("{}: there is no entity {}", file.getKey(), id));
				} else if (json.has("item")) {
					Identifier id = Identifier.parse(GsonHelper.getAsString(json, "item"));
					BuiltInRegistries.ITEM.getOptional(id).ifPresentOrElse(
							item -> ARMOR.put(item, armor(config)),
							() -> BlockGraphModels.LOGGER.warn("{}: there is no item {}", file.getKey(), id));
				} else {
					BlockGraphModels.LOGGER.warn("{}: needs \"entity\" (a mob) or \"item\" (armour)", file.getKey());
				}
			} catch (Exception e) {
				BlockGraphModels.LOGGER.error("{}: could not load: {}", file.getKey(), e.getMessage());
			}
		}

		if (!ENTITIES.isEmpty() || !ARMOR.isEmpty()) {
			BlockGraphModels.LOGGER.info("{} mob model(s) and {} armour model(s) loaded", ENTITIES.size(), ARMOR.size());
		}
	}

	private static void onRenderer(EntityType<?> type, LivingEntityRenderer<?, ?, ?> renderer) {
		Config config = ENTITIES.get(type);

		if (config == null) {
			return;
		}

		Model<?> model = renderer.getModel();
		fasten(model.root(), config);
		REPLACED.add(model);

		Skin skin = new Skin(
				RenderTypes.entityCutoutNoCull(config.texture()),
				RenderTypes.entityTranslucent(config.texture()),
				RenderTypes.outline(config.texture()));
		OURS.add(skin.cutout());
		OURS.add(skin.translucent());
		OURS.add(skin.outline());
		RENDERERS.put(renderer, skin);
	}

	/** Hides every cube of the model and fastens each group of the mesh to the part with its name. */
	private static void fasten(ModelPart root, Config config) {
		Map<String, List<ObjMesh.Face>> groups = groups(config.mesh());
		Set<String> names = new HashSet<>();
		collectNames(root, names);

		List<ObjMesh.Face> loose = new ArrayList<>();

		for (Map.Entry<String, List<ObjMesh.Face>> group : groups.entrySet()) {
			if (!names.contains(group.getKey())) {
				loose.addAll(group.getValue());
			}
		}

		Matrix4f rootPose = pose(new Matrix4f(), root);
		tag(root, loose.isEmpty() ? null : PartMesh.build(config.mesh(), loose, toLocal(rootPose)), true);
		fastenChildren(root, rootPose, groups, config.mesh());
	}

	private static void fastenChildren(ModelPart part, Matrix4f partPose, Map<String, List<ObjMesh.Face>> groups, ObjMesh mesh) {
		for (Map.Entry<String, ModelPart> child : ((ModelPartAccessor) (Object) part).blockgraph$children().entrySet()) {
			Matrix4f childPose = pose(new Matrix4f(partPose), child.getValue());
			List<ObjMesh.Face> faces = groups.get(child.getKey());
			tag(child.getValue(), faces == null ? null : PartMesh.build(mesh, faces, toLocal(childPose)), true);
			fastenChildren(child.getValue(), childPose, groups, mesh);
		}
	}

	private static void collectNames(ModelPart part, Set<String> names) {
		for (Map.Entry<String, ModelPart> child : ((ModelPartAccessor) (Object) part).blockgraph$children().entrySet()) {
			names.add(child.getKey());
			collectNames(child.getValue(), names);
		}
	}

	/** What ModelPart.translateAndRotate does, from the part's resting pose. */
	private static Matrix4f pose(Matrix4f m, ModelPart p) {
		return m.translate(p.x / 16, p.y / 16, p.z / 16).rotateZYX(p.zRot, p.yRot, p.xRot).scale(p.xScale, p.yScale, p.zScale);
	}

	private static Matrix4f toLocal(Matrix4f partPose) {
		return new Matrix4f(partPose).invert().mul(FEET_TO_MODEL);
	}

	private static void tag(ModelPart part, @Nullable PartMesh mesh, boolean hideCubes) {
		((PartTag) (Object) part).blockgraph$tag(mesh == null || mesh.isEmpty() ? null : mesh, hideCubes);
	}

	/** Faces by part name. "Head", "LeftArm" and "left arm" all mean the vanilla part "left_arm" or "head". */
	private static Map<String, List<ObjMesh.Face>> groups(ObjMesh mesh) {
		Map<String, List<ObjMesh.Face>> out = new LinkedHashMap<>();

		for (ObjMesh.Face face : mesh.faces) {
			out.computeIfAbsent(partName(face.group()), k -> new ArrayList<>()).add(face);
		}

		return out;
	}

	static String partName(String group) {
		String s = group.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
		return s.replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
	}

	private static Armor armor(Config config) {
		Map<String, List<ObjMesh.Face>> groups = groups(config.mesh());
		List<ObjMesh.Face> loose = new ArrayList<>();

		for (Map.Entry<String, List<ObjMesh.Face>> group : groups.entrySet()) {
			if (!HUMANOID.containsKey(group.getKey())) {
				loose.addAll(group.getValue());
			}
		}

		Map<String, ModelPart> parts = new HashMap<>();

		for (Map.Entry<String, Vector3f> entry : HUMANOID.entrySet()) {
			List<ObjMesh.Face> faces = new ArrayList<>(groups.getOrDefault(entry.getKey(), List.of()));

			if (entry.getKey().equals("body")) {
				faces.addAll(loose);
			}

			// The empty child makes ModelPart.render reach this part's own drawing.
			ModelPart part = new ModelPart(List.of(), Map.of("blockgraph_anchor", new ModelPart(List.of(), Map.of())));
			Vector3f pivot = entry.getValue();
			part.x = pivot.x;
			part.y = pivot.y;
			part.z = pivot.z;

			if (!faces.isEmpty()) {
				Matrix4f toLocal = new Matrix4f().translate(-pivot.x / 16, -pivot.y / 16, -pivot.z / 16).mul(FEET_TO_MODEL);
				tag(part, PartMesh.build(config.mesh(), faces, toLocal), false);
			}

			parts.put(entry.getKey(), part);
		}

		RenderType type = RenderTypes.armorCutoutNoCull(config.texture());
		OURS.add(type);
		Model<Object> model = new Model<Object>(new ModelPart(List.of(), parts), RenderTypes::armorCutoutNoCull) { };
		return new Armor(model, type);
	}

	// ------------------------------------------------------------ used by the mixins

	/** The texture swap for a mob with a model: its main render type, drawn with the model's texture. */
	public static @Nullable RenderType renderTypeFor(Object renderer, @Nullable RenderType original, boolean bodyVisible, boolean translucent) {
		if (original == null) {
			return null;
		}

		Skin skin = RENDERERS.get(renderer);

		if (skin == null) {
			return original;
		}

		return translucent ? skin.translucent() : bodyVisible ? skin.cutout() : skin.outline();
	}

	/** True for layers drawn on a replaced mob's vanilla body (eyes, charge, ...): they are left out. */
	public static boolean skip(Model<?> model, RenderType type) {
		return REPLACED.contains(model) && !OURS.contains(type);
	}

	/** Draws armour with a model in place of the vanilla piece. False when this item has none. */
	@SuppressWarnings({"unchecked", "rawtypes"})
	public static boolean submitArmor(ItemStack stack, PoseStack poseStack, SubmitNodeCollector collector, int light, HumanoidRenderState state, HumanoidModel<?> wearer) {
		Armor armor = ARMOR.get(stack.getItem());

		if (armor == null) {
			return false;
		}

		ArmorRenderer.submitTransformCopyingModel((Model) wearer, state, armor.model(), state, false, collector, poseStack, armor.type(), light, OverlayTexture.NO_OVERLAY, 0, null);
		return true;
	}
}
