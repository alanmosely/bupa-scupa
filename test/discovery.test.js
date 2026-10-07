import test from 'node:test';
import assert from 'node:assert/strict';
import { householdNames, memberCardName } from '../src/core/discovery.js';

const profile = [
  { label: 'First name', value: 'Example' },
  { label: 'Surname:', value: 'Person' },
];
const member = { href: '/plan/dependants/example', text: 'Second Person' };
test('discovery reads labelled names and deduplicates repeated links', () => {
  assert.deepEqual(householdNames(profile, [member, member]), ['Example Person', 'Second Person']);
  assert.deepEqual(householdNames(profile, [], true), ['Example Person']);
});
test('portal cards separate recognised relationship suffixes from names', () => {
  assert.deepEqual(
    householdNames(
      [{ label: 'Name', value: 'Example Person' }],
      [{ href: '/en/plan?memberid=synthetic', text: 'Second Person (Partner)', memberCard: true }],
    ),
    ['Example Person', 'Second Person'],
  );
  assert.equal(memberCardName('Second Person (Daughter)'), 'Second Person');
  assert.equal(memberCardName('Second Person (Junior)'), 'Second Person (Junior)');
  assert.throws(
    () =>
      householdNames(profile, [
        { href: '/en/plan?memberid=one', text: 'Example Person (Son)', memberCard: true },
      ]),
    { code: 'DISCOVERY_UNAVAILABLE' },
  );
  assert.throws(
    () =>
      householdNames(profile, [
        { href: '/en/plan?memberid=one', text: 'Second Person (Partner)', memberCard: true },
        { href: '/en/plan?memberid=two', text: 'Second Person (Son)', memberCard: true },
      ]),
    { code: 'DISCOVERY_UNAVAILABLE' },
  );
});
test('discovery refuses incomplete, ambiguous and foreign household metadata', () => {
  for (const [fields, links, empty] of [
    [profile, [], false],
    [[], [member], false],
    [[...profile, { label: 'First name', value: 'Different' }], [member], false],
    [profile, [member, { ...member, text: 'Different Person' }], false],
    [profile, [member, { ...member, href: '/plan/dependants/other' }], false],
    [profile, [{ ...member, href: 'https://example.invalid/member' }], false],
  ])
    assert.throws(() => householdNames(fields, links, empty), { code: 'DISCOVERY_UNAVAILABLE' });
});
