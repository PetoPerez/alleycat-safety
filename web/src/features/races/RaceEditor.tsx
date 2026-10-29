import {useEffect, useState, type FormEvent} from "react";
import {MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents} from "react-leaflet";
import L from "./leaflet";
import {errorText, fieldErrors, request, type Checkpoint, type Race, type RaceInput} from "../../api/client";
import {useBusy} from "../../useBusy";
import {formatRelease, formatWhen, fromLocalInput, msUntil, pinsForDisplay, toLocalInput} from "./mapUtils";

const chosenIcon = L.divIcon({className: "chosen-spot", iconSize: [18, 18]}); // where the next pin goes

const FieldError = ({id, text}: {id: string; text?: string}) => (text ? <p className="field-error" id={id}>{text}</p> : null);

/** Create/edit form for a draft race. Errors from the API land under the field named by `loc`. */
export function RaceForm({initial, submitLabel, onSubmit}: {initial?: Race; submitLabel: string; onSubmit: (body: RaceInput) => Promise<void>}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "");
    // Number("") is 0: a blank coordinate would silently become a valid point.
    const missing: Record<string, string> = {};
    for (const key of ["latitude", "longitude", "checkpoints_release_minutes"]) if (!get(key).trim()) missing[key] = "Indica un número";
    for (const key of ["starts_at", "ends_at"]) if (!get(key)) missing[key] = "Indica fecha y hora";
    const minutes = get("checkpoints_release_minutes");
    if (!missing.checkpoints_release_minutes && !Number.isInteger(Number(minutes))) missing.checkpoints_release_minutes = "Indica un número entero de minutos";
    if (Object.keys(missing).length) {
      setErrors(missing); setMessage("");
      return;
    }
    setBusy(true); setErrors({}); setMessage("");
    try {
      await onSubmit({
        name: get("name"), start_label: get("start_label"),
        latitude: Number(get("latitude")), longitude: Number(get("longitude")),
        starts_at: fromLocalInput(get("starts_at")), ends_at: fromLocalInput(get("ends_at")),
        checkpoints_release_minutes: Number(get("checkpoints_release_minutes")),
      });
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (!Object.keys(fields).length) setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const field = (name: keyof RaceInput, label: string, props: JSX.IntrinsicElements["input"]) => (
    <label>
      {label}
      <input name={name} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} {...props} />
      <FieldError id={`${name}-error`} text={errors[name]} />
    </label>
  );
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {field("name", "Nombre", {defaultValue: initial?.name})}
      {field("start_label", "Zona de salida", {defaultValue: initial?.start_label})}
      <div className="row">
        {field("latitude", "Latitud de salida", {type: "number", step: "any", defaultValue: initial?.latitude ?? 19.4326})}
        {field("longitude", "Longitud de salida", {type: "number", step: "any", defaultValue: initial?.longitude ?? -99.1332})}
      </div>
      <div className="row">
        {field("starts_at", "Inicio (hora local)", {type: "datetime-local", defaultValue: initial && toLocalInput(initial.starts_at)})}
        {field("ends_at", "Fin (hora local)", {type: "datetime-local", defaultValue: initial && toLocalInput(initial.ends_at)})}
      </div>
      {field("checkpoints_release_minutes", "Liberar checkpoints (minutos antes del inicio)",
        {type: "number", min: 0, max: 1440, step: 1, inputMode: "numeric", defaultValue: initial?.checkpoints_release_minutes ?? 10})}
      {message && <p className="error" role="alert">{message}</p>}
      <button className="btn-primary" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

function PinChooser({onSelect}: {onSelect: (lat: number, lng: number) => void}) {
  useMapEvents({click: event => onSelect(event.latlng.lat, event.latlng.lng)});
  return null;
}

/** MapContainer's center only applies on mount; follow edits to the race's start point. */
function Recenter({lat, lng}: {lat: number; lng: number}) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng]); }, [map, lat, lng]);
  return null;
}

const coordinate = (text: string, limit: number) => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

