import { CLAIM_STATUS } from './model.js';
import { ScupaError } from './errors.js';

/** @typedef {{notes: string, chasedOn: string, followUpOn: string, pinned: boolean, reviewed: boolean, assessmentKey?: string}} FollowUp */
/** @typedef {{search?: string, member?: string, status?: string, provider?: string, from?: string, to?: string, dateField?: string, sort?: string, direction?: string, view?: string}} ClaimQuery */
export const DATE_FIELDS = ['received_date', 'treatment_date', 'payment_date'];
export const SORT_FIELDS = [...DATE_FIELDS, 'member', 'provider', 'claimed', 'paid', 'status'];
const statuses = {
  awaiting: CLAIM_STATUS.awaiting,
  partial: CLAIM_STATUS.partial,
  rejected: CLAIM_STATUS.rejected,
  paid: CLAIM_STATUS.paid,
  duplicate: CLAIM_STATUS.duplicate,
  planRate: CLAIM_STATUS.planRate,
};
export const emptyFollowUp = () => ({
  notes: '',
  chasedOn: '',
  followUpOn: '',
  pinned: false,
  reviewed: false,
});
export function validDate(value) {
  return (
    typeof value === 'string' &&
    (value === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value))
  );
}
export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
/** @param {ClaimQuery} query */
export function validateQuery(query = {}) {
  const text = [
    'search',
    'member',
    'status',
    'provider',
    'from',
    'to',
    'dateField',
    'sort',
    'direction',
    'view',
  ];
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.entries(query).some(
      ([key, value]) => !text.includes(key) || typeof value !== 'string' || value.length > 500,
    ) ||
    !validDate(query.from || '') ||
    !validDate(query.to || '') ||
    (query.from && query.to && query.from > query.to) ||
    (query.status && !Object.hasOwn(statuses, query.status)) ||
    (query.dateField && !DATE_FIELDS.includes(query.dateField)) ||
    (query.sort && !SORT_FIELDS.includes(query.sort)) ||
    (query.direction && !['asc', 'desc'].includes(query.direction)) ||
    (query.view && !['all', 'attention'].includes(query.view))
  )
    throw new ScupaError(
      'INVALID_INPUT',
      'Choose valid claim filters and a date range with the start before the end.',
    );
  return query;
}
/** @param {FollowUp} followUp */
export function validateFollowUp(followUp) {
  if (
    !followUp ||
    typeof followUp !== 'object' ||
    Array.isArray(followUp) ||
    Object.keys(followUp)
      .filter((key) => key !== 'assessmentKey')
      .sort()
      .join(',') !== 'chasedOn,followUpOn,notes,pinned,reviewed' ||
    (followUp.assessmentKey !== undefined &&
      (typeof followUp.assessmentKey !== 'string' || followUp.assessmentKey.length > 1000000)) ||
    typeof followUp.notes !== 'string' ||
    followUp.notes.length > 4000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(followUp.notes) ||
    !validDate(followUp.chasedOn) ||
    !validDate(followUp.followUpOn) ||
    typeof followUp.pinned !== 'boolean' ||
    typeof followUp.reviewed !== 'boolean'
  )
    throw new ScupaError(
      'INVALID_INPUT',
      'Enter valid follow-up dates and notes up to 4,000 characters.',
    );
  return followUp;
}
/** @param {import('./model.js').ClaimRow} row */
export const assessmentKey = (row) =>
  JSON.stringify(
    ['status', 'claimed', 'paid', 'currency', 'paid_currency', 'payment_date', 'notes'].map(
      (field) => row[field] || '',
    ),
  );
export const assessmentReviewed = (row, followUp) =>
  followUp.reviewed && followUp.assessmentKey === assessmentKey(row);
/** @param {import('./model.js').ClaimRow} row @param {FollowUp} followUp */
export function attentionReasons(row, followUp = emptyFollowUp(), today = localToday()) {
  const reasons = [];
  if (followUp.followUpOn)
    reasons.push(followUp.followUpOn <= today ? 'Follow-up due' : 'Follow-up scheduled');
  if (followUp.pinned) reasons.push('Pinned');
  if (!assessmentReviewed(row, followUp)) {
    if (row.status === CLAIM_STATUS.awaiting) {
      const age =
        validDate(row.received_date) && row.received_date
          ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(row.received_date)) / 86400000))
          : null;
      reasons.push(
        age === null
          ? 'Awaiting statement'
          : `Awaiting statement · ${age} ${age === 1 ? 'day' : 'days'}`,
      );
    } else if (row.status === CLAIM_STATUS.rejected) reasons.push('Rejected · review assessment');
    else if (row.status === CLAIM_STATUS.partial) reasons.push('Partially paid · review invoice');
  }
  return reasons;
}
/** Shared by the desktop list and CSV export. Currency amounts are sorted within currency. */
export function queryClaims(rows, query = {}, followUps = {}, members = {}) {
  validateQuery(query);
  const dateField = query.dateField || 'received_date';
  const sort = query.sort || 'received_date';
  const direction = query.direction === 'asc' ? 1 : -1;
  const search = (query.search || '').trim().toLowerCase();
  return rows
    .filter(
      (row) =>
        (!query.member || row.member === query.member) &&
        (!query.provider || row.provider === query.provider) &&
        (!query.status || row.status === statuses[query.status]) &&
        (!query.from || (row[dateField] && row[dateField] >= query.from)) &&
        (!query.to || (row[dateField] && row[dateField] <= query.to)) &&
        (!search ||
          [...Object.values(row), members[row.member]?.displayName || '']
            .join(' ')
            .toLowerCase()
            .includes(search)) &&
        (query.view !== 'attention' || attentionReasons(row, followUps[row.claim_ref]).length > 0),
    )
    .sort((a, b) => {
      let comparison;
      if (sort === 'claimed' || sort === 'paid') {
        const currency = sort === 'paid' ? 'paid_currency' : 'currency';
        comparison =
          (a[currency] || '').localeCompare(b[currency] || '') ||
          (a[sort] === b[sort]
            ? 0
            : a[sort] === ''
              ? -1
              : b[sort] === ''
                ? 1
                : Number(a[sort]) - Number(b[sort]));
      } else {
        const value = (row) =>
          sort === 'member' ? members[row.member]?.displayName || row.member : row[sort] || '';
        comparison = value(a).localeCompare(value(b));
      }
      return direction * comparison || a.claim_ref.localeCompare(b.claim_ref);
    });
}
