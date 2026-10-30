import {useEffect, useState} from "react";
import {MapContainer, Marker, TileLayer, Tooltip} from "react-leaflet";
import L from "./leaflet";
import {ApiError, errorText, request, type Checkpoint, type HelpRequest} from "../../api/client";
import {formatTime} from "./mapUtils";
import {HELP_LABEL} from "./RaceDay";

const POLL_MS = 10_000;
const riderIcon = L.divIcon({className: "map-dot rider", iconSize: [16, 16]});
const helpIcon = L.divIcon({className: "map-dot help", iconSize: [28, 28]});
type Position = {rider_id: number; name: string; latitude: number; longitude: number; recorded_at: string};

/** Live map for organizers: checkpoints, each rider's last reported position and open help requests in red. */
export function LiveMap({raceId}: {raceId: string | null}) {
  const [pins, setPins] = useState<Checkpoint[]>();
  const [riders, setRiders] = useState<Position[]>([]);
  const [help, setHelp] = useState<HelpRequest[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!raceId) return;
    const path = `/races/${encodeURIComponent(raceId)}`;
    const load = () => Promise.all([
      request<Checkpoint[]>(`${path}/checkpoints`), request<Position[]>(`${path}/positions`), request<HelpRequest[]>(`${path}/help`),
    ]).then(([c, p, h]) => {
      setPins(c); setRiders(p); setHelp(h.filter(x => !x.resolved_at && x.latitude !== null && x.longitude !== null)); setError("");
    }, e => setError(e instanceof ApiError && e.status === 401 ? "login" : errorText(e)));
    load();
    const poll = setInterval(load, POLL_MS);
    return () => clearInterval(poll);
  }, [raceId]);
  if (error === "login") return <section className="card stack"><h1>Inicia sesión</h1><p>El mapa es solo para organizadores.</p><a className="btn-primary" href="/">Iniciar sesión</a></section>;
  if (!pins) return error ? <p className="error" role="alert">{error}</p> : <p role="status">Cargando mapa…</p>;
  const points = [...pins, ...riders].map(p => [p.latitude, p.longitude] as [number, number]);
  return (
    <div className="stack">
      <div className="row spread">
        <p className="muted">{riders.length} corredores con ubicación · {help.length} auxilios abiertos · se actualiza cada 10 s</p>
        <a className="btn-secondary" href={`/tablero/${encodeURIComponent(raceId!)}`}>Tablero</a>
      </div>
      {error && <p className="error" role="alert">Sin conexión: mostrando los últimos datos. {error}</p>}
      {points.length ? (
        <MapContainer bounds={L.latLngBounds(points)} boundsOptions={{padding: [24, 24], maxZoom: 16}} className="live-map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {pins.map(pin => <Marker key={pin.id} position={[pin.latitude, pin.longitude]}><Tooltip>{pin.finish ? `Meta: ${pin.name}` : pin.name}</Tooltip></Marker>)}
          {riders.map(r => (
            <Marker key={r.rider_id} position={[r.latitude, r.longitude]} icon={riderIcon}>
              <Tooltip>{r.name} · {formatTime(r.recorded_at)}</Tooltip>
            </Marker>
          ))}
          {help.map(h => (
            <Marker key={h.id} position={[h.latitude!, h.longitude!]} icon={helpIcon}>
              <Tooltip permanent>AUXILIO · {HELP_LABEL[h.kind]} · {h.rider}</Tooltip>
            </Marker>
          ))}
        </MapContainer>
      ) : <p className="muted">La carrera aún no tiene checkpoints.</p>}
    </div>
  );
}
