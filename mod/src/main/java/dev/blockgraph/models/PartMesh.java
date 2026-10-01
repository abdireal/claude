package dev.blockgraph.models;

import java.util.List;

import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Vector3f;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;

/**
 * The faces of an OBJ mesh that belong to one body part, ready to draw where the part is.
 *
 * <p>Positions are in the part's own space (blocks), so the part's animation moves them. UVs cover
 * the whole entity texture (0 to 1, V down). Every face is stored as a quad, as entity render types
 * draw quads: a triangle repeats its last corner.
 */
public final class PartMesh {
	private final float[] pos;
	private final float[] uv;
	private final float[] nrm;
	private final int vertices;

	private PartMesh(float[] pos, float[] uv, float[] nrm) {
		this.pos = pos;
		this.uv = uv;
		this.nrm = nrm;
		this.vertices = pos.length / 3;
	}

	/** {@code toLocal} takes the OBJ's coordinates to the part's space. */
	public static PartMesh build(ObjMesh mesh, List<ObjMesh.Face> faces, Matrix4f toLocal) {
		Matrix3f normalMatrix = toLocal.normal(new Matrix3f());
		int count = faces.size() * 4;
		float[] pos = new float[count * 3];
		float[] uv = new float[count * 2];
		float[] nrm = new float[count * 3];
		Vector3f p = new Vector3f();
		Vector3f n = new Vector3f();
		int v = 0;

		for (ObjMesh.Face face : faces) {
			ObjMesh.Corner[] c = face.corners();
			Vector3f flat = faceNormal(mesh, c, toLocal);

			for (int i = 0; i < 4; i++, v++) {
				ObjMesh.Corner corner = c[Math.min(i, c.length - 1)];
				float[] src = mesh.positions.get(corner.position());
				toLocal.transformPosition(src[0], src[1], src[2], p);
				pos[v * 3] = p.x;
				pos[v * 3 + 1] = p.y;
				pos[v * 3 + 2] = p.z;

				if (corner.uv() >= 0) {
					float[] t = mesh.uvs.get(corner.uv());
					uv[v * 2] = t[0];
					uv[v * 2 + 1] = 1 - t[1]; // OBJ V goes up, textures go down
				}

				if (corner.normal() >= 0) {
					float[] sn = mesh.normals.get(corner.normal());
					normalMatrix.transform(sn[0], sn[1], sn[2], n);

					if (n.lengthSquared() > 1.0e-12f) {
						n.normalize();
					} else {
						n.set(flat);
					}
				} else {
					n.set(flat);
				}

				nrm[v * 3] = n.x;
				nrm[v * 3 + 1] = n.y;
				nrm[v * 3 + 2] = n.z;
			}
		}

		return new PartMesh(pos, uv, nrm);
	}

	private static Vector3f faceNormal(ObjMesh mesh, ObjMesh.Corner[] c, Matrix4f toLocal) {
		Vector3f a = toLocal.transformPosition(new Vector3f(mesh.positions.get(c[0].position())));
		Vector3f b = toLocal.transformPosition(new Vector3f(mesh.positions.get(c[1].position())));
		Vector3f d = toLocal.transformPosition(new Vector3f(mesh.positions.get(c[2].position())));
		Vector3f n = b.sub(a).cross(d.sub(a));
		return n.lengthSquared() > 1.0e-12f ? n.normalize() : new Vector3f(0, 1, 0);
	}

	public boolean isEmpty() {
		return vertices == 0;
	}

	/** Draws the faces at the part's current pose, with the light, overlay and tint vanilla cubes get. */
	public void emit(PoseStack.Pose pose, VertexConsumer buffer, int light, int overlay, int color) {
		for (int i = 0; i < vertices; i++) {
			buffer.addVertex(pose, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
					.setColor(color)
					.setUv(uv[i * 2], uv[i * 2 + 1])
					.setOverlay(overlay)
					.setLight(light)
					.setNormal(pose, nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
		}
	}
}
