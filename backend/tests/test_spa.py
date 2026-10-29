"""SPA fallback in app/main.py, exercised against a temporary web/dist (the app code is unchanged).

main.py resolves web/dist from its own __file__ at import time, so its source is executed with a
fake __file__ inside a temp tree: <tmp>/backend/app/main.py -> <tmp>/web/dist.
"""
import asyncio
import os
import tempfile
from pathlib import Path

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/spa.db")

import httpx
import app.main as real_main


def spa_app(tmp_path: Path):
    dist = tmp_path / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>shell</title>")
    (dist / "assets" / "app.js").write_text("console.log('asset')")
    (tmp_path / "web" / "secret.txt").write_text("outside dist")
    fake = tmp_path / "backend" / "app" / "main.py"
    namespace = {"__name__": "app._spa_test_main", "__package__": "app", "__file__": str(fake)}
    exec(compile(Path(real_main.__file__).read_text(), str(fake), "exec"), namespace)
    return namespace["app"]


def test_spa_fallback_serves_shell_static_files_and_keeps_api(tmp_path):
    app = spa_app(tmp_path)

    async def flow():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for path in ("/", "/invite/x", "/auth/consume/x"):
                page = await client.get(path)
                assert page.status_code == 200 and "shell" in page.text, path
            asset = await client.get("/assets/app.js")
            assert asset.status_code == 200 and "asset" in asset.text
            me = await client.get("/auth/me")
            assert me.status_code == 401 and me.headers["content-type"].startswith("application/json")
            for escape in ("/..%2Fsecret.txt", "/assets/..%2F..%2Fsecret.txt", "/%2e%2e/secret.txt"):
                response = await client.get(escape)
                assert "outside dist" not in response.text and "shell" in response.text, escape

    asyncio.run(flow())
