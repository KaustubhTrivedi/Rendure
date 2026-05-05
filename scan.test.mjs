import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLocationFilter, buildTitleFilter } from './scan.mjs';

test('location filter rejects remote US state roles', () => {
  const filter = buildLocationFilter({
    location: { city: 'Dublin', country: 'Ireland' },
    compensation: { location_flexibility: 'Dublin-based, open to remote and hybrid roles' },
  });

  assert.equal(
    filter({
      title: 'NLP Data Scientist',
      location: 'Remote - Massachusetts',
    }),
    false,
  );
});

test('location filter allows EU remote roles', () => {
  const filter = buildLocationFilter({
    location: { city: 'Dublin', country: 'Ireland' },
    compensation: { location_flexibility: 'Dublin-based, open to remote and hybrid roles' },
  });

  assert.equal(
    filter({
      title: 'Software Engineer',
      location: 'Remote - Ireland',
    }),
    true,
  );
});

test('title filter rejects data scientist roles from personal negatives', () => {
  const filter = buildTitleFilter({
    positive: ['AI', 'ML', 'Software Engineer'],
    negative: ['Data Scientist', 'Data Science', 'Applied Scientist'],
  });

  assert.equal(filter('NLP Data Scientist'), false);
  assert.equal(filter('AI Software Engineer'), true);
});
