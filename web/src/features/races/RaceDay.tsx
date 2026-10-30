import {useEffect, useState} from "react";
import QRCode from "qrcode";
import {errorText, request, type Checkpoint, type CheckInRecord, type HelpKind, type HelpRequest, type Race, type Rider} from "../../api/client";
import {formatTime, formatWhen, pinsForDisplay} from "./mapUtils";
import {useBusy} from "../../useBusy";

const POLL_MS = 10_000;
export const HELP_LABEL: Record<HelpKind, string> = {medical: "Emergencia médica", accident: "Accidente", mechanical: "Problema mecánico", other: "Otra ayuda"};

const QR_PX = 640;
const fileName = (name: string) => `checkpoint-${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.png`;

/** PNG for WhatsApp: race and checkpoint names above the QR, so the volunteer knows which one they hold. */
async function qrPng(raceName: string, pin: Checkpoint): Promise<Blob> {
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, `${location.origin}/checkin/${pin.code}`, {width: QR_PX, margin: 2});
  const canvas = document.createElement("canvas");
  canvas.width = QR_PX; canvas.height = QR_PX + 140;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000"; ctx.textAlign = "center";
  ctx.font = "32px sans-serif"; ctx.fillText(raceName, QR_PX / 2, 50, QR_PX - 40);
  ctx.font = "bold 48px sans-serif"; ctx.fillText(pin.name, QR_PX / 2, 115, QR_PX - 40);
  ctx.drawImage(qr, 0, 140);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}

/** QR for the person staffing the checkpoint: scanning it opens /checkin/<code> on the rider's phone. */
function CheckpointQr({pin, raceName}: {pin: Checkpoint; raceName: string}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { QRCode.toDataURL(`${location.origin}/checkin/${pin.code}`, {width: 240}).then(setSrc, () => setSrc("")); }, [pin.code]);
  // Phones get the share sheet (pick WhatsApp); desktops download the PNG to attach in WhatsApp Web.
  const send = async () => {
    setError("");
    try {
      const file = new File([await qrPng(raceName, pin)], fileName(pin.name), {type: "image/png"});
      if (navigator.canShare?.({files: [file]})) return await navigator.share({files: [file], title: `Checkpoint ${pin.name}`});
      const url = URL.createObjectURL(file);
      Object.assign(document.createElement("a"), {href: url, download: file.name}).click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("No se pudo generar la imagen.");
    }
  };
  return (
    <figure className="qr">
      {src && <img src={src} alt={`QR del checkpoint ${pin.name}`} width={160} height={160} />}
      <figcaption>{pin.name}</figcaption>
      <button type="button" className="btn-secondary" onClick={send}>Enviar imagen</button>
      {error && <p className="error" role="alert">{error}</p>}
    </figure>
  );
}

/** Organizer's race-day view: help requests first, then who reached which checkpoint, then the checkpoint QRs. */
export function RaceDay({race, onChanged}: {race: Race; onChanged: (race: Race) => void}) {
  const [help, setHelp] = useState<HelpRequest[]>([]);
  const [visits, setVisits] = useState<CheckInRecord[]>([]);
  const [pins, setPins] = useState<Checkpoint[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, guard] = useBusy();
  const load = () => Promise.all([
    request<HelpRequest[]>(`/races/${race.id}/help`), request<CheckInRecord[]>(`/races/${race.id}/checkins`),
  ]).then(([h, v]) => { setHelp(h); setVisits(v); setError(""); }, e => setError(errorText(e)));
  useEffect(() => {
    request<Checkpoint[]>(`/races/${race.id}/checkpoints`).then(setPins, e => setError(errorText(e)));
    request<Rider[]>(`/races/${race.id}/riders`).then(setRiders, e => setError(errorText(e)));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [race.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = help.filter(h => !h.resolved_at);
  const resolve = (id: number) => guard(async () => {
    try { await request(`/help/${id}/resolve`, {method: "POST"}); await load(); } catch (e) { setError(errorText(e)); }
  });
  const reached = (id: number) => visits.filter(v => v.rider_id === id).length;
  const winner = riders.find(r => r.id === race.winner_rider_id);
  const setWinner = (riderId: number | null) => {
    const rider = riders.find(r => r.id === riderId);
    if (rider && !window.confirm(`¿Marcar a ${rider.name} como ganador? Lleva ${reached(rider.id)}/${pins.length} checkpoints.`)) return;
    guard(async () => {
      try {
        onChanged(await request<Race>(`/races/${race.id}/winner`, {method: "PUT", json: {rider_id: riderId}}));
        setChoice("");
      } catch (e) { setError(errorText(e)); }
    });
  };
  return (
    <section className="card stack" aria-labelledby="raceday-title">
      <div className="row spread">
        <h2 id="raceday-title">Día de carrera</h2>
        <a className="btn-secondary" href={`/tablero/${race.id}`} target="_blank" rel="noreferrer">Tablero</a>
      </div>
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
      <h3>Ganador</h3>
      {winner ? (
        <div className="row spread">
          <p className="notice" role="status"><strong>{winner.name}</strong> es el ganador ({reached(winner.id)}/{pins.length} checkpoints).</p>
          <button className="btn-secondary" disabled={busy} onClick={() => setWinner(null)}>Quitar ganador</button>
        </div>
      ) : (
        <form className="row" onSubmit={e => { e.preventDefault(); if (choice) setWinner(Number(choice)); }}>
          <label className="grow">Corredor que llegó a la meta
            <select value={choice} onChange={e => setChoice(e.target.value)}>
              <option value="">Elige al corredor</option>
              {[...riders].sort((a, b) => reached(b.id) - reached(a.id)).map(r => (
                <option key={r.id} value={r.id}>{r.name} · {reached(r.id)}/{pins.length} checkpoints</option>
              ))}
            </select>
          </label>
          <button className="btn-primary" disabled={busy || !choice}>Marcar ganador</button>
        </form>
      )}
      <p className="muted">En la meta no hay QR: revisa que tenga todos sus checkpoints y márcalo aquí. Aparecerá en el tablero.</p>
      <h3>QR de checkpoints</h3>
      <p className="muted">«Enviar imagen» abre el menú de compartir del teléfono para mandarlo por WhatsApp a la persona del checkpoint; en computadora descarga la imagen. El corredor lo escanea con la cámara y debe estar a menos de 50 m del checkpoint.</p>
      <div className="qr-grid">{pinsForDisplay(pins).map(pin => <CheckpointQr key={pin.id} pin={pin} raceName={race.name} />)}</div>
    </section>
  );
}
