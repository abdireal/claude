package dev.blockgraph.models.gametest;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.minecraft.client.CameraType;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackRepository;

import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;

import dev.blockgraph.models.ObjGeometry;

/**
 * Starts the real game with a resource pack exported by BlockGraph (Sting on the
 * netherite sword, a sample sword on the diamond sword, crystals on the flower
 * pot), checks that every OBJ mesh loaded, and takes screenshots.
 */
public class ModelsInGameTest implements FabricClientGameTest {
	private static final Logger LOG = LoggerFactory.getLogger("BlockGraph Models test");
	private static final String PACK_FILE = "blockgraph-test-pack.zip";

	@Override
	public void runTest(ClientGameTestContext context) {
		enableTestPack(context);
		context.takeScreenshot("00_title_screen_with_pack");

		int baked = ObjGeometry.BAKED.get();
		int failed = ObjGeometry.FAILED.get();
		LOG.info("OBJ meshes baked: {}, failed: {}", baked, failed);

		if (failed > 0) {
			throw new AssertionError(failed + " OBJ mesh(es) failed to load, see the log above");
		}

		if (baked < 3) {
			throw new AssertionError("Expected the 3 models of the test pack to bake, but only " + baked + " meshes were baked");
		}

		try (TestSingleplayerContext world = createWorld(context)) {
			TestServerContext server = world.getServer();
			world.getClientWorld().waitForChunksRender();

			server.runCommand("time set noon");
			// Face south, looking a little down, with three crystal flower pots ahead.
			server.runCommand("execute as @p at @s run tp @s ~ ~ ~ 0 12");
			for (int x = -1; x <= 1; x++) {
				server.runCommand("execute as @p at @s run setblock ~" + x + " ~ ~3 minecraft:flower_pot");
			}

			server.runCommand("item replace entity @p hotbar.0 with minecraft:netherite_sword");
			server.runCommand("item replace entity @p hotbar.1 with minecraft:diamond_sword");
			server.runCommand("item replace entity @p hotbar.2 with minecraft:flower_pot");
			server.runCommand("item replace entity @p hotbar.3 with minecraft:iron_sword");
			context.waitTicks(5);
			world.getClientWorld().waitForChunksRender();

			// Sting in first person
			context.getInput().pressKey(options -> options.keyHotbarSlots[0]);
			context.waitTicks(30);
			context.takeScreenshot("01_first_person_sting");

			// the sample sword, and a vanilla iron sword to compare
			context.getInput().pressKey(options -> options.keyHotbarSlots[1]);
			context.waitTicks(30);
			context.takeScreenshot("02_first_person_sample_sword");
			context.getInput().pressKey(options -> options.keyHotbarSlots[3]);
			context.waitTicks(30);
			context.takeScreenshot("03_first_person_vanilla_iron_sword");

			// Sting in the hand, seen from the front
			context.getInput().pressKey(options -> options.keyHotbarSlots[0]);
			context.waitTicks(10);
			setCamera(context, CameraType.THIRD_PERSON_FRONT);
			context.waitTicks(20);
			context.takeScreenshot("04_third_person_sting");
			setCamera(context, CameraType.FIRST_PERSON);

			// inventory icons
			context.getInput().pressKey(options -> options.keyInventory);
			context.waitTicks(10);
			context.takeScreenshot("05_inventory");
			context.setScreen(() -> null);
			context.waitTicks(5);

			// a big Sting on an item display, and the crystals up close
			context.getInput().pressKey(options -> options.keyHotbarSlots[5]);
			server.runCommand("execute as @p at @s run summon minecraft:item_display ~ ~1.7 ~2.2 "
					+ "{item:{id:\"minecraft:netherite_sword\",count:1},"
					+ "transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[2.5f,2.5f,2.5f]}}");
			setHideGui(context, true);
			context.waitTicks(20);
			context.takeScreenshot("06_item_display_sting");

			server.runCommand("execute as @p at @s run tp @s ~ ~ ~1.4 0 38");
			world.getClientWorld().waitForChunksRender();
			context.waitTicks(20);
			context.takeScreenshot("07_crystal_blocks");

			// A pool with gold pillars behind it: with the shader, the water and
			// the held Sting reflect what is on screen.
			server.runCommand("execute as @p at @s run tp @s ~ ~ ~-8 0 22");
			server.runCommand("execute as @p at @s run fill ~-5 ~-1 ~2 ~5 ~-1 ~9 minecraft:water");
			server.runCommand("execute as @p at @s run fill ~-3 ~ ~10 ~-3 ~3 ~10 minecraft:gold_block");
			server.runCommand("execute as @p at @s run fill ~3 ~ ~10 ~3 ~3 ~10 minecraft:diamond_block");
			server.runCommand("execute as @p at @s run fill ~-1 ~ ~11 ~1 ~2 ~11 minecraft:red_concrete");
			setHideGui(context, false);
			context.getInput().pressKey(options -> options.keyHotbarSlots[0]);
			world.getClientWorld().waitForChunksRender();
			context.waitTicks(40);
			context.takeScreenshot("08_water_reflections");

			// Sting up close in the hand, looking at the sky and then the pool.
			server.runCommand("execute as @p at @s run tp @s ~ ~ ~ 0 -20");
			context.waitTicks(30);
			context.takeScreenshot("09_sting_sky");
			server.runCommand("execute as @p at @s run tp @s ~ ~ ~ 0 55");
			context.waitTicks(30);
			context.takeScreenshot("10_sting_over_water");
		}
	}

