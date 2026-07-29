#!/usr/bin/env node
/**
 * Логический бэкап public-таблиц через Supabase service_role.
 * На Free-плане нет daily backups / PITR — этот скрипт закрывает дыру.
 *
 * Usage:
 *   node scripts/backup-supabase.mjs
 * Env: SUPABASE_URL, SUPABASE_KEY (service_role)
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY=service_role)');
  process.exit(1);
}
if (/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\./.test(key)) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role && payload.role !== 'service_role') {
      console.error('Key role is "' + payload.role + '". Use service_role secret for backups (anon is blocked by RLS).');
      process.exit(1);
    }
  } catch (_) { /* ignore decode errors */ }
}

const TABLES = [
  'admins',
  'aktivnye_igry',
  'anonsy',
  'bally',
  'chleny_klubov',
  'goroda',
  'igroki',
  'igroki_v_igre',
  'igrovye_bonusy',
  'igrovye_vechera',
  'igry',
  'klub_ankety',
  'kluby',
  'nastroyki_app',
  'rassylka_jobs',
  'zapisi_na_anons'
];

const PAGE = 1000;
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const outRoot = join(process.cwd(), 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(outRoot, stamp);

mkdirSync(outDir, { recursive: true });

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function dumpTable(name) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(name)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) {
      if (/Could not find the table|does not exist/i.test(error.message)) {
        return { skipped: true, reason: error.message };
      }
      throw new Error(name + ': ' + error.message);
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  writeFileSync(join(outDir, name + '.json'), JSON.stringify(rows, null, 0));
  return { rows: rows.length };
}

const manifest = {
  ts: new Date().toISOString(),
  project: url,
  tables: {}
};

for (const table of TABLES) {
  try {
    const rez = await dumpTable(table);
    manifest.tables[table] = rez;
    console.log(table, rez.skipped ? 'skip' : rez.rows + ' rows');
  } catch (e) {
    manifest.tables[table] = { error: e.message };
    console.error(table, e.message);
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Wrote', outDir);

// prune old dumps
try {
  const dirs = readdirSync(outRoot)
    .map((name) => ({ name, path: join(outRoot, name) }))
    .filter((d) => {
      try { return statSync(d.path).isDirectory(); } catch { return false; }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  while (dirs.length > KEEP) {
    const old = dirs.shift();
    for (const f of readdirSync(old.path)) unlinkSync(join(old.path, f));
    // rmdir via writeFileSync not available; use dynamic import
    const { rmSync } = await import('fs');
    rmSync(old.path, { recursive: true, force: true });
    console.log('pruned', old.name);
  }
} catch (e) {
  console.warn('prune skipped:', e.message);
}
