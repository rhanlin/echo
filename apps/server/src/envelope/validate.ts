/**
 * Hand-written envelope validator. Mirrors the JSON Schema in
 * `packages/envelope/envelope.schema.json`. The schema is the canonical
 * contract; this validator exists for runtime checks without pulling a
 * schema-validation dep into the production path.
 *
 * Spec coverage: see `specs/event-envelope/spec.md`.
 *
 * Re-evaluation trigger: if this file grows past ~80 LoC of validation logic,
 * swap to zod (per design D8).
 */

import type {
  EventEnvelope,
  HitlCallback,
  HumanInTheLoop,
} from '@echo/envelope';

export type ValidationResult =
  | { ok: true; envelope: EventEnvelope }
  | { ok: false; error: string };

export function validateEnvelope(input: unknown): ValidationResult {
  if (!isObject(input)) return fail('envelope must be a JSON object');

  // Versioning
  if (!('envelope_version' in input)) return fail('missing envelope_version');
  if (input.envelope_version !== 1) {
    return fail(`unsupported envelope_version: ${String(input.envelope_version)}`);
  }

  // Required non-empty strings
  for (const f of [
    'agent_kind',
    'agent_version',
    'source_app',
    'session_id',
    'event_type',
    'raw_event_type',
  ] as const) {
    const value = input[f];
    if (typeof value !== 'string') return fail(`missing or non-string ${f}`);
    if (value.length === 0) return fail(`${f} must be non-empty`);
  }

  if (!('payload' in input)) return fail('missing payload');
  if (!isObject(input.payload)) return fail('payload must be an object');

  if ('timestamp' in input && input.timestamp !== undefined) {
    if (!Number.isInteger(input.timestamp) || (input.timestamp as number) < 0) {
      return fail('timestamp must be a non-negative integer');
    }
  }

  if ('human_in_the_loop' in input && input.human_in_the_loop !== undefined) {
    const hitlErr = validateHitl(input.human_in_the_loop);
    if (hitlErr) return fail(hitlErr);
  }

  if ('transcript_ref' in input && input.transcript_ref !== undefined) {
    const ref = input.transcript_ref;
    if (!isObject(ref)) return fail('transcript_ref must be an object');
    if (ref.kind !== 'file' && ref.kind !== 'url') {
      return fail('transcript_ref.kind must be "file" or "url"');
    }
    if (typeof ref.location !== 'string' || ref.location.length === 0) {
      return fail('transcript_ref.location must be a non-empty string');
    }
  }

  return { ok: true, envelope: input as unknown as EventEnvelope };
}

function validateHitl(value: unknown): string | null {
  if (!isObject(value)) return 'human_in_the_loop must be an object';
  const hitl = value as Partial<HumanInTheLoop> & Record<string, unknown>;

  if (typeof hitl.question !== 'string' || hitl.question.length === 0) {
    return 'human_in_the_loop.question must be a non-empty string';
  }
  if (
    hitl.type !== 'question' &&
    hitl.type !== 'permission' &&
    hitl.type !== 'choice'
  ) {
    return 'human_in_the_loop.type must be one of question | permission | choice';
  }
  if (hitl.type === 'choice') {
    if (!Array.isArray(hitl.choices) || hitl.choices.length === 0) {
      return 'human_in_the_loop.choices must be a non-empty array when type is "choice"';
    }
    if (!hitl.choices.every((c) => typeof c === 'string')) {
      return 'human_in_the_loop.choices must contain only strings';
    }
  }
  if (
    hitl.timeout !== undefined &&
    (!Number.isInteger(hitl.timeout) || (hitl.timeout as number) < 0)
  ) {
    return 'human_in_the_loop.timeout must be a non-negative integer';
  }

  return validateCallback(hitl.callback);
}

function validateCallback(value: unknown): string | null {
  if (!isObject(value)) return 'human_in_the_loop.callback must be an object';
  const cb = value as Partial<HitlCallback> & Record<string, unknown>;
  if (cb.kind !== 'websocket' && cb.kind !== 'webhook') {
    return 'human_in_the_loop.callback.kind must be "websocket" or "webhook"';
  }
  if (typeof cb.url !== 'string' || cb.url.length === 0) {
    return 'human_in_the_loop.callback.url must be a non-empty string';
  }
  if (cb.kind === 'webhook' && cb.method !== undefined) {
    if (cb.method !== 'POST' && cb.method !== 'PUT') {
      return 'human_in_the_loop.callback.method must be POST or PUT';
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): ValidationResult {
  return { ok: false, error };
}
