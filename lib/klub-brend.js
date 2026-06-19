const supabase = require('./supabase');

function isVedushchiy(rol) {
    return rol === 'vedushchiy' || rol === 'vedushchii';
}

async function mozhnoUpravlyatBrendomKluba(telegram_id, klub_id) {
    if (!telegram_id || !klub_id) return false;
    const { data: klub } = await supabase.from('kluby').select('owner_tg_id').eq('id', klub_id).maybeSingle();
    if (klub?.owner_tg_id === telegram_id) return true;

    const { data: igrok } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).maybeSingle();
    if (!igrok?.id) return false;

    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('rol')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok.id)
        .maybeSingle();
    return chlen?.rol === 'vladyelets' || isVedushchiy(chlen?.rol);
}

async function klubyDlyaBrenda(telegram_id) {
    const { data: igrok } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).maybeSingle();
    if (!igrok?.id) return [];

    const { data: owned } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki')
        .eq('owner_tg_id', telegram_id);

    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('rol, kluby(id, nazvaniye, nastroyki)')
        .eq('igrok_id', igrok.id);

    const map = new Map();
    for (const k of owned || []) map.set(k.id, k);
    for (const c of chleny || []) {
        if (!c.kluby?.id) continue;
        if (c.rol === 'vladyelets' || isVedushchiy(c.rol)) map.set(c.kluby.id, c.kluby);
    }
    return [...map.values()];
}

async function sohranitLogoKluba(klub_id, file_id) {
    const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    const nastroyki = { ...(klub?.nastroyki || {}), logo_file_id: file_id, stilizatsiya_kluba: true, brend_obnovlen: new Date().toISOString() };
    const { error } = await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);
    return { error, nastroyki };
}

async function udalitLogoKluba(klub_id) {
    const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    const nastroyki = { ...(klub?.nastroyki || {}) };
    delete nastroyki.logo_file_id;
    delete nastroyki.brend_obnovlen;
    const { error } = await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);
    return { error };
}

async function poluchitLogoFileId(klub_id) {
    const { data } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).maybeSingle();
    return data?.nastroyki?.logo_file_id || null;
}

async function mozhnoSmotretLogoKluba(telegram_id, klub_id) {
    if (!klub_id) return false;
    const { data: igrok } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).maybeSingle();
    if (!igrok?.id) return false;
    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('id')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok.id)
        .maybeSingle();
    if (chlen) return true;
    const { data: klub } = await supabase.from('kluby').select('owner_tg_id').eq('id', klub_id).maybeSingle();
    return klub?.owner_tg_id === telegram_id;
}

module.exports = {
    klubyDlyaBrenda,
    mozhnoUpravlyatBrendomKluba,
    sohranitLogoKluba,
    udalitLogoKluba,
    poluchitLogoFileId,
    mozhnoSmotretLogoKluba
};
