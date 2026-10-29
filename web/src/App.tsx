import {Fragment, useEffect, useState, type FormEvent} from "react";
import {ApiError, errorText, request, setOnUnauthorized, type Me, type Race} from "./api/client";
import {RaceEditor, RaceForm} from "./features/races/RaceEditor";
import {InvitationPanel} from "./features/invitations/InvitationPanel";
import {AdminPanel} from "./features/admin/AdminPanel";
import {formatWhen} from "./features/races/mapUtils";

/** token null = malformed link: show the safe invalid state without calling the API. */
export type Route = {view: "invite" | "consume"; token: string | null} | {view: "app"};

/** Page loads only: these GETs are SPA routes; the API answers the matching POSTs. */
export function route(pathname: string): Route {
  const match = pathname.match(/^\/(invite|auth\/consume)\/([^/]+)\/?$/);
  if (!match) return {view: "app"};
  let token: string | null = null;
  try { token = decodeURIComponent(match[2]); } catch { /* malformed escape */ }
  return {view: match[1] === "invite" ? "invite" : "consume", token};
}

export function App() {
  const [current, setCurrent] = useState(() => route(location.pathname));
  const goHome = () => { history.replaceState(null, "", "/"); setCurrent({view: "app"}); };
  return (
    <main>
      <header className="brand"><a href="/">Alleycat Safety</a></header>
      {current.view === "invite" ? <InviteView token={current.token} />
        : current.view === "consume" ? <ConsumeView token={current.token} onDone={goHome} />
        : <Shell />}
    </main>
  );
}

type InviteSummary = {race: {name: string; start_label: string; starts_at: string; ends_at: string}; next: string};
type Load<T> = {state: "loading"} | {state: "ok"; value: T} | {state: "invalid"} | {state: "retry"; message: string};

/** POSTs a link token once per attempt. 4xx = safe invalid state; network/5xx = retry, not "invalid". */
function useTokenPost<T>(path: string | null, onOk?: (value: T) => void) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load<T>>(path ? {state: "loading"} : {state: "invalid"});
  useEffect(() => {
    if (!path) return;
    setLoad({state: "loading"});
    request<T>(path, {method: "POST"}).then(
      value => { setLoad({state: "ok", value}); onOk?.(value); },
      error => setLoad(error instanceof ApiError && error.status >= 400 && error.status < 500
        ? {state: "invalid"} : {state: "retry", message: errorText(error)}),
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

export function InviteView({token}: {token: string | null}) {
  const [load, retry] = useTokenPost<InviteSummary>(token === null ? null : `/invite/${encodeURIComponent(token)}`);
  if (load.state === "invalid") return <section className="card stack"><h1>Invitación no disponible</h1><p>Este enlace no es válido, expiró, fue revocado o ya se usó. Pide uno nuevo a quien organiza la carrera.</p></section>;
  if (load.state === "retry") return <Retry message={load.message} onRetry={retry} />;
  if (load.state === "loading") return <p role="status">Abriendo invitación…</p>;
  const {race} = load.value;
  return (
    <section className="card stack">
      <p className="muted">Estás invitado a</p>
      <h1>{race.name}</h1>
      <p><strong>Salida:</strong> {race.start_label}</p>
      <p><strong>Horario:</strong> {formatWhen(race.starts_at)} – {formatWhen(race.ends_at)}</p>
      <p className="notice">El registro de corredores llegará en una próxima versión. Guarda este enlace.</p>
    </section>
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
            </li>
          ))}
          {!races.length && !error && <li className="muted">Aún no tienes carreras.</li>}
        </ul>
      </section>
      {selected && (
        <Fragment key={selected.id}>{/* remount per race: no state leaks between races */}
          <RaceEditor race={selected} onChanged={replace} />
          <InvitationPanel raceId={selected.id} published={selected.status === "published"} />
        </Fragment>
      )}
      {me.role === "superadmin" && <AdminPanel />}
    </div>
  );
}
