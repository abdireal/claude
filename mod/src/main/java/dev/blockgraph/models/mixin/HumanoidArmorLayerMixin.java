package dev.blockgraph.models.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.mojang.blaze3d.vertex.PoseStack;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.HumanoidArmorLayer;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.state.HumanoidRenderState;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;

import dev.blockgraph.models.EntityMeshes;

/** Armour with a model is drawn as the model, on the wearer's head, body, arms and legs. */
@Mixin(HumanoidArmorLayer.class)
abstract class HumanoidArmorLayerMixin<S extends HumanoidRenderState, M extends HumanoidModel<S>, A extends HumanoidModel<S>> extends RenderLayer<S, M> {
	HumanoidArmorLayerMixin(RenderLayerParent<S, M> parent) {
		super(parent);
	}

	@Inject(method = "renderArmorPiece", at = @At("HEAD"), cancellable = true)
	private void blockgraph$renderArmorPiece(PoseStack poseStack, SubmitNodeCollector collector, ItemStack stack, EquipmentSlot slot, int light, S state, CallbackInfo ci) {
		if (EntityMeshes.submitArmor(stack, poseStack, collector, light, state, getParentModel())) {
			ci.cancel();
		}
	}
}
