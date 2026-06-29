import os
import uuid
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.mesh_processor import (
    load_scan,
    apply_texture_to_faces,
    crop_patch_from_render,
    detect_planes as detect_planes_fn,
    SUPPORTED_MESH,
    SUPPORTED_POINTCLOUD,
)

router = APIRouter()

ALLOWED_EXTENSIONS = SUPPORTED_MESH | SUPPORTED_POINTCLOUD


class ApplyTextureRequest(BaseModel):
    mesh_id: str
    face_indices: list[int]
    texture_path: str
    uv_repeat_x: float = 1.0
    uv_repeat_y: float = 1.0


class CropPatchRequest(BaseModel):
    render_path: str
    x: float
    y: float
    w: float
    h: float


@router.post("/upload")
async def upload_scan(file: Annotated[UploadFile, File()]):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported: {sorted(ALLOWED_EXTENSIONS)}",
        )

    upload_id = uuid.uuid4().hex
    upload_path = Path("uploads") / f"{upload_id}{ext}"

    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        result = load_scan(str(upload_path))
    except Exception as e:
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Failed to process scan: {e}")

    return result


@router.post("/apply-texture")
async def apply_texture(req: ApplyTextureRequest):
    local_texture = req.texture_path.lstrip("/")
    if not Path(local_texture).exists():
        raise HTTPException(status_code=404, detail="Texture file not found")

    try:
        result = apply_texture_to_faces(
            mesh_id=req.mesh_id,
            face_indices=req.face_indices,
            texture_path=local_texture,
            uv_repeat=(req.uv_repeat_x, req.uv_repeat_y),
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return result


@router.post("/crop-patch")
async def crop_patch(req: CropPatchRequest):
    local_render = req.render_path.lstrip("/")
    if not Path(local_render).exists():
        raise HTTPException(status_code=404, detail="Render image not found")

    try:
        patch_path = crop_patch_from_render(
            render_path=local_render,
            x=req.x,
            y=req.y,
            w=req.w,
            h=req.h,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {"patch_path": patch_path, "patch_url": f"/{patch_path}"}


class DetectPlanesRequest(BaseModel):
    mesh_id: str

class ExportRoomDxfRequest(BaseModel):
    points: list[tuple[float, float, float]]
    wall_height: float = 2.8

@router.post("/export-room-dxf")
async def export_room_dxf_endpoint(req: ExportRoomDxfRequest):
    """Export room polygon as DXF (2D floor plan + 3D wall faces)."""
    if len(req.points) < 3:
        raise HTTPException(status_code=422, detail="Need at least 3 room points")
    from services.export_service import export_room_dxf
    try:
        dxf_bytes = export_room_dxf(req.points, req.wall_height)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="room-plan.dxf"'},
    )


@router.post("/detect-planes")
async def detect_planes_endpoint(req: DetectPlanesRequest):
    """
    Run RANSAC plane segmentation on the scan mesh.
    Returns detected planes (floor, walls, ceiling) with center/rotation/scale ready for the frontend.
    Runs in a thread pool since open3d RANSAC is CPU-bound.
    """
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        planes = await loop.run_in_executor(None, detect_planes_fn, req.mesh_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")
    return {"planes": planes, "count": len(planes)}
