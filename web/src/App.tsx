import {Fragment, useEffect, useState, type FormEvent} from "react";
import {MapContainer, Marker, TileLayer, Tooltip} from "react-leaflet";
import L from "./features/races/leaflet";
import {ApiError, errorText, request, setOnUnauthorized, type HelpKind, type Me, type Race} from "./api/client";
import {RaceEditor, RaceForm} from "./features/races/RaceEditor";
import {InvitationPanel} from "./features/invitations/InvitationPanel";
import {AdminPanel} from "./features/admin/AdminPanel";
import {useBusy} from "./useBusy";
import {HELP_LABEL, RaceDay} from "./features/races/RaceDay";
import {Board} from "./features/races/Board";
import {formatRelease, formatTime, formatWhen, pinsForDisplay} from "./features/races/mapUtils";

/** token null = malformed link: show the safe invalid state without calling the API. */
export type Route = {view: "invite" | "consume" | "checkin" | "board"; token: string | null} | {view: "app"};

/** Page loads only: these GETs are SPA routes; the API answers the matching POSTs. */
export function route(pathname: string): Route {
  const match = pathname.match(/^\/(invite|auth\/consume|checkin|tablero)\/([^/]+)\/?$/);
  if (!match) return {view: "app"};
  let token: string | null = null;
  try { token = decodeURIComponent(match[2]); } catch { /* malformed escape */ }
  const view = match[1] === "auth/consume" ? "consume" : match[1] === "tablero" ? "board" : match[1] as "invite" | "checkin";
  return {view, token};
}

export function App() {
  const [current, setCurrent] = useState(() => route(location.pathname));
  const goHome = () => { history.replaceState(null, "", "/"); setCurrent({view: "app"}); };
  if (current.view === "board") return <main className="wide"><Board raceId={current.token} /></main>;
  return (
    <main>
      <header className="brand"><a href="/">Alleycat Safety</a></header>
      {current.view === "invite" ? <InviteView token={current.token} />
        : current.view === "consume" ? <ConsumeView token={current.token} onDone={goHome} />
        : current.view === "checkin" ? <CheckInView code={current.token} />
        : <Shell />}
    </main>
  );
}

type GuestPin = {name: string; latitude: number; longitude: number};
/** `checkpoints` is absent until the server releases them. */
type InviteSummary = {race: {name: string; start_label: string; starts_at: string; ends_at: string; checkpoints_release_at: string; checkpoints?: GuestPin[]}; confirmed: boolean};
const REFRESH_MS = 30_000;
const RETRY_MS = 5_000; // after a failed refresh, so a blip doesn't push the next try a full cycle away
/** stale: the last refresh failed on the network, so `value` is the previous good answer. */
type Load<T> = {state: "loading"} | {state: "ok"; value: T; stale?: boolean} | {state: "invalid"} | {state: "retry"; message: string};

