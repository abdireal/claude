package dev.blockgraph.models.mixin;

import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.mojang.blaze3d.vertex.PoseStack;

import net.minecraft.client.model.Model;
import net.minecraft.client.renderer.SubmitNodeCollection;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;

import dev.blockgraph.models.EntityMeshes;

/** Layers drawn over a replaced mob's vanilla body (spider eyes, creeper charge, ...) are left out. */
@Mixin(SubmitNodeCollection.class)
abstract class SubmitNodeCollectionMixin {
	@Inject(method = "submitModel", at = @At("HEAD"), cancellable = true)
	private void blockgraph$submitModel(Model<?> model, Object state, PoseStack poseStack, RenderType renderType, int light, int overlay, int color, @Nullable TextureAtlasSprite sprite, int outlineColor, ModelFeatureRenderer.@Nullable CrumblingOverlay crumbling, CallbackInfo ci) {
		if (EntityMeshes.skip(model, renderType)) {
			ci.cancel();
		}
	}
}
