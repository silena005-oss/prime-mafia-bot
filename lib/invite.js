const QRCode = require('qrcode');

let cachedBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') || null;

async function poluchitUsernameBota(bot) {
    if (cachedBotUsername) return cachedBotUsername;
    if (!bot) throw new Error('bot_required');
    const me = await bot.getMe();
    cachedBotUsername = me.username;
    return cachedBotUsername;
}

async function ssylkaVhodaVIgru(bot, kod) {
    const username = await poluchitUsernameBota(bot);
    return 'https://t.me/' + username + '?start=join_' + kod;
}

async function qrBufferVhodaVIgru(bot, kod) {
    const url = await ssylkaVhodaVIgru(bot, kod);
    return QRCode.toBuffer(url, { type: 'png', margin: 2, width: 480 });
}

function tekstPriglasheniyaVIgru(kod, url) {
    return '📱 *Вход в игру №' + kod + '*\n\n' +
        'Ссылка для игроков:\n' + url + '\n\n' +
        '_Можно отправить ссылку или показать QR на столе — игроки сразу попадут в лобби._';
}

async function otpravitQrVhodaVBota(bot, chatId, kod, opts = {}) {
    const url = await ssylkaVhodaVIgru(bot, kod);
    const buffer = await qrBufferVhodaVIgru(bot, kod);
    const caption = opts.caption || tekstPriglasheniyaVIgru(kod, url);
    await bot.sendPhoto(chatId, buffer, {
        caption,
        parse_mode: 'Markdown',
        ...(opts.telegramOpts || {})
    });
    return url;
}

function knopkiPriglasheniyaVIgru(kod) {
    return [
        [{ text: '📱 QR для входа', callback_data: 'qr_igry_' + kod }],
        [{ text: '🔗 Ссылка для игроков', callback_data: 'link_igry_' + kod }]
    ];
}

module.exports = {
    poluchitUsernameBota,
    ssylkaVhodaVIgru,
    qrBufferVhodaVIgru,
    tekstPriglasheniyaVIgru,
    otpravitQrVhodaVBota,
    knopkiPriglasheniyaVIgru
};
