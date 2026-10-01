package dev.blockgraph.models.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

import net.minecraft.client.renderer.block.model.SimpleModelWrapper;
import net.minecraft.client.resources.model.QuadCollection;

@Mixin(SimpleModelWrapper.class)
public interface SimpleModelWrapperAccessor {
	@Accessor("quads")
	QuadCollection blockgraph$quads();
}
