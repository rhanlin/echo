/**
 * Canonical normalized event type vocabulary.
 *
 * Adapters SHOULD map their native events to these values when possible and
 * use "unknown" otherwise. The server treats this list as a hint, not a
 * constraint — non-canonical values are accepted (and logged) so adapters
 * can ship before the vocabulary catches up.
 */
export const CANONICAL_EVENT_TYPES = [
  // session lifecycle
  'session.start',
  'session.end',

  // user input
  'user.prompt.submit',

  // tool lifecycle
  'tool.pre_use',
  'tool.post_use',
  'tool.failure',

  // agent signals
  'agent.notification',
  'agent.stop',
  'agent.precompact',

  // sub-agent lifecycle
  'subagent.start',
  'subagent.stop',

  // catch-all
  'unknown',
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_EVENT_TYPES);

export function isCanonicalEventType(value: string): value is CanonicalEventType {
  return CANONICAL_SET.has(value);
}
