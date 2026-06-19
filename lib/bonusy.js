const supabase = require('./supabase');
const { md } = require('./helpers');

const TIPY_BONUSOV = {
    vybor_karty: { nazvaniye: 'Выбор карты', emoji: '🎴' },
    immunitet_golos: { nazvaniye: 'Иммунитет на голосование', emoji: '🛡' },
    immunitet_noch: { nazvaniye: 'Иммунитет ночью', emoji: '🌙' },
    podarok_kosmetika: { nazvaniye: 'Подарок / бейдж', emoji: '🎁' }
};

async function poluchitBonusyIgroka(igrok_id, klub_id) {
    let q = supabase
        .from('igrovye_bonusy')
        .select('id, tip, status, nazvaniye, opisaniye, meta, istekaet, sozdan, kluby(nazvaniye)')
        .eq('igrok_id', igrok_id)
        .eq('status', 'active')
        .order('sozdan', { ascending: false });
    if (klub_id) q = q.eq('klub_id', klub_id);
    const { data } = await q;
    return (data || []).map(b => ({
        id: b.id,
        tip: b.tip,
        label: b.nazvaniye || TIPY_BONUSOV[b.tip]?.nazvaniye || b.tip,
        emoji: TIPY_BONUSOV[b.tip]?.emoji || '🎁',
        club: b.kluby?.nazvaniye || '',
        opisaniye: b.opisaniye || '',
        istekaet: b.istekaet
    }));
}

async function nachislitBonus({ igrok_id, klub_id, tip, nazvaniye, opisaniye, istochnik, istochnik_igrok_id, meta }) {
    const { data, error } = await supabase
        .from('igrovye_bonusy')
        .insert({
            igrok_id,
            klub_id: klub_id || null,
            tip,
            nazvaniye: nazvaniye || TIPY_BONUSOV[tip]?.nazvaniye || tip,
            opisaniye: opisaniye || null,
            istochnik: istochnik || 'klub',
            istochnik_igrok_id: istochnik_igrok_id || null,
            meta: meta || {},
            status: 'active'
        })
        .select()
        .single();
    return { data, error };
}

async function ispolzovatBonus(bonus_id, metaPatch = {}) {
    const { data: row } = await supabase.from('igrovye_bonusy').select('*').eq('id', bonus_id).single();
    if (!row || row.status !== 'active') return { ok: false, reason: 'not_active' };
    const meta = { ...(row.meta || {}), ...metaPatch };
    await supabase.from('igrovye_bonusy').update({
        status: 'used',
        ispolzovan: new Date().toISOString(),
        meta
    }).eq('id', bonus_id);
    return { ok: true, bonus: row };
}

async function aktivnyeBonusyIgrokaPoNomery(igra, nomer) {
    const igrok = igra.igroki?.find(i => i.nomer === nomer);
    if (!igrok?.igrok_id) return [];
    return poluchitBonusyIgroka(igrok.igrok_id, igra.klub_id);
}

function tekstTipovBonusov() {
    return Object.entries(TIPY_BONUSOV)
        .map(([k, v]) => v.emoji + ' *' + v.nazvaniye + '* (`' + k + '`)')
        .join('\n');
}

module.exports = {
    TIPY_BONUSOV,
    poluchitBonusyIgroka,
    nachislitBonus,
    ispolzovatBonus,
    aktivnyeBonusyIgrokaPoNomery,
    tekstTipovBonusov
};
