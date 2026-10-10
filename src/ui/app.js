import { VERSION } from '../version.js';
import { queryClaims, attentionReasons, assessmentReviewed, localToday } from '../core/claims.js';
/** @template {keyof UiElements} K @param {K} id @returns {UiElements[K]} */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing UI element: ' + id);
  return /** @type {UiElements[K]} */ (element);
}
/** @type {ReturnType<typeof import("../core/service.js").snapshot>} */
let data;
let busy = false;
let confirmPending = false;
let view = 'all';
let sortDirection = 'desc';
let selectedClaim = '';
let selectedAssessmentKey = '';
function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
  $('message').hidden = !text;
  $('recovery-actions').hidden = !error;
}
/** @template {keyof UiCommands} K @param {K} command @param {UiArgs<K>} args */
async function call(command, ...args) {
  const result = await window.scupa.call(command, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.result;
}
function setBusy(value) {
  busy = value;
  for (const id of /** @type {const} */ ([
    'sync',
    'full-sync',
    'save-setup',
    'choose-folder',
    'export',
    'change-folder',
    'reparse',
    'edit-household',
    'archive-help',
    'error-help',
    'save-view',
    'remove-view',
    'save-follow-up',
  ]))
    $(id).disabled = value;
  $('progress').hidden = !value;
  $('cancel').hidden = !value;
  if (data) renderRows();
}
function amount(currency, value) {
  if (!currency || value === '') return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value));
  } catch {
    return currency + ' ' + Number(value).toFixed(2);
  }
}
function shortDate(value) {
  const date = new Date(value + 'T12:00:00');
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
function statusLabel(status) {
  return /^No statement/.test(status) ? 'Awaiting statement' : status;
}
function compactAttention(row, followUp) {
  return attentionReasons(row, followUp)
    .map((reason) => {
      if (/^Follow-up/.test(reason))
        return `${followUp.followUpOn <= localToday() ? 'Due' : 'Follow up'} ${shortDate(followUp.followUpOn)}`;
      if (/^Awaiting statement ·/.test(reason))
        return reason.replace('Awaiting statement · ', '') + ' waiting';
      if (/^Rejected/.test(reason)) return 'Review assessment';
      if (/^Partially paid/.test(reason)) return 'Check invoice';
      return reason;
    })
    .join(' · ');
}
function renderViewControls() {
  const saved = data.workspace.savedViews.find((saved) => saved.id === $('saved-view').value);
  $('view-menu-title').textContent = saved ? saved.name : 'Views';
  $('view-menu-title').title = saved ? `Saved view: ${saved.name}` : 'Saved views';
  $('remove-view').hidden = !saved;
  const query = currentQuery();
  const advancedCount = Number(Boolean(query.provider)) + Number(Boolean(query.from || query.to));
  $('advanced-count').textContent = String(advancedCount);
  $('advanced-count').hidden = advancedCount === 0;
  const summary = [];
  if (query.provider) summary.push(query.provider);
  if (query.from || query.to) {
    const basis = $('date-field').selectedOptions[0].textContent?.replace(' date', '') || 'Date';
    summary.push(
      `${basis}: ${query.from ? shortDate(query.from) : 'Any date'} – ${query.to ? shortDate(query.to) : 'Any date'}`,
    );
  }
  const hasFilters = Boolean(query.search || query.member || query.status || advancedCount);
  const hasSort = query.sort !== 'received_date' || query.direction !== 'desc';
  $('filter-summary').hidden = !hasFilters && !hasSort;
  $('active-filters').textContent =
    summary.join(' · ') || (hasFilters ? 'Filters applied' : 'Custom sort order');
}
/** @param {'member' | 'provider'} id @param {string} value */
function selectFilter(id, value) {
  const select = $(id);
  if (value && ![...select.options].some((option) => option.value === value))
    select.add(new Option(value, value));
  select.value = value;
}
function render() {
  $('setup').hidden = data.configured;
  $('dashboard').hidden = !data.configured;
  $('sync').disabled = busy;
  $('claim-count').textContent = String(data.rows.length);
  $('awaiting-count').textContent = String(data.awaiting);
  const paymentCurrencies = new Set(
    data.rows.filter((row) => row.paid !== '').map((row) => row.paid_currency),
  );
  $('paid-total').textContent =
    Object.entries(data.totals)
      .filter(([currency]) => paymentCurrencies.has(currency))
      .map(([currency, t]) => amount(currency, t.paid))
      .join(' · ') || '—';
  $('last-sync').textContent = data.lastSync
    ? 'Updated ' +
      new Date(data.lastSync).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Sign in to Bupa to update your archive.';
  $('archive-path').textContent = data.dataDir;
  $('setup-archive-path').textContent = data.dataDir;
  $('privacy-path').textContent = data.dataDir;
  const previous = $('member').value;
  $('member').replaceChildren(new Option('Everyone', ''));
  for (const [id, member] of Object.entries(data.members))
    $('member').add(new Option(member.displayName, id));
  selectFilter('member', previous);
  const previousProvider = $('provider').value;
  $('provider').replaceChildren(new Option('All providers', ''));
  for (const provider of [...new Set(data.rows.map((row) => row.provider).filter(Boolean))].sort())
    $('provider').add(new Option(provider, provider));
  selectFilter('provider', previousProvider);
  const previousView = $('saved-view').value;
  $('saved-view').replaceChildren(new Option('Choose a saved view', ''));
  for (const saved of data.workspace.savedViews)
    $('saved-view').add(new Option(saved.name, saved.id));
  $('saved-view').value = previousView;
  $('remove-view').hidden = !$('saved-view').value;
  $('attention-count').textContent = String(
    data.rows.filter((row) => attentionReasons(row, data.workspace.followUps[row.claim_ref]).length)
      .length,
  );
  renderRows();
}
function currentQuery() {
  return {
    search: $('search').value,
    member: $('member').value,
    status: $('status').value,
    provider: $('provider').value,
    from: $('date-from').value,
    to: $('date-to').value,
    dateField: $('date-field').value,
    sort: $('sort-by').value,
    direction: sortDirection,
    view,
  };
}
function applyQuery(query = {}) {
  $('search').value = query.search || '';
  selectFilter('member', query.member || '');
  $('status').value = query.status || '';
  selectFilter('provider', query.provider || '');
  $('date-from').value = query.from || '';
  $('date-to').value = query.to || '';
  $('date-field').value = query.dateField || 'received_date';
  $('sort-by').value = query.sort || 'received_date';
  sortDirection = query.direction || 'desc';
  view = query.view || 'all';
  renderRows();
}
function renderRows() {
  renderViewControls();
  $('all-tab').setAttribute('aria-pressed', String(view === 'all'));
  $('attention-tab').setAttribute('aria-pressed', String(view === 'attention'));
  $('view-description').hidden = view !== 'attention';
  $('view-description').textContent = 'Pending claims and your follow-ups.';
  $('sort-direction').textContent = sortDirection === 'asc' ? 'Ascending ↑' : 'Descending ↓';
  for (const header of document.querySelectorAll('th[data-sort]')) {
    const selected = header.getAttribute('data-sort') === $('sort-by').value;
    header.setAttribute(
      'aria-sort',
      selected ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
    );
    const button = header.querySelector('button');
    if (button) button.dataset.direction = selected ? sortDirection : '';
  }
  let rows = [];
  try {
    rows = queryClaims(data.rows, currentQuery(), data.workspace.followUps, data.members);
    $('filter-error').hidden = true;
  } catch (error) {
    $('filter-error').textContent = error.message;
    $('filter-error').hidden = false;
  }
  $('export').disabled = busy || !rows.length;
  $('claims').replaceChildren();
  $('empty').hidden = rows.length > 0;
  $('result-count').textContent = `${rows.length} of ${data.rows.length} claims`;
  $('empty').textContent = data.rows.length
    ? view === 'attention'
      ? 'No claims need attention with these filters.'
      : 'No claims match these filters.'
    : 'Your claims will appear here after your first sync.';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = 'claim-row';
    tr.onclick = () => {
      if (!busy) openClaim(r.claim_ref);
    };
    for (const [index, [value, sub]] of [
      [data.members[r.member]?.displayName || r.member, r.claim_ref],
      [
        r.provider ||
          (/^No statement/.test(r.status) ? 'Awaiting a statement' : 'Provider not listed'),
        r.treatment_date || r.received_date,
      ],
      [amount(r.currency, r.claimed)],
      [amount(r.paid_currency, r.paid)],
    ].entries()) {
      const td = document.createElement('td');
      if (index === 2 || index === 3) td.className = 'numeric';
      td.textContent = value;
      if (sub) {
        const small = document.createElement('small');
        small.textContent = sub;
        if (index === 0) {
          const link = document.createElement('button');
          link.className = 'claim-link';
          link.textContent = sub;
          link.setAttribute('aria-label', `View claim ${sub}`);
          link.disabled = busy;
          link.onclick = (event) => {
            event.stopPropagation();
            openClaim(r.claim_ref);
          };
          td.append(link);
        } else td.append(small);
      }
      tr.append(td);
    }
    const td = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    if (/No statement|Partially/.test(r.status)) chip.classList.add('attention');
    if (/Rejected|Duplicate/.test(r.status)) chip.classList.add('rejected');
    chip.textContent = statusLabel(r.status);
    chip.title = r.status;
    td.append(chip);
    const followUp = data.workspace.followUps[r.claim_ref];
    if (view === 'attention') {
      const reason = document.createElement('small');
      reason.className = 'attention-reason';
      reason.textContent = compactAttention(r, followUp);
      td.append(reason);
    }
    if (view !== 'attention' && (followUp?.followUpOn || followUp?.pinned)) {
      const dates = document.createElement('small');
      dates.textContent = [
        followUp.followUpOn
          ? `${followUp.followUpOn <= localToday() ? 'Due' : 'Follow up'} ${shortDate(followUp.followUpOn)}`
          : '',
        followUp.pinned ? 'Pinned' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      dates.className = 'attention-reason';
      td.append(dates);
    }
    tr.append(td);
    $('claims').append(tr);
  }
}
function renderFollowUp(followUp) {
  $('follow-up-notes').value = followUp.notes;
  $('chased-on').value = followUp.chasedOn;
  $('follow-up-on').value = followUp.followUpOn;
  $('follow-up-pinned').checked = followUp.pinned;
  $('follow-up-reviewed').checked = followUp.reviewed;
}
function renderFollowUpSummary(row, followUp) {
  const summary = [];
  if (followUp.followUpOn)
    summary.push(
      `${followUp.followUpOn <= localToday() ? 'Due' : 'Follow up'} ${shortDate(followUp.followUpOn)}`,
    );
  else if (followUp.chasedOn) summary.push(`Chased ${shortDate(followUp.chasedOn)}`);
  if (followUp.pinned) summary.push('Pinned');
  if (assessmentReviewed(row, followUp)) summary.push('Reviewed');
  if (followUp.notes) summary.push('Notes saved');
  $('follow-up-summary').textContent = summary.join(' · ') || 'Add notes or a follow-up date';
  $('detail-attention').textContent = compactAttention(row, followUp) || 'No follow-up needed.';
}
async function openClaim(claimRef) {
  if (busy) return;
  setBusy(true);
  try {
    const details = await call('claim-details', { claimRef });
    selectedClaim = claimRef;
    selectedAssessmentKey = details.followUp.assessmentKey;
    const row = details.row;
    $('detail-provider').textContent = row.provider || 'Awaiting a statement';
    $('detail-member').textContent = data.members[row.member]?.displayName || row.member;
    $('detail-reference').textContent = row.claim_ref;
    $('detail-status').textContent = statusLabel(row.status);
    $('detail-status').title = row.status;
    $('detail-status').className =
      'status-chip' +
      (/No statement|Partially/.test(row.status)
        ? ' attention'
        : /Rejected|Duplicate/.test(row.status)
          ? ' rejected'
          : '');
    $('detail-claimed').textContent = amount(row.currency, row.claimed);
    $('detail-paid').textContent = amount(row.paid_currency, row.paid);
    $('detail-fields').replaceChildren();
    for (const [label, value] of [
      ['Received', row.received_date],
      ['Treatment', row.treatment_date],
      ['Payment date', row.payment_date],
      ['Paid to', row.paid_to],
      ['Invoice', row.invoice],
      ['Benefit', row.benefit_categories],
    ]) {
      const field = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value || 'Not recorded';
      field.append(term, description);
      $('detail-fields').append(field);
    }
    $('detail-notes').textContent = row.notes || 'No assessment or archive notes recorded.';
    $('detail-documents').replaceChildren();
    for (const doc of details.documents) {
      const button = document.createElement('button');
      button.className = 'document-button';
      const title = document.createElement('strong');
      title.textContent = doc.kind;
      const name = document.createElement('span');
      name.textContent = doc.name;
      button.append(title, name);
      button.onclick = async () => {
        button.disabled = true;
        try {
          await call('open-claim-document', { claimRef, file: doc.file, sha256: doc.sha256 });
        } catch (error) {
          $('detail-document-error').textContent = error.message;
          $('detail-document-error').hidden = false;
        } finally {
          button.disabled = false;
        }
      };
      $('detail-documents').append(button);
    }
    if (!details.documents.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No current PDFs are saved for this claim yet.';
      $('detail-documents').append(empty);
    }
    $('detail-document-error').textContent = details.documentError;
    $('detail-document-error').hidden = !details.documentError;
    renderFollowUpSummary(row, details.followUp);
    renderFollowUp(details.followUp);
    $('follow-up-details').open = false;
    document.querySelector('.assessment-notes')?.removeAttribute('open');
    $('follow-up-message').hidden = true;
    $('claim-dialog').showModal();
    $('claim-dialog').scrollTop = 0;
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}
$('close-claim').onclick = () => $('claim-dialog').close();
$('claim-dialog').addEventListener('close', () => {
  const claimRef = selectedClaim;
  selectedClaim = '';
  selectedAssessmentKey = '';
  const link = [...$('claims').querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === `View claim ${claimRef}`,
  );
  (link || $(view === 'attention' ? 'attention-tab' : 'all-tab')).focus();
});
$('follow-up-form').onsubmit = async (event) => {
  event.preventDefault();
  if (busy || !selectedClaim) return;
  setBusy(true);
  const followUp = {
    notes: $('follow-up-notes').value,
    chasedOn: $('chased-on').value,
    followUpOn: $('follow-up-on').value,
    pinned: $('follow-up-pinned').checked,
    reviewed: $('follow-up-reviewed').checked,
    assessmentKey: selectedAssessmentKey,
  };
  try {
    data = await call('update-follow-up', { claimRef: selectedClaim, followUp });
    render();
    const row = data.rows.find((row) => row.claim_ref === selectedClaim);
    if (row) renderFollowUpSummary(row, data.workspace.followUps[selectedClaim]);
    $('follow-up-message').textContent = 'Follow-up saved.';
    $('follow-up-message').className = '';
  } catch (error) {
    $('follow-up-message').textContent = error.message;
    $('follow-up-message').className = 'error-text';
  } finally {
    $('follow-up-message').hidden = false;
    setBusy(false);
  }
};
async function refresh() {
  data = await call('snapshot');
  render();
}
function clearChanges() {
  $('changes').hidden = true;
  $('changes').open = false;
  $('changes-list').replaceChildren();
}
/** @param {ParseResult} result @param {Snapshot['rows']} previousRows */
function renderChanges(result, previousRows) {
  clearChanges();
  const { added, updated } = result.changes;
  const append = (kind, member, ref, descriptions) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${kind} · ${data.members[member]?.displayName || member} · ${ref}`;
    item.append(title);
    for (const description of descriptions) {
      const line = document.createElement('p');
      line.textContent = description;
      item.append(line);
    }
    $('changes-list').append(item);
  };
  for (const row of added) {
    append('Added', row.member, row.claim_ref, [
      [row.provider, row.status].filter(Boolean).join(' · '),
      `Claimed ${amount(row.currency, row.claimed)} · Paid ${amount(row.paid_currency, row.paid)}`,
    ]);
  }
  for (const change of updated) {
    const before =
      previousRows.find(
        (row) => row.member === change.member && row.claim_ref === change.claim_ref,
      ) || {};
    const after = {
      ...before,
      ...Object.fromEntries(change.diffs.map(({ field, to }) => [field, to])),
    };
    const value = (field, raw, row) =>
      field === 'paid' || field === 'claimed'
        ? amount(row[field === 'paid' ? 'paid_currency' : 'currency'], raw)
        : raw || '—';
    append(
      'Updated',
      change.member,
      change.claim_ref,
      change.diffs.map(({ field, from, to }) => {
        const label = field.replaceAll('_', ' ');
        return `${label[0].toUpperCase() + label.slice(1)}: ${value(field, from, before)} → ${value(field, to, after)}`;
      }),
    );
  }
  $('changes-title').textContent = `View changes (${added.length + updated.length})`;
  $('changes').hidden = !added.length && !updated.length;
}
/** @template {'sync' | 'parse' | 'setup'} K @param {K} command @param {UiArgs<K>} args */
async function operate(command, ...args) {
  if (busy) return;
  clearChanges();
  message('');
  setBusy(true);
  $('progress-title').textContent = command === 'sync' ? 'Opening Bupa…' : 'Checking your records…';
  $('progress-detail').textContent = '';
  const previousRows = data.rows;
  /** @type {ParseResult | undefined} */
  let changes;
  try {
    const result = await call(command, ...args);
    if ('changes' in result) changes = result;
    message(
      'added' in result
        ? `Done. ${result.added} claims added, ${result.updated} updated.`
        : 'Household saved. You’re ready for your first sync.',
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    if (confirmPending) {
      $('confirmation').close('cancel');
      confirmPending = false;
    }
    await refresh().catch((e) => message(e.message, true));
    if (changes) renderChanges(changes, previousRows);
    setBusy(false);
  }
}
$('sync').onclick = () => operate('sync');
$('full-sync').onclick = () => operate('sync', { fullRefresh: true });
$('reparse').onclick = () => operate('parse');
$('save-setup').onclick = () =>
  operate('setup', {
    names: $('names')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
$('cancel').onclick = () => {
  $('cancel').disabled = true;
  call('cancel').finally(() => {
    $('cancel').disabled = false;
  });
};
for (const id of /** @type {const} */ (['choose-folder', 'change-folder']))
  $(id).onclick = async () => {
    try {
      data = await call('folder');
      clearChanges();
      $('claim-dialog').close();
      $('saved-view').value = '';
      $('provider').value = '';
      $('member').value = '';
      render();
      applyQuery();
    } catch (e) {
      message(e.message, true);
    }
  };
$('open-folder').onclick = () => call('open-folder').catch((e) => message(e.message, true));
$('export').onclick = async () => {
  try {
    const result = await call('export', { query: currentQuery() });
    if (result)
      message(
        `Exported ${result.rows} ${result.rows === 1 ? 'claim' : 'claims'} to ${result.file}`,
      );
  } catch (e) {
    message(e.message, true);
  }
};
for (const id of /** @type {const} */ ([
  'search',
  'member',
  'status',
  'provider',
  'date-field',
  'date-from',
  'date-to',
  'sort-by',
]))
  $(id).addEventListener('input', () => {
    $('saved-view').value = '';
    $('remove-view').hidden = true;
    renderRows();
  });
$('sort-direction').onclick = () => {
  sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  $('saved-view').value = '';
  $('remove-view').hidden = true;
  renderRows();
};
for (const button of document.querySelectorAll('button.column-sort')) {
  button.addEventListener('click', () => {
    const sort = button.getAttribute('data-sort') || 'received_date';
    sortDirection = $('sort-by').value === sort && sortDirection === 'asc' ? 'desc' : 'asc';
    $('sort-by').value = sort;
    $('saved-view').value = '';
    $('remove-view').hidden = true;
    renderRows();
  });
}
$('all-tab').onclick = () => {
  view = 'all';
  $('saved-view').value = '';
  $('remove-view').hidden = true;
  renderRows();
};
$('attention-tab').onclick = () => {
  view = 'attention';
  $('saved-view').value = '';
  $('remove-view').hidden = true;
  renderRows();
};
$('clear-filters').onclick = () => {
  $('saved-view').value = '';
  $('remove-view').hidden = true;
  applyQuery({ view });
};
$('more-filters').onclick = () => {
  const expanded = $('advanced-filters').hidden;
  $('advanced-filters').hidden = !expanded;
  $('more-filters').setAttribute('aria-expanded', String(expanded));
};
$('saved-view').onchange = () => {
  const saved = data.workspace.savedViews.find((saved) => saved.id === $('saved-view').value);
  $('remove-view').hidden = !saved;
  if (saved) applyQuery(saved.query);
  else renderViewControls();
  $('view-menu').open = false;
};
$('save-view').onclick = () => {
  $('view-menu').open = false;
  $('view-name').value = '';
  $('view-save-error').hidden = true;
  $('save-view-dialog').showModal();
};
$('cancel-save-view').onclick = () => $('save-view-dialog').close();
$('save-view-form').onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  $('confirm-save-view').disabled = true;
  try {
    data = await call('save-view', { name: $('view-name').value, query: currentQuery() });
    render();
    $('saved-view').value = data.workspace.savedViews.at(-1)?.id || '';
    $('remove-view').hidden = false;
    renderViewControls();
    $('save-view-dialog').close();
    message('View saved.');
  } catch (error) {
    $('view-save-error').textContent = error.message;
    $('view-save-error').hidden = false;
  } finally {
    setBusy(false);
    $('confirm-save-view').disabled = false;
  }
};
$('remove-view').onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    data = await call('remove-view', { id: $('saved-view').value });
    render();
    $('view-menu').open = false;
    message('Saved view removed.');
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
};
document.addEventListener('click', (event) => {
  if (event.target instanceof window.Node && !$('view-menu').contains(event.target))
    $('view-menu').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('view-menu').open = false;
});
window.scupa.onProgress((event) => {
  if (event.type === 'confirm' || event.type === 'household') {
    confirmPending = true;
    const household = event.type === 'household';
    $('confirm-name').textContent = household
      ? 'Is this your complete household?'
      : 'Is this ' + event.displayName + '?';
    $('confirm-instructions').textContent = household
      ? 'Compare this list with Bupa. The account holder is first. Continue only if everyone is listed correctly. You will still confirm each member’s claims before importing.'
      : 'Look at the Bupa browser window and check that the claims belong to this member. Do not confirm if the member is wrong or unclear.';
    $('confirm-count').textContent = household
      ? (event.names || []).join(' · ')
      : `${event.claimCount} claims are shown in the portal.`;
    $('confirm-accept').textContent = household
      ? 'Yes, save this household'
      : 'Yes, this is the right member';
    $('confirmation').showModal();
  } else {
    $('progress-title').textContent = event.message;
    $('progress-detail').textContent =
      event.phase === 'login'
        ? 'Login is manual. Passwords and MFA codes are never requested by SCUPA.'
        : '';
    if (event.phase === 'agent') message(event.message);
  }
});
$('confirmation').addEventListener('close', () => {
  if (confirmPending) {
    confirmPending = false;
    call('confirm', { accepted: $('confirmation').returnValue === 'accept' }).catch((e) =>
      message(e.message, true),
    );
  }
});
$('version').textContent = `Version ${VERSION}`;
$('privacy').onclick = () => $('privacy-dialog').showModal();
$('close-privacy').onclick = () => $('privacy-dialog').close();
$('edit-household').onclick = () => {
  $('household-fields').replaceChildren();
  $('household-error').hidden = true;
  for (const [id, member] of Object.entries(data.members)) {
    const label = document.createElement('label');
    label.textContent = member.self ? 'Account holder' : 'Dependant';
    const input = document.createElement('input');
    input.value = member.displayName;
    input.dataset.memberId = id;
    input.required = true;
    input.maxLength = 100;
    label.append(input);
    $('household-fields').append(label);
  }
  $('household-editor').showModal();
};
$('close-household').onclick = () => $('household-editor').close();
$('household-form').onsubmit = async (event) => {
  event.preventDefault();
  $('save-household').disabled = true;
  const edits = [...$('household-fields').querySelectorAll('input')].map((input) => ({
    id: input.dataset.memberId || '',
    displayName: input.value,
  }));
  try {
    data = await call('update-household', { edits });
    clearChanges();
    render();
    $('household-editor').close();
    message('Household names saved. Please confirm corrected names in Bupa at your next sync.');
  } catch (error) {
    $('household-error').textContent = error.message;
    $('household-error').hidden = false;
  } finally {
    $('save-household').disabled = false;
  }
};
async function showArchiveHelp() {
  try {
    const help = await call('archive-help');
    const descriptions = {
      unlocked: 'No operation lock is present. You can try your sync again.',
      active:
        'Another SCUPA process may be using this archive. Close other SCUPA windows, then check again.',
      stale:
        'A previous SCUPA process has stopped. You can safely release its leftover lock and retry.',
      unknown:
        'This lock cannot be verified safely. Close all SCUPA windows and follow the recovery instructions in the README.',
    };
    $('help-lock').textContent = descriptions[help.lock.state];
    $('recover-lock').hidden = !help.lock.recoverable;
    $('help-summary').textContent = help.issues.length
      ? 'The most recent parsing attempt reported:'
      : 'No parsing problems have been recorded.';
    $('help-issues').replaceChildren();
    for (const issue of help.issues) {
      if (
        help.documents.some(
          (doc) =>
            issue.startsWith(doc.file + ':') &&
            (!doc.readable || issue.includes('[UNREVIEWED_ASSESSMENT]')),
        )
      )
        continue;
      const item = document.createElement('li');
      item.textContent = issue;
      $('help-issues').append(item);
    }
    for (const doc of help.documents) {
      const item = document.createElement('li');
      const label = document.createElement('p');
      label.textContent =
        doc.file +
        (doc.supporting
          ? ' — marked as supporting.'
          : doc.assessment
            ? ' — confirmed Bupa assessment.'
            : doc.readable
              ? ' — assessment needs your confirmation.'
              : ' — no readable text.');
      const actions = document.createElement('div');
      actions.className = 'actions';
      const open = document.createElement('button');
      open.textContent = 'View PDF';
      open.onclick = async () => {
        open.disabled = true;
        try {
          await call('open-document', doc);
          $('help-summary').textContent =
            'PDF opened. Review every page and check who issued it before classifying it.';
        } catch (error) {
          $('help-summary').textContent = error.message;
        } finally {
          open.disabled = false;
        }
      };
      const review = document.createElement('button');
      review.textContent = doc.readable
        ? doc.assessment
          ? 'Undo assessment confirmation'
          : 'Confirm Bupa assessment'
        : doc.supporting
          ? 'Undo supporting classification'
          : 'Mark as supporting document';
      review.disabled = help.lock.state !== 'unlocked';
      review.onclick = async () => {
        review.disabled = true;
        try {
          await call('review-document', {
            file: doc.file,
            sha256: doc.sha256,
            classification:
              doc.assessment || doc.supporting ? null : doc.readable ? 'assessment' : 'supporting',
          });
          await showArchiveHelp();
          $('help-summary').textContent =
            'Review decisions are shown below. Recheck saved PDFs to update the parsing results.';
        } catch (error) {
          $('help-summary').textContent = error.message;
        } finally {
          review.disabled = false;
        }
      };
      actions.append(open, review);
      item.append(label, actions);
      $('help-issues').append(item);
    }
    if (!$('help-dialog').open) $('help-dialog').showModal();
  } catch (error) {
    message(error.message, true);
  }
}
$('archive-help').onclick = showArchiveHelp;
$('error-help').onclick = showArchiveHelp;
$('close-help').onclick = () => $('help-dialog').close();
$('help-open-folder').onclick = () =>
  call('open-folder').catch((error) => message(error.message, true));
$('recover-lock').onclick = async () => {
  $('recover-lock').disabled = true;
  try {
    await call('recover-lock');
    await showArchiveHelp();
    message('Interrupted run recovered. You can sync again.');
  } catch (error) {
    $('help-lock').textContent = error.message;
  } finally {
    $('recover-lock').disabled = false;
  }
};
setBusy(true);
$('progress-title').textContent = 'Loading archive…';
$('cancel').hidden = true;
refresh()
  .catch((error) => message(error.message, true))
  .finally(() => setBusy(false));
