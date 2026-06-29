"""
Mesh loading, face analysis, UV operations, and export.
Handles OBJ, GLB, GLTF, USDZ, PLY, PTS (point cloud) from Polycam/Scaniverse/Nomad.
"""
import os
import json
import uuid
import numpy as np
from pathlib import Path
from typing import Any

import trimesh
import trimesh.exchange.load as tl


SUPPORTED_MESH = {".obj", ".glb", ".gltf", ".usdz", ".ply", ".stl", ".fbx"}
SUPPORTED_POINTCLOUD = {".pts", ".las", ".xyz", ".e57"}


def _detect_floor_y(all_pts: np.ndarray) -> float:
    """
    Estimate floor Y by finding the dominant Y cluster in the lower half of the scan.
    Room floors typically have far more vertices than walls at the same Y level.
    """
    y = all_pts[:, 1]
    y_min, y_max = float(y.min()), float(y.max())
    y_range = y_max - y_min
    if y_range < 0.01:
        return y_min

    counts, edges = np.histogram(y, bins=200)
    # Restrict to bottom 40 % of height range to avoid ceiling/beam false positives
    cutoff = y_min + 0.40 * y_range
    mask = edges[:-1] <= cutoff
    if not mask.any():
        return y_min
    best = int(np.argmax(counts * mask))
    return float((edges[best] + edges[best + 1]) / 2)


