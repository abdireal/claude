package dev.blockgraph.models;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.minecraft.resources.Identifier;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.model.loading.v1.UnbakedModelDeserializer;

/**
 * BlockGraph Models: lets resource packs use OBJ meshes for blocks, items, mobs and armour.
 *
 * <p>A model file opts in with {@code "fabric:type": "blockgraph:obj"} and names the mesh with
 * {@code "obj"}. Everything else (parent, textures, display, gui_light) works like a vanilla model,
 * so blockstates, item model definitions and the {@code item_model} component all keep working.
 * Blocks with such a model never hide their neighbours' faces, and block entities (chests, signs,
 * beds, banners, heads) are drawn from it ({@link ObjBlockStates}). Mobs, players and worn armour
 * get models from {@code blockgraph/entities/*.json} ({@link EntityMeshes}).
 * Nothing is registered with the game, so the mod is client side only and works on any server.
 */
public final class BlockGraphModels implements ClientModInitializer {
	public static final Logger LOGGER = LoggerFactory.getLogger("BlockGraph Models");
	public static final Identifier OBJ_TYPE = Identifier.fromNamespaceAndPath("blockgraph", "obj");

	@Override
	public void onInitializeClient() {
		UnbakedModelDeserializer.register(OBJ_TYPE, new ObjModelDeserializer());
		ObjBlockStates.register();
		EntityMeshes.register();
		LOGGER.info("Ready. Model files with \"fabric:type\": \"{}\" load OBJ meshes.", OBJ_TYPE);
	}
}
