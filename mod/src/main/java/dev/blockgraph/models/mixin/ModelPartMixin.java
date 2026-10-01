package dev.blockgraph.models.mixin;

import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;

import net.minecraft.client.model.geom.ModelPart;

import dev.blockgraph.models.EntityMeshes;
import dev.blockgraph.models.PartMesh;

/** A body part can carry a piece of an OBJ mesh, drawn at the part's pose, and hide its cubes. */
@Mixin(ModelPart.class)
abstract class ModelPartMixin implements EntityMeshes.PartTag {
	@Unique
	private @Nullable PartMesh blockgraph$mesh;

	@Unique
	private boolean blockgraph$hideCubes;

	@Override
	public void blockgraph$tag(@Nullable PartMesh mesh, boolean hideCubes) {
		blockgraph$mesh = mesh;
		blockgraph$hideCubes = hideCubes;
	}

	@Inject(method = "compile", at = @At("HEAD"), cancellable = true)
	private void blockgraph$compile(PoseStack.Pose pose, VertexConsumer buffer, int light, int overlay, int color, CallbackInfo ci) {
		if (blockgraph$mesh != null) {
			blockgraph$mesh.emit(pose, buffer, light, overlay, color);
		}

		if (blockgraph$hideCubes) {
			ci.cancel();
		}
	}
}
