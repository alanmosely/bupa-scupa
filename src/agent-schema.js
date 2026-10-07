// JSON Schema draft-07 contracts for scripts and agents. No runtime validator required.
import { HEADERS } from './core/model.js';
const string = { type: 'string' };
const count = { type: 'integer', minimum: 0 };
const strings = { type: 'array', items: string };
const object = (properties, required = Object.keys(properties), additionalProperties = false) => ({
  type: 'object',
  properties,
  required,
  additionalProperties,
});
const array = (items) => ({ type: 'array', items });
export const COMMANDS = ['schema', 'status', 'claims', 'report', 'parse', 'sync'];
const member = object(
  { displayName: string, self: { type: 'boolean' }, needsConfirmation: { type: 'boolean' } },
  ['displayName'],
);
const members = { type: 'object', additionalProperties: member };
const row = object(Object.fromEntries(HEADERS.map((key) => [key, string])));
row.properties.currency = { ...string, description: 'Currency of the claimed amount.' };
row.properties.paid_currency = { ...string, description: 'Currency of the paid amount.' };
const totals = {
  type: 'object',
  description:
    'Amounts grouped by their own currency. A converted claim contributes to two currency groups; claims counts must not be summed across groups.',
  additionalProperties: object({
    claimed: { type: 'number' },
    paid: { type: 'number' },
    claims: count,
  }),
};
const timestamp = { type: ['string', 'null'] };
const change = object({
  member: string,
  claim_ref: string,
  diffs: array(object({ field: string, from: string, to: string })),
});
const parsed = object({ statements: count, duplicates: count, stubs: count, errors: strings });
const parse = object({
  added: count,
  updated: count,
  changes: object({ added: array(row), updated: array(change) }),
  warnings: strings,
  parsed,
  dryRun: { type: 'boolean' },
});
const results = {
  schema: object({
    schemaVersion: { const: 1 },
    application: { const: 'bupa-scupa' },
    version: string,
    commands: { type: 'object' },
    options: strings,
    exitCodes: { type: 'object' },
    schemas: { type: 'object' },
  }),
  status: object({
    schemaVersion: { const: 1 },
    configured: { type: 'boolean' },
    dataDir: string,
    members: array(object({ id: string, displayName: string })),
    claimCount: count,
    lastSync: timestamp,
    locked: { type: 'boolean' },
  }),
  claims: object({ members, rows: array(row) }),
  report: object({ totals, awaiting: count, lastSync: timestamp, claimCount: count }),
  parse,
  sync: object({ ...parse.properties, fetched: array(object({ member: string, claims: count })) }),
};
const schema = (value) => ({ $schema: 'http://json-schema.org/draft-07/schema#', ...value });
const error = object({ code: string, message: string, retryable: { type: 'boolean' } });
const base = {
  schemaVersion: { const: 1 },
  application: { const: 'bupa-scupa' },
  command: string,
  jobId: string,
};
export const responseSchemas = Object.fromEntries(
  COMMANDS.map((command) => [
    command,
    schema({
      oneOf: [
        object(
          { ...base, command: { const: command }, ok: { const: true }, result: results[command] },
          ['schemaVersion', 'application', 'command', 'ok', 'result'],
        ),
        object({ ...base, command: { enum: [command, 'unknown'] }, ok: { const: false }, error }, [
          'schemaVersion',
          'application',
          'command',
          'ok',
          'error',
        ]),
      ],
    }),
  ]),
);
export const requestSchemas = Object.fromEntries(
  COMMANDS.map((command) => [
    command,
    schema(
      object({
        command: { const: command },
        options: object(
          {
            dataDir: string,
            output: string,
            events: string,
            ...(command === 'claims' ? { member: string } : {}),
            ...(command === 'parse' ? { dryRun: { type: 'boolean' } } : {}),
            ...(command === 'sync' ? { fullRefresh: { type: 'boolean' } } : {}),
          },
          [],
        ),
      }),
    ),
  ]),
);
export const eventSchema = schema(
  object(
    {
      schemaVersion: { const: 1 },
      application: { const: 'bupa-scupa' },
      jobId: string,
      sequence: { type: 'integer', minimum: 1 },
      time: string,
      command: { enum: COMMANDS },
      state: { enum: ['running', 'waiting_for_human', 'succeeded', 'failed', 'cancelled'] },
      phase: {
        enum: [
          'starting',
          'agent',
          'setup',
          'login',
          'confirm',
          'member',
          'download',
          'parse',
          'complete',
        ],
      },
      humanAction: {
        enum: ['START_SYNC', 'SETUP_HOUSEHOLD', 'LOGIN_MFA', 'CONFIRM_HOUSEHOLD', 'CONFIRM_MEMBER'],
      },
      current: count,
      total: count,
      errorCode: string,
    },
    ['schemaVersion', 'application', 'jobId', 'sequence', 'time', 'command', 'state', 'phase'],
  ),
);
