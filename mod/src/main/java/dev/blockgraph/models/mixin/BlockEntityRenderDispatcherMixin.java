package dev.blockgraph.models.mixin;

import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import net.minecraft.client.renderer.blockentity.BlockEntityRenderDispatcher;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.world.level.block.entity.BlockEntity;

import dev.blockgraph.models.ObjBlockStates;

/** Chests, signs, beds, banners and heads with an OBJ model are drawn by the model alone. */
@Mixin(BlockEntityRenderDispatcher.class)
abstract class BlockEntityRenderDispatcherMixin {
	@Inject(method = "getRenderer", at = @At("HEAD"), cancellable = true)
	private void blockgraph$getRenderer(BlockEntity blockEntity, CallbackInfoReturnable<BlockEntityRenderer<?, ?>> cir) {
		if (ObjBlockStates.isObj(blockEntity.getBlockState())) {
			cir.setReturnValue(null);
		}
	}

	@Inject(method = "tryExtractRenderState", at = @At("HEAD"), cancellable = true)
	private void blockgraph$tryExtractRenderState(BlockEntity blockEntity, float partialTick, ModelFeatureRenderer.@Nullable CrumblingOverlay crumbling, CallbackInfoReturnable<BlockEntityRenderState> cir) {
		if (ObjBlockStates.isObj(blockEntity.getBlockState())) {
			cir.setReturnValue(null);
		}
	}
}
