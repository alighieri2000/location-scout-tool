"""
AI texture generation.
Primary path (Material Diffusion via Replicate): guaranteed seamless/tileable output.
Secondary path (FLUX Fill via fal.ai): faster, requires FAL_KEY.
"""
import io
import os
import uuid
import base64
import httpx
from pathlib import Path
from typing import Literal

TEXTURE_DIR = Path("textures")


async def generate_from_patch(
    patch_path: str,
    prompt: str,
    method: Literal["flux", "material_diffusion"] = "material_diffusion",
    output_size: int = 1024,
) -> dict:
    if method == "flux":
        return await _flux_fill(patch_path, prompt, output_size)
    return await _material_diffusion(patch_path, prompt)


async def _material_diffusion(patch_path: str, prompt: str) -> dict:
    """
    Replicate tstramer/material-diffusion — circular convolution guarantees
    perfectly wrapping edges. Accepts file-like objects for image inputs.
    replicate-python 1.x: use async_run(), pass io.BytesIO (not raw bytes).
    """
    import replicate

    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN not set in backend/.env")

    patch_bytes = Path(patch_path).read_bytes()
    init_image = io.BytesIO(patch_bytes)
    init_image.name = "patch.png"   # lets the client infer MIME type

    seamless_prompt = (
        f"{prompt}, seamless, tileable, PBR material, "
        "evenly lit, no shadows, photorealistic surface"
    )

    # async_run() — non-blocking, returns output directly (not an async iterator)
    output = await replicate.async_run(
        "tstramer/material-diffusion:a42692c54c0f407f803a0a8a9066160976baedb77c91171a01730f9b0d7beeff",
        input={
            "prompt": seamless_prompt,
            "init_image": init_image,
            "prompt_strength": 0.6,
            "num_inference_steps": 50,
            "guidance_scale": 7.5,
        },
    )

    # replicate 1.x returns FileOutput objects; str() gives the CDN URL
    image_url = str(output[0]) if isinstance(output, (list, tuple)) else str(output)
    return await _download_texture(image_url, "material_diffusion")


async def _flux_fill(patch_path: str, prompt: str, size: int) -> dict:
    """FLUX Pro Fill via fal.ai — fast inpainting. Requires FAL_KEY."""
    import fal_client

    fal_key = os.environ.get("FAL_KEY")
    if not fal_key:
        raise RuntimeError("FAL_KEY not set — use Material Diffusion method instead")

    patch_b64 = base64.b64encode(Path(patch_path).read_bytes()).decode()

    from PIL import Image as PILImage
    mask_buf = io.BytesIO()
    PILImage.new("L", (size, size), 255).save(mask_buf, format="PNG")
    mask_b64 = base64.b64encode(mask_buf.getvalue()).decode()

    seamless_prompt = (
        f"{prompt}, seamless tileable texture, no edges, no borders, "
        "evenly lit, flat surface photography, ultra high resolution material"
    )

    result = await fal_client.run_async(
        "fal-ai/flux-pro/v1/fill",
        arguments={
            "prompt": seamless_prompt,
            "image_url": f"data:image/png;base64,{patch_b64}",
            "mask_url": f"data:image/png;base64,{mask_b64}",
            "num_images": 1,
            "output_format": "png",
            "seed": 42,
        },
    )

    image_url = result["images"][0]["url"]
    return await _download_texture(image_url, "flux")


async def generate_from_text(prompt: str, output_size: int = 1024) -> dict:
    """
    Text-only texture generation. Uses FLUX if FAL_KEY is set, otherwise
    falls back to Material Diffusion (no init_image = pure text-to-texture).
    """
    fal_key = os.environ.get("FAL_KEY")
    if fal_key:
        return await _flux_text(prompt, output_size)
    return await _material_diffusion_text(prompt)


async def _flux_text(prompt: str, size: int) -> dict:
    import fal_client

    seamless_prompt = (
        f"{prompt}, seamless tileable texture, no edges, no shadows, "
        "evenly lit, flat surface, ultra high resolution PBR material"
    )
    result = await fal_client.run_async(
        "fal-ai/flux-pro/v1.1",
        arguments={
            "prompt": seamless_prompt,
            "image_size": {"width": size, "height": size},
            "num_images": 1,
            "output_format": "png",
            "seed": 42,
        },
    )
    image_url = result["images"][0]["url"]
    return await _download_texture(image_url, "flux_text")


async def _material_diffusion_text(prompt: str) -> dict:
    """Material Diffusion without an init image — pure text-to-seamless-texture."""
    import replicate

    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        raise RuntimeError("No API keys configured. Set FAL_KEY or REPLICATE_API_TOKEN in backend/.env")

    seamless_prompt = (
        f"{prompt}, seamless, tileable, PBR material, "
        "evenly lit, no shadows, photorealistic surface texture"
    )

    output = await replicate.async_run(
        "tstramer/material-diffusion:a42692c54c0f407f803a0a8a9066160976baedb77c91171a01730f9b0d7beeff",
        input={
            "prompt": seamless_prompt,
            "num_inference_steps": 50,
            "guidance_scale": 7.5,
        },
    )

    image_url = str(output[0]) if isinstance(output, (list, tuple)) else str(output)
    return await _download_texture(image_url, "material_diffusion_text")


async def _download_texture(url: str, source: str) -> dict:
    tex_id = uuid.uuid4().hex
    tex_path = TEXTURE_DIR / f"{source}_{tex_id}.png"

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=60)
        resp.raise_for_status()
        tex_path.write_bytes(resp.content)

    return {
        "texture_id": tex_id,
        "texture_url": f"/textures/{tex_path.name}",
        "local_path": str(tex_path),
        "source": source,
    }