def load_scan(file_path: str) -> dict[str, Any]:
    """
    Load a scan file and return mesh data ready for the viewer.
    Returns a GLB blob + metadata (face count, vertex count, bounding box).

    Textures are preserved by keeping the Scene structure when present.
    Only flattens to a single Trimesh when the file has no material data.
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext in SUPPORTED_POINTCLOUD:
        return _load_pointcloud(str(path))

    TARGET_FACES = 100_000

    # ── FBX: transcode via open3d (trimesh cannot parse FBX) ──────────────────
    if ext == ".fbx":
        import open3d as o3d
        o3d_mesh = o3d.io.read_triangle_mesh(str(path), enable_post_processing=True)
        if len(o3d_mesh.vertices) == 0:
            raise ValueError("FBX loaded 0 vertices — file may be empty or use unsupported features")
        tmp_glb = path.with_suffix(".tmp.glb")
        try:
            o3d.io.write_triangle_mesh(str(tmp_glb), o3d_mesh)
            loaded = trimesh.load(str(tmp_glb), process=False)
        finally:
            tmp_glb.unlink(missing_ok=True)
    else:
        # Do NOT use force="mesh" — that collapses the scene and strips materials/textures.
        loaded = trimesh.load(str(path), process=False)

    # ── Scene path: keep structure so per-mesh materials survive ──────────────
    if isinstance(loaded, trimesh.Scene) and len(loaded.geometry) > 0:
        geoms = list(loaded.geometry.values())
        total_faces = sum(len(g.faces) for g in geoms)

        if total_faces > TARGET_FACES:
            print(f"[mesh] Decimating scene: {total_faces:,} faces across {len(geoms)} meshes")
            for name in list(loaded.geometry.keys()):
                g = loaded.geometry[name]
                if len(g.faces) < 500:
                    continue
                target = max(500, int(len(g.faces) * TARGET_FACES / total_faces))
                try:
                    loaded.geometry[name] = g.simplify_quadric_decimation(target)
                except Exception as e:
                    print(f"[mesh]   skip {name}: {e}")

        out_id = uuid.uuid4().hex
        out_path = Path("outputs") / f"{out_id}.glb"
        loaded.export(str(out_path))

        geoms = list(loaded.geometry.values())
        face_count = sum(len(g.faces) for g in geoms)
        vert_count = sum(len(g.vertices) for g in geoms)
        all_pts = np.concatenate([g.vertices for g in geoms if len(g.vertices) > 0])
        bounds = [all_pts.min(axis=0).tolist(), all_pts.max(axis=0).tolist()]
        center = ((all_pts.min(axis=0) + all_pts.max(axis=0)) / 2).tolist()
        has_uv = any(
            hasattr(g.visual, "uv") and g.visual.uv is not None for g in geoms
        )
        return {
            "mesh_id": out_id,
            "glb_url": f"/outputs/{out_id}.glb",
            "vertex_count": vert_count,
            "face_count": face_count,
            "bounds": bounds,
            "center": center,
            "has_uv": has_uv,
            "floor_y": _detect_floor_y(all_pts),
        }

    # ── Single-mesh path (no material structure to preserve) ──────────────────
    if isinstance(loaded, trimesh.Scene):
        if len(loaded.geometry) == 0:
            raise ValueError("Empty scene — no geometry found in file")
        mesh = trimesh.util.concatenate(list(loaded.geometry.values()))
    else:
        mesh = loaded

    if len(mesh.faces) > TARGET_FACES:
        original_faces = len(mesh.faces)
        try:
            mesh = mesh.simplify_quadric_decimation(TARGET_FACES)
            print(f"[mesh] Decimated {original_faces:,} → {len(mesh.faces):,} faces")
        except Exception as e:
            print(f"[mesh] Decimation failed ({e}), using original mesh")

    out_id = uuid.uuid4().hex
    out_path = Path("outputs") / f"{out_id}.glb"
    mesh.export(str(out_path))

    bounds = mesh.bounds.tolist() if mesh.bounds is not None else None
    center = mesh.centroid.tolist() if len(mesh.vertices) > 0 else [0, 0, 0]
    all_pts = mesh.vertices if len(mesh.vertices) > 0 else np.zeros((1, 3))
    return {
        "mesh_id": out_id,
        "glb_url": f"/outputs/{out_id}.glb",
        "vertex_count": len(mesh.vertices),
        "face_count": len(mesh.faces),
        "bounds": bounds,
        "center": center,
        "has_uv": hasattr(mesh.visual, "uv") and mesh.visual.uv is not None,
        "floor_y": _detect_floor_y(all_pts),
    }


def _load_pointcloud(file_path: str) -> dict[str, Any]:
    """Convert a point cloud to a simple mesh via ball-pivoting approximation."""
    import open3d as o3d

    pcd = o3d.io.read_point_cloud(file_path)
    pcd.estimate_normals()

    # Ball-pivoting surface reconstruction
    distances = pcd.compute_nearest_neighbor_distance()
    avg_dist = np.mean(distances)
    radius = 3 * avg_dist
    mesh_o3d = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(
        pcd, o3d.utility.DoubleVector([radius, radius * 2])
    )

    # Convert to trimesh for export
    verts = np.asarray(mesh_o3d.vertices)
    faces = np.asarray(mesh_o3d.triangles)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    out_id = uuid.uuid4().hex
    out_path = Path("outputs") / f"{out_id}.glb"
    mesh.export(str(out_path))

    return {
        "mesh_id": out_id,
        "glb_url": f"/outputs/{out_id}.glb",
        "vertex_count": len(verts),
        "face_count": len(faces),
        "bounds": mesh.bounds.tolist() if mesh.bounds is not None else None,
        "center": mesh.centroid.tolist(),
        "has_uv": False,
        "source": "pointcloud",
    }


def apply_texture_to_faces(
    mesh_id: str,
    face_indices: list[int],
    texture_path: str,
    uv_repeat: tuple[float, float] = (1.0, 1.0),
) -> dict[str, Any]:
    """
    Apply a generated texture to a selected subset of faces.
    Re-exports the mesh as a new GLB with the texture baked in.
    """
    src_path = Path("outputs") / f"{mesh_id}.glb"
    mesh: trimesh.Trimesh = trimesh.load(str(src_path), force="mesh", process=False)

    if not face_indices:
        raise ValueError("No faces selected")

    face_mask = np.zeros(len(mesh.faces), dtype=bool)
    face_mask[face_indices] = True

    # Ensure UVs exist — auto-unwrap if not
    if not (hasattr(mesh.visual, "uv") and mesh.visual.uv is not None):
        mesh = _auto_unwrap(mesh)

    # Load and assign texture
    from PIL import Image as PILImage
    tex_img = PILImage.open(texture_path).convert("RGB")

    material = trimesh.visual.texture.SimpleMaterial(image=tex_img)
    mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.visual.uv, material=material)

    # Scale UVs for the selected faces to implement repeat
    uv = mesh.visual.uv.copy()
    selected_vertex_indices = np.unique(mesh.faces[face_mask])
    uv[selected_vertex_indices] *= np.array(uv_repeat)
    mesh.visual.uv = uv

    out_id = uuid.uuid4().hex
    out_path = Path("outputs") / f"{out_id}.glb"
    mesh.export(str(out_path))

    return {
        "mesh_id": out_id,
        "glb_url": f"/outputs/{out_id}.glb",
    }


def crop_patch_from_render(
    render_path: str,
    x: float,
    y: float,
    w: float,
    h: float,
) -> str:
    """
    Crop a rectangular patch from a rendered image of the mesh.
    Returns path to the cropped patch PNG used as the texture seed.
    """
    from PIL import Image as PILImage

    img = PILImage.open(render_path)
    width, height = img.size
    left = int(x * width)
    top = int(y * height)
    right = int((x + w) * width)
    bottom = int((y + h) * height)
    patch = img.crop((left, top, right, bottom))

    patch_id = uuid.uuid4().hex
    patch_path = Path("textures") / f"patch_{patch_id}.png"
    patch.save(str(patch_path))
    return str(patch_path)


def _auto_unwrap(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Minimal UV unwrap using trimesh's built-in angle-based method."""
    try:
        uv, _ = trimesh.exchange.uv.unwrap(mesh)
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv)
    except Exception:
        # Fallback: spherical projection
        verts = mesh.vertices - mesh.centroid
        u = 0.5 + np.arctan2(verts[:, 0], verts[:, 2]) / (2 * np.pi)
        v = 0.5 - np.arcsin(np.clip(verts[:, 1] / (np.linalg.norm(verts, axis=1) + 1e-8), -1, 1)) / np.pi
        uv = np.stack([u, v], axis=1)
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv)
    return mesh


