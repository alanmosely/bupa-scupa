import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { BUPA_ORIGIN, HEADERS } from './model.js';
export { HEADERS };

export const DATA = path.resolve(
  process.env.SCUPA_DATA_DIR || path.join(os.homedir(), 'Documents', 'BUPA SCUPA'),
);
export const RAW = path.join(DATA, 'raw');
export const MASTER = path.join(DATA, 'master', 'claims.csv');
export const PARSED = path.join(DATA, 'parsed.json');
export const REPORTS = path.join(DATA, 'reports');
export const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
export function atomicWrite(file, contents) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
/** @returns {import('./model.js').Household} */
export function loadConfig() {
  const file = path.join(DATA, 'household.json');
  const cfg = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {
        schemaVersion: 1,
        baseUrl: BUPA_ORIGIN,
        members: {},
        watchlist: [],
      };
  if (
    cfg.schemaVersion !== 1 ||
    cfg.baseUrl !== BUPA_ORIGIN ||
    !cfg.members ||
    Array.isArray(cfg.members) ||
    typeof cfg.members !== 'object'
  )
    throw new Error('Unsupported or invalid household configuration.');
  for (const [id, member] of Object.entries(cfg.members)) {
    if (
      !/^[a-z0-9_]{1,64}$/.test(id) ||
      !member ||
      typeof member.displayName !== 'string' ||
      !member.displayName.trim() ||
      member.displayName.length > 100 ||
      /[\x00-\x1f]/.test(member.displayName)
    )
      throw new Error('Invalid member configuration.');
  }
  const members = Object.values(cfg.members);
  if (
    members.length > 30 ||
    (members.length && members.filter((m) => m.self === true).length !== 1) ||
    (members.length && members[0].self !== true)
  )
    throw new Error('The household must list one account holder first.');
  if (new Set(members.map((m) => m.displayName.trim().toLowerCase())).size !== members.length)
    throw new Error('Member names must be distinct.');
  return cfg;
}
export function saveConfig(cfg) {
  atomicWrite(path.join(DATA, 'household.json'), JSON.stringify(cfg, null, 2) + '\n');
}
export const memberOrder = (cfg) => Object.keys(cfg.members);
export function refToDate(ref) {
  const m = /^CL(\d{2})(\d{2})(\d{2})\d{6}$/.exec(ref || '');
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : '';
}
export function sinceFromRef(ref, overlapDays) {
  const iso = refToDate(ref);
  if (!iso) return '000000';
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return d.toISOString().slice(2, 10).replaceAll('-', '');
}
export function ddmmyyyyToIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
export const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');
export const parseMoney = (s) => parseFloat(String(s).replace(/[£€$,\s]/g, ''));
export function fmtMoney(n) {
  if (n === '' || n == null || Number.isNaN(n)) return '';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
}
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const nowStamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
