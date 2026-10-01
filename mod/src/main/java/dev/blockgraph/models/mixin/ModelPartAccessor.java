package dev.blockgraph.models.mixin;

import java.util.Map;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

import net.minecraft.client.model.geom.ModelPart;

@Mixin(ModelPart.class)
public interface ModelPartAccessor {
	@Accessor("children")
	Map<String, ModelPart> blockgraph$children();
}
