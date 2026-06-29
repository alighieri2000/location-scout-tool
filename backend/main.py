import os
import mimetypes
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

# Register GLB/GLTF MIME types — Python's mimetypes module doesn't include these
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")

from routers import mesh, texture

load_dotenv()

app = FastAPI(title="Location Scout Tool", version="0.1.0")

# Allow both dev (Vite) and any deployed origin
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)
os.makedirs("textures", exist_ok=True)

app.include_router(mesh.router, prefix="/api/mesh", tags=["mesh"])
app.include_router(texture.router, prefix="/api/texture", tags=["texture"])

app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/textures", StaticFiles(directory="textures"), name="textures")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve built frontend if it exists (production / ngrok mode)
_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(str(_DIST / "index.html"))
