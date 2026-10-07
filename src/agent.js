import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { requestSchemas, responseSchemas, eventSchema } from './agent-schema.js';
import { VERSION } from './version.js';

export const API = {
  schemaVersion: 1,
  application: 'bupa-scupa',
  version: VERSION,
  commands: {
    schema: { access: 'read', description: 'Describe this local API.' },
    status: { access: 'read', description: 'Archive status and member identifiers.' },
    claims: { access: 'read', description: 'Structured claim rows; optional --member ID.' },
    report: { access: 'read', description: 'Currency totals and awaiting assessment count.' },
    parse: {
      access: 'write',
      description: 'Reparse archived PDFs; --dry-run prevents master changes.',
    },
    sync: {
      access: 'write',
      description:
        'Open the desktop app for manual login and member confirmation; --full-refresh rechecks all available claims. Portable executable only.',
    },
  },
  options: [
    '--data-dir ABSOLUTE_PATH',
    '--output ABSOLUTE_PATH',
    '--events ABSOLUTE_PATH',
    '--member MEMBER_ID',
    '--dry-run',
    '--full-refresh',
  ],
  exitCodes: {
    0: 'success',
    1: 'operation failed',
    2: 'invalid input',
    3: 'human action required',
    4: 'busy',
    5: 'cancelled',
  },
  schemas: { requests: requestSchemas, responses: responseSchemas, event: eventSchema },
};
export function parseArgs(args) {
  const command = args.shift() || 'schema';
  const options = {};
  try {
    for (let i = 0; i < args.length; i++) {
      const option = args[i];
      if (option === '--json') continue;
      if (option === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (option === '--full-refresh') {
        options.fullRefresh = true;
        continue;
      }
      const key = {
        '--data-dir': 'dataDir',
        '--output': 'output',
        '--events': 'events',
        '--member': 'member',
      }[option];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--'))
        throw Object.assign(new Error('Unrecognised or incomplete argument: ' + option), {
          code: 'INVALID_INPUT',
        });
      if (Object.hasOwn(options, key))
        throw Object.assign(new Error('Repeated argument: ' + option), { code: 'INVALID_INPUT' });
      options[key] = args[++i];
    }
    if (!Object.hasOwn(API.commands, command))
      throw Object.assign(new Error('Unknown command.'), { code: 'INVALID_INPUT' });
    for (const key of ['dataDir', 'output', 'events'])
      if (options[key] && !path.isAbsolute(options[key]))
        throw Object.assign(new Error(key + ' must be an absolute path.'), {
          code: 'INVALID_INPUT',
        });
    if (options.member && command !== 'claims')
      throw Object.assign(new Error('--member is supported by claims only.'), {
        code: 'INVALID_INPUT',
      });
    if (options.dryRun && command !== 'parse')
      throw Object.assign(new Error('--dry-run is supported by parse only.'), {
        code: 'INVALID_INPUT',
      });
    if (options.fullRefresh && command !== 'sync')
      throw Object.assign(new Error('--full-refresh is supported by sync only.'), {
        code: 'INVALID_INPUT',
      });
    return { command, options };
  } catch (error) {
    error.options = Object.fromEntries(
      ['dataDir', 'output']
        .filter((key) => typeof options[key] === 'string' && path.isAbsolute(options[key]))
        .map((key) => [key, options[key]]),
    );
    throw error;
  }
}
export function envelope(command, result, error) {
  return {
    schemaVersion: 1,
    application: 'bupa-scupa',
    command,
    ok: !error,
    ...(error
      ? {
          error: {
            code: error.code || 'OPERATION_FAILED',
            message: error.message,
            retryable: ['BUSY', 'LOGIN_TIMEOUT', 'BROWSER_CLOSED'].includes(error.code),
          },
        }
      : { result }),
  };
}
export function exitCode(error) {
  return !error
    ? 0
    : { INVALID_INPUT: 2, HUMAN_ACTION_REQUIRED: 3, SETUP_REQUIRED: 3, BUSY: 4, CANCELLED: 5 }[
        error.code
      ] || 1;
}
export async function execute(command, options = {}) {
  if (command === 'schema') return API;
  if (options.dataDir) process.env.SCUPA_DATA_DIR = options.dataDir;
  process.env.SCUPA_PDFTOTEXT ||= path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../vendor/xpdf/pdftotext.exe',
  );
  const service = await import('./core/service.js');
  if (command === 'status') return service.status();
  if (command === 'claims') {
    const data = service.snapshot();
    if (options.member && !Object.hasOwn(data.members, options.member))
      throw new service.ScupaError('INVALID_INPUT', 'Unknown member identifier.');
    return {
      members: options.member ? { [options.member]: data.members[options.member] } : data.members,
      rows: options.member ? data.rows.filter((r) => r.member === options.member) : data.rows,
    };
  }
  if (command === 'report') {
    const { totals, awaiting, lastSync, rows } = service.snapshot();
    return { totals, awaiting, lastSync, claimCount: rows.length };
  }
  if (command === 'parse') {
    const release = service.acquireLock();
    try {
      return service.reparse({ dryRun: options.dryRun });
    } finally {
      release();
    }
  }
  throw new service.ScupaError(
    'HUMAN_ACTION_REQUIRED',
    'Run the portable executable with --agent sync to open the desktop app for login.',
  );
}
function canonicalPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file ? file : path.join(canonicalPath(parent), path.basename(file));
}
function reserveFile(file, dataDir) {
  if (!path.isAbsolute(file))
    throw Object.assign(new Error('Output paths must be absolute.'), { code: 'INVALID_INPUT' });
  const absolute = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  const archive = canonicalPath(
    path.resolve(
      dataDir ||
        process.env.SCUPA_DATA_DIR ||
        path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'BUPA SCUPA'),
    ),
  );
  const relative = path.relative(archive, absolute);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  ) {
    throw Object.assign(new Error('Write responses and events outside the health archive.'), {
      code: 'INVALID_INPUT',
    });
  }
  return fs.openSync(absolute, 'wx', 0o600);
}
export function reserveResult(output, dataDir) {
  let fd = output ? reserveFile(output, dataDir) : null;
  let used = false;
  return {
    write(value) {
      if (used) throw new Error('Response has already been written.');
      used = true;
      const text = JSON.stringify(value, null, 2) + '\n';
      try {
        if (fd !== null) fs.writeFileSync(fd, text);
      } finally {
        if (fd !== null) {
          fs.closeSync(fd);
          fd = null;
        }
      }
      return text;
    },
  };
}
export function writeResult(output, value, dataDir) {
  return reserveResult(output, dataDir).write(value);
}
export function createAgentSession(command, options = {}, dataDir) {
  const result = reserveResult(options.output, dataDir);
  /** @type {number | null} */
  let events = null;
  try {
    if (options.events) events = reserveFile(options.events, dataDir);
  } catch (error) {
    result.write(envelope(command, null, error));
    throw error;
  }
  const jobId = randomUUID();
  let sequence = 0;
  let finished = false;
  /** @param {{phase?: string, state?: string, humanAction?: string, current?: number, total?: number, errorCode?: string}} [details] */
  const event = ({
    phase = 'starting',
    state = 'running',
    humanAction,
    current,
    total,
    errorCode,
  } = {}) => {
    if (finished || events === null) return;
    const value = {
      schemaVersion: 1,
      application: 'bupa-scupa',
      jobId,
      sequence: ++sequence,
      time: new Date().toISOString(),
      command,
      state,
      phase,
      ...(humanAction ? { humanAction } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(typeof current === 'number' && Number.isInteger(current) && current >= 0
        ? { current }
        : {}),
      ...(typeof total === 'number' && Number.isInteger(total) && total >= 0 ? { total } : {}),
    };
    // Events contain only control information, never portal text or member names.
    try {
      fs.writeSync(events, JSON.stringify(value) + '\n');
    } catch {
      fs.closeSync(events);
      events = null;
      process.stderr.write('Progress events could not be written. Check the final response.\n');
    }
  };
  return {
    jobId,
    event,
    finish(value, error) {
      if (finished) return '';
      event({
        phase: 'complete',
        state: error ? (error.code === 'CANCELLED' ? 'cancelled' : 'failed') : 'succeeded',
        errorCode: error?.code,
      });
      finished = true;
      try {
        return result.write({ ...envelope(command, value, error), jobId });
      } finally {
        if (events !== null) {
          fs.closeSync(events);
          events = null;
        }
      }
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  let result;
  let error;
  let agentSession;
  try {
    parsed = parseArgs(process.argv.slice(2));
    agentSession = createAgentSession(parsed.command, parsed.options, parsed.options.dataDir);
    agentSession.event();
    result = await execute(parsed.command, parsed.options);
  } catch (e) {
    error = e;
  }
  try {
    if (agentSession) process.stdout.write(agentSession.finish(result, error));
    else if (!parsed)
      process.stdout.write(
        writeResult(
          error?.options?.output,
          envelope('unknown', null, error),
          error?.options?.dataDir,
        ),
      );
    else process.stdout.write(JSON.stringify(envelope(parsed.command, null, error)) + '\n');
  } catch (e) {
    process.stderr.write(e.message + '\n');
    error = e;
  }
  process.exitCode = exitCode(error);
}
