import {useEffect, useState, type FormEvent} from "react";
import {ApiError, errorText, fieldErrors, request, type Invitation, type InvitationState, type Issued, type Rider} from "../../api/client";
import {formatWhen} from "../races/mapUtils";
import {useBusy} from "../../useBusy";

const STATE_LABEL: Record<InvitationState, string> = {sent: "Enviada", opened: "Abierta", confirmed: "Confirmada", expired: "Expirada", revoked: "Revocada", used: "Usada"};
const isActive = (inv: Invitation) => inv.state === "sent" || inv.state === "opened" || inv.state === "confirmed";

function CopyLink({link}: {link: string}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setFailed(false); setCopied(true); } catch { setFailed(true); }
  };
  return (
    <div className="stack">
      <div className="row copy">
        <input readOnly value={link} aria-label="Enlace de invitación" onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn-secondary" onClick={copy}>{copied ? "Copiado" : "Copiar para WhatsApp"}</button>
      </div>
      {failed && <p className="error" role="alert">No se pudo copiar: selecciona el enlace y cópialo a mano.</p>}
      <p className="muted">Cópialo ahora: al recargar la página ya no se mostrará. Después usa «Reenviar» para obtener uno nuevo.</p>
    </div>
  );
}

type Notice = {text: string; error?: boolean};

