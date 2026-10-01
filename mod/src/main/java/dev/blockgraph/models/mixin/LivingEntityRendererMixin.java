package dev.blockgraph.models.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;
import net.minecraft.client.renderer.rendertype.RenderType;

import dev.blockgraph.models.EntityMeshes;

/** A mob with a model is drawn with the model's texture. */
@Mixin(LivingEntityRenderer.class)
abstract class LivingEntityRendererMixin {
	@Inject(method = "getRenderType", at = @At("RETURN"), cancellable = true)
	private void blockgraph$getRenderType(LivingEntityRenderState state, boolean bodyVisible, boolean translucent, boolean glowing, CallbackInfoReturnable<RenderType> cir) {
		RenderType original = cir.getReturnValue();
		RenderType type = EntityMeshes.renderTypeFor(this, original, bodyVisible, translucent);

		if (type != original) {
			cir.setReturnValue(type);
		}
	}
}
