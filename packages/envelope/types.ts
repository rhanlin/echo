/**
 * Envelope v1 — wire contract every adapter MUST produce when posting events.
 *
 * This file is hand-written; the JSON Schema in `envelope.schema.json` mirrors
 * these types and is the canonical contract for non-TypeScript adapters.
 * A test fixture corpus (`fixtures/`) verifies the two stay in sync.
 */

// ============================================================================
// Top-level envelope
// ============================================================================

export interface EventEnvelope {
  /** Envelope schema version. Bumped only on breaking changes. */
  envelope_version: 1;

  /** Identifies the originating agent kind. Free string; conventionally one of:
   *  "claude-code" | "gemini-cli" | "codex" | "cursor" | ... */
  agent_kind: string;

  /** Adapter's self-reported version (semver). Diagnostic only. */
  agent_version: string;

  /** User-defined project/app identifier. e.g. "my-backend". */
  source_app: string;

  /** Session identifier from the agent. Together with agent_kind + source_app
   *  uniquely identifies an agent run. */
  session_id: string;

  /** Milliseconds since epoch. If omitted, server fills receive time. */
  timestamp?: number;

  /** Normalized event type. Free string; SUGGESTED values live in
   *  CANONICAL_EVENT_TYPES. Use "unknown" if no mapping fits. */
  event_type: string;

  /** Original event name from the agent's native hook system. */
  raw_event_type: string;

  /** Original payload from the agent, untouched. */
  payload: Record<string, unknown>;

  /** Adapter-extracted convenience fields. Server treats as opaque JSON. */
  normalized?: NormalizedFields;

  /** Adapter-generated short summary (e.g. via LLM). */
  summary?: string;

  /** Conversation transcript. Inline ONLY for terminal events. */
  transcript?: TranscriptMessage[];

  /** Pointer to a transcript when not inlined. */
  transcript_ref?: TranscriptRef;

  /** Human-in-the-loop request, if this event blocks on human response. */
  human_in_the_loop?: HumanInTheLoop;
}

// ============================================================================
// Optional sub-shapes
// ============================================================================

export interface NormalizedFields {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  user_prompt?: string;
  model_name?: string;
  cwd?: string;
  error?: { message: string; code?: string };
}

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown;
  timestamp?: number;
}

export interface TranscriptRef {
  kind: 'file' | 'url';
  location: string;
}

// ============================================================================
// Human-in-the-loop
// ============================================================================

export interface HumanInTheLoop {
  question: string;
  type: 'question' | 'permission' | 'choice';
  /** Required when type === 'choice'. */
  choices?: string[];
  /** Whether the agent is blocking. Conceptually always true in v1. */
  requires_response?: boolean;
  /** Optional timeout in seconds. Server may auto-resolve as 'timeout'. */
  timeout?: number;
  /** How the server delivers the human's response back to the agent. */
  callback: HitlCallback;
}

export type HitlCallback =
  | { kind: 'websocket'; url: string }
  | { kind: 'webhook'; url: string; method?: 'POST' | 'PUT' }
  | { kind: 'polling' };

export interface HumanInTheLoopResponse {
  response?: string;
  permission?: boolean;
  choice?: string;
  responded_by?: string;
  /** Server-filled. */
  responded_at?: number;
}

export interface HumanInTheLoopStatus {
  status: 'pending' | 'responded' | 'timeout' | 'error';
  responded_at?: number;
  response?: HumanInTheLoopResponse;
  /** When status === 'error', a short reason. */
  error?: string;
}

// ============================================================================
// Server-side stored event (what the API and WebSocket return)
// ============================================================================

export interface StoredEvent extends EventEnvelope {
  /** Auto-increment server id. */
  id: number;
  /** Always populated server-side. */
  timestamp: number;
  /** Tracking for HITL flow, set when human_in_the_loop is present. */
  human_in_the_loop_status?: HumanInTheLoopStatus;
}