def _normal_to_euler_xyz(n: np.ndarray) -> list[float]:
    """Euler XYZ rotation to orient PlaneGeometry (default face +Z) toward n."""
    n = np.asarray(n, dtype=float)
    default = np.array([0., 0., 1.])
    cross = np.cross(default, n)
    dot = float(np.dot(default, n))
    cn = float(np.linalg.norm(cross))
    if cn < 1e-8:
        return [0., 0., 0.] if dot > 0 else [float(np.pi), 0., 0.]
    ang = float(np.arccos(np.clip(dot, -1., 1.)))
    ax = cross / cn
    c, s = np.cos(ang), np.sin(ang)
    t = 1. - c
    x, y, z = float(ax[0]), float(ax[1]), float(ax[2])
    R = np.array([
        [t*x*x+c,   t*x*y-s*z, t*x*z+s*y],
        [t*x*y+s*z, t*y*y+c,   t*y*z-s*x],
        [t*x*z-s*y, t*y*z+s*x, t*z*z+c  ],
    ])
    ry = float(np.arcsin(np.clip(R[0, 2], -1., 1.)))
    cos_ry = float(np.cos(ry))
    if abs(cos_ry) > 1e-6:
        rx = float(np.arctan2(-R[1, 2], R[2, 2]))
        rz = float(np.arctan2(-R[0, 1], R[0, 0]))
    else:
        rx = float(np.arctan2(R[2, 1], R[1, 1]))
        rz = 0.
    return [rx, ry, rz]


