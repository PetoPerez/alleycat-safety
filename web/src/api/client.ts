export type Me = {id: number; email: string; role: "superadmin" | "admin"};
export type Race = {id: number; name: string; start_label: string; latitude: number; longitude: number; starts_at: string; ends_at: string; status: "draft" | "published";
  checkpoints_release_minutes: number; checkpoints_release_at: string; checkpoints_released: boolean};
export type RaceInput = Omit<Race, "id" | "status" | "checkpoints_release_at" | "checkpoints_released">;
export type Checkpoint = {id: number; name: string; description?: string | null; latitude: number; longitude: number};
export type Rider = {id: number; name: string; email?: string | null; phone?: string | null};
export type InvitationState = "sent" | "opened" | "expired" | "revoked" | "used";
export type Invitation = {id: number; rider_id: number; channel: "email" | "whatsapp"; expires_at: string; delivery_status: string; state: InvitationState};
export type Issued = {id: number; delivery_status: string; state: InvitationState; expires_at: string; link?: string};
export type Organizer = {id: number; email: string; role: string; created_at: string};

type Detail = string | {loc?: (string | number)[]; msg?: string}[] | undefined;

/** Known backend texts (English) -> Spanish UI text. Unknown texts fall back by status. */
const MESSAGES: Record<string, string> = {
  "Organizer authentication required": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "Superadmin only": "Sólo el superadmin puede hacer esto.",
  "A valid email is required": "Escribe un email válido.",
  "An organizer with this email already exists": "Ya existe un organizador con ese email.",
  "Magic link is invalid, expired, or already used": "El enlace de acceso no es válido, ya se usó o expiró.",
  "Race not found": "No se encontró la carrera.",
  "Rider not found": "No se encontró el corredor.",
  "Checkpoint not found": "No se encontró el checkpoint.",
  "Invitation not found": "No se encontró la invitación.",
  "Publish race before inviting": "Publica la carrera antes de invitar.",
  "Unsupported delivery channel": "Canal de envío no válido.",
  "Email delivery requires a rider email address": "Este corredor no tiene email: invítalo por WhatsApp.",
  "Invitation expiry must be between 1 hour and 30 days": "La invitación debe durar entre 1 hora y 30 días.",
  "Active invitation exists; resend or revoke it": "Este corredor ya tiene una invitación activa: reenvíala o revócala.",
  "Invitation is no longer active": "La invitación ya no está activa.",
  "This invitation is invalid, expired, revoked, or already used": "Esta invitación no es válida, expiró, fue revocada o ya se usó.",
  "Name cannot be blank": "Escribe un nombre.",
  "Start area cannot be blank": "Escribe la zona de salida.",
  "Invalid coordinates": "Coordenadas no válidas.",
  "End time must be after start time": "El fin debe ser posterior al inicio.",
  "Published races cannot be changed in this release": "Una carrera publicada ya no se puede cambiar.",
  "Rider name cannot be blank": "Escribe el nombre del corredor.",
  "Email or phone is required": "Indica un email o un teléfono.",
  "Checkpoint label cannot be blank": "Escribe una etiqueta para el checkpoint.",
  "Add at least one checkpoint before publishing": "Añade al menos un checkpoint antes de publicar.",
  "Release minutes must be between 0 and 1440": "Indica entre 0 y 1440 minutos.",
  "Publish race before releasing checkpoints": "Publica la carrera antes de liberar los checkpoints.",
};
const BY_STATUS: Record<number, string> = {
  401: MESSAGES["Organizer authentication required"], 403: "No tienes permiso para hacer esto.",
  404: "No se encontró.", 409: "Ya existe.", 422: "Revisa los datos.",
};
export function translate(message: string | undefined, status: number): string {
  if (message && MESSAGES[message]) return MESSAGES[message];
  if (message?.startsWith("Invitation is already")) return MESSAGES["Invitation is no longer active"];
  return BY_STATUS[status] ?? `Error del servidor (${status}). Inténtalo de nuevo.`;
}

/** The one error type the UI sees: a readable message plus per-field messages keyed by the last `loc` segment. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export function toApiError(status: number, detail: Detail): ApiError {
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    for (const item of detail) {
      const field = item.loc?.filter(part => typeof part === "string" && part !== "body").pop();
      if (field && !fields[field]) fields[field] = translate(item.msg, status);
    }
    return new ApiError(status, [...new Set(detail.map(item => translate(item.msg, status)))].join(" "), fields);
  }
  return new ApiError(status, translate(typeof detail === "string" ? detail : undefined, status));
}

/** Shell sets this so any 401 (expired session) sends the user back to the login. */
let unauthorized: (() => void) | undefined;
export const setOnUnauthorized = (fn: (() => void) | undefined) => { unauthorized = fn; };

export async function request<T>(path: string, init: RequestInit & {json?: unknown} = {}): Promise<T> {
  const {json, ...rest} = init;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: json === undefined ? rest.headers : {"Content-Type": "application/json", ...rest.headers},
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) unauthorized?.();
    throw toApiError(response.status, body?.detail);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, "Respuesta inesperada del servidor. Inténtalo de nuevo.");
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "Algo salió mal");
export const fieldErrors = (error: unknown) => (error instanceof ApiError ? error.fields : {});
