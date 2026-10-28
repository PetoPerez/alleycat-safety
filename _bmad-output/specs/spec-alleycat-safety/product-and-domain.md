# Product and domain detail

## Roles

| Role | Responsibilities and access |
|---|---|
| Race administrator | Creates and publishes a race; places checkpoints; invites participants; sees the authorized live map; receives and manages alerts. |
| Rider | Accepts an invitation; submits profile and emergency data; activates participation; shares location while active; scans QR checkpoints; requests assistance. |
| Support responder | Optional operational role for future definition. May be granted limited access to assigned incidents only; is not assumed to be an administrator. |

## Core entities

| Entity | Essential data |
|---|---|
| Race | Name, organizer(s), status, start-area geofence, start/end time, checkpoints, invited participants. |
| Checkpoint | Race ID, name/description, map coordinates, QR credential, active state. No sequence number is required for validation. |
| Invitation | Race ID, intended participant, invitation state, expiry, join token or equivalent. |
| Rider profile | Identity/contact details and consent acknowledgement. |
| Emergency profile | Emergency contact name, relationship, phone number, optional medical notes only if legally and operationally justified. |
| Participation session | Rider/race pair, state, activation and end timestamps, consent state, latest location freshness. |
| Location event | Session ID, latitude/longitude, accuracy, capture time, receipt time, source/connection state. |
| Incident | Race/rider/session, type (`mechanical` or `emergency`), trigger time, captured location, status, administrator acknowledgements and resolution. |
| Check-in | Rider/race/checkpoint, verified time, verification result, anti-duplicate credential or idempotency key. |

## Primary lifecycle

1. An administrator creates a draft race, selects its start area and time window, and places checkpoint pins.
2. The administrator publishes the race and sends invitations.
3. The invitee joins, completes required general and emergency information, and grants location/camera permissions with clear consent.
4. At the race start, the rider activates participation from within the start-area rule. The app begins background-appropriate location sharing while the session is active.
5. The organizer map displays each active rider's most recent coordinate, location accuracy/freshness, and participation state.
6. The rider scans each desired checkpoint QR code. The server verifies it and records a check-in without imposing an order.
7. If help is needed, the rider taps Mechanical help or Emergency. The client captures an immediate location where possible and submits an incident; organizers are notified.
8. An administrator acknowledges, coordinates assistance, and resolves the incident. The rider ends participation or the session expires at race end.

## Participation states

| State | Meaning |
|---|---|
| Invited | Invitation issued; rider has not joined. |
| Registered | Rider accepted and supplied required information; not sharing location. |
| Eligible to start | Registered and within the race start window; awaiting activation. |
| Active | Rider deliberately enabled participation and location sharing. |
| Location stale | Active session but no acceptable new location within a configurable freshness threshold. |
| Help requested | Active rider has an unresolved mechanical incident. |
| Emergency reported | Active rider has an unresolved emergency incident; this must be visually prominent and separately escalated. |
| Ended | Rider or system ended the participation session. |

## Minimum map contract

An authenticated race-map endpoint should expose a race-scoped view with:

- race metadata and time/status;
- checkpoint pins and identifiers;
- each participant's display name or organizer-defined alias, session state, last location, capture timestamp, accuracy, and stale indicator;
- unresolved incident marker with type, creation time, last known location, and acknowledgement status;
- no location history unless the endpoint and viewer are explicitly authorized for it.

The transport shape, real-time mechanism, pagination/history controls, and authorization scheme remain architecture decisions.

## Acceptance scenarios

1. **Any-order checkpoints:** A rider scans checkpoint C, then A, then B. All three valid scans appear as completed and none is rejected due to order.
2. **Mechanical assistance:** An active rider selects Mechanical help. The organizer receives an actionable alert with the rider and a current/last-known location, and can mark it acknowledged.
3. **Emergency:** An active rider selects Emergency. The alert is durable, visually distinguishable from mechanical help, and sent through the chosen escalation channels even if the map is not open.
4. **Stale location:** A rider loses connectivity. The map shows their last coordinate with capture time and stale state rather than presenting it as live.
5. **Unauthorized access:** A non-organizer and a rider from another race cannot retrieve this race's participant locations or emergency profiles.
6. **QR integrity:** A copied, expired, or wrong-race checkpoint QR does not generate a valid check-in.
