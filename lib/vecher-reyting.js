// Рейтинг игрового вечера и месячный итог (городской / свободный)

const { md } = require('./helpers');

function mesyachnyDiapazon(year, month) {
    const m = String(month).padStart(2, '0');
    const start = `${year}-${m}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}

function tekushiyMesyachnyKlyuch(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function proshlyMesyachnyKlyuch(d = new Date()) {
    const x = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return tekushiyMesyachnyKlyuch(x);
}

function razobratMesyachnyKlyuch(klyuch) {
    const [y, m] = String(klyuch || '').split('-').map(Number);
    if (!y || !m) return null;
    return { year: y, month: m, ...mesyachnyDiapazon(y, m) };
}

function agregirovatBally(rows) {
    const totals = {};
    for (const row of rows || []) {
        const id = row.igrok_id;
        if (!id) continue;
        if (!totals[id]) {
            totals[id] = {
                igrok_id: id,
                name: row.igroki?.igrovoy_nik || row.igroki?.imya || '?',
                tg_id: row.igroki?.tg_id || null,
                pts: 0,
                games: 0
            };
        }
        totals[id].pts += row.bally_vsego || 0;
        totals[id].games += 1;
    }
    return Object.values(totals).sort((a, b) => b.pts - a.pts || b.games - a.games);
}

async function poluchitStatistikuPobedVechera(supabase, klub_id, data_igry) {
    const { data: rows } = await supabase
        .from('aktivnye_igry')
        .select('nastroyki, obnovlena_v')
        .eq('klub_id', klub_id)
        .eq('zavershena', true);
    const stats = { mirnye: 0, mafiya: 0, manyak: 0, vsego: 0 };
    for (const row of rows || []) {
        const date = row.obnovlena_v ? String(row.obnovlena_v).slice(0, 10) : '';
        if (date !== data_igry) continue;
        const n = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
        const p = n.pobeditel;
        if (p === 'mirnye' || p === 'mafiya' || p === 'manyak') {
            stats[p]++;
            stats.vsego++;
        }
    }
    return stats;
}

function formatStatistikuPobed(stats) {
    if (!stats?.vsego) return '_За вечер завершённых игр с итогом пока нет._';
    return [
        '🟢 Мирные — *' + stats.mirnye + '*',
        '🔴 Мафия — *' + stats.mafiya + '*',
        '🎯 Маньяк — *' + stats.manyak + '*',
        '_Всего игр: ' + stats.vsego + '_'
    ].join('\n');
}

async function poluchitReytingVechera(supabase, klub_id, data_igry) {
    const { data: rows } = await supabase
        .from('bally')
        .select('igrok_id, bally_vsego, igroki(igrovoy_nik, imya, tg_id)')
        .eq('klub_id', klub_id)
        .eq('data_igry', data_igry)
        .eq('sportivniy', false);
    return agregirovatBally(rows);
}

async function poluchitMesyachnyReyting(supabase, klub_id, year, month) {
    const { start, end } = mesyachnyDiapazon(year, month);
    const { data: rows } = await supabase
        .from('bally')
        .select('igrok_id, bally_vsego, igroki(igrovoy_nik, imya, tg_id)')
        .eq('klub_id', klub_id)
        .eq('sportivniy', false)
        .gte('data_igry', start)
        .lte('data_igry', end);
    return agregirovatBally(rows);
}

function formatReytingSpiska(reyting, zagolovok, limit = 15) {
    let t = zagolovok ? `*${zagolovok}*\n\n` : '';
    if (!reyting || reyting.length === 0) {
        t += '_Пока нет очков за игры._';
        return t;
    }
    const medals = ['🥇', '🥈', '🥉'];
    reyting.slice(0, limit).forEach((p, i) => {
        const m = medals[i] || `${i + 1}.`;
        t += `${m} *${md(p.name)}* — ${p.pts} очк. (${p.games} игр)\n`;
    });
    return t;
}

async function sohranitReytingVechera(supabase, klub_id, data_igry, reyting) {
    const payload = {
        reyting_vechera: reyting || [],
        updated_at: new Date().toISOString()
    };
    const { error } = await supabase
        .from('igrovye_vechera')
        .update(payload)
        .eq('klub_id', klub_id)
        .eq('data_igry', data_igry);
    if (error) console.error('[vecher-reyting] save:', error.message);
}

async function ustanovitIgrokaVechera(supabase, klub_id, data_igry, igrok_id) {
    const { error } = await supabase
        .from('igrovye_vechera')
        .update({
            igrok_vechera_id: igrok_id || null,
            zavershen_v: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('klub_id', klub_id)
        .eq('data_igry', data_igry);
    if (error) console.error('[vecher-reyting] poe:', error.message);
}

async function poluchitIgrokaVechera(supabase, klub_id, data_igry) {
    const { data } = await supabase
        .from('igrovye_vechera')
        .select('igrok_vechera_id, reyting_vechera')
        .eq('klub_id', klub_id)
        .eq('data_igry', data_igry)
        .maybeSingle();
    if (!data) return null;
    if (data.igrok_vechera_id) {
        const { data: igrok } = await supabase
            .from('igroki')
            .select('igrovoy_nik, imya')
            .eq('id', data.igrok_vechera_id)
            .maybeSingle();
        data.igroki = igrok;
    }
    return data;
}

/** Автоитог прошлого месяца — один раз на клуб, пишем в nastroyki */
async function obrabotatMesyachnyItog(supabase, bot, klub_id, klubNazvaniye) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki, owner_tg_id')
        .eq('id', klub_id)
        .single();
    if (!klub) return null;

    const nastroyki = klub.nastroyki || {};
    const proshly = proshlyMesyachnyKlyuch();
    const uzhe = nastroyki.reyting_mesyaca_obrabotan;
    if (uzhe === proshly) return null;

    const parsed = razobratMesyachnyKlyuch(proshly);
    if (!parsed) return null;

    const reyting = await poluchitMesyachnyReyting(supabase, klub_id, parsed.year, parsed.month);
    nastroyki.reyting_mesyaca_obrabotan = proshly;
    nastroyki.reyting_mesyaca_itog = {
        mesyac: proshly,
        top: reyting.slice(0, 20),
        obnovlen: new Date().toISOString()
    };
    await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);

    if (klub.owner_tg_id && reyting.length > 0) {
        const mesyacRu = new Date(parsed.year, parsed.month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
        let msg = `📊 *Итог месяца* — ${klubNazvaniye || 'клуб'}\n_${mesyacRu}_\n\n`;
        msg += formatReytingSpiska(reyting, 'Городской рейтинг', 10);
        msg += '\n\n_Очки вечеров автоматически учтены в месячном рейтинге._';
        bot.sendMessage(klub.owner_tg_id, msg, { parse_mode: 'Markdown' }).catch(() => {});
    }
    return reyting;
}

module.exports = {
    mesyachnyDiapazon,
    tekushiyMesyachnyKlyuch,
    proshlyMesyachnyKlyuch,
    poluchitStatistikuPobedVechera,
    formatStatistikuPobed,
    poluchitReytingVechera,
    poluchitMesyachnyReyting,
    formatReytingSpiska,
    sohranitReytingVechera,
    ustanovitIgrokaVechera,
    poluchitIgrokaVechera,
    obrabotatMesyachnyItog
};