/** Mount with key={race.id}: every piece of state here belongs to exactly one race. */
export function RaceEditor({race, onChanged}: {race: Race; onChanged: (race: Race) => void}) {
  const draft = race.status === "draft";
  const [pins, setPins] = useState<Checkpoint[]>([]);
  // No default point: a pin is only placed where the organizer chose (map click or typed coordinates).
  const [spot, setSpot] = useState({lat: "", lng: ""});
  const lat = coordinate(spot.lat, 90);
  const lng = coordinate(spot.lng, 180);
  const selected: [number, number] | null = lat !== null && lng !== null ? [lat, lng] : null;
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, guard] = useBusy();
  const pinsPath = `/races/${race.id}/checkpoints`;
  const run = (action: () => Promise<void>) => guard(async () => {
    setMessage("");
    try { await action(); } catch (error) { setMessage(errorText(error)); }
  });
  const reloadPins = async () => setPins(await request<Checkpoint[]>(pinsPath));
  useEffect(() => { reloadPins().catch(error => setMessage(errorText(error))); }, [race.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPin = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return setMessage("Elige el punto en el mapa o escribe latitud y longitud");
    if (!label.trim()) return setMessage("Escribe una etiqueta para el checkpoint");
    run(async () => {
      await request(pinsPath, {method: "POST", json: {name: label, latitude: selected[0], longitude: selected[1]}});
      setLabel(""); setSpot({lat: "", lng: ""});
      await reloadPins();
    });
  };
  const removePin = (pin: Checkpoint) => run(async () => {
    await request(`${pinsPath}/${pin.id}`, {method: "DELETE"});
    await reloadPins();
  });
  const publish = () => {
    if (!window.confirm(`¿Publicar «${race.name}»? Ya no podrás editarla ni mover sus checkpoints.`)) return;
    run(async () => onChanged(await request<Race>(`/races/${race.id}/publish`, {method: "POST"})));
  };
  // Re-render when the scheduled release passes; capped because setTimeout overflows past ~24.8 days.
  const [tick, setTick] = useState(0);
  const wait = race.checkpoints_released ? 0 : msUntil(race.checkpoints_release_at);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick(n => n + 1), Math.min(wait, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [race.checkpoints_release_at, race.checkpoints_released, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const released = race.checkpoints_released || wait <= 0;
  const releaseNow = () => {
    if (!window.confirm(`¿Liberar ya los checkpoints de «${race.name}»? Los invitados los verán de inmediato y no se pueden volver a ocultar.`)) return;
    run(async () => onChanged(await request<Race>(`/races/${race.id}/release-checkpoints`, {method: "POST"})));
  };

  return (
    <section className="card stack" aria-labelledby="race-title">
      <h2 id="race-title">{race.name} <span className={`badge ${race.status}`}>{draft ? "Borrador" : "Publicada"}</span></h2>
      {draft ? (
        <details>
          <summary>Editar datos de la carrera</summary>
          <RaceForm initial={race} submitLabel="Guardar cambios" onSubmit={async body =>
            onChanged(await request<Race>(`/races/${race.id}`, {method: "PUT", json: body}))} />
        </details>
      ) : (
        <p className="muted">{race.start_label} · {formatWhen(race.starts_at)} – {formatWhen(race.ends_at)}</p>
      )}
      {draft ? (
        <p className="muted">Los invitados verán los checkpoints {race.checkpoints_release_minutes} min antes del inicio.</p>
      ) : released ? (
        <p className="notice" role="status">Checkpoints liberados: los invitados ya los ven.</p>
      ) : (
        <div className="row spread">
          <p role="status">Checkpoints ocultos. Se liberan a las {formatRelease(race.checkpoints_release_at)}.</p>
          <button className="btn-secondary" disabled={busy} onClick={releaseNow}>Liberar ahora</button>
        </div>
      )}

      <h3>Checkpoints</h3>
      <p className="notice">Los checkpoints no tienen orden: cada corredor elige su ruta. La lista va por orden alfabético sólo para encontrarlos.</p>
      <MapContainer center={[race.latitude, race.longitude]} zoom={14} className="checkpoint-map">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Recenter lat={race.latitude} lng={race.longitude} />
        {draft && <PinChooser onSelect={(la, ln) => setSpot({lat: la.toFixed(6), lng: ln.toFixed(6)})} />}
        {draft && selected && <Marker position={selected} icon={chosenIcon} interactive={false} />}
        {pins.map(pin => (
          <Marker key={pin.id} position={[pin.latitude, pin.longitude]}><Tooltip>{pin.name}</Tooltip></Marker>
        ))}
      </MapContainer>
      {draft && (
        <form className="stack" onSubmit={addPin}>
          <p className="muted">Toca el mapa para elegir el punto, o escribe sus coordenadas.</p>
          <div className="row">
            <label>Latitud del checkpoint
              <input type="number" step="any" inputMode="decimal" value={spot.lat} onChange={e => setSpot({...spot, lat: e.target.value})} />
            </label>
            <label>Longitud del checkpoint
              <input type="number" step="any" inputMode="decimal" value={spot.lng} onChange={e => setSpot({...spot, lng: e.target.value})} />
            </label>
          </div>
          <div className="row">
            <label className="grow">Etiqueta del checkpoint
              <input value={label} onChange={e => setLabel(e.target.value)} />
            </label>
            <button className="btn-secondary" disabled={busy || !selected}>Añadir checkpoint</button>
          </div>
        </form>
      )}
      <ul className="list">
        {pinsForDisplay(pins).map(pin => (
          <li key={pin.id}>
            <span>{pin.name} <span className="muted">({pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)})</span></span>
            {draft && <button className="btn-danger" disabled={busy} onClick={() => removePin(pin)} aria-label={`Borrar ${pin.name}`}>Borrar</button>}
          </li>
        ))}
        {!pins.length && <li className="muted">Aún no hay checkpoints.</li>}
      </ul>
      {message && <p className="error" role="alert">{message}</p>}
      {draft && (
        <div className="stack">
          <button className="btn-primary" disabled={busy || !pins.length} onClick={publish} aria-describedby="publish-help">Publicar carrera</button>
          {!pins.length && <p id="publish-help" className="muted">Añade al menos un checkpoint para poder publicar.</p>}
        </div>
      )}
    </section>
  );
}
