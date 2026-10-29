import {useEffect, useState, type FormEvent} from "react";
import {ApiError, errorText, fieldErrors, request, type Organizer} from "../../api/client";
import {useBusy} from "../../useBusy";

const ROLE_LABEL: Record<string, string> = {superadmin: "Superadmin", admin: "Admin"};

/** Render only for role === "superadmin"; the API enforces it too (403). */
export function AdminPanel() {
  const [admins, setAdmins] = useState<Organizer[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [busy, guard] = useBusy();
  const [message, setMessage] = useState("");
  const load = async () => setAdmins(await request<Organizer[]>("/admin/organizers"));
  useEffect(() => { load().catch(e => setError(errorText(e))); }, []);

  const create = (event: FormEvent) => {
    event.preventDefault();
    guard(async () => {
      setError(""); setFieldError(""); setMessage("");
      try {
        const created = await request<Organizer>("/admin/organizers", {method: "POST", json: {email}});
        setEmail("");
        setMessage(`${created.email} ya puede pedir su enlace de acceso.`);
        await load();
      } catch (e) {
        // 422 (bad email) goes under the field; 409 and anything else as a form error.
        const field = fieldErrors(e).email ?? (e instanceof ApiError && e.status === 422 ? e.message : "");
        if (field) setFieldError(field); else setError(errorText(e));
      }
    });
  };

  return (
    <section className="card stack" aria-labelledby="admins-title">
      <h2 id="admins-title">Administradores</h2>
      <form className="row" onSubmit={create} noValidate>
        <label className="grow">Email del nuevo admin
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={!!fieldError} />
          {fieldError && <p className="field-error">{fieldError}</p>}
        </label>
        <button className="btn-primary" disabled={busy}>Crear admin</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <ul className="list">
        {admins.map(a => <li key={a.id}><span>{a.email}</span><span className="muted">{ROLE_LABEL[a.role] ?? a.role}</span></li>)}
      </ul>
    </section>
  );
}
