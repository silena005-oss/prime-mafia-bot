const supabase = require('./supabase');
const { md } = require('./helpers');

async function poluchitChatGruppyKluba(klub_id) {
    const { data } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    const n = data?.nastroyki || {};
    const chatId = n.telegram_chat_id;
    if (!chatId) return null;
    return {
        chat_id: chatId,
        title: n.telegram_chat_title || '',
        auto: !!n.auto_publish_results
    };
}

async function sohranitChatGruppyKluba(klub_id, chat_id, title) {
    const { data } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    const n = { ...(data?.nastroyki || {}) };
    n.telegram_chat_id = chat_id;
    n.telegram_chat_title = title || '';
    await supabase.from('kluby').update({ nastroyki: n }).eq('id', klub_id);
    return n;
}

async function toggleAutoPublishKluba(klub_id, value) {
    const { data } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    const n = { ...(data?.nastroyki || {}) };
    n.auto_publish_results = value;
    await supabase.from('kluby').update({ nastroyki: n }).eq('id', klub_id);
    return n;
}

function tekstItogaDlyaPublikacii(igra, kod) {
    const pobediteli = { mirnye: '🟢 Мирные', mafiya: '🔴 Мафия', manyak: '🎯 Маньяк' };
    let t = '🏁 *Итог игры*';
    if (igra.nomer_igry) t += ' №' + igra.nomer_igry;
    t += '\n\n';
    if (igra.klub_nazvaniye) t += 'Клуб: *' + md(igra.klub_nazvaniye) + '*\n';
    if (igra.data_igry) t += 'Дата: *' + igra.data_igry + '*\n';
    t += 'Победитель: *' + (pobediteli[igra.pobeditel] || igra.pobeditel || '—') + '*\n\n';
    t += '*Состав:*\n';
    (igra.igroki || []).forEach(i => {
        const em = i.status === 'v_igre' ? '✅' : '💀';
        t += em + ' №' + i.nomer + ' ' + md(i.name) + ' — ' + i.rol + '\n';
    });
    t += '\n🏆 Баллы записаны в рейтинг Prime Mafia';
    if (kod) t += ' · код ' + kod;
    return t;
}

async function otpravitItogVGruppuKluba(bot, klub_id, text) {
    const grp = await poluchitChatGruppyKluba(klub_id);
    if (!grp?.chat_id) return { ok: false, reason: 'no_chat' };
    try {
        await bot.sendMessage(grp.chat_id, text, { parse_mode: 'Markdown' });
        return { ok: true, chat_id: grp.chat_id, title: grp.title };
    } catch (e) {
        return { ok: false, reason: e.message || 'send_failed' };
    }
}

module.exports = {
    poluchitChatGruppyKluba,
    sohranitChatGruppyKluba,
    toggleAutoPublishKluba,
    tekstItogaDlyaPublikacii,
    otpravitItogVGruppuKluba
};
