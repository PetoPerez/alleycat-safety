/** Alphabetical copy for the list: display order only, never a route. */
export const pinsForDisplay = <T extends {name: string}>(checkpoints: T[]) => [...checkpoints].sort((a, b) => a.name.localeCompare(b.name));

const pad = (n: number) => String(n).padStart(2, "0");
const asDate = (iso: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`); // zone-less API values are UTC

/** API ISO timestamp -> value for <input type="datetime-local"> in the viewer's local time. */
export function toLocalInput(iso: string): string {
  const d = asDate(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local wall time) -> ISO UTC with zone, as the API requires. */
export const fromLocalInput = (value: string) => new Date(value).toISOString();

export const formatWhen = (iso: string) =>
  asDate(iso).toLocaleString("es", {dateStyle: "medium", timeStyle: "short"});

export const formatTime = (iso: string) => asDate(iso).toLocaleTimeString("es", {timeStyle: "short"});

/** "HH:MM del <fecha>" in the viewer's local time, for the checkpoint release moment. */
export const formatRelease = (iso: string) =>
  `${formatTime(iso)} del ${asDate(iso).toLocaleDateString("es", {dateStyle: "medium"})}`;

/** Display only: the server alone decides whether checkpoints are sent to guests. */
export const msUntil = (iso: string, now = Date.now()) => asDate(iso).getTime() - now;
export const isReleased = (iso: string, now = Date.now()) => msUntil(iso, now) <= 0;