/** Mount with key={raceId}; also reloads if raceId changes. */
export function InvitationPanel({raceId, published}: {raceId: number; published: boolean}) {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [links, setLinks] = useState<Record<number, string>>({}); // only known right after issue/resend
  const [riderId, setRiderId] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [notice, setNotice] = useState<Notice>();
  const [conflict, setConflict] = useState<Invitation>();
  const [rider, setRider] = useState({name: "", email: "", phone: ""});
  const [riderErrors, setRiderErrors] = useState<Record<string, string>>({});
  const [busy, guard] = useBusy();
  const fail = (error: unknown) => setNotice({text: errorText(error), error: true});

  const refresh = async () => {
    const [roster, issued] = await Promise.all([request<Rider[]>(`/races/${raceId}/riders`), request<Invitation[]>(`/races/${raceId}/invitations`)]);
    setRiders(roster);
    setInvitations(issued);
    return issued;
  };
  useEffect(() => {
    setInvitations([]); setLinks({}); setNotice(undefined); setConflict(undefined);
    refresh().catch(fail);
  }, [raceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: number) => riders.find(r => r.id === id)?.name ?? "Corredor";

  const addRider = (event: FormEvent) => {
    event.preventDefault();
    guard(async () => {
      setRiderErrors({});
      try {
        const created = await request<Rider>(`/races/${raceId}/riders`, {method: "POST", json: {name: rider.name, email: rider.email || null, phone: rider.phone || null}});
        setRiders(list => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
        setRiderId(String(created.id));
        setRider({name: "", email: "", phone: ""});
        setNotice({text: `${created.name} se añadió al padrón.`});
      } catch (error) {
        const fields = fieldErrors(error);
        setRiderErrors(Object.keys(fields).length ? fields : {form: errorText(error)});
      }
    });
  };

  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const importSheet = (file: File | undefined) => file && guard(async () => {
    setRowErrors([]); setNotice(undefined);
    try {
      const {added, skipped} = await request<{added: number; skipped: number}>(`/races/${raceId}/riders/import`, {method: "POST", body: file,
        headers: {"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}});
      await refresh();
      setNotice({text: `Se añadieron ${added} corredores al padrón${skipped ? `; ${skipped} ya estaban (mismo email o teléfono)` : ""}.`});
    } catch (error) {
      const rows = Object.entries(fieldErrors(error)).filter(([key]) => key.startsWith("row-"));
      if (rows.length) setRowErrors(rows.map(([key, text]) => `Fila ${key.slice(4)}: ${text}`));
      else fail(error);
    }
  });

  const remember = (issued: Issued) => issued.link && setLinks(map => ({...map, [issued.id]: issued.link!}));

  const invite = (event: FormEvent) => {
    event.preventDefault();
    guard(async () => {
      setNotice(undefined); setConflict(undefined);
      if (!riderId) return setNotice({text: "Elige un corredor del padrón.", error: true});
      try {
        const issued = await request<Issued>(`/races/${raceId}/invitations`, {method: "POST", json: {rider_id: Number(riderId), channel}});
        remember(issued);
        setNotice({text: issued.link ? "Invitación lista: copia el enlace de la lista." : "Invitación enviada por email."});
        await refresh();
      } catch (error) {
        fail(error);
        if (error instanceof ApiError && error.status === 409) {
          // The active invitation may not be in our list yet (another tab, stale view): reload first.
          const fresh = await refresh().catch(() => invitations);
          setConflict(fresh.find(inv => inv.rider_id === Number(riderId) && isActive(inv)));
        }
      }
    });
  };

  const act = (inv: Invitation, kind: "resend" | "revoke") => {
    if (kind === "revoke" && !window.confirm(`¿Revocar la invitación de ${nameOf(inv.rider_id)}? Su enlace dejará de funcionar.`)) return;
    guard(async () => {
      setNotice(undefined); setConflict(undefined);
      try {
        const result = await request<Issued | {status: string}>(`/invitations/${inv.id}/${kind}`, {method: "POST"});
        if ("id" in result) remember(result);
        setNotice({text: kind === "revoke" ? "Invitación revocada." : "link" in result && result.link ? "Nuevo enlace listo para copiar." : "Invitación reenviada."});
        await refresh();
      } catch (error) {
        fail(error);
      }
    });
  };

  const actions = (inv: Invitation) => (
    <span className="row">
      <button className="btn-secondary" disabled={busy} onClick={() => act(inv, "resend")}>Reenviar</button>
      <button className="btn-danger" disabled={busy} onClick={() => act(inv, "revoke")}>Revocar</button>
    </span>
  );

  return (
    <section className="card stack" aria-labelledby="invites-title">
      <h2 id="invites-title">Corredores e invitaciones</h2>

      <details>
        <summary>Añadir corredor al padrón de esta carrera</summary>
        <form className="stack" onSubmit={addRider} noValidate>
          <label>Nombre
            <input value={rider.name} onChange={e => setRider({...rider, name: e.target.value})} aria-invalid={!!riderErrors.name} />
            {riderErrors.name && <p className="field-error">{riderErrors.name}</p>}
          </label>
          <label>Email
            <input type="email" value={rider.email} onChange={e => setRider({...rider, email: e.target.value})} aria-invalid={!!riderErrors.email} />
            {riderErrors.email && <p className="field-error">{riderErrors.email}</p>}
          </label>
          <label>Teléfono
            <input type="tel" value={rider.phone} onChange={e => setRider({...rider, phone: e.target.value})} />
            {riderErrors.phone && <p className="field-error">{riderErrors.phone}</p>}
          </label>
          <p className="muted">Indica al menos un email o un teléfono.</p>
          {riderErrors.form && <p className="error" role="alert">{riderErrors.form}</p>}
          <button className="btn-secondary" disabled={busy}>Añadir corredor</button>
        </form>
      </details>

      <details>
        <summary>Cargar padrón desde Excel</summary>
        <div className="stack">
          <p className="muted">Archivo .xlsx con una fila de encabezados: <strong>Nombre</strong> y <strong>Email</strong> y/o <strong>Teléfono</strong>, en cualquier orden. Se lee la primera hoja. Si subes el archivo otra vez, no se duplica a nadie.</p>
          <a className="btn-secondary" href="/plantilla-padron.xlsx" download>Descargar plantilla de Excel</a>
          <label>Archivo de Excel
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy}
              onChange={e => { importSheet(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {rowErrors.length > 0 && (
            <div className="error" role="alert">
              <p>No se cargó nadie. Corrige estas filas y vuelve a subir el archivo:</p>
              <ul>{rowErrors.map(text => <li key={text}>{text}</li>)}</ul>
            </div>
          )}
        </div>
      </details>

      {published ? (
        <form className="row" onSubmit={invite}>
          <label className="grow">Corredor
            <select value={riderId} onChange={e => setRiderId(e.target.value)}>
              <option value="">Elige del padrón</option>
              {riders.map(r => <option key={r.id} value={r.id}>{r.name} · {r.email || r.phone}</option>)}
            </select>
          </label>
          <label>Canal
            <select value={channel} onChange={e => setChannel(e.target.value as "whatsapp" | "email")}>
              <option value="whatsapp">WhatsApp (copiar enlace)</option>
              <option value="email">Email</option>
            </select>
          </label>
          <button className="btn-primary" disabled={busy}>Invitar</button>
        </form>
      ) : (
        <p className="notice">Publica la carrera para poder invitar corredores.</p>
      )}

      {notice && (notice.error ? <p className="error" role="alert">{notice.text}</p> : <p role="status">{notice.text}</p>)}
      {conflict && (
        <div className="row"><span>Invitación activa de {nameOf(conflict.rider_id)}:</span>{actions(conflict)}</div>
      )}

      <ul className="list">
        {invitations.map(inv => (
          <li key={inv.id} className="stack">
            <div className="row spread">
              <span><strong>{nameOf(inv.rider_id)}</strong> · {STATE_LABEL[inv.state] ?? inv.state} · {inv.channel === "whatsapp" ? "WhatsApp" : "Email"}
                <span className="muted"> · vence {formatWhen(inv.expires_at)}</span></span>
              {isActive(inv) && actions(inv)}
            </div>
            {links[inv.id] && isActive(inv) && <CopyLink link={links[inv.id]} />}
          </li>
        ))}
        {!invitations.length && <li className="muted">Aún no hay invitaciones.</li>}
      </ul>
    </section>
  );
}
