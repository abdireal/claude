package dev.blockgraph.models.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.server.packs.resources.ResourceManager;

import dev.blockgraph.models.EntityMeshes;

/** Mob and armour models are read before the entity renderers are made, on every resource reload. */
@Mixin(EntityRenderDispatcher.class)
abstract class EntityRenderDispatcherMixin {
	@Inject(method = "onResourceManagerReload", at = @At("HEAD"))
	private void blockgraph$reload(ResourceManager manager, CallbackInfo ci) {
		EntityMeshes.reload(manager);
	}
}