def detect_planes(mesh_id: str) -> list[dict]:
    """
    RANSAC plane segmentation on the scan mesh.
    Returns plane descriptors ready to become PlacedShapes in the frontend.
    Each result has: type, normal, center, width, height, area, rotation, point_count.
    """
    import trimesh.sample as ts
    import open3d as o3d

    path = Path("outputs") / f"{mesh_id}.glb"
    if not path.exists():
        raise FileNotFoundError(f"Mesh {mesh_id} not found in outputs/")

    tri = trimesh.load(str(path), force="mesh", process=False)
    if isinstance(tri, trimesh.Scene):
        tri = trimesh.util.concatenate(list(tri.geometry.values()))

    n_pts = min(60_000, max(5_000, len(tri.faces) * 2))
    pts, _ = ts.sample_surface(tri, n_pts)

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)

    planes: list[dict] = []
    rem = pcd
    room_center = pts.mean(axis=0)   # used to orient wall normals inward

    floor_found = False

    for _ in range(12):
        pts_arr = np.asarray(rem.points)
        if len(pts_arr) < 300:
            break
        try:
            model, inliers = rem.segment_plane(
                distance_threshold=0.025,   # tighter fit — fewer runaway inliers
                ransac_n=3,
                num_iterations=2000,
            )
        except Exception as e:
            print(f"[detect] RANSAC error: {e}")
            break
        if len(inliers) < 200:
            break

        a, b, c, d = model
        raw_n = np.array([a, b, c], dtype=float)
        rn = np.linalg.norm(raw_n)
        if rn < 1e-8:
            rem = rem.select_by_index(inliers, invert=True)
            continue
        raw_n /= rn

        # Snap to nearest cardinal axis
        ax, ay, az = abs(raw_n[0]), abs(raw_n[1]), abs(raw_n[2])
        if ay >= ax and ay >= az:
            snapped = np.array([0., float(np.sign(raw_n[1])), 0.])
            is_horiz = True
        elif ax >= az:
            snapped = np.array([float(np.sign(raw_n[0])), 0., 0.])
            is_horiz = False
        else:
            snapped = np.array([0., 0., float(np.sign(raw_n[2]))])
            is_horiz = False

        # Skip ceiling (downward-pointing horizontal normal) entirely.
        # Only keep the first floor found; additional horizontal planes are ignored.
        if is_horiz:
            if snapped[1] < 0:            # ceiling — skip
                rem = rem.select_by_index(inliers, invert=True)
                continue
            if floor_found:               # second floor — skip
                rem = rem.select_by_index(inliers, invert=True)
                continue
            floor_found = True

        # For wall planes, flip normal to face inward toward room center
        if not is_horiz:
            to_center = room_center - np.array([a, b, c], dtype=float) * (-d / (a*a + b*b + c*c + 1e-12))
            if np.dot(to_center, snapped) < 0:
                snapped = -snapped

        inlier_pts = pts_arr[inliers]

        if is_horiz:
            u_dir = np.array([1., 0., 0.])
            v_dir = np.array([0., 0., 1.])
        else:
            u_dir = np.cross(snapped, np.array([0., 1., 0.]))
            ul = np.linalg.norm(u_dir)
            u_dir = u_dir / ul if ul > 1e-6 else np.array([1., 0., 0.])
            v_dir = np.array([0., 1., 0.])

        # Project inliers onto plane-local axes and crop to 2nd–98th percentile
        # to reject stray scan artifacts that inflate the bounding box.
        u_proj = inlier_pts @ u_dir
        v_proj = inlier_pts @ v_dir
        u_lo, u_hi = np.percentile(u_proj, 2), np.percentile(u_proj, 98)
        v_lo, v_hi = np.percentile(v_proj, 2), np.percentile(v_proj, 98)

        w = float(u_hi - u_lo)
        h = float(v_hi - v_lo)
        area = w * h

        # Centre the shape at the median of its inlier footprint, not the mean
        center = (
            ((u_lo + u_hi) / 2) * u_dir
            + ((v_lo + v_hi) / 2) * v_dir
            + float(np.median(inlier_pts @ snapped)) * snapped
        )

        if area >= 0.5 and w > 0.3 and h > 0.3:
            planes.append({
                "type": "floor" if is_horiz else "wall",
                "normal": snapped.tolist(),
                "center": center.tolist(),
                "width": round(w, 3),
                "height": round(h, 3),
                "area": round(area, 3),
                "rotation": _normal_to_euler_xyz(snapped),
                "point_count": int(len(inliers)),
            })

        rem = rem.select_by_index(inliers, invert=True)

    planes.sort(key=lambda p: (0 if p["type"] == "floor" else 1, -p["area"]))
    return planes
