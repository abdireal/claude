package dev.blockgraph.models;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * A Wavefront OBJ mesh: positions, texture coordinates, normals and polygon faces.
 *
 * <p>Supports {@code v} (with optional vertex colours {@code v x y z r g b}), {@code vt}, {@code vn},
 * {@code f} with any of the {@code v}, {@code v/vt}, {@code v//vn}, {@code v/vt/vn} forms and negative
 * indices, and {@code usemtl}. Faces with more than four corners are split into a triangle fan.
 * Groups, smoothing groups, lines and {@code mtllib} are ignored: textures come from the model file.
 */
public final class ObjMesh {
	/** One corner of a face. {@code uv} and {@code normal} are -1 when the file gave none. */
	public record Corner(int position, int uv, int normal) { }

	/** A triangle or a quad. */
	public record Face(Corner[] corners, String material) { }

	public final List<float[]> positions = new ArrayList<>();
	public final List<float[]> colors = new ArrayList<>();
	public final List<float[]> uvs = new ArrayList<>();
	public final List<float[]> normals = new ArrayList<>();
	public final List<Face> faces = new ArrayList<>();
	public boolean hasColors;

	public static ObjMesh parse(BufferedReader reader) throws IOException {
		ObjMesh mesh = new ObjMesh();
		String material = "";
		String line;
		int lineNumber = 0;

		while ((line = reader.readLine()) != null) {
			lineNumber++;
			int hash = line.indexOf('#');

			if (hash >= 0) {
				line = line.substring(0, hash);
			}

			line = line.strip();

			if (line.isEmpty()) {
				continue;
			}

			String[] p = line.split("\\s+");

			try {
				switch (p[0]) {
				case "v" -> {
					mesh.positions.add(new float[] {f(p[1]), f(p[2]), f(p[3])});

					if (p.length >= 7) {
						mesh.colors.add(new float[] {f(p[4]), f(p[5]), f(p[6])});
						mesh.hasColors = true;
					} else {
						mesh.colors.add(null);
					}
				}
				case "vt" -> mesh.uvs.add(new float[] {f(p[1]), p.length > 2 ? f(p[2]) : 0});
				case "vn" -> mesh.normals.add(new float[] {f(p[1]), f(p[2]), f(p[3])});
				case "usemtl" -> material = p.length > 1 ? line.substring(6).strip() : "";
				case "f" -> mesh.addFace(p, material);
				default -> { }
				}
			} catch (RuntimeException e) {
				throw new IOException("Line " + lineNumber + " (\"" + line + "\"): " + e.getMessage(), e);
			}
		}

		return mesh;
	}

	private void addFace(String[] p, String material) {
		Corner[] corners = new Corner[p.length - 1];

		for (int i = 1; i < p.length; i++) {
			String[] idx = p[i].split("/", -1);
			int v = index(idx[0], positions.size());
			int t = idx.length > 1 && !idx[1].isEmpty() ? index(idx[1], uvs.size()) : -1;
			int n = idx.length > 2 && !idx[2].isEmpty() ? index(idx[2], normals.size()) : -1;
			corners[i - 1] = new Corner(v, t, n);
		}

		if (corners.length < 3) {
			return;
		}

		if (corners.length <= 4) {
			faces.add(new Face(corners, material));
			return;
		}

		for (int i = 1; i < corners.length - 1; i++) {
			faces.add(new Face(new Corner[] {corners[0], corners[i], corners[i + 1]}, material));
		}
	}

	/** OBJ indices start at 1; negative ones count back from the end. */
	private static int index(String s, int count) {
		int i = Integer.parseInt(s);
		int r = i < 0 ? count + i : i - 1;

		if (r < 0 || r >= count) {
			throw new IllegalArgumentException("index " + i + " is out of range (" + count + " defined so far)");
		}

		return r;
	}

	private static float f(String s) {
		return Float.parseFloat(s);
	}
}
