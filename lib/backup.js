const supabase = require('./supabase');

const TABLES = [
    { name: 'kluby', cols: '*' },
    { name: 'igroki', cols: 'id, tg_id, imya, igrovoy_nik, tg_username, gorod, gorod_id, sozdan_v, otpis_priglasheniy, den_rozhdeniya' },
    { name: 'chleny_klubov', cols: '*' },
    { name: 'anonsy', cols: '*' },
    { name: 'zapisi_na_anons', cols: '*' },
    { name: 'igrovye_vechera', cols: '*' },
    { name: 'igrovye_bonusy', cols: '*' },
    { name: 'klub_ankety', cols: '*' },
    { name: 'bally', cols: '*' },
    { name: 'admins', cols: '*' },
    { name: 'aktivnye_igry', cols: 'kod, klub_id, vedushchii_tg_id, kolichestvo, tip_kluba, sportivniy, igroki, faza, den, nastroyki, zavershena, obnovlena_v, sozdana_v' },
    { name: 'rassylka_jobs', cols: 'id, tip, klub_id, status, total, ok, fail, blocked, sozdan, zavershen, oshibka' }
];

const PAGE = 1000;
const KEEP = Number(process.env.BACKUP_KEEP || 7);
const INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000);

let workerStarted = false;
let busy = false;

async function fetchAll(name, cols) {
    const rows = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from(name)
            .select(cols)
            .range(from, from + PAGE - 1);
        if (error) {
            if (/Could not find the table|does not exist|schema cache/i.test(error.message)) {
                return { skipped: true, reason: error.message, rows: [] };
            }
            throw new Error(name + ': ' + error.message);
        }
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
    }
    return { rows };
}

async function sdelatLogicalBackup(istochnik = 'bot') {
    if (busy) return { ok: false, error: 'busy' };
    busy = true;
    try {
        const payload = {};
        const meta = { tables: {}, istochnik };
        for (const t of TABLES) {
            const rez = await fetchAll(t.name, t.cols);
            if (rez.skipped) {
                meta.tables[t.name] = { skipped: true, reason: rez.reason };
                continue;
            }
            payload[t.name] = rez.rows;
            meta.tables[t.name] = { rows: rez.rows.length };
        }
        meta.bytes_approx = Buffer.byteLength(JSON.stringify(payload), 'utf8');

        const { data, error } = await supabase
            .from('pm_logical_backups')
            .insert({ istochnik, meta, payload })
            .select('id, sozdan, meta')
            .single();
        if (error) throw error;

        await pruneOld();
        return { ok: true, id: data.id, sozdan: data.sozdan, meta: data.meta };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    } finally {
        busy = false;
    }
}

async function pruneOld() {
    const { data: rows } = await supabase
        .from('pm_logical_backups')
        .select('id, sozdan')
        .order('sozdan', { ascending: false });
    const extra = (rows || []).slice(KEEP);
    for (const r of extra) {
        await supabase.from('pm_logical_backups').delete().eq('id', r.id);
    }
}

async function poslednieBekapy(limit = 5) {
    const { data, error } = await supabase
        .from('pm_logical_backups')
        .select('id, sozdan, istochnik, meta')
        .order('sozdan', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

function zapustitWorker() {
    if (workerStarted) return;
    workerStarted = true;
    const run = () => {
        sdelatLogicalBackup('cron').then((rez) => {
            if (rez.ok) console.log('[backup] ok', rez.id, rez.meta?.tables);
            else if (rez.error !== 'busy') console.error('[backup]', rez.error);
        }).catch((e) => console.error('[backup]', e.message || e));
    };
    // первый через 3 мин после старта, дальше раз в сутки
    setTimeout(run, 3 * 60 * 1000).unref?.();
    setInterval(run, INTERVAL_MS).unref?.();
}

module.exports = {
    sdelatLogicalBackup,
    poslednieBekapy,
    zapustitWorker,
    KEEP
};
