import { describe, expect, test, beforeEach } from 'bun:test';
import { register, wake, count } from '../src/hitl/waiters';

// Reset the module-level map between tests by exhausting all registered waiters.
// Since the map is module-level, we drain it by calling each test's cleanup fns.
// Individual tests are responsible for cleaning up their own registrations.

describe('waiters', () => {
  // Ensure a clean slate: call cleanup on any stray registrations by always
  // verifying count() === 0 at the start of each test through test design.

  test('register + wake calls resolver with response', async () => {
    const responses: object[] = [];
    register(1, (r) => responses.push(r));

    wake(1, { permission: true });

    expect(responses).toEqual([{ permission: true }]);
    expect(count(1)).toBe(0);
  });

  test('register + cleanup: wake does not call the resolver', () => {
    const responses: object[] = [];
    const cleanup = register(2, (r) => responses.push(r));

    cleanup();
    wake(2, { permission: true });

    expect(responses).toHaveLength(0);
    expect(count(2)).toBe(0);
  });

  test('two resolvers on same id are both woken', () => {
    const a: object[] = [];
    const b: object[] = [];
    register(3, (r) => a.push(r));
    register(3, (r) => b.push(r));

    wake(3, { choice: 'yes' });

    expect(a).toEqual([{ choice: 'yes' }]);
    expect(b).toEqual([{ choice: 'yes' }]);
    expect(count(3)).toBe(0);
  });

  test('wake is a no-op when no waiters are registered', () => {
    // Should not throw
    wake(9999, { permission: false });
    expect(count(9999)).toBe(0);
  });

  test('cleanup after wake is safe (no-op)', () => {
    const cleanup = register(4, () => {});
    wake(4, {});
    // Should not throw
    cleanup();
    expect(count(4)).toBe(0);
  });

  test('count returns total across all events when called without argument', () => {
    const c1 = register(10, () => {});
    const c2 = register(11, () => {});
    const c3 = register(11, () => {});

    const total = count();
    expect(total).toBeGreaterThanOrEqual(3);

    c1(); c2(); c3();
    // After cleanup, these specific entries are gone
    expect(count(10)).toBe(0);
    expect(count(11)).toBe(0);
  });

  test('10k register-then-cancel cycle leaves no leaks', () => {
    const cleanups: Array<() => void> = [];
    const BASE_ID = 1_000_000;
    for (let i = 0; i < 10_000; i++) {
      cleanups.push(register(BASE_ID + i, () => {}));
    }
    for (const cleanup of cleanups) cleanup();

    for (let i = 0; i < 10_000; i++) {
      expect(count(BASE_ID + i)).toBe(0);
    }
  });
});
