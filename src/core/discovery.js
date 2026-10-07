import { BUPA_ORIGIN } from './model.js';
import { ScupaError } from './errors.js';

const normal = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

/** Relationship suffixes belong to the portal card, not the person's display name. */
export function memberCardName(value) {
  return normal(value).replace(
    /\s+\((?:partner|son|daughter|spouse|husband|wife|child|dependant|dependent|civil partner)\)$/i,
    '',
  );
}
const fail = () => {
  throw new ScupaError(
    'DISCOVERY_UNAVAILABLE',
    'SCUPA could not identify the complete household safely. No household was saved. Use manual setup with the exact names shown in Bupa, or report the changed portal layout without sharing personal details.',
  );
};

/** Interpret only labelled profile fields and member links, never arbitrary page text. */
export function householdNames(profileFields, memberLinks, explicitlyEmpty = false) {
  const field = (labels) => {
    const values = [
      ...new Set(
        profileFields
          .filter((item) => labels.includes(normal(item.label).replace(/:$/, '').toLowerCase()))
          .map((item) => normal(item.value))
          .filter(Boolean),
      ),
    ];
    if (values.length > 1) fail();
    return values[0];
  };
  const full = field(['full name', 'member name', 'account holder name', 'name']);
  const first = field(['first name', 'given name', 'forename']);
  const last = field(['last name', 'surname', 'family name']);
  const holder = full || (first && last ? `${first} ${last}` : '');
  if (!holder) fail();
  const byHref = new Map();
  for (const link of memberLinks) {
    let url;
    try {
      url = new URL(link.href, BUPA_ORIGIN);
    } catch {
      fail();
    }
    if (url.origin !== BUPA_ORIGIN || url.username || url.password || url.hash) fail();
    const name = link.memberCard ? memberCardName(link.text) : normal(link.text);
    // The actual dependant cards exclude the holder. Identical names would be
    // ambiguous people, not a repeated account-holder navigation link.
    if (link.memberCard && name.toLowerCase() === holder.toLowerCase()) fail();
    if (!name || (byHref.has(url.href) && byHref.get(url.href) !== name)) fail();
    byHref.set(url.href, name);
  }
  if (!byHref.size && !explicitlyEmpty) fail();
  const names = [
    holder,
    ...[...byHref.values()].filter((name) => name.toLowerCase() !== holder.toLowerCase()),
  ];
  if (
    names.length > 30 ||
    names.some((name) => name.length > 100 || /[\x00-\x1f]/.test(name)) ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length
  )
    fail();
  return names;
}

/** Read visible, labelled fields without collecting credentials, cookies or page captures. */
export async function discoverHousehold(page) {
  const navigate = async (route) => {
    await page.goto(BUPA_ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = new URL(page.url());
    if (url.origin !== BUPA_ORIGIN || /login|sign.?in/i.test(url.pathname)) fail();
    if (await page.locator('input[type="password"]').count()) fail();
  };
  await navigate('/my-profile');
  const fields = await page.evaluate(() => {
    const visible = (el) => !!el && !!el.getClientRects().length;
    const result = [];
    for (const label of document.querySelectorAll('label')) {
      const control = label.control;
      if (
        visible(label) &&
        control instanceof HTMLInputElement &&
        !['password', 'hidden', 'email'].includes(control.type)
      )
        result.push({ label: label.textContent, value: control.value });
    }
    for (const term of document.querySelectorAll('dt, th')) {
      const value = term.nextElementSibling;
      if (visible(term) && visible(value) && value && /^(DD|TD)$/.test(value.tagName))
        result.push({ label: term.textContent, value: value.textContent });
    }
    // MembersWorld's read-only profile uses heading/value cards, not form controls.
    for (const key of document.querySelectorAll(
      'main .a-list-lval-item > .a-list-lval-key, [role="main"] .a-list-lval-item > .a-list-lval-key',
    )) {
      const value = key.nextElementSibling;
      if (
        visible(key) &&
        visible(value) &&
        value?.classList.contains('a-list-lval-value') &&
        /^name\s*:?$/i.test((key.textContent || '').trim())
      )
        result.push({ label: 'Name', value: value.textContent });
    }
    return result;
  });
  await navigate('/plan');
  await navigate('/plan/dependants');
  const dependants = await page.evaluate(() => {
    const scope = document.querySelector('main, [role="main"]');
    if (!scope) return { links: [], empty: false };
    const links = [...scope.querySelectorAll('a[href]')]
      .filter((a) => {
        if (!a.getClientRects().length || a.closest('nav, [role="navigation"]')) return false;
        const url = new URL(a.getAttribute('href') || '', location.href);
        return (
          /\/(?:dependants|dependents|member)\/[^/]+\/?$/i.test(url.pathname) ||
          (a.matches('.m-card-sum-header') &&
            a.querySelector('h2.m-card-sum-title') &&
            /\/plan\/?$/i.test(url.pathname) &&
            [...url.searchParams.keys()].some((key) => /^memberid$/i.test(key)))
        );
      })
      .map((a) => {
        const heading = a.matches('.m-card-sum-header')
          ? a.querySelector('h2.m-card-sum-title')
          : null;
        return {
          href: a.getAttribute('href'),
          text: heading?.textContent || a.textContent,
          memberCard: !!heading,
        };
      });
    const empty = /\b(?:you (?:have|do) not have|you have no|no) depend[ae]nts\b/i.test(
      scope.textContent || '',
    );
    return { links, empty };
  });
  return householdNames(fields, dependants.links, dependants.empty);
}
