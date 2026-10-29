from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from .routers import admin, auth, invitations, races

app = FastAPI(title="Alleycat Safety API")
for module in (auth, admin, races, invitations):
    app.include_router(module.router)

WEB_DIST = (Path(__file__).resolve().parents[2] / "web" / "dist").resolve()

if (WEB_DIST / "index.html").is_file():
    # Registered last, so API routes win; any other GET gets a static file or the SPA shell.
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (WEB_DIST / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(WEB_DIST):
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
