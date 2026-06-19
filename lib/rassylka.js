const supabase = require('./supabase');
const { md } = require('./helpers');

const OtpisTekst = '\n\n_Отписаться от приглашений: /stop или «стоп»._';

async function poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id) {
    const { data: rows } = await supabase
        .from('chleny_klubov')
        .select('igroki(id, tg_id, otpis_priglasheniy, igrovoy_nik, imya)')
        .eq('klub_id', klub_id);

    return (rows || [])
        .map(r => r.igroki)
        .filter(i => i?.tg_id && !i.otpis_priglasheniy && i.tg_id !== exclude_tg_id);
}

async function otpravitRassylku(bot, poluchateli, text, opts = {}) {
    let ok = 0;
    let fail = 0;
    let blocked = 0;
    const delayMs = opts.delayMs ?? 55;

    for (const p of poluchateli) {
        try {
            await bot.sendMessage(p.tg_id, text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {})
            });
            ok += 1;
        } catch (e) {
            const code = e.response?.body?.error_code;
            if (code === 403) blocked += 1;
            else fail += 1;
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }

    return { ok, fail, blocked, total: poluchateli.length };
}

function tekstPriglasheniyaNaAnons(klub, anons, botUsername) {
    const ssylka = botUsername
        ? 'https://t.me/' + botUsername + '?start=anons_' + anons.id
        : null;
    let t = '📢 *Приглашение на игру*\n\n';
    t += '🎴 *' + md(klub?.nazvaniye || 'Клуб') + '*\n';
    t += '📅 ' + (anons.data_igry || '') + ' в ' + (anons.vremya || '') + '\n';
    t += '📍 ' + md(anons.adres || '') + '\n';
    if (anons.kommentariy) t += '💬 ' + md(anons.kommentariy) + '\n';
    t += '\nЗапишись в боте Prime Mafia';
    if (ssylka) t += ':\n' + ssylka;
    else t += ' → «📢 Анонсы игр».';
    return t + OtpisTekst;
}

function tekstPriglasheniyaVIgru(klubNazvaniye, kod, url) {
    let t = '🎴 *' + md(klubNazvaniye || 'Клуб') + '* приглашает на игру №*' + kod + '*\n\n';
    t += 'Войти по ссылке:\n' + url + '\n\n';
    t += '_Или в боте: «🎮 Войти в игру» → код ' + kod + '._';
    return t + OtpisTekst;
}

async function razoslatAnons(bot, klub_id, klub, anons, botUsername, exclude_tg_id) {
    const poluchateli = await poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id);
    if (!poluchateli.length) {
        return { ok: 0, fail: 0, blocked: 0, total: 0, empty: true };
    }
    const text = tekstPriglasheniyaNaAnons(klub, anons, botUsername);
    return otpravitRassylku(bot, poluchateli, text);
}

async function razoslatVhodVIgru(bot, klub_id, klubNazvaniye, kod, url, exclude_tg_id) {
    const poluchateli = await poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id);
    if (!poluchateli.length) {
        return { ok: 0, fail: 0, blocked: 0, total: 0, empty: true };
    }
    const text = tekstPriglasheniyaVIgru(klubNazvaniye, kod, url);
    return otpravitRassylku(bot, poluchateli, text);
}

module.exports = {
    OtpisTekst,
    poluchitPoluchateleyPriglasheniy,
    otpravitRassylku,
    tekstPriglasheniyaNaAnons,
    tekstPriglasheniyaVIgru,
    razoslatAnons,
    razoslatVhodVIgru
};
