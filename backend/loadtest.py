"""Race-day load test: 160 riders against a LOCAL server (it creates a race, riders and invitations; never aim it at production).

    docker run -d --rm --name alleycat-loadtest-db -e POSTGRES_PASSWORD=load -e POSTGRES_DB=alleycat -p 5440:5432 postgres:16-alpine
    export DATABASE_URL=postgresql://postgres:load@localhost:5440/alleycat APP_ENV=development SUPERADMIN_EMAIL=boss@load.test PUBLIC_APP_URL=http://localhost:8765
    uv run alembic upgrade head && uv run uvicorn app.main:app --port 8765 &
    uv run python loadtest.py http://localhost:8765
    docker stop alleycat-loadtest-db
"""
import asyncio, random, statistics, sys, time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
import httpx

BASE = sys.argv[1]
RIDERS = 160
CHECKPOINTS = 6
stats = defaultdict(list)   # kind -> latencies (s)
errors = defaultdict(list)  # kind -> status codes / exceptions


async def call(client, kind, method, path, **kw):
    t = time.perf_counter()
    try:
        r = await client.request(method, path, **kw)
        stats[kind].append(time.perf_counter() - t)
        if r.status_code >= 400:
            errors[kind].append(r.status_code)
        return r
    except Exception as e:  # timeouts, refused connections
        stats[kind].append(time.perf_counter() - t)
        errors[kind].append(type(e).__name__)


def report(title):
    print(f"\n== {title}")
    print(f"{'tipo':<18}{'peticiones':>11}{'errores':>9}{'p50 ms':>9}{'p95 ms':>9}{'max ms':>9}")
    for kind, lat in sorted(stats.items()):
        lat = sorted(lat)
        p95 = lat[int(len(lat) * 0.95) - 1] if len(lat) > 1 else lat[0]
        print(f"{kind:<18}{len(lat):>11}{len(errors[kind]):>9}{statistics.median(lat)*1000:>9.0f}{p95*1000:>9.0f}{lat[-1]*1000:>9.0f}")
        if errors[kind]:
            print(f"   errores: {sorted(set(map(str, errors[kind])))}")
    stats.clear(); errors.clear()


async def setup(org):
    link = (await org.post("/auth/magic-links", json={"email": "boss@load.test"})).json()["link"]
    (await org.post("/auth/consume/" + link.rsplit("/", 1)[1])).raise_for_status()
    now = datetime.now(UTC)
    race = (await org.post("/races", json={"name": "Carga 160", "start_label": "Zócalo", "latitude": 19.4326, "longitude": -99.1332,
            "starts_at": (now - timedelta(minutes=1)).isoformat(), "ends_at": (now + timedelta(hours=3)).isoformat(),
            "checkpoints_release_minutes": 0})).json()
    for i in range(CHECKPOINTS):
        (await org.post(f"/races/{race['id']}/checkpoints", json={"name": f"CP{i}", "latitude": 19.40 + i / 100, "longitude": -99.13})).raise_for_status()
    (await org.post(f"/races/{race['id']}/publish")).raise_for_status()
    pins = (await org.get(f"/races/{race['id']}/checkpoints")).json()
    tokens = []
    for i in range(RIDERS):  # the organizer loads the roster one by one, as in the UI
        rider = (await call(org, "alta corredor", "POST", f"/races/{race['id']}/riders", json={"name": f"Corredor {i:03}", "phone": f"+52550000{i:04}"})).json()
        inv = (await call(org, "invitación", "POST", f"/races/{race['id']}/invitations", json={"rider_id": rider["id"], "channel": "whatsapp"})).json()
        tokens.append(inv["link"].rsplit("/", 1)[1])
    return race, pins, tokens


async def organizer_screens(org, race_id, stop):
    """3 board screens + 2 race-day panels, polling every second (10x the real 10 s)."""
    async def poll(kind, paths):
        while not stop.is_set():
            await asyncio.gather(*(call(org, kind, "GET", p) for p in paths))
            await asyncio.sleep(1)
    await asyncio.gather(*[poll("tablero", [f"/races/{race_id}/board"]) for _ in range(3)],
                         *[poll("panel día", [f"/races/{race_id}/help", f"/races/{race_id}/checkins"]) for _ in range(2)])


async def rider(client, token, pins, spread):
    route = random.sample(pins, len(pins))  # unordered race: each rider picks a route
    for pin in route:
        await asyncio.sleep(random.uniform(0, spread))
        await call(client, "check-in QR", "POST", f"/invite/{token}/checkins", json={"code": pin["code"], "latitude": pin["latitude"], "longitude": pin["longitude"]})


async def main():
    limits = httpx.Limits(max_connections=1000, max_keepalive_connections=1000)
    async with httpx.AsyncClient(base_url=BASE, timeout=30, limits=limits) as org, \
               httpx.AsyncClient(base_url=BASE, timeout=30, limits=limits) as riders:
        t = time.perf_counter()
        race, pins, tokens = await setup(org)
        report(f"Preparación: 160 altas + 160 invitaciones en serie ({time.perf_counter() - t:.1f} s)")

        t = time.perf_counter()
        await asyncio.gather(*(call(riders, "abrir invitación", "POST", f"/invite/{tk}") for tk in tokens))
        await asyncio.gather(*(call(riders, "confirmar", "POST", f"/invite/{tk}/confirm") for tk in tokens))
        report(f"Los 160 abren y confirman a la vez ({time.perf_counter() - t:.1f} s)")

        stop = asyncio.Event()
        screens = asyncio.create_task(organizer_screens(org, race["id"], stop))
        t = time.perf_counter()
        await asyncio.gather(*(rider(riders, tk, pins, 5) for tk in tokens),
                             *(call(riders, "auxilio", "POST", f"/invite/{tk}/help", json={"kind": "mechanical", "latitude": 19.4, "longitude": -99.1})
                               for tk in random.sample(tokens, 20)))
        stop.set(); await screens
        report(f"Carrera comprimida: 960 check-ins + 20 auxilios + pantallas cada 1 s ({time.perf_counter() - t:.1f} s)")

        # Worst case: all 160 riders scan the same QR in the same instant (already checked in: idempotent path).
        t = time.perf_counter()
        await asyncio.gather(*(call(riders, "check-in QR", "POST", f"/invite/{tk}/checkins", json={"code": pins[0]["code"], "latitude": pins[0]["latitude"], "longitude": pins[0]["longitude"]}) for tk in tokens))
        report(f"Ráfaga: 160 escaneos del mismo QR al mismo instante ({time.perf_counter() - t:.1f} s)")

        t = time.perf_counter()
        await asyncio.gather(*(call(riders, "abrir invitación", "POST", f"/invite/{tk}") for tk in tokens * 5))
        report(f"Estrés x5: 800 peticiones simultáneas ({time.perf_counter() - t:.1f} s)")

        board = (await org.get(f"/races/{race['id']}/board")).json()
        print(f"\nTablero final: {len(board['riders'])} corredores, {len(board['checkins'])} check-ins, {len(board['help'])} auxilios abiertos")

asyncio.run(main())
