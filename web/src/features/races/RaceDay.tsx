import {useEffect, useState} from "react";
import QRCode from "qrcode";
import {errorText, request, type Checkpoint, type CheckInRecord, type HelpKind, type HelpRequest, type Race} from "../../api/client";
import {formatTime, formatWhen, pinsForDisplay} from "./mapUtils";
import {useBusy} from "../../useBusy";

const POLL_MS = 10_000;
export const HELP_LABEL: Record<HelpKind, string> = {medical: "Emergencia médica", accident: "Accidente", mechanical: "Problema mecánico", other: "Otra ayuda"};

/** QR for the person staffing the checkpoint: scanning it opens /checkin/<code> on the rider's phone. */
function CheckpointQr({pin}: {pin: Checkpoint}) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(`${location.origin}/checkin/${pin.code}`, {width: 240}).then(setSrc, () => setSrc("")); }, [pin.code]);
  return (
    <figure className="qr">
      {src && <img src={src} alt={`QR del checkpoint ${pin.name}`} width={160} height={160} />}
      <figcaption>{pin.name}</figcaption>
    </figure>
  );
}

/** Organizer's race-day view: help requests first, then who reached which checkpoint, then the checkpoint QRs. */
export function RaceDay({race}: {race: Race}) {
  const [help, setHelp] = useState<HelpRequest[]>([]);
  const [visits, setVisits] = useState<CheckInRecord[]>([]);
  const [pins, setPins] = useState<Checkpoint[]>([]);
  const [error, setError] = useState("");
  const [busy, guard] = useBusy();
  const load = () => Promise.all([
    request<HelpRequest[]>(`/races/${race.id}/help`), request<CheckInRecord[]>(`/races/${race.id}/checkins`),
  ]).then(([h, v]) => { setHelp(h); setVisits(v); setError(""); }, e => setError(errorText(e)));
  useEffect(() => {
    request<Checkpoint[]>(`/races/${race.id}/checkpoints`).then(setPins, e => setError(errorText(e)));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [race.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = help.filter(h => !h.resolved_at);
  const resolve = (id: number) => guard(async () => {
    try { await request(`/help/${id}/resolve`, {method: "POST"}); await load(); } catch (e) { setError(errorText(e)); }
  });
  return (
    <section className="card stack" aria-labelledby="raceday-title">
      <h2 id="raceday-title">Día de carrera</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <h3>Solicitudes de auxilio</h3>
      <ul className="list">
        {open.map(h => (
          <li key={h.id} className="alert" role="alert">
            <span>
              <strong>{HELP_LABEL[h.kind]}</strong> · {h.rider}{h.phone && <> · <a href={`tel:${h.phone}`}>{h.phone}</a></>}
              <span className="muted"> · {formatWhen(h.created_at)} · </span>
              {h.latitude !== null && h.longitude !== null
                ? <a href={`https://www.openstreetmap.org/?mlat=${h.latitude}&mlon=${h.longitude}#map=17/${h.latitude}/${h.longitude}`} target="_blank" rel="noreferrer">Ver ubicación</a>
                : <span className="muted">sin ubicación</span>}
            </span>
            <button className="btn-secondary" disabled={busy} onClick={() => resolve(h.id)}>Atendida</button>
          </li>
        ))}
        {!open.length && <li className="muted">Sin solicitudes pendientes.</li>}
      </ul>
      <h3>Llegadas a checkpoints</h3>
      <ul className="list">
        {pinsForDisplay(pins).map(pin => {
          const here = visits.filter(v => v.checkpoint_id === pin.id);
          return <li key={pin.id}><span><strong>{pin.name}</strong> ({here.length}){here.length > 0 && ": "}
            {here.map(v => `${v.rider} ${formatTime(v.checked_in_at)}`).join(", ")}</span></li>;
        })}
      </ul>
      <h3>QR de checkpoints</h3>
      <p className="muted">Imprime o envía cada QR a la persona del checkpoint. El corredor lo escanea con la cámara de su teléfono.</p>
      <div className="qr-grid">{pinsForDisplay(pins).map(pin => <CheckpointQr key={pin.id} pin={pin} />)}</div>
    </section>
  );
}