	// A creative flat world. If it does not load, say which screen it is stuck on.
	private static TestSingleplayerContext createWorld(ClientGameTestContext context) {
		try {
			return context.worldBuilder()
					.adjustSettings(creator -> creator.setGameMode(WorldCreationUiState.SelectedGameMode.CREATIVE))
					.create();
		} catch (AssertionError e) {
			String state = context.computeOnClient(client -> "screen " + (client.screen == null ? "none" : client.screen.getClass().getName())
					+ ", level " + (client.level == null ? "none" : "loaded") + ", overlay " + client.getOverlay());
			LOG.error("World did not load: {}", state);
			context.takeScreenshot("00_world_load_failed");
			throw e;
		}
	}

	// Copies the pack into resourcepacks/, turns it on and waits for the reload.
	private static void enableTestPack(ClientGameTestContext context) {
		context.runOnClient(client -> {
			Path dir = client.gameDirectory.toPath().resolve("resourcepacks");

			try (InputStream in = ModelsInGameTest.class.getResourceAsStream("/" + PACK_FILE)) {
				if (in == null) {
					throw new AssertionError(PACK_FILE + " is missing from the test mod");
				}

				Files.createDirectories(dir);
				Files.copy(in, dir.resolve(PACK_FILE), StandardCopyOption.REPLACE_EXISTING);
			} catch (IOException e) {
				throw new UncheckedIOException(e);
			}

			PackRepository repo = client.getResourcePackRepository();
			repo.reload();
			Pack pack = repo.getPack("file/" + PACK_FILE);

			if (pack == null) {
				throw new AssertionError("The test resource pack was not found. Available: " + repo.getAvailableIds());
			}

			LOG.info("Test resource pack {}: compatibility {}", pack.getId(), pack.getCompatibility());
			List<String> selected = new ArrayList<>(repo.getSelectedIds());
			selected.add(pack.getId());
			repo.setSelected(selected);
			client.options.updateResourcePacks(repo);
		});
		context.waitTicks(5);
		context.waitFor(client -> client.getOverlay() == null, 20 * 60 * 5);
	}

	private static void setCamera(ClientGameTestContext context, CameraType type) {
		context.runOnClient(client -> client.options.setCameraType(type));
	}

	private static void setHideGui(ClientGameTestContext context, boolean hide) {
		context.runOnClient(client -> client.options.hideGui = hide);
	}
}
