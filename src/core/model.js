export const BUPA_ORIGIN = 'https://membersworld.bupaglobal.com';
export const HEADERS = [
  'member',
  'claim_ref',
  'received_date',
  'treatment_date',
  'currency',
  'claimed',
  'paid_currency',
  'paid',
  'status',
  'paid_to',
  'benefit_categories',
  'is_dental',
  'provider',
  'invoice',
  'payment_date',
  'notes',
];
export const CLAIM_STATUS = {
  paid: 'Paid in Full',
  partial: 'Partially Paid',
  rejected: 'Rejected',
  duplicate: 'Duplicate - declined (already assessed)',
  planRate: 'Paid at plan rate (member not liable for balance)',
  awaiting: 'No statement in portal (unassessed?)',
};

/** @typedef {{ displayName: string, self?: boolean, needsConfirmation?: boolean }} Member */
/** @typedef {Record<string, string>} ClaimRow */
/** @typedef {{schemaVersion: number, baseUrl: string, members: Record<string, Member>, lastSync?: string, watchlist?: Array<{kind: string, match: string, note?: string}>}} Household */
/** @typedef {{code?: string, message: string, retryable?: boolean, options?: {dataDir?: string, output?: string}}} OperationError */
