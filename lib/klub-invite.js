const crypto = require('crypto');
const QRCode = require('qrcode');
const supabase = require('./supabase');

const KOD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KOD_DLINA = 6;

let cachedBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') || null;

function generiratKodRegistracii() {
    let s = '';
    for (let i = 0; i < KOD_DLINA; i++) {
        s += KOD_CHARS[crypto.randomInt(0, KOD_CHARS.length)];
    }
    return s;
}

function normalizovatKodRegistracii(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function poluchitUsernameBota(bot) {
    if (cachedBotUsername) return cachedBotUsername;
    if (!bot) throw new Error('bot_required');
    const me = await bot.getMe();
    cachedBotUsername = me.username;
    return cachedBotUsername;
}

async function poluchitKlubPoKoduRegistracii(kod) {
    const norm = normalizovatKodRegistracii(kod);
    if (norm.length < 4) return null;
    const { data } = await supabase
        .from('kluby')
        .select('id, nazvaniye, gorod_id, gorod, nastroyki, owner_tg_id')
        .filter('nastroyki->>kod_registracii', 'eq', norm)
        .maybeSingle();
    return data || null;
}

async function obespechitKodRegistraciiKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('id, nastroyki')
        .eq('id', klub_id)
        .maybeSingle();
    if (!klub) return null;
    const n = { ...(klub.nastroyki || {}) };
    if (n.kod_registracii) return n.kod_registracii;
    for (let i = 0; i < 12; i++) {
        const kod = generiratKodRegistracii();
        const zanyat = await poluchitKlubPoKoduRegistracii(kod);
        if (zanyat) continue;
        n.kod_registracii = kod;
        await supabase.from('kluby').update({ nastroyki: n }).eq('id', klub_id);
        return kod;
    }
    return null;
}

async function obnovitKodRegistraciiKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('id, nastroyki')
        .eq('id', klub_id)
        .maybeSingle();
    if (!klub) return null;
    const n = { ...(klub.nastroyki || {}) };
    for (let i = 0; i < 12; i++) {
        const kod = generiratKodRegistracii();
        const zanyat = await poluchitKlubPoKoduRegistracii(kod);
        if (zanyat && zanyat.id !== klub_id) continue;
        n.kod_registracii = kod;
        await supabase.from('kluby').update({ nastroyki: n }).eq('id', klub_id);
        return kod;
    }
    return null;
}

async function ssylkaRegistraciiVKlub(bot, kod) {
    const username = await poluchitUsernameBota(bot);
    return 'https://t.me/' + username + '?start=club_' + normalizovatKodRegistracii(kod);
}

function tekstPriglasheniyaVKlub(klubNazvaniye, kod, url) {
    return '🔗 *Приглашение в клуб*\n\n' +
        '🎴 *' + klubNazvaniye + '*\n\n' +
        '🔑 *Код для регистрации:* `' + kod + '`\n\n' +
        '📎 *Ссылка:*\n' + url + '\n\n' +
        '_Дай код или ссылку новому игроку *до* регистрации — без них клуб не виден в боте._';
}

async function otpravitQrRegistraciiVKlub(bot, chatId, klubNazvaniye, kod) {
    const url = await ssylkaRegistraciiVKlub(bot, kod);
    const buffer = await QRCode.toBuffer(url, { type: 'png', margin: 2, width: 480 });
    await bot.sendPhoto(chatId, buffer, {
        caption: tekstPriglasheniyaVKlub(klubNazvaniye, kod, url),
        parse_mode: 'Markdown'
    });
    return url;
}

module.exports = {
    generiratKodRegistracii,
    normalizovatKodRegistracii,
    poluchitKlubPoKoduRegistracii,
    obespechitKodRegistraciiKluba,
    obnovitKodRegistraciiKluba,
    ssylkaRegistraciiVKlub,
    tekstPriglasheniyaVKlub,
    otpravitQrRegistraciiVKlub
};
