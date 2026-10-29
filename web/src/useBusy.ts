import {useRef, useState} from "react";

/** One request at a time: `busy` disables buttons, the ref drops repeat submits before React re-renders. */
export function useBusy() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const guard = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await action(); } finally { inFlight.current = false; setBusy(false); }
  };
  return [busy, guard] as const;
}
