package dev.blockgraph.models.mixin;

import com.llamalad7.mixinextras.injector.ModifyReturnValue;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;

import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;

import dev.blockgraph.models.ObjBlockStates;

/**
 * A block state with an OBJ model hides nothing behind it (so stone or dirt with a model leaves no
 * holes in its neighbours) and is drawn from its block model (so chests, signs, beds, banners and
 * heads show the model instead of their block entity renderer).
 */
@Mixin(BlockBehaviour.BlockStateBase.class)
abstract class BlockStateBaseMixin implements ObjBlockStates.Flag {
	@Unique
	private volatile boolean blockgraph$obj;

	@Override
	public boolean blockgraph$isObj() {
		return blockgraph$obj;
	}

	@Override
	public void blockgraph$setObj(boolean obj) {
		blockgraph$obj = obj;
	}

	@ModifyReturnValue(method = "canOcclude", at = @At("RETURN"))
	private boolean blockgraph$canOcclude(boolean original) {
		return original && !blockgraph$obj;
	}

	@ModifyReturnValue(method = "isSolidRender", at = @At("RETURN"))
	private boolean blockgraph$isSolidRender(boolean original) {
		return original && !blockgraph$obj;
	}

	@ModifyReturnValue(method = "getFaceOcclusionShape", at = @At("RETURN"))
	private VoxelShape blockgraph$getFaceOcclusionShape(VoxelShape original) {
		return blockgraph$obj ? Shapes.empty() : original;
	}

	@ModifyReturnValue(method = "getRenderShape", at = @At("RETURN"))
	private RenderShape blockgraph$getRenderShape(RenderShape original) {
		return blockgraph$obj ? RenderShape.MODEL : original;
	}
}
