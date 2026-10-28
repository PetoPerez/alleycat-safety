# Safety, reliability, and privacy requirements to resolve

## Safety boundary

The app is a coordination aid. It must make clear that an emergency alert notifies configured event staff; it does not guarantee emergency-service dispatch. The emergency flow should prominently present the local emergency number and permit the rider or organizer to call it, subject to product and jurisdiction decisions.

## Alert behavior

- An incident must be persisted before it is treated as sent.
- The client should attach the best available location plus timestamp, accuracy, and a flag indicating whether it is current or last-known.
- Delivery must be retried and be observable by administrators. The product needs an explicit policy for the case where the rider has no data connection.
- Administrators need acknowledgement and resolution timestamps so an alert is not mistaken for unhandled.
- Mechanical and emergency alerts require different visual severity and escalation policy.

## Location behavior

- Show riders when location sharing is active and provide a clear end-sharing control.
- Store capture time separately from server-receipt time.
- Define a configurable freshness threshold, accuracy threshold, upload cadence, and behavior for background permissions, device power saving, and app termination.
- The system must never infer that a silent rider is safe; stale or missing data must remain explicit.

## Data protection decisions required before launch

- Define the legal basis for collecting GPS, emergency contacts, and any medical notes; record consent and its version.
- Minimize emergency data to what organizers actually need; medical data needs separate justification and stricter access.
- Encrypt data in transit and at rest; use authenticated, role-scoped access and audit organizer access to emergency profiles and location data.
- Set separate retention/deletion schedules for race data, location events, incidents, and emergency profiles.
- Define participant access, correction, export, withdrawal-of-consent, and account deletion behavior.
- Verify jurisdiction-specific rules for the race location, including treatment of minors and emergency-contact information.

## Abuse and integrity risks

- Invitations and QR credentials must be hard to guess, expire appropriately, and be scoped to one race/checkpoint.
- Rate-limit location, check-in, and alert endpoints without preventing emergency alerts.
- Protect against false location injection, replayed QR scans, spoofed organizer sessions, and accidental emergency taps; confirmation behavior for emergency must balance prevention of accidental use against speed.
- Log security-relevant actions and preserve the incident event trail for the retention period.
