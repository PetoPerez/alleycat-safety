---
id: SPEC-alleycat-safety
companions:
  - product-and-domain.md
  - safety-and-privacy.md
sources: []
---

> **Canonical contract.** This SPEC and its companions are the complete working contract for planning, building, testing, and validating the product.

# Alleycat Safety Monitor

## Why

Informal alleycat bicycle races are self-routed: riders choose the order and route between checkpoints on public streets. Race organizers need a timely, reliable way to see who is actively participating and where they last reported their position, and riders need a low-friction way to request mechanical or emergency assistance after a breakdown or accident. The product reduces the time needed to notice, locate, and coordinate help for a rider in trouble while preserving the free-route nature of the race.

## Capabilities

- **CAP-1 — Race setup and checkpoints**
  - **intent:** An administrator can create a race, define its start area and time window, and place map pins for checkpoints that riders may visit in any order.
  - **success:** A published race displays its start area, schedule, and all checkpoints to invited participants; no ordering rule is imposed on checkpoint visits.

- **CAP-2 — Invitation and rider safety profile**
  - **intent:** An administrator can invite a participant, and the participant can join the race and provide the general and emergency-contact information needed to assist them.
  - **success:** Only an invited participant can join that race, and an administrator can retrieve the participant's submitted emergency information during an active incident.

- **CAP-3 — Start-of-race participation and live location**
  - **intent:** A registered rider can activate as participating near the designated start area during the race window and share mobile GPS location while active.
  - **success:** Administrators can see each active rider's latest location, timestamp, and participation state on a race map; riders outside activation rules cannot silently appear as active.

- **CAP-4 — Assistance and emergency alerts**
  - **intent:** An active rider can send either a mechanical-assistance request or an accident/emergency alert, including their current or last-known location.
  - **success:** Every submitted alert creates a durable incident record and notifies the race administrators with rider identity, alert type, timestamp, location, and emergency-contact data when applicable.

- **CAP-5 — Checkpoint verification**
  - **intent:** A rider can prove arrival at a checkpoint by scanning that checkpoint's QR code.
  - **success:** A valid scan is recorded once with rider, checkpoint, and timestamp; duplicate or invalid checkpoint scans cannot create an extra valid visit. Checkpoint completion is evaluated independently of visit order.

- **CAP-6 — Organizer map endpoint**
  - **intent:** Authorized organizer tools can obtain current race, checkpoint, rider-location, and active-incident data through an endpoint suitable for rendering a live map.
  - **success:** The endpoint returns only data for the authorized race and makes active riders and unresolved alerts distinguishable in a map client.

## Constraints

- The product is mobile-first because GPS sharing and QR scanning happen from the rider's phone during a street race.
- The course has no prescribed route or checkpoint order; routing, turn-by-turn navigation, and ordered progression must not be required for participation or scoring.
- Location sharing is limited to an active participation session for the relevant race and must be visible to the rider as an intentional state.
- Emergency and location data are sensitive personal data; access must be limited to authorized race administrators and retained only according to a defined policy.
- The app must communicate location freshness and loss of connectivity so an administrator does not mistake a stale coordinate for a rider's current position.

## Non-goals

- Automatically determining the fastest route, enforcing a route, or providing navigation.
- Replacing public emergency services, dispatching medical professionals, or diagnosing injuries.
- Building a public rider-tracking feed or exposing emergency contacts to other riders.
- Automating official race scoring beyond recording verified checkpoint visits in the first release.

## Success signal

- In a simulated race, an organizer can create a race, invite riders, observe active riders on a map, receive both alert types with usable last-known locations, and see QR-verified checkpoint visits in arbitrary order.
- During a connectivity loss or a rider-requested alert, the organizer can distinguish current GPS data from last-known data and access the minimum information needed to coordinate help.

## Assumptions

- The first release supports one organizer-managed race at a time per rider and uses smartphone GPS and camera access.
- Administrators are trusted event staff who have a legitimate operational need to see active locations and emergency details.
- Checkpoint QR codes are physically displayed at checkpoints and can be signed or otherwise validated by the backend.

## Open Questions

- Which jurisdictions, consent language, retention period, and deletion/export rights must apply to location and emergency-contact data?
- What is the exact activation radius around the start area, and what should happen when GPS accuracy is worse than that radius?
- Which delivery channels and escalation rules are required for alerts: in-app dashboard, push notification, SMS, phone call, or all of these?
- Should a rider be able to pause, resume, or end location sharing before the race window ends, and how should that appear to organizers?
- What happens when a rider is offline: queue alerts and QR checks locally, send an SMS fallback, or both?
- What identity and invitation method will be used (email, phone number, share link, or existing account)?
