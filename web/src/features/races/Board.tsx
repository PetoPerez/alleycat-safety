import {useEffect, useState} from "react";
import {ApiError, errorText, request, type HelpRequest} from "../../api/client";
import {formatTime} from "./mapUtils";
import {HELP_LABEL} from "./RaceDay";

const POLL_MS = 10_000;
const FRESH_MS = 2 * 60_000; // arrivals this recent are highlighted so the room notices them

type BoardData = {
  race: {id: number; name: string; starts_at: string; ends_at: string; winner_rider_id: number | null};
  checkpoints: {id: number; name: string; finish: boolean}[];
  riders: {id: number; name: string}[];
  checkins: {rider_id: number; checkpoint_id: number; checked_in_at: string}[];
  help: HelpRequest[];
};

/** Most checkpoints first; ties go to whoever reached their last checkpoint earlier. The finish is not a checkpoint. */
export function standings(data: BoardData) {
  const finishId = data.checkpoints.find(p => p.finish)?.id;
  return data.riders.map(rider => {
    const mine = data.checkins.filter(c => c.rider_id === rider.id);
    const visits = new Map(mine.filter(c => c.checkpoint_id !== finishId).map(c => [c.checkpoint_id, c.checked_in_at]));
    const last = [...visits.values()].sort().pop() ?? "";
    const finished = mine.find(c => c.checkpoint_id === finishId)?.checked_in_at;
    return {rider, visits, last, finished};
  }).sort((a, b) => b.visits.size - a.visits.size || a.last.localeCompare(b.last) || a.rider.name.localeCompare(b.rider.name));
}

/** Read-only race-day screen for a projector or TV: arrivals per checkpoint and open help requests. */
export function Board({raceId}: {raceId: string | null}) {
  const [data, setData] = useState<BoardData>();
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!raceId) return;
    const load = () => request<BoardData>(`/races/${encodeURIComponent(raceId)}/board`).then(
      value => { setData(value); setError(""); },
      e => setError(e instanceof ApiError && e.status === 401 ? "login" : errorText(e)));
    load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [raceId]);
  if (error === "login") return <section className="card stack"><h1>Inicia sesión</h1><p>El tablero es solo para organizadores.</p><a className="btn-primary" href="/">Iniciar sesión</a></section>;
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p role="status">Cargando tablero…</p>;
  const rows = standings(data);
  const stops = data.checkpoints.filter(p => !p.finish);
  const finish = data.checkpoints.find(p => p.finish);
  const winner = data.riders.find(r => r.id === data.race.winner_rider_id);
  const podium = rows.filter(r => r.visits.size).slice(0, 3); // nobody leads with zero checkpoints
  const arrived = (id: number) => data.checkins.filter(c => c.checkpoint_id === id).length;
  return (
    <div className="board">
      <header className="board-head">
        <div>
          <h1>{data.race.name}</h1>
          <p className="muted">{formatTime(data.race.starts_at)} – {formatTime(data.race.ends_at)} · {data.riders.length} corredores · {data.checkins.length} llegadas</p>
        </div>
        <div className="board-clock">{new Date(now).toLocaleTimeString("es")}</div>
        <button className="btn-secondary" onClick={() => document.documentElement.requestFullscreen?.()}>Pantalla completa</button>
      </header>
      {error && <p className="error" role="alert">Sin conexión: mostrando los últimos datos. {error}</p>}
      {data.help.length > 0 && (
        <ul className="board-help" role="alert">
          {data.help.map(h => (
            <li key={h.id}><strong>AUXILIO · {HELP_LABEL[h.kind]}</strong> {h.rider}{h.phone && ` · ${h.phone}`} · {formatTime(h.created_at)}</li>
          ))}
        </ul>
      )}
      {winner && <p className="board-winner" role="status">Ganador: {winner.name}</p>}
      {podium.length > 0 && (
        <ol className="board-podium" aria-label="Más checkpoints">
          {podium.map(({rider, visits, last, finished}, i) => (
            <li key={rider.id} className={i === 0 ? "leader" : ""}>
              <span className="board-place">{i + 1}º</span>
              <strong className="board-name">{rider.name}</strong>
              <span>{visits.size}/{stops.length} checkpoints · último {formatTime(last)}</span>
              {finished && <span>En meta {formatTime(finished)}</span>}
              {i === 0 && <span className="board-crown">Líder virtual</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="board-scroll">
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th><th>Corredor</th>
              {stops.map(p => <th key={p.id}>{p.name}<span className="muted"> {arrived(p.id)}/{data.riders.length}</span></th>)}
              <th>Total</th>
              {finish && <th>Meta<span className="muted"> {arrived(finish.id)}/{data.riders.length}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({rider, visits, finished}, i) => (
              <tr key={rider.id} className={i === 0 && visits.size ? "leader" : undefined}>
                <td>{i + 1}</td>
                <td className="board-name">{rider.name}</td>
                {stops.map(p => {
                  const at = visits.get(p.id);
                  const fresh = at && now - new Date(at).getTime() < FRESH_MS;
                  return <td key={p.id} className={at ? `hit${fresh ? " fresh" : ""}` : "miss"}>{at ? formatTime(at) : "—"}</td>;
                })}
                <td className="board-total">{visits.size}/{stops.length}</td>
                {finish && <td className={finished ? "hit" : "miss"}>{finished ? formatTime(finished) : "—"}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={data.checkpoints.length + 3} className="muted">Aún no hay corredores invitados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
