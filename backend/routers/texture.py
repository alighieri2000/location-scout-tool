import uuid
import shutil
from pathlib import Path
from typing import Literal, Annotated

from fastapi import APIRouter, HTTPException, File, UploadFile
from pydantic import BaseModel

from services.texture_generator import generate_from_patch, generate_from_text

router = APIRouter()

TEXTURE_DIR = Path("textures")


class GenerateFromPatchRequest(BaseModel):
    patch_path: str
    prompt: str
    method: Literal["flux", "material_diffusion"] = "flux"
    output_size: int = 1024


class GenerateFromTextRequest(BaseModel):
    prompt: str
    output_size: int = 1024


@router.post("/upload-patch")
async def upload_patch(file: Annotated[UploadFile, File()]):
    """
    Accept a patch image (PNG) cropped client-side from the WebGL canvas,
    save it to the textures directory, and return its path for use in
    the from-patch generation endpoint.
    """
    patch_id = uuid.uuid4().hex
    patch_path = TEXTURE_DIR / f"patch_{patch_id}.png"

    with open(patch_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {
        "patch_id": patch_id,
        "patch_path": str(patch_path),
        "patch_url": f"/textures/patch_{patch_id}.png",
    }


@router.post("/from-patch")
async def texture_from_patch(req: GenerateFromPatchRequest):
    local_patch = req.patch_path.lstrip("/")
    if not Path(local_patch).exists():
        raise HTTPException(status_code=404, detail=f"Patch file not found: {local_patch}")

    try:
        result = await generate_from_patch(
            patch_path=local_patch,
            prompt=req.prompt,
            method=req.method,
            output_size=req.output_size,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return result


@router.post("/from-text")
async def texture_from_text(req: GenerateFromTextRequest):
    try:
        result = await generate_from_text(prompt=req.prompt, output_size=req.output_size)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return result
