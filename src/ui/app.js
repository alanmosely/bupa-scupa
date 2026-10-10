import { VERSION } from '../version.js';
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
  ]))
    $(id).disabled = value;
  $('progress').hidden = !value;
  $('cancel').hidden = !value;
}
function amount(currency, value) {
  if (!currency || value === '') return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value));
  } catch {
    return currency + ' ' + Number(value).toFixed(2);
  }
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
  if (Object.hasOwn(data.members, previous)) $('member').value = previous;
  renderRows();
}
function renderRows() {
  const search = $('search').value.toLowerCase();
  const member = $('member').value;
  const status = $('status').value;
  const rows = data.rows
    .filter(
      (r) =>
        (!member || r.member === member) &&
        (!search || Object.values(r).join(' ').toLowerCase().includes(search)) &&
        (!status ||
          (status === 'awaiting' && /^No statement/.test(r.status)) ||
          (status === 'partial' && r.status === 'Partially Paid') ||
          (status === 'rejected' && r.status === 'Rejected')),
    )
    .sort((a, b) => b.received_date.localeCompare(a.received_date));
  $('claims').replaceChildren();
  $('empty').hidden = rows.length > 0;
  $('result-count').textContent = `${rows.length} of ${data.rows.length} claims`;
  $('empty').textContent = data.rows.length
    ? 'No claims match these filters.'
    : 'Your claims will appear here after your first sync.';
  for (const r of rows) {
    const tr = document.createElement('tr');
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
        td.append(small);
      }
      tr.append(td);
    }
    const td = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    if (/No statement|Partially/.test(r.status)) chip.classList.add('attention');
    if (/Rejected|Duplicate/.test(r.status)) chip.classList.add('rejected');
    chip.textContent = r.status;
    td.append(chip);
    tr.append(td);
    $('claims').append(tr);
  }
}
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
      render();
    } catch (e) {
      message(e.message, true);
    }
  };
$('open-folder').onclick = () => call('open-folder').catch((e) => message(e.message, true));
$('export').onclick = async () => {
  try {
    const result = await call('export');
    if (result) message(`Exported ${result.rows} claims to ${result.file}`);
  } catch (e) {
    message(e.message, true);
  }
};
for (const id of /** @type {const} */ (['search', 'member', 'status']))
  $(id).addEventListener('input', renderRows);
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
