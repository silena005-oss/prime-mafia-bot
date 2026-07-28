/**
 * CSV rating import — club members loaded once, inserts batched.
 */

function parseBoolCell(v) {
    const s = String(v || '').trim().toLowerCase();
    return s === 'да' || s === 'yes' || s === '1' || s === 'true' || s === '+';
}

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if ((ch === ',' || ch === ';') && !inQ) {
            out.push(cur.trim());
            cur = '';
        } else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

function normalizovatZagolovok(h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function parseRatingCsv(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!raw) return { rows: [], errors: ['Пустой файл'] };

    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Нужна строка заголовков и хотя бы одна строка данных'] };
    if (lines.length > 2001) {
        return { rows: [], errors: ['Слишком большой файл: максимум 2000 строк данных'] };
    }

    const headers = parseCsvLine(lines[0]).map(normalizovatZagolovok);
    const idx = (names) => {
        for (const n of names) {
            const i = headers.indexOf(n);
            if (i >= 0) return i;
        }
        return -1;
    };

    const iNik = idx(['ник', 'igrovoy_nik', 'nickname']);
    const iImya = idx(['имя', 'imya', 'name']);
    const iRol = idx(['роль', 'rol', 'role']);
    const iPob = idx(['победа', 'pobeda', 'pobedila_komanda']);
    const iVyz = idx(['выжил', 'vyzhil', 'survived']);
    const iBk = idx(['баллы_команды', 'bally_komanda', 'командные']);
    const iBl = idx(['личные_баллы', 'bally_lichnie', 'личные']);
    const iVsego = idx(['итого', 'bally_vsego', 'total']);
    const iData = idx(['дата', 'data', 'data_igry', 'date']);

    if (iRol < 0 && iVsego < 0) {
        return { rows: [], errors: ['Не найдены колонки «Роль» или «Итого»'] };
    }

    const rows = [];
    const errors = [];
    for (let li = 1; li < lines.length; li++) {
        const cells = parseCsvLine(lines[li]);
        if (!cells.some(c => c)) continue;
        const nik = iNik >= 0 ? cells[iNik] : '';
        const imya = iImya >= 0 ? cells[iImya] : '';
        const rol = iRol >= 0 ? cells[iRol] : '?';
        const pob = iPob >= 0 ? parseBoolCell(cells[iPob]) : false;
        const vyz = iVyz >= 0 ? parseBoolCell(cells[iVyz]) : false;
        let bk = iBk >= 0 ? parseFloat(String(cells[iBk]).replace(',', '.')) : 0;
        let bl = iBl >= 0 ? parseFloat(String(cells[iBl]).replace(',', '.')) : 0;
        let vsego = iVsego >= 0 ? parseFloat(String(cells[iVsego]).replace(',', '.')) : NaN;
        if (!Number.isFinite(vsego)) vsego = (Number.isFinite(bk) ? bk : 0) + (Number.isFinite(bl) ? bl : 0);
        if (!Number.isFinite(bk)) bk = 0;
        if (!Number.isFinite(bl)) bl = Math.max(0, vsego - bk);
        const dataStr = iData >= 0 ? cells[iData] : '';
        let data_igry = null;
        if (dataStr) {
            const m = dataStr.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (m) data_igry = m[0];
            else {
                const m2 = dataStr.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
                if (m2) {
                    const y = m2[3].length === 2 ? '20' + m2[3] : m2[3];
                    data_igry = y + '-' + m2[2].padStart(2, '0') + '-' + m2[1].padStart(2, '0');
                }
            }
        }
        if (!nik && !imya) {
            errors.push('Строка ' + (li + 1) + ': нет ника или имени');
            continue;
        }
        rows.push({ nik, imya, rol, pobedila_komanda: pob, vyzhil: vyz, bally_komanda: bk, bally_lichnie: bl, bally_vsego: vsego, data_igry });
    }
    return { rows, errors };
}

async function zagruzitKartuChlenovKluba(supabase, klub_id) {
    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('igrok_id, igroki(id, imya, igrovoy_nik)')
        .eq('klub_id', klub_id);
    const byNick = new Map();
    const byImya = new Map();
    for (const c of chleny || []) {
        const g = c.igroki;
        if (!g?.id) continue;
        const nick = String(g.igrovoy_nik || '').trim().toLowerCase();
        const imya = String(g.imya || '').trim().toLowerCase();
        if (nick) byNick.set(nick, g.id);
        if (imya) byImya.set(imya, g.id);
    }
    return { byNick, byImya };
}

function naytiIgrokIdVKarte(karta, { nik, imya }) {
    const n = String(nik || '').trim().toLowerCase();
    const i = String(imya || '').trim().toLowerCase();
    if (n && karta.byNick.has(n)) return karta.byNick.get(n);
    if (i && karta.byImya.has(i)) return karta.byImya.get(i);
    if (n && karta.byImya.has(n)) return karta.byImya.get(n);
    return null;
}

/** @deprecated use zagruzitKartuChlenovKluba once per import */
async function naytiIgrokIdVKlube(supabase, klub_id, row) {
    const karta = await zagruzitKartuChlenovKluba(supabase, klub_id);
    return naytiIgrokIdVKarte(karta, row);
}

async function importRatingCsv(supabase, klub_id, text, opts = {}) {
    const { rows, errors } = parseRatingCsv(text);
    if (!rows.length) return { ok: false, imported: 0, skipped: 0, errors: errors.length ? errors : ['Нет строк для импорта'] };

    const sportivniy = !!opts.sportivniy;
    const source = opts.source || 'archive_import';
    const batchSize = Math.max(50, Math.min(Number(opts.batchSize) || 250, 500));
    const karta = await zagruzitKartuChlenovKluba(supabase, klub_id);
    const stamp = Date.now();

    let imported = 0;
    let skipped = 0;
    const outErrors = [...errors];
    const batch = [];

    const flush = async () => {
        if (!batch.length) return;
        const chunk = batch.splice(0, batch.length);
        const { error } = await supabase.from('bally').insert(chunk);
        if (error) {
            skipped += chunk.length;
            outErrors.push('Пакет insert: ' + error.message);
        } else {
            imported += chunk.length;
        }
    };

    for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const igrok_id = naytiIgrokIdVKarte(karta, row);
        if (!igrok_id) {
            skipped++;
            if (outErrors.length < 40) {
                outErrors.push('Строка ' + (ri + 2) + ': игрок «' + (row.nik || row.imya) + '» не найден в клубе');
            }
            continue;
        }
        const record = {
            klub_id,
            igrok_id,
            rol: row.rol || '?',
            pobedila_komanda: !!row.pobedila_komanda,
            vyzhil: !!row.vyzhil,
            bally_komanda: row.bally_komanda,
            bally_lichnie: row.bally_lichnie,
            bally_vsego: row.bally_vsego,
            sportivniy,
            kod_igry: source + '_' + stamp + '_' + ri,
            bonus_info: { archive_import: true }
        };
        if (row.data_igry) record.data_igry = row.data_igry;
        batch.push(record);
        if (batch.length >= batchSize) await flush();
    }
    await flush();

    return { ok: imported > 0, imported, skipped, errors: outErrors.slice(0, 15) };
}

module.exports = {
    parseRatingCsv,
    naytiIgrokIdVKlube,
    zagruzitKartuChlenovKluba,
    importRatingCsv
};
