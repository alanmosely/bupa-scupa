import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, atomicWrite } from './util.js';
import { validateQuery, validateFollowUp } from './claims.js';
import { ScupaError } from './errors.js';

/** @typedef {{id: string, name: string, query: import('./claims.js').ClaimQuery}} SavedView */
/** @typedef {{schemaVersion: number, followUps: Record<string, import('./claims.js').FollowUp>, savedViews: SavedView[]}} Workspace */
const file = path.join(DATA, 'workspace.json');
/** @returns {Workspace} */
export function loadWorkspace() {
  if (!fs.existsSync(file)) return { schemaVersion: 1, followUps: {}, savedViews: [] };
  if (fs.lstatSync(file).isSymbolicLink())
    throw new Error('Linked workspace settings are not supported.');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    state.schemaVersion !== 1 ||
    !state.followUps ||
    typeof state.followUps !== 'object' ||
    Array.isArray(state.followUps) ||
    !Array.isArray(state.savedViews) ||
    state.savedViews.length > 30
  )
    throw new Error('Invalid workspace.json. Keep this file and restore a private backup.');
  for (const [ref, followUp] of Object.entries(state.followUps)) {
    if (!/^CL\d{12}$/.test(ref)) throw new Error('Invalid follow-up reference.');
    validateFollowUp(followUp);
  }
  const ids = new Set();
  for (const view of state.savedViews) {
    if (
      !view ||
      typeof view.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(view.id) ||
      ids.has(view.id)
    )
      throw new Error('Invalid saved view.');
    ids.add(view.id);
    validateViewName(view.name);
    validateQuery(view.query);
  }
  return state;
}
/** Caller holds the archive lock; records and PDFs are never changed here. */
export function storeFollowUp(claimRef, followUp) {
  validateFollowUp(followUp);
  const state = loadWorkspace();
  state.followUps[claimRef] = followUp;
  atomicWrite(file, JSON.stringify(state, null, 2) + '\n');
}
function validateViewName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\x00-\x1f]/.test(name))
    throw new ScupaError('INVALID_INPUT', 'Give this view a name up to 60 characters.');
}
/** Caller holds the archive lock. */
export function saveView(name, query) {
  validateViewName(name);
  query = validateQuery(query);
  const state = loadWorkspace();
  if (state.savedViews.length >= 30)
    throw new ScupaError(
      'INVALID_INPUT',
      'Remove a saved view before adding another (maximum 30).',
    );
  const view = { id: crypto.randomUUID(), name: name.trim(), query };
  state.savedViews.push(view);
  atomicWrite(file, JSON.stringify(state, null, 2) + '\n');
  return view;
}
/** Caller holds the archive lock. */
export function removeView(id) {
  const state = loadWorkspace();
  if (typeof id !== 'string' || !state.savedViews.some((view) => view.id === id))
    throw new ScupaError('INVALID_INPUT', 'Choose an existing saved view.');
  state.savedViews = state.savedViews.filter((view) => view.id !== id);
  atomicWrite(file, JSON.stringify(state, null, 2) + '\n');
}