/** POSTs a link token once per attempt. 4xx = safe invalid state; network/5xx = retry, not "invalid". */
function useTokenPost<T>(path: string | null, onOk?: (value: T) => void) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load<T>>(path ? {state: "loading"} : {state: "invalid"});
  useEffect(() => {
    if (!path) return;
    setLoad(prev => (prev.state === "ok" ? prev : {state: "loading"})); // refreshes keep showing the last value
    request<T>(path, {method: "POST"}).then(
      value => { setLoad({state: "ok", value}); onOk?.(value); },
      error => setLoad(prev => error instanceof ApiError && error.status >= 400 && error.status < 500
        ? {state: "invalid"} : prev.state === "ok" ? {...prev, stale: true} : {state: "retry", message: errorText(error)}),
    );
  }, [path, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return [load, () => setAttempt(n => n + 1)] as const;
}

function Retry({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <section className="card stack">
      <p className="error" role="alert">{message}</p>
      <button className="btn-secondary" onClick={onRetry}>Reintentar</button>
    </section>
  );
}

/** The checkpoint QR opens a separate page, so the rider's invitation token is remembered on this phone. */
const INVITE_KEY = "alleycat.invite";
const remember = (token: string) => { try { localStorage.setItem(INVITE_KEY, token); } catch { /* storage blocked */ } };
const remembered = () => { try { return localStorage.getItem(INVITE_KEY); } catch { return null; } };

export function InviteView({token}: {token: string | null}) {
  const [load, retry] = useTokenPost<InviteSummary>(token === null ? null : `/invite/${encodeURIComponent(token)}`, () => token && remember(token));
  const waiting = load.state === "ok" && !load.value.race.checkpoints;
  const stale = load.state === "ok" && !!load.stale;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(retry, stale ? RETRY_MS : REFRESH_MS); // the server decides when checkpoints appear
    return () => clearInterval(timer);
  }, [waiting, stale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (load.state === "invalid") return <section className="card stack"><h1>Invitación no disponible</h1><p>Este enlace no es válido, expiró, fue revocado o ya se usó. Pide uno nuevo a quien organiza la carrera.</p></section>;
  if (load.state === "retry") return <Retry message={load.message} onRetry={retry} />;
  if (load.state === "loading") return <p role="status">Abriendo invitación…</p>;
  const {race, confirmed} = load.value;
  return (
    <section className="card stack">
      <p className="muted">Estás invitado a</p>
      <h1>{race.name}</h1>
      <p><strong>Salida:</strong> {race.start_label}</p>
      <p><strong>Horario:</strong> {formatWhen(race.starts_at)} – {formatWhen(race.ends_at)}</p>
      {token && <ConfirmButton token={token} confirmed={confirmed} />}
      {token && <HelpButtons token={token} />}
      {race.checkpoints ? <GuestCheckpoints pins={race.checkpoints} />
        : <p className="notice" role="status">Los checkpoints se publican a las {formatRelease(race.checkpoints_release_at)}. Deja esta página abierta: aparecerán solos.</p>}
      <p className="notice">Para registrar tu visita a un checkpoint, escanea su QR con la cámara de este teléfono estando ahí (a menos de 50 m). Guarda este enlace.</p>
    </section>
  );
}

function ConfirmButton({token, confirmed}: {token: string; confirmed: boolean}) {
  const [done, setDone] = useState(confirmed);
  const [error, setError] = useState("");
  const [busy, guard] = useBusy();
  const send = () => guard(async () => {
    setError("");
    try {
      await request(`/invite/${encodeURIComponent(token)}/confirm`, {method: "POST"});
      setDone(true);
    } catch (e) { setError(errorText(e)); }
  });
  if (done) return <p className="notice" role="status">Participación confirmada. ¡Nos vemos en la salida!</p>;
  return (
    <div className="stack">
      <button className="btn-primary" disabled={busy} onClick={send}>Confirmo que participo</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

const KINDS: HelpKind[] = ["medical", "accident", "mechanical", "other"];
const FIX_TIMEOUT_MS = 10_000;

/** The current position, or null: a help request must go out even without GPS. */
const currentPosition = () => new Promise<GeolocationCoordinates | null>(resolve => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(p => resolve(p.coords), () => resolve(null), {enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS});
});

function HelpButtons({token}: {token: string}) {
  const [busy, guard] = useBusy();
  const [status, setStatus] = useState("");
  const ask = (kind: HelpKind) => guard(async () => {
    if (!confirm(`¿Enviar solicitud de auxilio: ${HELP_LABEL[kind]}?`)) return;
    setStatus("Enviando solicitud…");
    const coords = await currentPosition();
    try {
      await request(`/invite/${encodeURIComponent(token)}/help`, {method: "POST",
        json: {kind, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null}});
      setStatus(coords ? "Solicitud enviada con tu ubicación. La organización ya fue avisada." : "Solicitud enviada sin ubicación (no se pudo obtener). La organización ya fue avisada.");
    } catch (e) {
      setStatus(`No se pudo enviar: ${errorText(e)} Si es urgente, llama a la organización.`);
    }
  });
  return (
    <div className="stack">
      <h2>¿Necesitas ayuda?</h2>
      <div className="help-grid">
        {KINDS.map(kind => <button key={kind} className="btn-danger" disabled={busy} onClick={() => ask(kind)}>{HELP_LABEL[kind]}</button>)}
      </div>
      {status && <p role="status">{status}</p>}
    </div>
  );
}

type CheckInResult = {checkpoint: string; checked_in_at: string};
type CheckIn = {state: "locating"} | {state: "sending"} | {state: "ok"; value: CheckInResult} | {state: "failed"; message: string};

/** Opened by the phone camera from a checkpoint QR. The rider is identified by the invitation opened earlier on
 *  this phone, and the server only accepts the scan if the phone's position is next to the checkpoint. */
export function CheckInView({code}: {code: string | null}) {
  const token = remembered();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CheckIn>({state: "locating"});
  useEffect(() => {
    if (!code || !token) return;
    let live = true;
    setResult({state: "locating"});
    currentPosition().then(async coords => {
      if (!live) return;
      if (!coords) return setResult({state: "failed", message: "No se pudo obtener tu ubicación. Activa el GPS y permite la ubicación al navegador."});
      setResult({state: "sending"});
      try {
        const value = await request<CheckInResult>(`/invite/${encodeURIComponent(token)}/checkins`, {method: "POST",
          json: {code, latitude: coords.latitude, longitude: coords.longitude}});
        if (live) setResult({state: "ok", value});
      } catch (e) {
        if (live) setResult({state: "failed", message: errorText(e)});
      }
    });
    return () => { live = false; };
  }, [code, token, attempt]);
  const back = token && <a className="btn-secondary" href={`/invite/${encodeURIComponent(token)}`}>Volver a mi invitación</a>;
  if (!token) return <section className="card stack"><h1>Abre primero tu invitación</h1><p>Abre en este teléfono el enlace de invitación que te enviaron y vuelve a escanear el QR del checkpoint.</p></section>;
  if (!code) return <section className="card stack"><h1>QR no válido</h1><p>Este QR no es válido para tu carrera.</p>{back}</section>;
  if (result.state === "locating") return <p role="status">Obteniendo tu ubicación…</p>;
  if (result.state === "sending") return <p role="status">Registrando checkpoint…</p>;
  if (result.state === "failed") return (
    <section className="card stack">
      <h1>No se pudo registrar</h1>
      <p className="error" role="alert">{result.message}</p>
      <button className="btn-primary" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>
      {back}
    </section>
  );
  return (
    <section className="card stack">
      <h1>Checkpoint registrado</h1>
      <p><strong>{result.value.checkpoint}</strong> a las {formatTime(result.value.checked_in_at)}.</p>
      {back}
    </section>
  );
}

/** Read-only: no ordering, numbering or route; the list is alphabetical only to find a name. */
function GuestCheckpoints({pins}: {pins: GuestPin[]}) {
  const sorted = pinsForDisplay(pins);
  const bounds = L.latLngBounds(sorted.map(p => [p.latitude, p.longitude] as [number, number]));
  return (
    <>
      <h2>Checkpoints</h2>
      <p className="muted">Visítalos en el orden que quieras.</p>
      <MapContainer bounds={bounds} boundsOptions={{padding: [24, 24], maxZoom: 16}} className="checkpoint-map">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {sorted.map((pin, i) => (
          <Marker key={i} position={[pin.latitude, pin.longitude]}><Tooltip>{pin.name}</Tooltip></Marker>
        ))}
      </MapContainer>
      <ul className="list">
        {sorted.map((pin, i) => (
          <li key={i}><span>{pin.name} <span className="muted">({pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)})</span></span></li>
        ))}
      </ul>
    </>
  );
}

export function ConsumeView({token, onDone}: {token: string | null; onDone: () => void}) {
  const [load, retry] = useTokenPost(token === null ? null : `/auth/consume/${encodeURIComponent(token)}`, onDone);
  if (load.state === "retry") return <Retry message={load.message} onRetry={retry} />;
  if (load.state !== "invalid") return <p role="status">Iniciando sesión…</p>;
  return (
    <section className="card stack">
      <h1>Enlace no válido</h1>
      <p>Este enlace de acceso no es válido, ya se usó o expiró.</p>
      <a className="btn-primary" href="/">Pedir otro enlace</a>
    </section>
  );
}

function Shell() {
  const [me, setMe] = useState<Me | null>();
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    request<Me>("/auth/me").then(setMe, e => { if (!(e instanceof ApiError && e.status === 401)) setError(errorText(e)); });
  };
  useEffect(() => {
    setOnUnauthorized(() => setMe(null)); // expired session anywhere -> back to Login
    load();
    return () => setOnUnauthorized(undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <section className="card stack"><p className="error" role="alert">{error}</p><button className="btn-secondary" onClick={load}>Reintentar</button></section>;
  if (me === undefined) return <p role="status">Cargando…</p>;
  return me ? <Dashboard me={me} /> : <Login />;
}

export function Login() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage(""); setPreview("");
    try {
      const result = await request<{link?: string}>("/auth/magic-links", {method: "POST", json: {email}});
      setMessage("Si este email pertenece a una cuenta de organizador, te enviamos un enlace de acceso. Vale 15 minutos y un solo uso.");
      setPreview(result.link ?? "");
    } catch (e) {
      setError(errorText(e)); // keep the email so they can retry
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card stack">
      <h1>Acceso para organizadores</h1>
      <form className="stack" onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <button className="btn-primary" disabled={busy}>Enviarme un enlace</button>
      </form>
      {message && <p role="status">{message}</p>}
      {preview && <p className="notice">Vista previa (desarrollo): <a href={preview}>{preview}</a></p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function Dashboard({me}: {me: Me}) {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { request<Race[]>("/races").then(setRaces, e => setError(errorText(e))); }, []);
  const selected = races.find(r => r.id === selectedId);
  const [busy, guard] = useBusy();
  const remove = (race: Race) => {
    if (!window.confirm(`¿Eliminar «${race.name}»? Se borran sus checkpoints, corredores, invitaciones y check-ins. No se puede deshacer.`)) return;
    guard(async () => {
      setError("");
      try {
        await request(`/races/${race.id}`, {method: "DELETE"});
        setRaces(list => list.filter(r => r.id !== race.id));
      } catch (e) { setError(errorText(e)); }
    });
  };
  const replace = (race: Race) => setRaces(list => list.some(r => r.id === race.id) ? list.map(r => (r.id === race.id ? race : r)) : [...list, race]);

  return (
    <div className="stack">
      <p className="muted">Sesión: {me.email}</p>
      <section className="card stack" aria-labelledby="races-title">
        <div className="row spread">
          <h2 id="races-title">Mis carreras</h2>
          <button className="btn-secondary" onClick={() => setCreating(!creating)}>{creating ? "Cancelar" : "Nueva carrera"}</button>
        </div>
        {creating && <RaceForm submitLabel="Crear borrador" onSubmit={async body => {
          const race = await request<Race>("/races", {method: "POST", json: body});
          replace(race); setSelectedId(race.id); setCreating(false);
        }} />}
        {error && <p className="error" role="alert">{error}</p>}
        <ul className="list">
          {races.map(r => (
            <li key={r.id}>
              <button className={`link ${r.id === selectedId ? "active" : ""}`} aria-pressed={r.id === selectedId} onClick={() => setSelectedId(r.id)}>
                {r.name}
              </button>
              <span className={`badge ${r.status}`}>{r.status === "draft" ? "Borrador" : "Publicada"}</span>
              {Date.parse(r.ends_at) <= Date.now() &&
                <button className="btn-danger" disabled={busy} onClick={() => remove(r)} aria-label={`Eliminar ${r.name}`}>Eliminar</button>}
            </li>
          ))}
          {!races.length && !error && <li className="muted">Aún no tienes carreras.</li>}
        </ul>
      </section>
      {selected && (
        <Fragment key={selected.id}>{/* remount per race: no state leaks between races */}
          <RaceEditor race={selected} onChanged={replace} />
          <InvitationPanel raceId={selected.id} published={selected.status === "published"} />
          {selected.status === "published" && <RaceDay race={selected} onChanged={replace} />}
        </Fragment>
      )}
      {me.role === "superadmin" && <AdminPanel />}
    </div>
  );
}
