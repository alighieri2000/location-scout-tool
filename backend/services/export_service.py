"""
DXF export for room geometry traced in the Location Scout tool.
Produces a file importable into Vectorworks, AutoCAD, ArchiCAD, etc.

Layers:
  A-ROOM-OUTLINE  — 2D closed floor plan polyline
  A-ROOM-DIMS     — wall length text labels (plan view)
  A-ANNOTATIONS   — area, perimeter, wall height
  A-WALLS-3D      — extruded wall quads as 3DFACEs (Z-up)
"""
import io
import math


def export_room_dxf(
    tracer_points: list[tuple[float, float, float]],
    wall_height: float,
) -> bytes:
    """
    Generate a DXF R2013 file from a room polygon.

    tracer_points — floor-level vertices in scan space (X, Y_floor, Z).
    wall_height   — extrusion height in metres.

    Coordinate mapping to DXF:
      scan X → DXF X
      scan Z → DXF Y   (scan's horizontal depth becomes DXF north)
      wall H → DXF Z   (up)
    """
    try:
        import ezdxf
        from ezdxf import units as dxf_units
    except ImportError:
        raise RuntimeError(
            "ezdxf is required for DXF export. "
            "Install it with: pip install ezdxf"
        )

    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = 6     # 6 = metres
    doc.header["$MEASUREMENT"] = 1  # 1 = metric
    doc.header["$LUNITS"] = 2       # 2 = decimal

    msp = doc.modelspace()

    # ── Layers ────────────────────────────────────────────────────────────────
    doc.layers.add("A-ROOM-OUTLINE", color=7)   # white / black
    doc.layers.add("A-ROOM-DIMS",    color=3)   # green
    doc.layers.add("A-ANNOTATIONS",  color=2)   # yellow
    doc.layers.add("A-WALLS-3D",     color=5)   # blue

    # ── 2D plan coordinates (XZ → XY) ─────────────────────────────────────────
    p2d = [(p[0], p[2]) for p in tracer_points]
    n = len(p2d)

    # Closed floor plan polyline
    msp.add_lwpolyline(
        p2d, close=True,
        dxfattribs={"layer": "A-ROOM-OUTLINE", "const_width": 0.025},
    )

    # ── Wall segment length labels ─────────────────────────────────────────────
    centroid_x = sum(q[0] for q in p2d) / n
    centroid_y = sum(q[1] for q in p2d) / n
    total_perimeter = 0.0

    for i in range(n):
        a = p2d[i]
        b = p2d[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        seg_len = math.sqrt(dx * dx + dy * dy)
        total_perimeter += seg_len
        if seg_len < 0.01:
            continue

        # Midpoint + outward perpendicular offset for label placement
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = -dy / seg_len, dx / seg_len   # perpendicular left
        if nx * (centroid_x - mx) + ny * (centroid_y - my) > 0:
            nx, ny = -nx, -ny                  # flip to face outward
        offset = 0.25
        text_x, text_y = mx + nx * offset, my + ny * offset

        angle = math.degrees(math.atan2(dy, dx))
        if not (-90 <= angle <= 90):
            angle += 180  # keep text upright

        msp.add_text(
            f"{seg_len:.2f} m",
            dxfattribs={
                "layer": "A-ROOM-DIMS",
                "height": 0.12,
                "insert": (text_x, text_y),
                "rotation": angle,
            },
        )

    # ── Area / perimeter annotation ────────────────────────────────────────────
    area = abs(
        sum(
            p2d[i][0] * p2d[(i + 1) % n][1] - p2d[(i + 1) % n][0] * p2d[i][1]
            for i in range(n)
        )
    ) / 2

    msp.add_text(
        f"Floor area:  {area:.2f} m²",
        dxfattribs={"layer": "A-ANNOTATIONS", "height": 0.18,
                    "insert": (centroid_x, centroid_y + 0.22)},
    )
    msp.add_text(
        f"Perimeter:   {total_perimeter:.2f} m",
        dxfattribs={"layer": "A-ANNOTATIONS", "height": 0.14,
                    "insert": (centroid_x, centroid_y + 0.02)},
    )
    msp.add_text(
        f"Wall height: {wall_height:.2f} m",
        dxfattribs={"layer": "A-ANNOTATIONS", "height": 0.14,
                    "insert": (centroid_x, centroid_y - 0.18)},
    )

    # ── 3D wall faces (Z-up, DXF standard) ────────────────────────────────────
    for i in range(n):
        p1 = tracer_points[i]
        p2 = tracer_points[(i + 1) % n]
        bl = (p1[0], p1[2], 0.0)
        br = (p2[0], p2[2], 0.0)
        tr = (p2[0], p2[2], wall_height)
        tl = (p1[0], p1[2], wall_height)
        msp.add_3dface([bl, br, tr, tl], dxfattribs={"layer": "A-WALLS-3D"})

    # Floor face outline at Z=0 (for reference / slab generation in VW)
    msp.add_lwpolyline(
        p2d, close=True,
        dxfattribs={"layer": "A-WALLS-3D", "elevation": 0.0},
    )

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
