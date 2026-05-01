## ADDED Requirements

### Requirement: Broadcaster interface

The system SHALL define a `Broadcaster` interface with the operations: `subscribe(client) → unsubscribe`, `publish(event)`, and `snapshot() → StoredEvent[]`. The `event-ingestion` capability SHALL depend on this interface and not on its concrete implementation.

#### Scenario: Server uses interface, not implementation

- **WHEN** the server module imports broadcasting capability
- **THEN** it imports the `Broadcaster` interface and is wired with a concrete implementation only at the composition root (process entry)

### Requirement: WebSocket subscription endpoint

The server SHALL expose a WebSocket endpoint at `/stream`. On a successful upgrade, the client SHALL receive an initial snapshot message of the most recent events, followed by live event messages as they arrive.

#### Scenario: Initial snapshot on connect

- **WHEN** a client connects to `/stream`
- **THEN** the server sends one message of the form `{ type: "snapshot", data: StoredEvent[] }` containing the most recent events ordered oldest-to-newest

#### Scenario: Live event push

- **WHEN** an event is ingested via `POST /events` after a client is subscribed
- **THEN** that client receives a `{ type: "event", data: StoredEvent }` message

#### Scenario: HITL response broadcast

- **WHEN** a HITL response is recorded via `POST /events/:id/respond`
- **THEN** all subscribed clients receive a `{ type: "event", data: <updated StoredEvent> }` message reflecting the new HITL status

### Requirement: Dead-connection cleanup

The broadcaster SHALL detect failed sends and remove the failing client from its subscriber set. Subsequent broadcasts SHALL not attempt to deliver to removed clients.

#### Scenario: Send failure removes client

- **WHEN** `publish` is called and one client's send raises an exception
- **THEN** the broadcaster catches the exception, removes that client from its set, logs the disconnect, and successfully delivers to remaining clients

#### Scenario: Explicit close removes client

- **WHEN** a client cleanly closes its WebSocket
- **THEN** the broadcaster's `close` handler removes it from the subscriber set within the same tick

### Requirement: Snapshot size and ordering

The initial snapshot SHALL contain at most `WS_SNAPSHOT_LIMIT` events (default 300, configurable via env var). Events SHALL be ordered by `timestamp` ascending so a Dashboard can render them top-to-bottom in chronological order.

#### Scenario: Configurable snapshot limit

- **WHEN** `WS_SNAPSHOT_LIMIT=50` is set and a client connects to `/stream`
- **THEN** the snapshot contains at most 50 events

#### Scenario: Chronological order

- **WHEN** the snapshot is delivered
- **THEN** for any two adjacent events, `events[i].timestamp <= events[i+1].timestamp`

### Requirement: In-memory implementation for v1

The v1 release SHALL ship an `InMemoryBroadcaster` class that maintains a `Set` of WebSocket clients in process memory. The system SHALL NOT ship a Redis-backed implementation in v1, but the interface boundary SHALL allow one to be added without changes to the ingestion or HTTP layers.

#### Scenario: Multi-replica swap is localized

- **WHEN** a future change replaces `InMemoryBroadcaster` with `RedisPubSubBroadcaster`
- **THEN** no file outside `apps/server/src/broadcast/` and the composition root needs to change
