package dev.blockgraph.models;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import net.minecraft.client.renderer.block.model.BlockModelPart;
import net.minecraft.client.renderer.block.model.BlockStateModel;
import net.minecraft.client.renderer.block.model.SimpleModelWrapper;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.state.BlockState;

import net.fabricmc.fabric.api.client.model.loading.v1.ModelLoadingPlugin;

import dev.blockgraph.models.mixin.SimpleModelWrapperAccessor;

/**
 * Block states whose model is an OBJ mesh.
 *
 * <p>Two things in vanilla get in the way of a model on a block:
 * <ul>
 * <li>A full cube such as stone or dirt is solid, so its neighbours hide the faces that touch it.
 * A model with any gaps then shows holes into the neighbours.</li>
 * <li>Chests, signs, beds, banners and heads are drawn by a block entity renderer, not by their
 * block model, so a model in the resource pack would never be seen.</li>
 * </ul>
 * For every state with an OBJ model the mod therefore reports "not solid", "draw the block model"
 * and "no block entity renderer" (see the mixins). All of it is client side: the server still sees
 * the vanilla block.
 */
public final class ObjBlockStates {
	/** Added to every block state by {@code BlockStateBaseMixin}. */
	public interface Flag {
		boolean blockgraph$isObj();

		void blockgraph$setObj(boolean obj);
	}

	private static final Set<BlockState> MARKED = ConcurrentHashMap.newKeySet();

	private ObjBlockStates() {
	}

	public static boolean isObj(BlockState state) {
		return ((Flag) (Object) state).blockgraph$isObj();
	}

	public static int count() {
		return MARKED.size();
	}

	static void register() {
		ModelLoadingPlugin.register(context -> {
			// Called on every model reload: start from vanilla again.
			for (BlockState state : MARKED) {
				((Flag) (Object) state).blockgraph$setObj(false);
			}

			MARKED.clear();

			context.modifyBlockModelAfterBake().register((model, ctx) -> {
				if (usesObj(model)) {
					MARKED.add(ctx.state());
					((Flag) (Object) ctx.state()).blockgraph$setObj(true);
				}

				return model;
			});
		});
	}

	private static boolean usesObj(BlockStateModel model) {
		List<BlockModelPart> parts = new ArrayList<>();
		model.collectParts(RandomSource.create(42L), parts);

		for (BlockModelPart part : parts) {
			if (part instanceof SimpleModelWrapper wrapper && ObjGeometry.isObjGeometry(((SimpleModelWrapperAccessor) (Object) wrapper).blockgraph$quads())) {
				return true;
			}
		}

		return false;
	}
}
