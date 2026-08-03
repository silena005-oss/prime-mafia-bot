const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bez = require('../lib/bezopasnost');
const reyting = require('../lib/reyting-import');
const { ochistitNikIzSpiska, razobratSpisokNikov } = require('../lib/helpers');

describe('bezopasnost', () => {
  it('sanitizes PostgREST search', () => {
    const s = bez.sanitizirovatPoisk("ab'c%,.(x)");
    assert.ok(!s.includes("'"));
    assert.ok(!s.includes('%'));
    assert.ok(!s.includes(','));
  });

  it('rejects telegram path traversal', () => {
    assert.equal(bez.bezopasnyyPutTelegramFile('../etc/passwd'), null);
    assert.equal(bez.bezopasnyyPutTelegramFile('photos/file.jpg'), 'photos/file.jpg');
    assert.ok(bez.urlTelegramFile('TOKEN', 'photos/file.jpg').includes('/file/botTOKEN/photos/file.jpg'));
  });

  it('detects image magic bytes', () => {
    assert.equal(bez.etoImageMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
    assert.equal(bez.etoImageMagicBytes(Buffer.from('notanimage!!')), false);
    assert.equal(bez.etoRazreshennyyImageMime('image/png'), true);
    assert.equal(bez.etoRazreshennyyImageMime('application/pdf'), false);
  });

  it('rate limit trips', () => {
    const key = 'test-rl-' + Date.now();
    assert.equal(bez.proveritRateLimit(key, 2, 60000).ok, true);
    assert.equal(bez.proveritRateLimit(key, 2, 60000).ok, true);
    assert.equal(bez.proveritRateLimit(key, 2, 60000).ok, false);
  });
});

describe('reyting-import', () => {
  it('parses CSV and rejects oversized files', () => {
    const csv = 'Ник,Роль,Итого\nAlice,Дон,5\nBob,Мирный,2\n';
    const { rows, errors } = reyting.parseRatingCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].nik, 'Alice');
    assert.equal(rows[0].bally_vsego, 5);
  });

  it('caps at 2000 data rows', () => {
    const lines = ['Ник,Итого'];
    for (let i = 0; i < 2002; i++) lines.push('u' + i + ',1');
    const { rows, errors } = reyting.parseRatingCsv(lines.join('\n'));
    assert.equal(rows.length, 0);
    assert.ok(errors[0].includes('2000'));
  });
});

describe('razobratSpisokNikov', () => {
  it('strips UI labels and keycap seat numbers from pasted roster', () => {
    const text = [
      'В игре:',
      '1️⃣Худи 🤩',
      '2️⃣Лиса 🦊',
      '🔟 Миледи',
      '1️⃣2️⃣Айк рез.',
      '1. Анна',
      '2) Боря'
    ].join('\n');
    assert.deepEqual(
      razobratSpisokNikov(text),
      ['Худи 🤩', 'Лиса 🦊', 'Миледи', 'Айк рез.', 'Анна', 'Боря']
    );
  });

  it('drops bare status labels', () => {
    assert.equal(ochistitNikIzSpiska('В игре:'), '');
    assert.equal(ochistitNikIzSpiska('состав вечера'), '');
  });
});
