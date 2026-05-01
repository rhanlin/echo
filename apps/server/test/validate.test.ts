import { describe, expect, test } from 'bun:test';
import { Validator } from '@cfworker/json-schema';
import schema from '../../../packages/envelope/envelope.schema.json' with {
  type: 'json',
};
import validFixtures from '../../../packages/envelope/fixtures/valid-envelopes.json' with {
  type: 'json',
};
import invalidFixtures from '../../../packages/envelope/fixtures/invalid-envelopes.json' with {
  type: 'json',
};
import { validateEnvelope } from '../src/envelope/validate';

interface Fixture {
  name: string;
  envelope: unknown;
}

const schemaValidator = new Validator(schema as object, '2020-12');

describe('envelope validator vs JSON Schema', () => {
  for (const fixture of validFixtures as Fixture[]) {
    test(`valid: ${fixture.name}`, () => {
      const inline = validateEnvelope(fixture.envelope);
      expect(inline.ok).toBe(true);

      const schemaResult = schemaValidator.validate(fixture.envelope);
      expect(schemaResult.valid).toBe(true);
    });
  }

  for (const fixture of invalidFixtures as Fixture[]) {
    test(`invalid: ${fixture.name}`, () => {
      const inline = validateEnvelope(fixture.envelope);
      expect(inline.ok).toBe(false);

      const schemaResult = schemaValidator.validate(fixture.envelope);
      expect(schemaResult.valid).toBe(false);
    });
  }
});
