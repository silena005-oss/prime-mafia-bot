// ============================================
// PrimeMafia — Telegram бот
// Раздача ролей каждому игроку в личку
// ============================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_TOKEN не задан. Добавь переменную в Railway → Variables');
    process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL или SUPABASE_KEY не заданы в Railway → Variables');
    process.exit(1);
}

// Railway (web-сервис) требует открытый PORT, иначе контейнер помечают Crashed
const http = require('http');
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('PrimeMafia bot OK\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Health check слушает порт', PORT);
});

const bot = new TelegramBot(token, { polling: false });

function md(text) {
    return String(text ?? '').replace(/([_*`\[])/g, '\\$1');
}

function etoOshibkaMarkdown(err) {
    const msg = String(err?.message || err?.response?.body?.description || '');
    return /parse entities|can't parse|entity/i.test(msg);
}

function optsBezMarkdown(opts) {
    if (!opts || typeof opts !== 'object') return opts;
    const copy = { ...opts };
    delete copy.parse_mode;
    return copy;
}

function vklyuchitMarkdownFallback() {
    const sendMessage = bot.sendMessage.bind(bot);
    const editMessageText = bot.editMessageText.bind(bot);
    const sendPhoto = bot.sendPhoto.bind(bot);

    bot.sendMessage = async (chatId, text, opts) => {
        try {
            return await sendMessage(chatId, text, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] sendMessage:', e.message || e);
                return sendMessage(chatId, text, optsBezMarkdown(opts));
            }
            throw e;
        }
    };

    bot.editMessageText = async (text, opts) => {
        try {
            return await editMessageText(text, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] editMessageText:', e.message || e);
                return editMessageText(text, optsBezMarkdown(opts));
            }
            throw e;
        }
    };

    bot.sendPhoto = async (chatId, photo, opts) => {
        try {
            return await sendPhoto(chatId, photo, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] sendPhoto:', e.message || e);
                return sendPhoto(chatId, photo, optsBezMarkdown(opts));
            }
            throw e;
        }
    };
}

vklyuchitMarkdownFallback();

let pollingZapuschen = false;
let konflikt409Popytki = 0;
const MAX_409_POVTOROV = 8;

function etoOshibka409(err) {
    return err?.response?.statusCode === 409
        || (err?.message && String(err.message).includes('409'));
}

async function zapustitPolling() {
    if (pollingZapuschen) return;
    await bot.deleteWebHook({ drop_pending_updates: true });
    await bot.startPolling();
    pollingZapuschen = true;
    konflikt409Popytki = 0;
}

async function perezapuskPosle409() {
    konflikt409Popytki += 1;
    if (konflikt409Popytki > MAX_409_POVTOROV) {
        console.error(
            '409: второй процесс с тем же TELEGRAM_TOKEN. Останови локальный node bot.js, на Railway — 1 реплика.\n' +
            'Бот продолжит попытки каждые 30с (контейнер не падает).'
        );
        konflikt409Popytki = MAX_409_POVTOROV;
    }
    const sek = konflikt409Popytki > MAX_409_POVTOROV ? 30 : Math.min(konflikt409Popytki * 3, 15);
    console.warn('409 конфликт — другой getUpdates. Пауза ' + sek + 'с, попытка ' + konflikt409Popytki + '/' + MAX_409_POVTOROV);
    try { await bot.stopPolling(); } catch (_) {}
    pollingZapuschen = false;
    await new Promise(r => setTimeout(r, sek * 1000));
    try {
        await zapustitPolling();
        console.log('✅ Polling снова активен');
    } catch (e) {
        if (etoOshibka409(e)) await perezapuskPosle409();
        else console.error('[polling restart]', e.message || e);
    }
}

bot.on('polling_error', (err) => {
    if (etoOshibka409(err)) {
        perezapuskPosle409().catch(e => console.error('[409 handler]', e.message || e));
        return;
    }
    console.error('[polling_error]', err.message || err);
});

// ID администратора для загрузки картинок
const ADMIN_TG_ID = parseInt(process.env.ADMIN_TG_ID || '0');
if (ADMIN_TG_ID) {
    console.log('🔐 Режим админа: tg_id', ADMIN_TG_ID);
} else {
    console.warn('⚠️ ADMIN_TG_ID не задан — загрузка фото ролей отключена');
}

const ROL_VEDUSHCHIY = 'vedushchiy';
function isVedushchiy(rol) {
    return rol === ROL_VEDUSHCHIY || rol === 'vedushchii';
}

function klubIdIzSostoyaniyaNaznacha(tg_id) {
    const st = sostoyanie[tg_id];
    if (!st) return null;
    if (typeof st === 'string' && st.startsWith('naznach_poisk_')) {
        return st.replace('naznach_poisk_', '');
    }
    if (st?.naznach_klub_id) return st.naznach_klub_id;
    if (st?.naznach_podtv?.klub_id) return st.naznach_podtv.klub_id;
    return null;
}

async function naznachitVedushchegoVKlube(klub_id, igrok_id) {
    const { data: sushch, error: errQ } = await supabase
        .from('chleny_klubov')
        .select('id, rol')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .maybeSingle();

    if (errQ) return { ok: false, error: errQ.message };
    if (sushch?.rol === 'vladyelets') return { ok: false, error: 'owner' };
    if (sushch && isVedushchiy(sushch.rol)) return { ok: true, already: true };

    if (sushch) {
        let { error } = await supabase
            .from('chleny_klubov')
            .update({ rol: ROL_VEDUSHCHIY })
            .eq('id', sushch.id);
        if (error && String(error.message || '').includes('rol')) {
            ({ error } = await supabase.from('chleny_klubov').update({ rol: 'vedushchii' }).eq('id', sushch.id));
        }
        if (error) return { ok: false, error: error.message };
    } else {
        let { error } = await supabase
            .from('chleny_klubov')
            .insert({ klub_id, igrok_id, rol: ROL_VEDUSHCHIY });
        if (error && String(error.message || '').includes('rol')) {
            ({ error } = await supabase.from('chleny_klubov').insert({ klub_id, igrok_id, rol: 'vedushchii' }));
        }
        if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
}

async function uvedomitONaznacheniiVedushchego(igrok_id, klub_id) {
    const { data: igrok } = await supabase.from('igroki').select('imya, tg_id').eq('id', igrok_id).single();
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
    if (igrok?.tg_id) {
        bot.sendMessage(igrok.tg_id,
            '🎤 *Вас назначили ведущим!*\n\n🎴 Клуб: *' + md(klub?.nazvaniye || '') + '*\n\nНапиши /start чтобы открыть меню ведущего.',
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }
    return { igrok, klub };
}

async function klubyVladeltsa(owner_tg_id) {
    const { data: owner } = await supabase.from('igroki').select('id').eq('tg_id', owner_tg_id).single();
    const ids = new Set();

    if (owner?.id) {
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id')
            .eq('igrok_id', owner.id)
            .eq('rol', 'vladyelets');
        (chleny || []).forEach(c => ids.add(c.klub_id));
    }

    const { data: kluby } = await supabase
        .from('kluby')
        .select('id, nazvaniye')
        .eq('owner_tg_id', owner_tg_id);
    (kluby || []).forEach(k => ids.add(k.id));

    const klubySpisok = kluby || [];
    const { data: vse } = ids.size
        ? await supabase.from('kluby').select('id, nazvaniye').in('id', [...ids])
        : { data: [] };
    return (vse || klubySpisok).filter(k => ids.has(k.id));
}

async function klubIdDlyaNaznacheniyaVedushchego(owner_tg_id, igrok_id) {
    const kluby = await klubyVladeltsa(owner_tg_id);
    if (!kluby.length) return { error: 'no_clubs' };
    if (kluby.length === 1) return { klub_id: kluby[0].id, klub: kluby[0] };

    const izSost = klubIdIzSostoyaniyaNaznacha(owner_tg_id);
    if (izSost && kluby.some(k => k.id === izSost)) return { klub_id: izSost, klub: kluby.find(k => k.id === izSost) };

    const ids = kluby.map(k => k.id);
    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('klub_id')
        .eq('igrok_id', igrok_id)
        .in('klub_id', ids);
    const vKlube = (chlen || []).map(c => c.klub_id);
    if (vKlube.length === 1) return { klub_id: vKlube[0], klub: kluby.find(k => k.id === vKlube[0]) };

    return { error: 'pick_club', kluby };
}

function igrokIdIzNcfm(data) {
    const rest = String(data.replace('ncfm_', ''));
    const packed = cbUnpack(rest);
    if (packed?.igrok_id) return { igrok_id: packed.igrok_id, klub_id: packed.klub_id || null };
    if (/^[0-9a-f-]{36}$/i.test(rest)) return { igrok_id: rest, klub_id: null };
    return null;
}

function callbackNaznacheniyaVedushchego(igrok_id) {
    return 'nda_' + igrok_id;
}

async function zavershitNaznachenieVedushchego(chatId, messageId, owner_tg_id, klub_id, igrok_id) {
    const rez = await naznachitVedushchegoVKlube(klub_id, igrok_id);
    console.log('[naznach]', { owner_tg_id, klub_id, igrok_id, rez });

    if (!rez.ok) {
        const msg = rez.error === 'owner'
            ? '❌ Собственника нельзя назначить ведущим'
            : '❌ Ошибка: ' + (rez.error || 'не удалось сохранить');
        await bot.editMessageText(msg, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    sostoyanie[owner_tg_id] = 'naznach_poisk_' + klub_id;
    const { igrok } = await uvedomitONaznacheniiVedushchego(igrok_id, klub_id);
    const tekst = rez.already
        ? 'ℹ️ *' + md(igrok?.imya || 'Игрок') + '* уже ведущий этого клуба.'
        : '✅ *' + md(igrok?.imya || 'Игрок') + '* назначен ведущим!';

    await bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🎤 Назначить ещё', callback_data: 'naznachit_vedushchego' }],
            [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
        ]}
    });
}

function razobrat_datu_anonsa(vvod) {
    if (!vvod) return null;
    const s = String(vvod).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (m1) {
        let god = parseInt(m1[3], 10);
        if (god < 100) god += 2000;
        return god + '-' + String(m1[2]).padStart(2, '0') + '-' + String(m1[1]).padStart(2, '0');
    }

    const mesyacy = {
        'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
        'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
        'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
        'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12
    };
    const m2 = s.match(/^(\d{1,2})\s+([а-яё]+)/i);
    if (m2) {
        const mes = mesyacy[m2[2].toLowerCase()];
        if (mes) {
            const den = parseInt(m2[1], 10);
            const seychas = new Date();
            let god = seychas.getFullYear();
            const kandidat = new Date(god, mes - 1, den);
            if (kandidat < new Date(seychas.getFullYear(), seychas.getMonth(), seychas.getDate())) {
                god += 1;
            }
            return god + '-' + String(mes).padStart(2, '0') + '-' + String(den).padStart(2, '0');
        }
    }
    return null;
}

function formatDataAnonsa(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return d.replace(/^0/, '') + '.' + m.replace(/^0/, '') + '.' + y;
}

function isAdmin(tg_id) {
    return ADMIN_TG_ID > 0 && tg_id === ADMIN_TG_ID;
}

// Telegram: callback_data максимум 64 байта
const _cbStore = new Map();
let _cbSeq = 0;

function cbPack(data) {
    _cbSeq = (_cbSeq % 999000) + 1;
    _cbStore.set(_cbSeq, { ...data, _t: Date.now() });
    return _cbSeq;
}

function cbUnpack(id) {
    return _cbStore.get(Number(id)) || null;
}

function cbBtn(prefix, data) {
    const id = cbPack(data);
    const s = prefix + id;
    const len = Buffer.byteLength(s, 'utf8');
    if (len > 64) console.error('[cbBtn] превышен лимит', len, prefix, data);
    return s;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _cbStore) {
        if (now - v._t > 3600000) _cbStore.delete(k);
    }
}, 600000);

process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    console.error('[unhandledRejection]', msg);
    if (msg.includes('BUTTON_DATA_INVALID')) {
        console.error('→ Нажмите /start для нового меню (старая кнопка с длинным callback)');
    }
});

function sanitizeInlineKeyboard(reply_markup) {
    if (!reply_markup?.inline_keyboard) return reply_markup;
    for (const row of reply_markup.inline_keyboard) {
        for (const btn of row) {
            if (!btn.callback_data) continue;
            const len = Buffer.byteLength(String(btn.callback_data), 'utf8');
            if (len > 64) {
                console.error('[sanitize] callback >64 байт:', len, btn.callback_data);
                btn.callback_data = 'baza_noop';
            }
        }
    }
    return reply_markup;
}

const _sendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = async function(chatId, text, opts = {}) {
    if (opts.reply_markup) sanitizeInlineKeyboard(opts.reply_markup);
    try {
        return await _sendMessage(chatId, text, opts);
    } catch (e) {
        if (String(e.message || e).includes('BUTTON_DATA_INVALID')) {
            console.error('[sendMessage BUTTON_DATA_INVALID]', e.message);
            return _sendMessage(chatId, text + '\n\n_Нажми /start — обнови меню._', { parse_mode: opts.parse_mode || 'Markdown' });
        }
        throw e;
    }
};

const _editMessageText = bot.editMessageText.bind(bot);
bot.editMessageText = async function(text, opts = {}) {
    if (opts.reply_markup) sanitizeInlineKeyboard(opts.reply_markup);
    try {
        return await _editMessageText(text, opts);
    } catch (e) {
        if (String(e.message || e).includes('BUTTON_DATA_INVALID')) {
            console.error('[editMessageText BUTTON_DATA_INVALID]', e.message);
            const chatId = opts.chat_id;
            if (chatId) {
                return _sendMessage(chatId, text + '\n\n_Нажми /start — обнови меню._', { parse_mode: opts.parse_mode || 'Markdown' });
            }
        }
        throw e;
    }
};

// ============================================
// СОСТАВЫ
// ============================================

// ── ПАСКАЛЬ (городская, базовая) ──────────────────
const sostavy = {
    8:  ['Дон', 'Мафия', 'Шериф', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    10: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    11: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    12: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    13: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный'],
    14: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    15: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    16: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    17: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Любовница', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── ВИП (городская профессиональная) ─────────────
// Мафия: Дон, Путана, Подрывник мафии, Мафия
// Мирные: Комиссар, Доктор, Стрелок, Стрелочник, Камикадзе, Любовница, Мирный
// Сам за себя: Маньяк
const sostavy_vip = {
    8:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Маньяк', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    10: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    11: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Маньяк', 'Мирный', 'Мирный'],
    12: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Маньяк', 'Мирный', 'Мирный'],
    13: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Маньяк', 'Мирный'],
    14: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    15: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    16: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный'],
    17: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── НАИЛЯ (Москва) ────────────────────────────────
// Мирные: Детектив, Доктор, Ведьма, Бомба, Безликий, Адвокат, Мстительный родственник, Мирный
// Мафия: Дон, Мафия
// Сам за себя: Маньяк
const sostavy_naila = {
    8:  ['Дон', 'Мафия', 'Детектив', 'Доктор', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    10: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    11: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    12: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    13: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    14: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    15: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    16: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    17: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── СПОРТИВНАЯ (классика 10 человек) ─────────────
const sostavy_sport = {
    10: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── ОПИСАНИЯ РОЛЕЙ (для раздачи в личку) ─────────
const roli_opisaniya = {
    // Мафия
    'Дон': '\uD83D\uDD34 *Дон мафии*\n\nТы — глава мафии. Знаешь всю команду. Ночью выбираете жертву вместе, твоё слово решающее. Можешь искать Шерифа/Комиссара.',
    'Мафия': '\uD83D\uDD34 *Мафия*\n\nТы — часть команды мафии. Знаешь своих. Ночью голосуете за жертву.',
    'Путана': '\uD83D\uDD34 *Путана (Эскортница)*\n\nЧасть мафии. Ночью называешь роль игрока. Угадала — он не переживает утро. Промахнулась — остаётся.\n\nВыстрелов за ночь: до 11 игроков — 1, с 12 до 14 — 2, от 15 — 3.',
    'Эскортница': '\uD83D\uDD34 *Эскортница*\n\nЧасть мафии. Ночью называешь роль игрока. Угадала — он не переживает утро. Промахнулась — остаётся.\n\nВыстрелов за ночь: до 11 игроков — 1, с 12 до 14 — 2, от 15 — 3.\n\u2B50 За угаданную роль: *+0.5 балла*.',
    'Подрывник мафии': '\uD83D\uDD34 *Подрывник мафии*\n\nЧасть мафии. Если в тебя выстрелит Стрелок или Маньяк — ты забираешь стрелявшего с собой.',
    'Консильери': '\uD83D\uDD34 *Консильери*\n\nЧасть мафии. Советник Дона.',
    // Мирные
    'Шериф': '\uD83D\uDFE2 *Шериф*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия.',
    'Комиссар': '\uD83D\uDFE2 *Комиссар (Детектив)*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Детектив': '\uD83D\uDFE2 *Детектив*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Доктор': '\uD83D\uDFE2 *Доктор*\n\nКаждую ночь спасаешь одного игрока от одного ночного выстрела.\n\n\u274C Если в игрока стреляли и мафия, и маньяк — доктор его не спасает.\n\nPascal: одного и того же игрока можно лечить сколько угодно, себя — до 2 ночей подряд.\nVIP: нельзя лечить одного игрока две ночи подряд, себя — через ночь.',
    'Подрывник': '\uD83D\uDFE2 *Подрывник*\n\nЕсли ночью тебя убивает мафия — ты взрываешься и забираешь с собой того мафиози, которого выбрал.',
    'Охотник': '\uD83D\uDFE2 *Охотник (Стрелок)*\n\nКаждую ночь можешь выстрелить в игрока. Убил 2 мирных — выбываешь сам.',
    'Стрелок': '\uD83D\uDFE2 *Стрелок*\n\nКаждую ночь можешь выстрелить. Убил 2 мирных — выбываешь. За правильный отстрел мафии +0.5 балла.',
    'Стрелочник': '\uD83D\uDFE2 *Стрелочник*\n\nЕсли в тебя стреляли ночью — можешь перекинуть выстрел на другого. Попал в мафию — уходит мафия. Попал в мирного — уходишь ты.',
    'Камикадзе': '\uD83D\uDFE2 *Камикадзе*\n\nКаждую ночь идёшь к игроку. Пошёл к мафии — вы оба выбываете. К мирному/маньяку — ничего.',
    'Бессмертный': '\uD83D\uDFE2 *Бессмертный — Мирный житель*\n\nПросыпаешься только в первую ночь для знакомства с ведущим.\n\n\uD83D\uDEE1\uFE0F Не умирает от выстрела мафии и стрелка.\n\u274C Умирает от: эскортницы (если угадали роль), выстрела маньяка, голосования днём.\n\n\uD83C\uDFAF Задача: притягивай выстрелы мафии на себя.',
    'Шахид': '\uD83D\uDFE2 *Шахид*\n\nПри выбывании забираешь с собой случайных игроков.',
    'Затычка': '\uD83D\uDFE2 *Затычка — Мирный житель*\n\nКаждую ночь просыпаешься и выбираешь одного игрока.\n\n\uD83D\uDD07 Заблокированный игрок:\n— лишается своей минуты речи на дне\n— не может голосовать\n— но может быть выставлен на голосование другими\n\n\uD83C\uDFAF Задача: найди мафию и лишай её голоса.\n\u2B50 За правильный ход: *+0.5 балла*',
    'Любовница': '\uD83D\uDFE2 *Любовница*\n\nМожешь заблокировать роль одного игрока на голосовании.',
    'Ведьма': '\uD83D\uDFE2 *Ведьма*\n\nОдин раз за игру можешь воскресить выбывшего игрока. Просыпаешься каждую ночь до воскрешения. Если выбываешь до — вскрой карту и остаёшься за столом.',
    'Бомба': '\uD83D\uDFE2 *Бомба*\n\nПервые 3 ночи минируешь 30% стола. Если выбываешь — взрываешься вместе с заминированными.',
    'Безликий': '\uD83D\uDFE2 *Безликий*\n\nПросыпаешься на 3-ю ночь первым. Выбираешь: 1 палец — остаться за мирных, 2 — перейти в мафию, 3 — перейти к маньяку.',
    'Адвокат': '\uD83D\uDFE2 *Адвокат*\n\nМожешь показать карту на голосовании и спасти игрока. Вместо него выбирается другой.',
    'Мстительный родственник': '\uD83D\uDFE2 *Мстительный родственник*\n\nЕсли тебя убили — вскрываешь карту и забираешь с собой любого игрока.',
    // Соло
    'Маньяк': '\uD83C\uDFAF *Маньяк — Серая команда*\n\nИграешь сам за себя. Держи баланс между мирными и мафией.\n\n\uD83D\uDC4D При проверке Комиссара показываешься как мирный — пока за столом есть мафия.\n\n\uD83C\uDFC6 Победа: остался один на один с любым игроком.\n\u2B50 За победу: *5 баллов* + 0.5 за каждое убийство мафии.',
    // Мирный
    'Мирный': '\uD83D\uDFE2 *Мирный житель*\n\nНочью не просыпаешься. Логикой и ораторством вычисляй мафию. Победа — когда не останется ни мафии ни маньяка.'
};

// ── МАППИНГ: тип клуба → составы ─────────────────
function poluchit_sostav(kolichestvo, tip_kluba) {
    if (tip_kluba === 'vip') return sostavy_vip[kolichestvo] || sostavy[kolichestvo];
    if (tip_kluba === 'naila') return sostavy_naila[kolichestvo] || sostavy[kolichestvo];
    if (tip_kluba === 'sportivniy') return sostavy_sport[kolichestvo] || sostavy[kolichestvo];
    return sostavy[kolichestvo]; // паскаль и все остальные
}

// sostav_sport теперь в sostavy_sport объекте выше

// Базовые очки по умолчанию
const BALLY_DEFAULT = {
    pobeda_komanda: 2,
    porazhenie: 0,
    vyzhil: 0.25,
    ubit_v_pervuyu_noch: 0,
    luchshiy_hod_za_mafiyu: 1,
    bonus_sheriff_nashel_maf: 0.5,
    bonus_doctor_spas: 0.5,
    bonus_bessmertnyy_prinyal_vystrel: 0.5,
    bonus_eskort_ugadala_rol: 0.5,
    bonus_don_nashel_sherifa_n1: 0.5,
    bonus_kamikadze_mafiya: 0.5,
    bonus_den1_vygolosovan: 0.25,
    mafiya_pobedila_vybyl: 3,
    mafiya_pobedila_vyzhil: 4,
    bonus_don_pobedil: 0,
    bonus_manyak_pobedil: 5,
    bonus_pravilnyy_otstrel_mafii: 0.5
};

const SOGLASIE_VERSIYA = '2026-05-29';

function tekstEkranaSoglasiya() {
    return '👋 *Добро пожаловать в Prime Mafia!*\n\n' +
        'Перед регистрацией ознакомься и прими:\n' +
        '• публичную оферту\n' +
        '• политику конфиденциальности\n\n' +
        '_Мы обрабатываем данные только для игр, клубов, рейтинга и сервисных функций. ' +
        'Материалы клуба используются только внутри Prime Mafia и не передаются другим клубам._';
}

function knopkiEkranaSoglasiya() {
    return [
        [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
        [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
        [{ text: '✅ Принимаю условия', callback_data: 'reg_soglasie_prinyat' }],
        [{ text: '❌ Не принимаю', callback_data: 'reg_soglasie_otkaz' }]
    ];
}

function tekstOffertaKratko() {
    return '📄 *Публичная оферта Prime Mafia*\n\n' +
        '• Сервис автоматизирует игры, рейтинг, клубы и анонсы.\n' +
        '• Платные услуги: игры, пакеты, анонсы, персонализация клуба.\n' +
        '• Материалы клуба используются только внутри Prime Mafia.\n' +
        '• Код, логика и интерфейс защищены авторским правом.\n' +
        '• Клуб и ведущий отвечают за корректность введённых данных.\n' +
        '• Персональные данные обрабатываются по политике конфиденциальности.\n\n' +
        'Полный текст: `OFFERTA.md` в проекте.\n' +
        'Контакт: silena005@gmail.com';
}

function tekstPrivacyKratko() {
    return '🔒 *Политика конфиденциальности Prime Mafia*\n\n' +
        'Мы обрабатываем:\n' +
        '• Telegram ID, username, имя\n' +
        '• игровой ник, телефон, город\n' +
        '• данные игр, ролей, рейтинга и клубов\n\n' +
        'Данные хранятся в Supabase и используются только для работы Сервиса. ' +
        'Мы не продаём персональные данные.\n\n' +
        'Запрос на выгрузку или удаление: silena005@gmail.com\n' +
        'Тема письма: *PRIME MAFIA — DATA REQUEST*';
}

async function pokazatEkranSoglasiya(chatId, messageId) {
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopkiEkranaSoglasiya() }
    };
    if (messageId) {
        await bot.editMessageText(tekstEkranaSoglasiya(), { chat_id: chatId, message_id: messageId, ...opts });
    } else {
        await bot.sendMessage(chatId, tekstEkranaSoglasiya(), opts);
    }
}

async function sohranitSoglasiePolzovatelya(igrok_id, tg_id) {
    const payload = {
        soglasie_offerta: true,
        soglasie_versiya: SOGLASIE_VERSIYA,
        soglasie_data: new Date().toISOString()
    };
    const query = igrok_id
        ? supabase.from('igroki').update(payload).eq('id', igrok_id)
        : supabase.from('igroki').update(payload).eq('tg_id', tg_id);
    const { error } = await query;
    if (error) console.error('Не удалось сохранить согласие (возможно, нет колонок в igroki):', error.message);
}

// ============================================
// ПАМЯТЬ БОТА (временная, до полного перехода на БД)
// ============================================

const sostoyanie = {}; // { telegram_id: 'vvodit_kod' | 'baza_poisk_<klub_id>' }
const igry = {};       // активные игры в памяти (кэш)
const ruchnyeRezultaty = {}; // черновики ручного внесения игр без процесса

// ============================================
// ПЕРСИСТЕНТНОСТЬ ИГР
// ============================================

// Сохранить игру в Supabase
async function sohranit_igru(kod) {
    const igra = igry[kod];
    if (!igra || igra._ne_sohranyat) return;
    try {
        const nastroyki = {
            ...(igra._nastroyki || {}),
            rezhim_rolei: igra.rezhim_rolei || null,
            klub_nazvaniye: nazvanieKlubaIgry(igra) || null,
            luchshie_hody: igra.luchshie_hody || [],
            ostanovlena: !!igra.ostanovlena,
            data_igry: igra.data_igry || igra._nastroyki?.data_igry || null,
            nomer_igry: igra.nomer_igry || igra._nastroyki?.nomer_igry || null
        };
        const data = {
            kod,
            klub_id: igra.klub_id || null,
            vedushchii_tg_id: igra.vedushchii_id || null,
            kolichestvo: igra.kolichestvo,
            tip_kluba: igra.tip_kluba || 'paskal',
            sportivniy: igra.sportivniy || false,
            igroki: JSON.stringify(igra.igroki || []),
            faza: igra.faza || 'ozhidanie',
            den: igra.den || 1,
            nastroyki: JSON.stringify(nastroyki),
            noch_deystviya: JSON.stringify(igra.noch_deystviya || {}),
            naznacheny_golos: JSON.stringify(igra.naznacheny_golos || []),
            obnovlena_v: new Date().toISOString(),
            zavershena: false
        };
        await supabase.from('aktivnye_igry').upsert(data, { onConflict: 'kod' });
    } catch(e) {
        console.error('Ошибка сохранения игры:', e.message);
    }
}

// Удалить игру из Supabase при завершении
async function zavershit_igru_v_db(kod) {
    try {
        const igra = igry[kod] || igry['archive_' + kod];
        const nastroyki = {
            ...(igra?._nastroyki || {}),
            rezhim_rolei: igra?.rezhim_rolei || null,
            pobeditel: igra?.pobeditel || null,
            data_igry: igra?.data_igry || igra?._nastroyki?.data_igry || null,
            nomer_igry: igra?.nomer_igry || igra?._nastroyki?.nomer_igry || null
        };
        await supabase.from('aktivnye_igry').update({
            zavershena: true,
            igroki: JSON.stringify(igra?.igroki || []),
            nastroyki: JSON.stringify(nastroyki),
            obnovlena_v: new Date().toISOString()
        }).eq('kod', kod);
    } catch(e) {}
}

// Загрузить все активные игры при старте
async function zagruzit_aktivnye_igry() {
    try {
        const { data: rows } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('zavershena', false);
        let count = 0;
        (rows || []).forEach(row => {
            if (!igry[row.kod]) {
                const nastroyki = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki) : (row.nastroyki || {});
                igry[row.kod] = {
                    kolichestvo: row.kolichestvo,
                    vedushchii_id: row.vedushchii_tg_id,
                    klub_id: row.klub_id,
                    klub_nazvaniye: nastroyki.klub_nazvaniye || null,
                    tip_kluba: row.tip_kluba || 'paskal',
                    sportivniy: row.sportivniy || false,
                    igroki: typeof row.igroki === 'string' ? JSON.parse(row.igroki) : (row.igroki || []),
                    faza: row.faza || 'ozhidanie',
                    den: row.den || 1,
                    rezhim_rolei: nastroyki.rezhim_rolei || null,
                    luchshie_hody: nastroyki.luchshie_hody || [],
                    ostanovlena: !!nastroyki.ostanovlena,
                    _nastroyki: nastroyki,
                    noch_deystviya: typeof row.noch_deystviya === 'string' ? JSON.parse(row.noch_deystviya) : (row.noch_deystviya || {}),
                    naznacheny_golos: typeof row.naznacheny_golos === 'string' ? JSON.parse(row.naznacheny_golos) : (row.naznacheny_golos || []),
                    roli_razdany: (row.igroki && (typeof row.igroki === 'string' ? JSON.parse(row.igroki) : row.igroki).some(i => i.rol)),
                    _vosstanovlena: true
                };
                count++;
            }
        });
        if (count > 0) console.log('\u2705 Восстановлено игр из БД:', count);
    } catch(e) {
        console.error('Ошибка загрузки игр:', e.message);
    }
}

// Запускаем загрузку при старте
zagruzit_aktivnye_igry();

// Состояние регистрации: { tg_id: { shag: 'imya' | 'telefon', imya: '...' } }
const ozhidanie_registracii = {};

// ============================================
// ФУНКЦИИ
// ============================================

function peremeshat(massiv) {
    const novyi = [...massiv];
    for (let i = novyi.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [novyi[i], novyi[j]] = [novyi[j], novyi[i]];
    }
    return novyi;
}

function sgenerirovat_kod() {
    let kod;
    do {
        kod = String(Math.floor(1000 + Math.random() * 9000));
    } while (igry[kod]);
    return kod;
}

// ============================================
// МЕНЮ
// ============================================

const menu_vedushchego = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
            [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
            [{ text: '🏛 Игры клуба', callback_data: 'igry_kluba' }],
            [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
            [{ text: '📋 Внести результаты', callback_data: 'vnesti_rezultaty' }],
            [{ text: '📢 Создать анонс игры', callback_data: 'anons_vybor_kluba' }],
            [{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_igroka = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' }],
            [{ text: '📢 Анонсы игр', callback_data: 'anonsy_goroda' }],
            [{ text: '🎮 Играть с друзьями', callback_data: 'druzya_menu' }],
            [{ text: '🏆 Мой рейтинг', callback_data: 'moy_reyting' }],
            [{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }],
            [{ text: '📄 Оферта и конфиденциальность', callback_data: 'legal_menu' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_vladeltsa = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [{ text: '📊 Аналитика', callback_data: 'analitika' }],
            [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
            [{ text: '🏛 Игры клуба', callback_data: 'igry_kluba' }],
            [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
            [{ text: '🏆 Рейтинг и баллы', callback_data: 'reyting_vybor_kluba' }],
            [{ text: '👥 База игроков', callback_data: 'baza_igrokov' }],
            [{ text: '🎤 Назначить ведущего', callback_data: 'naznachit_vedushchego' }],
            [{ text: '📢 Создать анонс игры', callback_data: 'anons_vybor_kluba' }],
            [{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_vse' }],
            [{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }],
            [{ text: '⚙️ Настройки клуба', callback_data: 'nastroyki_kluba_v' }],
            [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_kolichestva = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '8', callback_data: 'create_8' },
                { text: '9', callback_data: 'create_9' },
                { text: '10', callback_data: 'create_10' },
                { text: '11', callback_data: 'create_11' }
            ],
            [
                { text: '12', callback_data: 'create_12' },
                { text: '13', callback_data: 'create_13' },
                { text: '14', callback_data: 'create_14' },
                { text: '15', callback_data: 'create_15' }
            ],
            [
                { text: '16', callback_data: 'create_16' },
                { text: '17', callback_data: 'create_17' },
                { text: '18', callback_data: 'create_18' }
            ],
            [
                { text: '19', callback_data: 'create_19' },
                { text: '20', callback_data: 'create_20' }
            ],
            [
                { text: '⬅️ Назад', callback_data: 'menu_vedushchego' }
            ]
        ]
    }
};

const bystrayaKlaviaturaVedushchego = {
    reply_markup: {
        keyboard: [
            ['🏠 Меню', '🌙 Игровой вечер'],
            ['🎮 Мои игры', '🎲 Создать игру'],
            ['⏸ Пауза/стоп', '▶️ Возобновить'],
            ['🗑 Удалить игру']
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

bot.setMyCommands([
    { command: 'start', description: 'Открыть меню' },
    { command: 'games', description: 'Мои игры' },
    { command: 'pause', description: 'Остановить активную игру' },
    { command: 'resume', description: 'Возобновить игру' }
]).catch(e => console.error('[commands]', e?.message || e));

async function pokazatBystryeKnopkiVedushchego(chatId) {
    await bot.sendMessage(chatId, '⚡ Быстрые кнопки ведущего включены.', bystrayaKlaviaturaVedushchego).catch(() => {});
}

const TEST_LIMIT_IGRY = 2;
const TEST_LIMIT_DNEY = 7;
// true — блокировать старт игры после исчерпания теста; false — только считать и показывать статус
const ENFORCE_TRIAL_LIMITS = process.env.ENFORCE_TRIAL_LIMITS === 'true';

function formatDatyRu(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
}

function dataOkonchaniyaTesta(nachaloIso, dney) {
    const [y, m, d] = String(nachaloIso).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + (dney ?? TEST_LIMIT_DNEY)));
    return dt.toISOString().slice(0, 10);
}

async function poluchitNastroykiKlubaBilling(klub_id) {
    const { data } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
    return { ...(data?.nastroyki || {}) };
}

async function sohranitNastroykiKlubaBilling(klub_id, nastroyki) {
    await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);
}

async function nachatTestovuyuNedelyuKluba(klub_id) {
    const n = await poluchitNastroykiKlubaBilling(klub_id);
    if (n.test?.nachalo) return n;
    n.test = {
        nachalo: dataIgrovoegoVechera(),
        igry_ispolzovano: 0,
        limit_igry: TEST_LIMIT_IGRY,
        dney: TEST_LIMIT_DNEY
    };
    if (!n.tarif_status) n.tarif_status = 'test';
    await sohranitNastroykiKlubaBilling(klub_id, n);
    return n;
}

function raschetStatusaTarifa(nastroyki) {
    const seg = dataIgrovoegoVechera();
    const test = nastroyki.test || {};
    const balans = parseInt(nastroyki.igry_balans, 10) || 0;

    if (nastroyki.tarif_status === 'oplachen' || balans > 0) {
        return {
            mozhno: balans > 0 || nastroyki.tarif_status === 'oplachen',
            tip: 'oplachen',
            balans,
            tekst: balans > 0
                ? ('Оплаченный пакет: осталось *' + balans + '* игр')
                : 'Подписка клуба активна'
        };
    }

    if (!test.nachalo) {
        return { mozhno: true, tip: 'net_testa', tekst: 'Тестовая неделя ещё не активирована' };
    }

    const konets = dataOkonchaniyaTesta(test.nachalo, test.dney ?? TEST_LIMIT_DNEY);
    const limit = test.limit_igry ?? TEST_LIMIT_IGRY;
    const ispolz = test.igry_ispolzovano || 0;
    const ostatok = Math.max(0, limit - ispolz);
    const vremya_ok = seg < konets;

    if (!vremya_ok) {
        return {
            mozhno: false,
            tip: 'test_istek',
            tekst: 'Тестовая неделя закончилась (' + formatDatyRu(konets) + ')',
            konets,
            ostatok: 0,
            ispolz,
            limit
        };
    }
    if (ostatok <= 0) {
        return {
            mozhno: false,
            tip: 'test_igry_konchilis',
            tekst: 'Тестовые игры использованы (*' + limit + ' из ' + limit + '*)',
            konets,
            ostatok: 0,
            ispolz,
            limit
        };
    }
    return {
        mozhno: true,
        tip: 'test',
        tekst: 'Тестовая неделя: *' + ostatok + '* из *' + limit + '* игр до *' + formatDatyRu(konets) + '*',
        konets,
        ostatok,
        ispolz,
        limit,
        nachalo: test.nachalo
    };
}

function tekstTestovoyNedeli(nazvanieKluba) {
    return '🎁 *Тестовая неделя для клуба*\n\n' +
        'Клуб: *' + md(nazvanieKluba) + '*\n\n' +
        'Раньше клубы завидовали тем, у кого есть автоматизация: роли, таймеры, рейтинги, история игр и помощь ведущему.\n' +
        'Теперь это доступно каждому мафия-клубу.\n\n' +
        'Подарок перед основным подключением:\n' +
        '— *2 игры* с полным функционалом ведущего;\n' +
        '— *7 календарных дней* с момента создания клуба;\n' +
        '— лимит списывается только при *реальном старте* игры:\n' +
        '  раздача ролей в боте, «Начать игру» с физическими картами или ночь знакомства;\n' +
        '— создание игры и лобби тест не тратят.\n\n' +
        'После теста:\n' +
        '— разовая игра *500₽*;\n' +
        '— пакет *12 игр от 3000₽* (3 игры в неделю × 4 недели);\n' +
        '— подписка на *3 месяца* — со скидкой;\n' +
        '— подписка на *год* — максимальная скидка.\n\n' +
        'Старт без физических карт и автоматизация ведущего — это отдельная ценность, поэтому после теста клуб выбирает тариф.\n\n' +
        '_Онлайн-оплату подключим отдельно; пока — заявка администратору._';
}

function tekstPaywallPosleTesta() {
    return '⏳ *Тестовая неделя завершена*\n\n' +
        'Бесплатный период клуба закончился: использованы 2 тестовые игры или прошло 7 дней.\n\n' +
        'Чтобы продолжить:\n' +
        '— разовая игра *500₽*;\n' +
        '— пакет *12 игр от 3000₽*.\n\n' +
        'Нажми «Подключить тариф» — оформим оплату или пакет вручную.';
}

async function proveritStartPlatnoyIgry(igra, kod) {
    if (!igra?.klub_id || igra._druzya_rezhim || igra._slot_oplaty) {
        return { ok: true };
    }

    const nastroyki = await poluchitNastroykiKlubaBilling(igra.klub_id);
    const st = raschetStatusaTarifa(nastroyki);

    if (st.tip === 'oplachen' && st.balans > 0) {
        nastroyki.igry_balans = st.balans - 1;
        igra._slot_oplaty = true;
        await sohranitNastroykiKlubaBilling(igra.klub_id, nastroyki);
        return { ok: true, tip: 'balans', info: 'Списана 1 игра с пакета. Осталось: ' + nastroyki.igry_balans, klub_id: igra.klub_id };
    }
    if (st.tip === 'oplachen' && nastroyki.tarif_status === 'oplachen') {
        igra._slot_oplaty = true;
        return { ok: true, tip: 'oplachen', klub_id: igra.klub_id };
    }

    if (st.mozhno && st.tip === 'test') {
        nastroyki.test.igry_ispolzovano = (nastroyki.test.igry_ispolzovano || 0) + 1;
        igra._slot_oplaty = true;
        await sohranitNastroykiKlubaBilling(igra.klub_id, nastroyki);
        const posle = raschetStatusaTarifa(nastroyki);
        return { ok: true, tip: 'test', info: posle.tekst, klub_id: igra.klub_id };
    }

    if (!ENFORCE_TRIAL_LIMITS) {
        return { ok: true, tip: 'soft', preduprezhdenie: st.tekst, klub_id: igra.klub_id };
    }

    return { ok: false, paywall: tekstPaywallPosleTesta(), klub_id: igra.klub_id };
}

async function pokazatBlokStartaIgry(chatId, messageId, query, rez) {
    const alertText = (rez.paywall || rez.preduprezhdenie || 'Нет доступных игр')
        .replace(/\*/g, '')
        .slice(0, 200);
    if (query?.id) {
        await bot.answerCallbackQuery(query.id, { text: alertText, show_alert: true }).catch(() => {});
    }
    const body = rez.paywall || ('⚠️ ' + rez.preduprezhdenie);
    const klub_id = rez.klub_id || '';
    const knopki = [
        [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + klub_id }],
        [{ text: '🎁 О тестовой неделе', callback_data: 'tarif_klub_' + klub_id }],
        [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
    ];
    if (messageId) {
        await bot.editMessageText(body, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        }).catch(() => bot.sendMessage(chatId, body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } }));
    } else {
        await bot.sendMessage(chatId, body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }
}

function tekstStilizatsiiKluba(nazvanieKluba = 'клуб') {
    return '🎨 *Стилизация приложения под клуб*\n\n' +
        'Клуб: *' + md(nazvanieKluba) + '*\n\n' +
        'Можно оформить интерфейс Prime Mafia в стиле вашего клуба:\n' +
        '— цвета и визуальный стиль клуба;\n' +
        '— клубная подача экранов и кнопок;\n' +
        '— ощущение собственного приложения для игроков и ведущих.\n\n' +
        'Стоимость: *5000₽ один раз, навсегда*.\n\n' +
        '_После подключения игроки и ведущие видят интерфейс, стилизованный под ваш клуб._';
}

// ============================================
// КОМАНДА /start
// ============================================

bot.onText(/\/start(?:\s+(.+))?/, async function(msg, match) {
    try {
    await obrabotatStart(msg, match);
    } catch (e) {
        console.error('[/start error]', e.message || e);
        bot.sendMessage(msg.chat.id, '❌ Ошибка запуска. Попробуй ещё раз через минуту.\n\n_' + (e.message || '') + '_', { parse_mode: 'Markdown' }).catch(() => {});
    }
});

async function obrabotatStart(msg, match) {
    // Deep link: /start join_КОД
    const param = match?.[1]?.trim();
    if (param && param.startsWith('join_')) {
        const kod_join = param.replace('join_', '');
        const igra_join = igry[kod_join];
        if (!igra_join) { bot.sendMessage(msg.chat.id, '\u274C Игра не найдена или уже завершена.'); return; }
        const tg_id_j = msg.from.id;
        if (igra_join.igroki.find(i => i.telegram_id === tg_id_j)) {
            bot.sendMessage(msg.chat.id, '\u2705 Ты уже в этой игре!'); return;
        }
        if (igra_join.igroki.length >= igra_join.kolichestvo) {
            bot.sendMessage(msg.chat.id, '\u274C Все места заняты'); return;
        }
        const { data: igrok_j } = await supabase.from('igroki').select('id, imya, igrovoy_nik').eq('tg_id', tg_id_j).single();
        const name_j = igrok_j?.igrovoy_nik || igrok_j?.imya || msg.from.first_name || 'Игрок';
        const nomer_j = igra_join.igroki.length + 1;
        igra_join.igroki.push({ telegram_id: tg_id_j, name: name_j, nomer: nomer_j, status: 'v_igre', foly: 0, igrok_id: igrok_j?.id || null });
        if (igra_join.klub_id && igrok_j?.id) await dobavitChlenaKlubaEsliNuzhno(igra_join.klub_id, igrok_j.id);
        await sohranit_igru(kod_join);
        bot.sendMessage(msg.chat.id, '\u2705 Ты в игре! *\u2116' + nomer_j + ' ' + name_j + '*\n\n\uD83C\uDFB4 Игра: *' + kod_join + '*\n\uD83D\uDC65 ' + igra_join.igroki.length + '/' + igra_join.kolichestvo + '\n\n_Ожидай — ведущий скоро начнёт_', { parse_mode: 'Markdown' });
        if (igra_join.vedushchii_id) bot.sendMessage(igra_join.vedushchii_id, '\uD83D\uDC4B *' + name_j + '* вошёл! ' + igra_join.igroki.length + '/' + igra_join.kolichestvo, { parse_mode: 'Markdown' }).catch(() => {});
        return;
    }
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const tg_username = msg.from.username || '';

    // Проверяем есть ли игрок в базе
    const { data: igrok } = await supabase
        .from('igroki')
        .select('*')
        .eq('tg_id', tg_id)
        .single();

    if (igrok) {
        // Игрок уже зарегистрирован — определяем роль
        const { data: memberships } = await supabase
            .from('chleny_klubov')
            .select('rol')
            .eq('igrok_id', igrok.id);

        const roli = (memberships || []).map(m => m.rol);
        const rol = roli.includes('vladyelets') ? 'vladyelets'
            : roli.some(r => isVedushchiy(r)) ? ROL_VEDUSHCHIY
            : 'igrok';

        if (rol === 'vladyelets') {
            bot.sendMessage(chatId, `🏛 *Привет, ${igrok.imya}!*\n\nМеню собственника`, {
                parse_mode: 'Markdown', ...menu_vladeltsa
            });
            await pokazatBystryeKnopkiVedushchego(chatId);
        } else if (isVedushchiy(rol)) {
            bot.sendMessage(chatId, `🎭 *Привет, ${igrok.imya}!*\n\nМеню ведущего`, {
                parse_mode: 'Markdown', ...menu_vedushchego
            });
            await pokazatBystryeKnopkiVedushchego(chatId);
        } else {
            bot.sendMessage(chatId, `🎴 *Привет, ${igrok.imya}!*\n\nМеню игрока`, {
                parse_mode: 'Markdown', ...menu_igroka
            });
        }
    } else {
        // Новый пользователь — сначала согласие с офертой и политикой
        ozhidanie_registracii[tg_id] = { shag: 'soglasie' };
        return pokazatEkranSoglasiya(chatId);
    }
}

// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================


// ============================================
// ЗАГРУЗКА КАРТИНОК РОЛЕЙ (только для админа)
// ============================================

// Маппинг file_id ролей (заполняется через /upload_role)
const roli_foto = {};

const ALL_ROLE_NAMES = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник мафии', 'Консильери',
                      'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                      'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
                      'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
                      'Мстительный родственник', 'Маньяк', 'Мирный'];

function normalizovatNazvanieRoli(input) {
    const text = String(input || '').trim().toLowerCase();
    if (text === 'путана') return 'Эскортница';
    return ALL_ROLE_NAMES.find(r => r.toLowerCase() === text) || null;
}

async function sohranitFotoRoli(msg, file_id) {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        if (msg.caption) {
            bot.sendMessage(msg.chat.id, '❌ Загрузка картинок ролей доступна только администратору.\n\nНапиши /admin — там инструкция.');
        }
        return;
    }

    // Проверяем caption — должно быть название роли
    const caption = normalizovatNazvanieRoli(msg.caption);
    if (!caption) {
        bot.sendMessage(msg.chat.id, 
            '📸 Картинка получена, но я не понял роль.\n\nОтправь картинку с подписью = название роли.\nПример подписи: Дон\n\nМожно писать с маленькой буквы: ведьма, маньяк.'
        );
        return;
    }

    roli_foto[caption] = file_id;

    // Сохраняем в Supabase для постоянства
    try {
        const { error } = await supabase.from('nastroyki_app').upsert({
            klyuch: 'rol_foto_' + caption,
            znachenie: file_id
        }, { onConflict: 'klyuch' });
        if (error) {
            console.error('❌ Ошибка сохранения картинки роли:', error.message);
            bot.sendMessage(msg.chat.id, '❌ Картинка дошла, но не сохранилась в Supabase.\n\nОшибка: ' + error.message);
            return;
        }
    } catch(e) {
        console.error('❌ Supabase save exception:', e.message);
        bot.sendMessage(msg.chat.id, '❌ Картинка дошла, но не сохранилась.\n\nОшибка: ' + e.message);
        return;
    }

    bot.sendMessage(msg.chat.id,
        '✅ ' + caption + ' — картинка сохранена.'
    );
}

bot.on('photo', async (msg) => {
    const file_id = msg.photo[msg.photo.length - 1].file_id;
    await sohranitFotoRoli(msg, file_id);
});

bot.on('document', async (msg) => {
    const doc = msg.document;
    const mime = doc?.mime_type || '';
    if (!mime.startsWith('image/')) return;
    await sohranitFotoRoli(msg, doc.file_id);
});

// Команда /roles_status — показать какие роли загружены
bot.onText(/\/admin/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        bot.sendMessage(msg.chat.id,
            '🔐 *Режим администратора*\n\n' +
            'Доступ только у владельца бота (ADMIN_TG_ID в Railway).\n\n' +
            'Твой Telegram ID: `' + tg_id + '`\n' +
            '_Добавь его в переменную ADMIN_TG_ID и перезапусти сервис._',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    bot.sendMessage(msg.chat.id,
        '🔐 *Режим администратора*\n\n' +
        '📸 *Загрузка картинок ролей:*\n' +
        'Отправь фото или PNG/JPG-файл с *подписью* = название роли\n' +
        '_Пример подписи: Дон или ведьма_\n\n' +
        '📋 /roles\\_status — какие роли уже загружены',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/roles_status/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) return;

    // Загружаем из Supabase
    const { data: rows, error } = await supabase.from('nastroyki_app')
        .select('klyuch, znachenie')
        .like('klyuch', 'rol_foto_%');
    if (error) {
        console.error('❌ Ошибка статуса картинок:', error.message);
        bot.sendMessage(msg.chat.id, '❌ Не получилось загрузить статус картинок.\n\nОшибка: ' + error.message);
        return;
    }

    const loaded = (rows || []).map(r => r.klyuch.replace('rol_foto_', ''));
    let t = '📸 Статус загрузки картинок:\n\n';
    ALL_ROLE_NAMES.forEach(r => {
        t += (loaded.includes(r) ? '✅' : '❌') + ' ' + r + '\n';
    });
    t += '\nЗагружено: ' + loaded.length + '/' + ALL_ROLE_NAMES.length;

    bot.sendMessage(msg.chat.id, t);
});

// Загрузка file_id при старте бота из Supabase
async function zagruzit_foto_roley() {
    try {
        const { data: rows } = await supabase.from('nastroyki_app')
            .select('klyuch, znachenie')
            .like('klyuch', 'rol_foto_%');
        (rows || []).forEach(r => {
            const rol = r.klyuch.replace('rol_foto_', '');
            roli_foto[rol] = r.znachenie;
        });
        if (rows?.length > 0) console.log('✅ Загружено фото ролей:', rows.length);
    } catch(e) {
        console.log('Фото ролей не загружены:', e.message);
    }
}
zagruzit_foto_roley();


// ============================================
// АВТОАРХИВАЦИЯ АНОНСОВ
// ============================================
async function arhivirovat_starye_anonsy() {
    try {
        const segodnya = new Date().toISOString().slice(0, 10);
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry')
            .eq('status', 'aktiven');
        const ids = (anonsy || []).filter(a => {
            const iso = razobrat_datu_anonsa(a.data_igry) || a.data_igry;
            return iso && iso < segodnya;
        }).map(a => a.id);
        if (ids.length === 0) return;
        const { error } = await supabase
            .from('anonsy')
            .update({ status: 'arhiv' })
            .in('id', ids);
        if (!error) console.log('📦 Архивация анонсов:', ids.length);
    } catch(e) {
        console.error('Ошибка архивации:', e.message);
    }
}
arhivirovat_starye_anonsy();
setInterval(arhivirovat_starye_anonsy, 2 * 60 * 60 * 1000);

function naytiIgruDlyaRuchnyhRoley(tg_id, text) {
    if (!text || !text.includes('\n')) return null;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length < 6) return null;

    const matches = Object.entries(igry).filter(([kod, igra]) => {
        if (String(kod).startsWith('archive_')) return false;
        if (!igra || igra.vedushchii_id !== tg_id) return false;
        if (igra.roli_razdany) return false;
        if (igra.rezhim_rolei && igra.rezhim_rolei !== 'karty') return false;
        if (lines.length !== igra.kolichestvo) return false;
        return lines.every((line, idx) => !!razobratStrokuRoli(line, idx));
    });

    return matches.length === 1 ? matches[0][0] : null;
}

bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const text = (msg.text || '').trim();

    if (text === '🏠 Меню') {
        await obrabotatStart(msg, []);
        return;
    }
    if (text === '🎮 Мои игры' || text === '/games') {
        await pokazatMoiIgryBystraya(chatId, tg_id);
        return;
    }
    if (text === '🌙 Игровой вечер') {
        const kluby = await poluchitKlubyDlyaIgr(tg_id);
        if (kluby.length === 0) {
            await bot.sendMessage(chatId, '🌙 У тебя пока нет клуба для игрового вечера.', bystrayaKlaviaturaVedushchego);
        } else if (kluby.length === 1) {
            const msgVecher = await bot.sendMessage(chatId, '🌙 Открываю игровой вечер...', bystrayaKlaviaturaVedushchego);
            await pokazatIgrovoyVecher(chatId, msgVecher.message_id, kluby[0], tg_id);
        } else {
            const knopki = kluby.map(k => [{ text: '🌙 ' + k.nazvaniye, callback_data: 'vecher_klub_' + k.id }]);
            await bot.sendMessage(chatId, '🌙 *Игровой вечер*\n\nВыбери клуб:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: knopki }
            });
        }
        return;
    }
    if (text === '🎲 Создать игру') {
        await bot.sendMessage(chatId, '🎲 *Создать игру*', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]] }
        });
        return;
    }
    if (text === '⏸ Пауза/стоп' || text === '/pause') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'pause');
        return;
    }
    if (text === '▶️ Возобновить' || text === '/resume') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'resume');
        return;
    }
    if (text === '🗑 Удалить игру') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'delete');
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_date') {
        const dataIso = razobrat_datu_anonsa(text) || (text.toLowerCase() === 'сегодня' ? dataIgrovoegoVechera() : null);
        if (!dataIso) {
            bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *01.06.2026* или напиши *сегодня*.', { parse_mode: 'Markdown' });
            return;
        }
        ozhidanie_registracii[tg_id].data_igry = dataIso;
        ozhidanie_registracii[tg_id].shag = 'manual_result_number';
        bot.sendMessage(chatId, '🎲 Введи номер игры за этот вечер.\n\nНапример: `1`, `2`, `3`.', { parse_mode: 'Markdown' });
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_number') {
        const nomer = parseInt(text, 10);
        if (!Number.isFinite(nomer) || nomer < 1) {
            bot.sendMessage(chatId, '❌ Введи номер игры числом: `1`, `2`, `3`.', { parse_mode: 'Markdown' });
            return;
        }
        ozhidanie_registracii[tg_id].nomer_igry = nomer;
        ozhidanie_registracii[tg_id].shag = 'manual_result_players';
        bot.sendMessage(chatId, tekstVvodaRuchnogoProtokola(), { parse_mode: 'Markdown' });
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_players') {
        const parsed = razobratRuchnoyProtokol(text);
        if (!parsed) {
            bot.sendMessage(chatId,
                '❌ Не смог разобрать состав.\n\n' +
                'Нужно минимум 6 строк в формате:\n' +
                '`1. Анна — Дон`\n' +
                '`2. Олег — Шериф`\n' +
                '`3. Катя — Мирный`',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        const draftInfo = ozhidanie_registracii[tg_id];
        const { data: klub } = await supabase
            .from('kluby')
            .select('id, nazvaniye, nastroyki, sportivniy_rezhim')
            .eq('id', draftInfo.klub_id)
            .single();
        const igra = {
            klub_id: draftInfo.klub_id,
            klub_nazvaniye: klub?.nazvaniye || null,
            tip_kluba: klub?.nastroyki?.tip_kluba || 'paskal',
            sportivniy: !!klub?.sportivniy_rezhim,
            _nastroyki: klub?.nastroyki || {},
            data_igry: draftInfo.data_igry,
            nomer_igry: draftInfo.nomer_igry,
            igroki: parsed,
            avto_bonusy: [],
            luchshie_hody: []
        };
        for (const igrok of igra.igroki) await privyazatIgrokaIzBazy(igra, igrok);
        ruchnyeRezultaty[tg_id] = { igra };
        ozhidanie_registracii[tg_id].shag = 'manual_result_survivors';
        bot.sendMessage(chatId,
            '✅ Состав принят: *' + parsed.length + '* игроков.\n\n' +
            'Кто *выжил* к концу игры?\n\n' +
            'Отправь номера или ники через запятую. Например: `1, 4, 7, Анна`\n' +
            'Если выжили все — напиши `все`.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_survivors') {
        const draft = ruchnyeRezultaty[tg_id];
        if (!draft?.igra) {
            delete ozhidanie_registracii[tg_id];
            bot.sendMessage(chatId, '❌ Черновик результата не найден. Начни заново.');
            return;
        }
        const vvod = text.toLowerCase();
        if (['все', 'all', '+'].includes(vvod)) {
            draft.igra.igroki.forEach(i => { i.status = 'v_igre'; });
        } else {
            const survivors = razobratSpisokNikov(text);
            const nums = new Set();
            survivors.forEach(item => {
                const found = naytiIgrokaPoVvodu(draft.igra, item);
                if (found) nums.add(found.nomer);
            });
            if (nums.size === 0) {
                bot.sendMessage(chatId, '❌ Не нашёл выживших по этому списку. Отправь номера/ники через запятую или `все`.', { parse_mode: 'Markdown' });
                return;
            }
            draft.igra.igroki.forEach(i => { i.status = nums.has(i.nomer) ? 'v_igre' : 'vybyl'; });
        }
        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId, '🏆 Кто победил?', {
            reply_markup: { inline_keyboard: [
                [{ text: '🟢 Мирные', callback_data: 'rez_manual_win_mirnye' }],
                [{ text: '🔴 Мафия', callback_data: 'rez_manual_win_mafiya' }],
                [{ text: '🎯 Маньяк', callback_data: 'rez_manual_win_manyak' }]
            ] }
        });
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('vecher_vvod_')) {
        const klub_id = sostoyanie[tg_id].replace('vecher_vvod_', '');
        const niki = razobratSpisokNikov(text);
        if (niki.length === 0) {
            bot.sendMessage(chatId, '❌ Отправь ники через запятую или каждый с новой строки.');
            return;
        }
        const igraTemp = { klub_id, igroki: [] };
        for (let i = 0; i < niki.length; i++) {
            const igrok = {
                telegram_id: null,
                name: niki[i],
                nomer: i + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null
            };
            await privyazatIgrokaIzBazy(igraTemp, igrok);
            igraTemp.igroki.push(igrok);
        }
        await sohranitSpisokVecheraKluba(klub_id, igraTemp.igroki);
        delete sostoyanie[tg_id];
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        const soobsh = await bot.sendMessage(chatId, '✅ Состав вечера сохранён: *' + niki.length + '* игроков.', { parse_mode: 'Markdown' });
        await pokazatIgrovoyVecher(chatId, soobsh.message_id, klub || { id: klub_id, nazvaniye: '' }, tg_id);
        return;
    }

    // Игнорируем команды
    if (text.startsWith('/')) return;

    // ===== ГОЛОСОВАНИЕ: ведущий вводит количество голосов =====
    if (sostoyanie[tg_id]?.startsWith('golos_count_')) {
        const parts_gc = sostoyanie[tg_id].replace('golos_count_', '').split('_');
        const kod_gc = parts_gc[0];
        const nomer_gc = parseInt(parts_gc[1], 10);
        const igra_gc = igry[kod_gc];
        if (!igra_gc) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const count = parseInt(text, 10);
        if (!Number.isFinite(count) || count < 0 || count > (igra_gc.igroki || []).length) {
            bot.sendMessage(chatId, '❌ Введи число голосов от 0 до ' + (igra_gc.igroki || []).length + '.');
            return;
        }
        igra_gc.golosa_dnya = igra_gc.golosa_dnya || {};
        igra_gc.golosa_dnya[nomer_gc] = count;
        delete sostoyanie[tg_id];
        await sohranit_igru(kod_gc);
        const igrok_gc = igra_gc.igroki.find(i => i.nomer === nomer_gc);
        await bot.sendMessage(chatId, '\u2705 За \u2116' + nomer_gc + ' ' + (igrok_gc?.name || '') + ': *' + count + '* голос(ов)', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra_gc, kod_gc) }
        });
        return;
    }

    // ===== ДЕНЬ: выставить на голосование по нику во время минуты игрока =====
    if (sostoyanie[tg_id]?.startsWith('vystav_golos_')) {
        const kod_vg = sostoyanie[tg_id].replace('vystav_golos_', '');
        const igra_vg = igry[kod_vg];
        if (!igra_vg) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const igrok_vg = naytiIgrokaPoVvodu(igra_vg, text);
        if (!igrok_vg) {
            bot.sendMessage(chatId,
                '❌ Игрок не найден.\n\n' + tekstVystavleniyaNaGolos(igra_vg),
                { parse_mode: 'Markdown', reply_markup: knopkiVystavleniyaNaGolos(igra_vg, kod_vg) }
            );
            return;
        }
        await vypolnitVystavlenieNaGolos(chatId, igra_vg, kod_vg, igrok_vg, tg_id);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: состав игроков списком (лобби / игровой вечер) =====
    if (sostoyanie[tg_id]?.startsWith('perviy_hod_')) {
        const kod_ph = sostoyanie[tg_id].replace('perviy_hod_', '');
        const igra_ph = igry[kod_ph];
        if (!igra_ph) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const faza_ph = igra_ph._zhdat_fazu || 'den';
        const igrok_ph = naytiIgrokaPoVvodu(igra_ph, text);
        if (!igrok_ph || igrok_ph.status !== 'v_igre') {
            bot.sendMessage(chatId, '❌ Не нашёл такого игрока. Отправь *номер* или *ник* из списка.', { parse_mode: 'Markdown' });
            return;
        }
        await ustanovitPervogoHoda(chatId, null, kod_ph, igrok_ph.nomer, faza_ph, tg_id);
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('lobby_spisok_')) {
        const kod_ls = sostoyanie[tg_id].replace('lobby_spisok_', '');
        const igra_ls = igry[kod_ls];
        if (!igra_ls) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        await vnestiSpisokIgrokovLobby(chatId, igra_ls, kod_ls, text);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ночь знакомства по ролям =====
    if (sostoyanie[tg_id]?.startsWith('noch_znakomstvo_')) {
        const parts_nz = sostoyanie[tg_id].replace('noch_znakomstvo_', '').split('_');
        const kod_nz = parts_nz[0];
        const idx_nz = parseInt(parts_nz[1], 10) || 0;
        const igra_nz = igry[kod_nz];
        if (!igra_nz) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена. Создай игру заново.');
            return;
        }

        const roles_nz = poryadokRoleyDlyaNochi(igra_nz);
        const rol_nz = roles_nz[idx_nz];
        if (!rol_nz) {
            await pokazatShagNochiZnakomstva(chatId, kod_nz, idx_nz);
            return;
        }

        let igrok_nz = naytiIgrokaPoVvodu(igra_nz, text);
        if (!igrok_nz) {
            if ((igra_nz.igroki || []).length >= igra_nz.kolichestvo) {
                bot.sendMessage(chatId,
                    '❌ Не нашёл такого игрока за столом.\n\n' +
                    'Отправь *номер места* или точный ник игрока. Например: `7`',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            igrok_nz = {
                telegram_id: null,
                name: text.trim(),
                nomer: (igra_nz.igroki || []).length + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null
            };
            igra_nz.igroki.push(igrok_nz);
        }

        if (igrok_nz.rol) {
            bot.sendMessage(chatId,
                '⚠️ У игрока №' + igrok_nz.nomer + ' ' + igrok_nz.name + ' уже стоит роль *' + igrok_nz.rol + '*.\n\n' +
                'Выбери другого игрока для роли *' + rol_nz + '* или открой панель и проверь состав.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        igrok_nz.rol = rol_nz;
        igrok_nz.status = 'v_igre';
        igrok_nz.foly = igrok_nz.foly || 0;
        await sohranit_igru(kod_nz);

        await bot.sendMessage(chatId, '\u2705 \u2116' + igrok_nz.nomer + ' ' + igrok_nz.name + ' — *' + rol_nz + '*', { parse_mode: 'Markdown' });
        await pokazatShagNochiZnakomstva(chatId, kod_nz, idx_nz + 1);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ручной ввод мирных после ночи знакомства =====
    if (sostoyanie[tg_id]?.startsWith('noch_mirnye_')) {
        const kod_m = sostoyanie[tg_id].replace('noch_mirnye_', '');
        const igra_m = igry[kod_m];
        if (!igra_m) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const niki_m = razobratSpisokNikov(text);
        if (niki_m.length > 1) {
            await vnestiSpisokMirnyh(chatId, igra_m, kod_m, text);
        } else {
            await vnestiOdnogoMirnogo(chatId, igra_m, kod_m, text);
        }
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ведущая вручную вносит игроков и роли =====
    const manualRolesKod = sostoyanie[tg_id]?.startsWith('manual_roles_')
        ? sostoyanie[tg_id].replace('manual_roles_', '')
        : naytiIgruDlyaRuchnyhRoley(tg_id, text);

    if (manualRolesKod) {
        const kod = manualRolesKod;
        const igra = igry[kod];
        if (!igra) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена. Создай игру заново.');
            return;
        }

        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length !== igra.kolichestvo) {
            bot.sendMessage(chatId,
                '❌ Нужно ' + igra.kolichestvo + ' строк, по числу мест в игре.\n\n' +
                'Сейчас строк: ' + lines.length + '.\n\n' +
                'Пример:\n`1. Аня — Дон`\n`2. Оля — Мафия`\n`3. Катя — Мирный`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const parsed = [];
        const oshibki = [];
        lines.forEach((line, idx) => {
            const row = razobratStrokuRoli(line, idx);
            if (!row) oshibki.push((idx + 1) + '. ' + line);
            else parsed.push(row);
        });

        if (oshibki.length > 0) {
            bot.sendMessage(chatId,
                '❌ Не понял роль в строках:\n' + oshibki.join('\n') +
                '\n\nПиши так: `Имя — Роль`.\nРоль должна совпадать с названием в боте: Дон, Мафия, Шериф, Мирный и т.д.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        igra.igroki = parsed.map((row, idx) => ({
            telegram_id: null,
            name: row.name,
            nomer: idx + 1,
            rol: row.rol,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        }));
        const rezStart = await proveritStartPlatnoyIgry(igra, kod);
        if (!rezStart.ok) {
            await pokazatBlokStartaIgry(chatId, null, null, rezStart);
            return;
        }

        igra.rezhim_rolei = 'karty';
        igra.roli_razdany = true;
        igra.den = 1;
        delete sostoyanie[tg_id];
        await podgruzitImmunitetIgrokam(igra);
        await sohranit_igru(kod);

        let svodka = '\u2705 *Роли внесены вручную!*\n\n';
        if (rezStart.info) svodka += '\n_' + rezStart.info.replace(/\*/g, '') + '_\n';
        svodka += '\uD83C\uDFB4 Игра \u2116' + kod + '\n';
        svodka += '\uD83D\uDC65 Игроков: ' + igra.kolichestvo + '\n\n';
        svodka += tekstSpiskaPosleRoley(igra);

        bot.sendMessage(chatId, svodka, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }]
            ]}
        });
        return;
    }

    // ===== РЕГИСТРАЦИЯ: шаг 1 — имя =====
    if (ozhidanie_registracii[tg_id]?.shag === 'soglasie') {
        bot.sendMessage(chatId, '📄 Сначала прими оферту и политику конфиденциальности — нажми /start');
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'imya') {
        if (!ozhidanie_registracii[tg_id].soglasie_prinyato) {
            bot.sendMessage(chatId, '📄 Сначала прими условия — нажми /start');
            return;
        }
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Введи настоящее имя (минимум 2 символа).');
            return;
        }
        ozhidanie_registracii[tg_id].imya = text.trim();
        ozhidanie_registracii[tg_id].shag = 'igrovoy_nik';

        bot.sendMessage(chatId,
            `✅ Отлично, *${text}*!\n\n` +
            'Теперь введи свой *игровой ник*:\n' +
            '_Например: Madame X, Доктор, Рыжая, Арчи_',
            {
                parse_mode: 'Markdown'
            }
        );
        return;
    }

    // ===== РЕГИСТРАЦИЯ: шаг 2 — игровой ник =====
    if (ozhidanie_registracii[tg_id]?.shag === 'igrovoy_nik') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Ник должен быть минимум 2 символа.');
            return;
        }
        ozhidanie_registracii[tg_id].igrovoy_nik = text.trim();
        ozhidanie_registracii[tg_id].shag = 'telefon';

        bot.sendMessage(chatId,
            '✅ Ник сохранён: *' + text.trim() + '*\n\n' +
            'Теперь поделись номером телефона — нажми кнопку ниже:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        return;
    }

    // ===== РЕГИСТРАЦИЯ: шаг 2 — телефон (через contact) =====
    if (msg.contact && ozhidanie_registracii[tg_id]?.shag === 'telefon') {
        const telefon = msg.contact.phone_number;
        ozhidanie_registracii[tg_id].telefon = telefon;
        ozhidanie_registracii[tg_id].shag = 'gorod';

        bot.sendMessage(chatId, '📍 *Последний шаг — выбери свою страну:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                remove_keyboard: true,
                inline_keyboard: [
                    [{ text: '🇷🇺 Россия', callback_data: 'reg_strana_Россия' }],
                    [{ text: '🇧🇾 Беларусь', callback_data: 'reg_strana_Беларусь' }],
                    [{ text: '🇰🇿 Казахстан', callback_data: 'reg_strana_Казахстан' }],
                    [{ text: '🇺🇿 Узбекистан', callback_data: 'reg_strana_Узбекистан' }],
                    [{ text: '🇰🇬 Кыргызстан', callback_data: 'reg_strana_Кыргызстан' }],
                    [{ text: '🇦🇲 Армения', callback_data: 'reg_strana_Армения' }],
                    [{ text: '🇬🇪 Грузия', callback_data: 'reg_strana_Грузия' }],
                    [{ text: '🇦🇿 Азербайджан', callback_data: 'reg_strana_Азербайджан' }]
                ]
            }
        });
        return;
    }

    // ===== СОЗДАНИЕ КЛУБА: ввод названия =====
    if (ozhidanie_registracii[tg_id]?.shag === 'sozdat_klub_nazvanie') {
        const nazvaniye = text.trim();
        if (nazvaniye.length < 2) {
            bot.sendMessage(chatId, '❌ Название должно быть минимум 2 символа.');
            return;
        }

        const gorod_id = ozhidanie_registracii[tg_id].gorod_id || null;

        // Создаём клуб с gorod_id
        const insert_data = { nazvaniye, owner_tg_id: tg_id };
        if (gorod_id) insert_data.gorod_id = gorod_id;

        const { data: novyi_klub, error: klub_err } = await supabase
            .from('kluby')
            .insert(insert_data)
            .select()
            .single();

        if (klub_err) {
            console.error('Ошибка создания клуба:', klub_err);
            bot.sendMessage(chatId, '❌ Ошибка создания клуба. Попробуй ещё раз.');
            delete ozhidanie_registracii[tg_id];
            return;
        }

        // Находим самого игрока (собственника)
        const { data: igrok } = await supabase
            .from('igroki')
            .select('id')
            .eq('tg_id', tg_id)
            .single();

        if (igrok) {
            await supabase
                .from('chleny_klubov')
                .insert({ klub_id: novyi_klub.id, igrok_id: igrok.id, rol: 'vladyelets' });
        }

        await nachatTestovuyuNedelyuKluba(novyi_klub.id);
        const konetsTesta = formatDatyRu(dataOkonchaniyaTesta(dataIgrovoegoVechera(), TEST_LIMIT_DNEY));

        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId,
            `✅ *Клуб создан!*\n\n🎴 ${nazvaniye}\n\nТеперь ты собственник этого клуба.\n\n` +
            '🎁 *Тестовая неделя в подарок:* 2 игры за 7 дней (до ' + konetsTesta + ').\n' +
            'Игра списывается только при старте (раздача ролей / начало игры), не при создании лобби.\n\n' +
            '🎨 Можно сразу подключить стилизацию интерфейса под клуб — *5000₽ навсегда*.',
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🎁 Тестовая неделя: 2 игры', callback_data: 'tarif_klub_' + novyi_klub.id }],
                    [{ text: '🎨 Стилизация за 5000₽ навсегда', callback_data: 'stil_klub_' + novyi_klub.id }],
                    ...menu_vladeltsa.reply_markup.inline_keyboard
                ] }
            }
        );
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ АНОНСА: обновление полей =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('anons_upd_')) {
        const parts = sostoyanie[tg_id].replace('anons_upd_', '').split('_');
        const pole = parts[0]; // data, vremya, adres, komment
        const anons_id = parts.slice(1).join('_');
        delete sostoyanie[tg_id];

        const update = {};
        if (pole === 'data') {
            const dataIso = razobrat_datu_anonsa(text.trim());
            if (!dataIso) {
                bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *15.05.2026* или *15 мая*', { parse_mode: 'Markdown' });
                sostoyanie[tg_id] = 'anons_upd_data_' + anons_id;
                return;
            }
            update.data_igry = dataIso;
        }
        if (pole === 'vremya') update.vremya = text.trim();
        if (pole === 'adres') update.adres = text.trim();
        if (pole === 'komment') update.kommentariy = text.trim();

        const { error } = await supabase.from('anonsy').update(update).eq('id', anons_id);

        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка обновления. Попробуй ещё раз.');
            return;
        }

        const soobsh = await bot.sendMessage(chatId, '✅ Обновлено!');
        setTimeout(async () => {
            await pokazat_kartochku_anонса(chatId, soobsh.message_id, anons_id);
        }, 500);
        return;
    }

    // ===== АНОНС: ввод даты =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('anons_data_')) {
        const klub_id = sostoyanie[tg_id].replace('anons_data_', '');
        const dataIso = razobrat_datu_anonsa(text.trim());
        if (!dataIso) {
            bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *15.05.2026* или *15 мая*', { parse_mode: 'Markdown' });
            return;
        }
        delete sostoyanie[tg_id];
        ozhidanie_registracii[tg_id] = { shag: 'anons_vremya', klub_id, data_igry: dataIso };
        bot.sendMessage(chatId, '📢 *Создание анонса*\n\n*Дата:* ' + formatDataAnonsa(dataIso) + '\n\n🕐 Введи время игры:\n_Пример: 19:00_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    // ===== АНОНС: ввод времени =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_vremya') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.vremya = text.trim();
        dannye.shag = 'anons_adres';
        bot.sendMessage(chatId,
            '📢 *Создание анонса*\n\n*Дата:* ' + dannye.data_igry + '\n*Время:* ' + dannye.vremya + '\n\n📍 Введи место проведения:\n_Пример: Ресторан Паскаль, ул. Воровского 19, 2 этаж_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    // ===== АНОНС: ввод адреса =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_adres') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.adres = text.trim();
        dannye.shag = 'anons_komment';
        bot.sendMessage(chatId,
            '📢 *Создание анонса*\n\n*Дата:* ' + dannye.data_igry + '\n*Время:* ' + dannye.vremya + '\n*Адрес:* ' + dannye.adres + '\n\n💬 Добавь комментарий:\n_Пример: Играем 3 игры, стоимость 1000₽, дресс-код приветствуется_\n_Или нажми "Пропустить"_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '➡️ Пропустить', callback_data: 'anons_skip_komment' }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
        return;
    }

    // ===== АНОНС: ввод комментария =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_komment') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.kommentariy = text.trim();
        delete ozhidanie_registracii[tg_id];
        await sohranit_anons(chatId, tg_id, dannye);
        return;
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: ввод названия =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('rol_nazvanie_')) {
        const klub_id = sostoyanie[tg_id].replace('rol_nazvanie_', '');
        const nazvanie = text.trim();
        if (nazvanie.length < 2) {
            bot.sendMessage(chatId, '❌ Название должно быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        // Сохраняем временно название и переходим к выбору стороны
        ozhidanie_registracii[tg_id] = { shag: 'rol_storona', klub_id, nazvanie };
        const soobsh = await bot.sendMessage(chatId, '🎭 *Создание роли*\n\n*Название:* ' + nazvanie + '\n\nВыбери сторону:', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👨‍👩‍👧 Мирные', callback_data: 'rol_st_mirnye' }],
                    [{ text: '🔫 Мафия', callback_data: 'rol_st_mafiya' }],
                    [{ text: '🎯 Сам за себя', callback_data: 'rol_st_solo' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + klub_id }]
                ]
            }
        });
        return;
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: ввод количества раз =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('rol_kolichestvo_')) {
        const klub_id = sostoyanie[tg_id].replace('rol_kolichestvo_', '');
        delete sostoyanie[tg_id];
        const dannye = ozhidanie_registracii[tg_id];
        if (!dannye || dannye.shag !== 'rol_kolichestvo') {
            bot.sendMessage(chatId, '❌ Ошибка. Начни заново.');
            return;
        }
        const kolichestvo = text.trim();
        const chislo = parseInt(kolichestvo);
        if (isNaN(chislo) || chislo < 1 || chislo > 99) {
            bot.sendMessage(chatId, '❌ Введи число от 1 до 99.');
            sostoyanie[tg_id] = 'rol_kolichestvo_' + klub_id;
            return;
        }
        dannye.kolichestvo_raz = chislo;
        dannye.shag = 'gotovo';
        await sohranit_rol(chatId, tg_id, klub_id, dannye);
        return;
    }


    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО: контакт =====
    if (msg.contact && klubIdIzSostoyaniyaNaznacha(tg_id)) {
        const klub_id = klubIdIzSostoyaniyaNaznacha(tg_id);
        const telefon = msg.contact.phone_number.replace(/\D/g, '');

        const { data: igroki } = await supabase
            .from('igroki')
            .select('id, imya, tg_username, telefon')
            .ilike('telefon', '%' + telefon.slice(-10) + '%')
            .limit(3);

        if (!igroki || igroki.length === 0) {
            bot.sendMessage(chatId,
                '❌ Игрок с этим номером не найден в базе.\n\nВведи имя или @username:', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            sostoyanie[tg_id] = 'naznach_poisk_' + klub_id;
            return;
        }

        const knopki = igroki.map(i => [{
            text: i.imya + (i.tg_username ? ' @' + i.tg_username : '') + ' ' + (i.telefon || ''),
            callback_data: 'ncfm_' + i.id
        }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

        bot.sendMessage(chatId, '✅ Нашёл! Выбери кого назначить ведущим:', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО: поиск по имени/телефону =====
    if (klubIdIzSostoyaniyaNaznacha(tg_id)) {
        const klub_id = klubIdIzSostoyaniyaNaznacha(tg_id);
        const query = text.trim();

        // Нормализуем если это телефон — берём последние 10 цифр
        const tolko_cifry = query.replace(/\D/g, '');
        const poisk_telefon = tolko_cifry.length >= 10 ? tolko_cifry.slice(-10) : null;

        let igroki;
        if (poisk_telefon) {
            const { data } = await supabase
                .from('igroki')
                .select('id, imya, tg_username, telefon')
                .ilike('telefon', '%' + poisk_telefon + '%')
                .limit(5);
            igroki = data;
        } else {
            const { data } = await supabase
                .from('igroki')
                .select('id, imya, tg_username, telefon')
                .or(`imya.ilike.%${query}%,tg_username.ilike.%${query}%`)
                .limit(5);
            igroki = data;
        }

        if (!igroki || igroki.length === 0) {
            bot.sendMessage(chatId, '❌ Игрок не найден. Попробуй ещё раз:', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            sostoyanie[tg_id] = 'naznach_poisk_' + klub_id;
            return;
        }

        const knopki = igroki.map(i => [{
            text: i.imya + (i.tg_username ? ' @' + i.tg_username : '') + (i.telefon ? ' ' + i.telefon : ''),
            callback_data: 'ncfm_' + i.id
        }]);
        knopki.push([{ text: '🔍 Искать снова', callback_data: 'naznachit_v_klube_' + klub_id }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

        bot.sendMessage(chatId, '🔍 Найдено ' + igroki.length + ' игрок(ов).\n\nВыбери кого назначить ведущим:', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('baza_poisk_')) {
        const klub_id = sostoyanie[tg_id].replace('baza_poisk_', '');
        const zapros = text.trim();
        delete sostoyanie[tg_id];

        if (zapros.length < 1) {
            bot.sendMessage(chatId, '❌ Пустой запрос.');
            return;
        }

        // Сохраняем фильтр для пагинации
        sostoyanie['baza_filtr_' + tg_id] = zapros;

        // Отправляем новое сообщение и редактируем его результатом
        const soobsh = await bot.sendMessage(chatId, '🔍 Ищу...');
        await pokazat_bazu_igrokov(chatId, soobsh.message_id, klub_id, 0, zapros);
        return;
    }

    // ===== БОНУС: ввод очков =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('bonus_vvod_')) {
        const parts_bv = sostoyanie[tg_id].replace('bonus_vvod_', '').split('_');
        const kod_bv = parts_bv[0];
        const nomer_bv = parseInt(parts_bv[1]);
        delete sostoyanie[tg_id];

        const igra_bv = igry['archive_' + kod_bv];
        if (!igra_bv) { bot.sendMessage(chatId, '\u274C Игра не найдена'); return; }
        const igrok_bv = igra_bv.igroki.find(i => i.nomer === nomer_bv);
        if (!igrok_bv) return;

        const parts_input = text.trim().split(' ');
        const pts = parseInt(parts_input[0]);
        const reason = parts_input.slice(1).join(' ') || 'бонус';

        if (isNaN(pts) || pts < 0 || pts > 20) {
            bot.sendMessage(chatId, '\u274C Введи число от 0 до 20, затем причину');
            sostoyanie[tg_id] = 'bonus_vvod_' + kod_bv + '_' + nomer_bv;
            return;
        }

        igrok_bv.bonus_pts = pts;
        igrok_bv.bonus_text = reason;

        // Обновляем в БД
        if (igrok_bv.igrok_id && igra_bv.klub_id) {
            await supabase.from('bally')
                .update({ bally_lichnie: supabase.rpc ? undefined : pts, bally_vsego: supabase.rpc ? undefined : pts, bonus_info: { ruchnoy: { pts, text: reason } } })
                .eq('kod_igry', kod_bv)
                .eq('igrok_id', igrok_bv.igrok_id);
        }

        const soobsh_bv = await bot.sendMessage(chatId, '\u2705 Бонус +' + pts + ' (' + reason + ') для ' + igrok_bv.name);
        setTimeout(async () => {
            const igra_reload = igry['archive_' + kod_bv];
            if (!igra_reload) return;
            let t_bv = '\uD83C\uDF81 *Бонусы* — Игра \u2116' + kod_bv + '\n\n';
            igra_reload.igroki.forEach(i => {
                const b = i.bonus_pts ? ' +' + i.bonus_pts + ' (' + i.bonus_text + ')' : '';
                t_bv += '\u2116' + i.nomer + ' ' + i.name + ' [' + i.rol + ']' + b + '\n';
            });
            const kk = igra_reload.igroki.map(i => [{ text: '\uD83C\uDF81 \u2116' + i.nomer + ' ' + i.name + (i.bonus_pts ? ' +' + i.bonus_pts : ''), callback_data: 'bonus_igrok_' + kod_bv + '_' + i.nomer }]);
            kk.push([{ text: '\u2705 Готово', callback_data: 'bonusy_done_' + kod_bv }]);
            await bot.editMessageText(t_bv, { chat_id: chatId, message_id: soobsh_bv.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kk } });
        }, 500);
        return;
    }

    // ===== ИЗМЕНИТЬ БАЛЛЫ КЛУБА (JSON) =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('edit_bally_json_')) {
        const klub_id_bj = sostoyanie[tg_id].replace('edit_bally_json_', '');
        delete sostoyanie[tg_id];
        try {
            const new_bally = JSON.parse(text.trim());
            const { data: k_bj } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id_bj).single();
            const nastroyki_bj = k_bj?.nastroyki || {};
            nastroyki_bj.bally = { ...(nastroyki_bj.bally || BALLY_DEFAULT), ...new_bally };
            await supabase.from('kluby').update({ nastroyki: nastroyki_bj }).eq('id', klub_id_bj);
            bot.sendMessage(chatId, '\u2705 Баллы обновлены!');
        } catch(e) {
            bot.sendMessage(chatId, '\u274C Неверный JSON. Попробуй ещё раз.\n\nПример: `{"pobeda_komanda":3,"vyzhil":1}`', { parse_mode: 'Markdown' });
        }
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ ИМЕНИ =====
    if (sostoyanie[tg_id] === 'edit_imya') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Имя должно быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        const { error } = await supabase
            .from('igroki').update({ imya: text.trim() }).eq('tg_id', tg_id);
        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
            return;
        }
        const soobsh = await bot.sendMessage(chatId, '✅ Имя обновлено: *' + text.trim() + '*', { parse_mode: 'Markdown' });
        setTimeout(async () => {
            await bot.editMessageText(
                '⚙️ *Настройки*\n\nВыбери что изменить:',
                { chat_id: chatId, message_id: soobsh.message_id, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                    [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                    [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                  ]}
                }
            );
        }, 800);
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ ИГРОВОГО НИКА =====
    if (sostoyanie[tg_id] === 'edit_nik') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Ник должен быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        const { error } = await supabase
            .from('igroki').update({ igrovoy_nik: text.trim() }).eq('tg_id', tg_id);
        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
            return;
        }
        const soobsh = await bot.sendMessage(chatId, '✅ Игровой ник обновлён: *' + text.trim() + '*', { parse_mode: 'Markdown' });
        setTimeout(async () => {
            await bot.editMessageText(
                '⚙️ *Настройки*\n\nВыбери что изменить:',
                { chat_id: chatId, message_id: soobsh.message_id, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                    [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                    [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                  ]}
                }
            );
        }, 800);
        return;
    }

    // ===== ВВОД КОДА ИГРЫ =====
    if (sostoyanie[tg_id] === 'vvodit_kod') {
        const kod = text;

        if (!/^\d{4}$/.test(kod)) {
            bot.sendMessage(chatId, '❌ Код должен быть из 4 цифр. Попробуй ещё раз.');
            return;
        }

        const igra = igry[kod];
        if (!igra) {
            bot.sendMessage(chatId, '❌ Игра с кодом *' + kod + '* не найдена.\n\nПроверь код у ведущего.', {
                parse_mode: 'Markdown'
            });
            return;
        }

        if (igra.roli_razdany) {
            bot.sendMessage(chatId, '⚠️ Эта игра уже началась. Подожди следующую.');
            delete sostoyanie[tg_id];
            return;
        }

        const uzhe_v_igre = igra.igroki.find(i => i.telegram_id === tg_id);
        if (uzhe_v_igre) {
            bot.sendMessage(chatId, '⚠️ Ты уже в этой игре. Жди раздачи ролей.');
            delete sostoyanie[tg_id];
            return;
        }

        if (igra.igroki.length >= igra.kolichestvo) {
            bot.sendMessage(chatId, '❌ В этой игре уже все места заняты.');
            delete sostoyanie[tg_id];
            return;
        }

        const { data: igrok_vhod } = await supabase
            .from('igroki')
            .select('id, imya, igrovoy_nik')
            .eq('tg_id', tg_id)
            .single();
        const nomer = igra.igroki.length + 1;
        const name = igrok_vhod?.igrovoy_nik || igrok_vhod?.imya || msg.from.first_name || 'Игрок ' + nomer;

        igra.igroki.push({ telegram_id: tg_id, name: name, nomer: nomer, status: 'v_igre', foly: 0, igrok_id: igrok_vhod?.id || null });
        if (igra.klub_id && igrok_vhod?.id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, igrok_vhod.id);
        delete sostoyanie[tg_id];
        await sohranit_igru(kod);

        bot.sendMessage(chatId,
            '✅ *Ты подключён к игре!*\n\n' +
            '🎴 Игра №' + kod + '\n' +
            '👤 Твой номер: *' + nomer + '*\n' +
            '👥 Подключено: ' + igra.igroki.length + '/' + igra.kolichestvo + '\n\n' +
            '_Жди когда ведущий раздаст роли..._',
            { parse_mode: 'Markdown' }
        );

        bot.sendMessage(igra.vedushchii_id,
            '👤 *Игрок подключился*\n\n' +
            '№' + nomer + ' — ' + name + '\n' +
            '👥 Подключено: *' + igra.igroki.length + '/' + igra.kolichestvo + '*',
            { parse_mode: 'Markdown' }
        );

        if (igra.igroki.length === igra.kolichestvo) {
            const knopkaStarta = igra.rezhim_rolei === 'karty'
                ? { text: '\u25B6\uFE0F Начать игру', callback_data: 'nachat_igru_' + kod }
                : { text: '🎴 Раздать роли', callback_data: 'razdat_' + kod };
            bot.sendMessage(igra.vedushchii_id,
                '🎉 *Все игроки в сборе!*\n\nМожно начинать.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[knopkaStarta]]
                    }
                }
            );
        }
    }
});


// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ — ТАЙМЕР И ФАЗЫ
// ============================================

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m > 0 ? m + ':' : '') + (s < 10 ? '0' : '') + s;
}

function stopTimer(kod) {
    const igra = igry[kod];
    if (!igra) return;
    igra.taymer_aktiven = false;
    if (igra._interval) { clearInterval(igra._interval); igra._interval = null; }
}

function obnovitPanelTaymera(kod) {
    const igra = igry[kod];
    if (!igra || !igra._taymer_chat_id || !igra._taymer_message_id) return;
    bot.editMessageText(buildPanelText(igra, kod), {
        chat_id: igra._taymer_chat_id,
        message_id: igra._taymer_message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
    }).catch(() => {});
}

function zapustitTaymer(chatId, messageId, kod, sekundy) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra.taymer_sekundy = sekundy;
    igra.taymer_aktiven = true;
    igra._taymer_chat_id = chatId;
    igra._taymer_message_id = messageId;

    obnovitPanelTaymera(kod);

    igra._interval = setInterval(() => {
        const ig = igry[kod];
        if (!ig || !ig.taymer_aktiven) {
            if (ig?._interval) { clearInterval(ig._interval); ig._interval = null; }
            return;
        }
        ig.taymer_sekundy--;
        obnovitPanelTaymera(kod);
        if (ig.taymer_sekundy <= 0) {
            stopTimer(kod);
            sleduyushchiy(ig._taymer_chat_id, ig._taymer_message_id, kod);
        }
    }, 1000);
}

function estDostupKIgre(igra, telegram_id) {
    return !!igra && (!igra.vedushchii_id || igra.vedushchii_id === telegram_id);
}

async function ostanovitIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };

    stopTimer(kod);
    const v = igra.vedushchii_id;
    if (v && sostoyanie[v] && String(sostoyanie[v]).includes(kod)) delete sostoyanie[v];
    igra.ostanovlena = true;
    await sohranit_igru(kod);

    for (const igrok of igra.igroki || []) {
        if (igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '⏸ *Игра №' + kod + ' остановлена ведущим.*\n\n_Ведущий сможет возобновить её позже._',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
    }
    return { ok: true };
}

async function vozobnovitIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };
    igra.ostanovlena = false;
    await sohranit_igru(kod);
    return { ok: true };
}

async function udalitAktivnuyuIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };
    stopTimer(kod);
    const v = igra.vedushchii_id;
    if (v && sostoyanie[v] && String(sostoyanie[v]).includes(kod)) delete sostoyanie[v];
    for (const igrok of igra.igroki || []) {
        if (igrok.telegram_id) bot.sendMessage(igrok.telegram_id, '🗑 Игра №' + kod + ' удалена ведущим.').catch(() => {});
    }
    delete igry[kod];
    try {
        await supabase.from('aktivnye_igry').delete().eq('kod', kod);
    } catch (e) {
        console.error('[delete_igra] db:', e?.message);
        return { ok: false, error: 'db' };
    }
    return { ok: true };
}

function knopkiUpravleniyaIgroi(kod) {
    const igra = igry[kod];
    const knopki = [];
    if (igra?.ostanovlena) {
        knopki.push([{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }]);
    } else {
        knopki.push([{ text: '⏸ Остановить игру', callback_data: 'stop_igra_' + kod }]);
    }
    knopki.push([{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }]);
    return knopki;
}

async function udalitIgruIzIstorii(kod, telegram_id) {
    const { data: row } = await supabase
        .from('aktivnye_igry')
        .select('kod, klub_id, vedushchii_tg_id')
        .eq('kod', kod)
        .eq('zavershena', true)
        .single();
    if (!row) return { ok: false, error: 'not_found' };
    if (row.vedushchii_tg_id !== telegram_id) {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (!row.klub_id || !kluby.some(k => k.id === row.klub_id)) return { ok: false, error: 'access' };
    }
    const { error } = await supabase.from('aktivnye_igry').delete().eq('kod', kod).eq('zavershena', true);
    if (error) return { ok: false, error: 'db' };
    return { ok: true };
}

function vseRoliDostupnye() {
    return Object.keys(roli_opisaniya);
}

function razobratStrokuRoli(line, index) {
    const bezNomera = String(line || '')
        .trim()
        .replace(/^\d+[\).\-\s]*/, '')
        .trim();

    const roli = vseRoliDostupnye().sort((a, b) => b.length - a.length);
    const lower = bezNomera.toLowerCase();

    for (const rol of roli) {
        const rolLower = rol.toLowerCase();
        if (lower === rolLower) {
            return { name: 'Игрок ' + (index + 1), rol: rol === 'Путана' ? 'Эскортница' : rol };
        }
        if (lower.endsWith(rolLower)) {
            const name = bezNomera.slice(0, bezNomera.length - rol.length)
                .replace(/[—–\-:|,]+$/g, '')
                .trim();
            if (name) return { name, rol: rol === 'Путана' ? 'Эскортница' : rol };
        }
    }

    return null;
}

const PORYADOK_ROLEY_NOCHI = [
    'Дон', 'Эскортница', 'Мафия', 'Консильери', 'Подрывник мафии',
    'Шериф', 'Комиссар', 'Детектив', 'Маньяк', 'Доктор', 'Стрелок', 'Охотник',
    'Камикадзе', 'Шахид', 'Бессмертный', 'Затычка', 'Любовница', 'Ведьма',
    'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник'
];

function poluchitSostavDlyaIgry(igra) {
    return [...(igra?._sostav_custom || poluchit_sostav(igra?.kolichestvo, igra?.tip_kluba || 'paskal') || [])]
        .map(rol => rol === 'Путана' ? 'Эскортница' : rol);
}

function poryadokRoleyDlyaNochi(igra) {
    const sostav = poluchitSostavDlyaIgry(igra).filter(rol => rol !== 'Мирный');
    return sostav.sort((a, b) => {
        const ia = PORYADOK_ROLEY_NOCHI.indexOf(a);
        const ib = PORYADOK_ROLEY_NOCHI.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
}

function naytiIgrokaPoVvodu(igra, text) {
    const vvod = String(text || '').trim().toLowerCase();
    const nomer = parseInt(vvod, 10);
    if (Number.isFinite(nomer)) {
        const poNomeru = igra.igroki.find(i => i.nomer === nomer);
        if (poNomeru) return poNomeru;
    }
    return igra.igroki.find(i =>
        String(i.name || '').toLowerCase() === vvod ||
        String(i.name || '').toLowerCase().includes(vvod)
    ) || null;
}

function tekstShagaNochiZnakomstva(igra, kod, idx) {
    const roles = poryadokRoleyDlyaNochi(igra);
    const rol = roles[idx];
    const vsego = roles.length;
    const takihDo = roles.slice(0, idx + 1).filter(r => r === rol).length;
    const takihVsego = roles.filter(r => r === rol).length;
    const label = (rol === 'Мафия' ? 'Запись мафии: ' : '') + rol + (takihVsego > 1 ? ' ' + takihDo + '/' + takihVsego : '');

    let t = '\uD83C\uDF19 *Ночь знакомства* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += 'Шаг *' + (idx + 1) + '/' + vsego + '*\n';
    t += 'Роль: *' + label + '*\n\n';
    t += 'Отправь номер или ник игрока, у которого эта роль.\n';
    t += '_Например: `7` или `Аня`_\n\n';
    t += 'Мирных жителей вводить на этом шаге не нужно — их добавим отдельно после всех активных ролей.';
    return t;
}

function mirnyePoSostavu(igra) {
    return poluchitSostavDlyaIgry(igra).filter(rol => rol === 'Мирный').length;
}

function mirnyeOstalosVnesti(igra) {
    const uzhe = (igra?.igroki || []).filter(i => i.rol === 'Мирный').length;
    return Math.max(0, mirnyePoSostavu(igra) - uzhe);
}

async function privyazatIgrokaIzBazy(igra, igrok) {
    if (!igrok || igrok.igrok_id) return igrok;
    const name = String(igrok.name || '').trim().toLowerCase();
    if (!name) return igrok;

    const sravnit = (i) => {
        if (!i) return false;
        const nick = String(i.igrovoy_nik || '').toLowerCase();
        const imya = String(i.imya || '').toLowerCase();
        const username = String(i.tg_username || '').toLowerCase();
        return nick === name || imya === name || username === name || ('@' + username) === name;
    };

    if (igra?.klub_id) {
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('igroki(id, tg_id, imya, igrovoy_nik, tg_username)')
            .eq('klub_id', igra.klub_id);
        const found = (chleny || []).map(c => c.igroki).find(sravnit);
        if (found) {
            igrok.igrok_id = found.id;
            igrok.telegram_id = igrok.telegram_id || found.tg_id || null;
            igrok.name = igrok.name || found.igrovoy_nik || found.imya || igrok.name;
            await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, found.id);
            return igrok;
        }
    }

    const { data: poNicku } = await supabase
        .from('igroki')
        .select('id, tg_id, imya, igrovoy_nik, tg_username')
        .or('igrovoy_nik.ilike.' + name + ',imya.ilike.' + name + ',tg_username.ilike.' + name)
        .limit(5);
    const foundGlobal = (poNicku || []).find(sravnit);
    if (foundGlobal) {
        igrok.igrok_id = foundGlobal.id;
        igrok.telegram_id = igrok.telegram_id || foundGlobal.tg_id || null;
        igrok.name = igrok.name || foundGlobal.igrovoy_nik || foundGlobal.imya || igrok.name;
        if (igra?.klub_id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, foundGlobal.id);
    }
    return igrok;
}

async function zavershitNochZnakomstva(chatId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    if (!igra._slot_oplaty) {
        const rezStart = await proveritStartPlatnoyIgry(igra, kod);
        if (!rezStart.ok) {
            await pokazatBlokStartaIgry(chatId, null, null, rezStart);
            return;
        }
    }
    igra.rezhim_rolei = 'karty';
    igra.roli_razdany = true;
    igra.den = 1;
    igra.igroki.forEach(i => {
        i.status = 'v_igre';
        i.foly = i.foly || 0;
        if (!i.rol) i.rol = 'Мирный';
    });
    const mirnyeVsego = igra.igroki.filter(i => i.rol === 'Мирный').length;
    const sReytingom = igra.igroki.filter(i => i.igrok_id).length;
    const bezReytinga = igra.igroki.filter(i => !i.igrok_id).map(i => i.name);
    delete sostoyanie[igra.vedushchii_id];
    if (igra.klub_id) await sohranitSpisokVecheraKluba(igra.klub_id, igra.igroki);
    await podgruzitImmunitetIgrokam(igra);
    await sohranit_igru(kod);

    let t = '\u2705 *Ночь знакомства завершена!*\n\n';
    t += 'Активные роли и *' + mirnyeVsego + '* мирных внесены.\n';
    t += 'В рейтинг попадут: *' + sReytingom + '/' + igra.igroki.length + '* игроков.\n';
    if (bezReytinga.length > 0) {
        t += '\n\u26A0\uFE0F Без привязки к боту (баллы не запишутся): ' + bezReytinga.join(', ') + '\n';
        t += '_Пусть зарегистрируются в боте и в следующий раз вводи их игровой ник._\n';
    }
    t += '\n\n' + tekstSpiskaPosleRoley(igra);
    t += '\n\nНажми *«Кто начинает представление?»* — выберешь первого игрока, с которого пойдёт круг.';

    await bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }],
            [{ text: '\uD83C\uDFAE Панель игры', callback_data: 'panel_' + kod }]
        ] }
    });
}

function razobratSpisokNikov(text) {
    return String(text || '')
        .split(/\n|[,;]+/)
        .map(s => s.trim().replace(/^\d+[\).\-\s]+/, '').trim())
        .filter(Boolean);
}

function tekstVvodaRuchnogoProtokola() {
    return '📋 *Ручное внесение результата*\n\n' +
        'Отправь состав игры списком: *ник — роль*.\n\n' +
        'Пример:\n' +
        '`1. Анна — Дон`\n' +
        '`2. Олег — Шериф`\n' +
        '`3. Катя — Мирный`\n\n' +
        '_Можно использовать дефис, тире, двоеточие или пробел перед названием роли._';
}

function razobratRuchnoyProtokol(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const parsed = lines.map((line, idx) => razobratStrokuRoli(line, idx));
    if (lines.length < 6 || parsed.some(row => !row)) return null;
    return parsed.map((row, idx) => ({
        telegram_id: null,
        name: row.name,
        nomer: idx + 1,
        rol: row.rol,
        status: 'vybyl',
        foly: 0,
        igrok_id: null
    }));
}

function ruchnyeBonusVoprosy(igra) {
    const voprosy = [];
    (igra.igroki || []).forEach(i => {
        if (i.rol === 'Дон') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_don_nashel_sherifa_n1', text: 'Дон нашёл Шерифа/Комиссара/Детектива в первую ночь?', bonusText: 'Дон нашёл Шерифа/Комиссара/Детектива в первую ночь' });
        } else if (isSheriffRole(i.rol)) {
            voprosy.push({ nomer: i.nomer, key: 'bonus_sheriff_nashel_maf', text: i.rol + ' нашёл мафию проверкой?', bonusText: i.rol + ' нашёл мафию проверкой' });
        } else if (i.rol === 'Доктор') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_doctor_spas', text: 'Доктор правильно спас игрока?', bonusText: 'Доктор правильно спас игрока' });
        } else if (i.rol === 'Эскортница' || i.rol === 'Путана') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_eskort_ugadala_rol', text: 'Эскортница/Путана угадала роль игрока?', bonusText: 'Эскортница/Путана угадала роль игрока' });
        } else if (i.rol === 'Бессмертный') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_bessmertnyy_prinyal_vystrel', text: 'Бессмертный принял выстрел и остался в игре?', bonusText: 'Бессмертный принял выстрел' });
        } else if (rolStrelyayushchegoZaMirnyh(i.rol)) {
            voprosy.push({ nomer: i.nomer, key: 'bonus_pravilnyy_otstrel_mafii', text: i.rol + ' правильно отстрелил мафию?', bonusText: i.rol + ' правильно отстрелил мафию' });
        }
    });
    return voprosy;
}

function tekstVoprosaRuchnogoBonusa(draft) {
    const q = draft.bonus_voprosy[draft.bonus_idx];
    const igrok = draft.igra.igroki.find(i => i.nomer === q.nomer);
    const pts = BALLY_DEFAULT[q.key] ?? 0;
    return '🎁 *Бонусы по ролям*\n\n' +
        'Игрок: №' + igrok.nomer + ' *' + igrok.name + '* — ' + igrok.rol + '\n' +
        q.text + '\n\n' +
        'Если да, добавим *+' + pts + '* к личным баллам.';
}

function knopkiRuchnogoBonusa() {
    return {
        inline_keyboard: [
            [{ text: '✅ Да', callback_data: 'rez_bonus_yes' }, { text: '❌ Нет', callback_data: 'rez_bonus_no' }]
        ]
    };
}

function tekstItogaRuchnoyIgry(igra, kod) {
    const pobediteli = {
        mirnye: 'Мирные',
        mafiya: 'Мафия',
        manyak: 'Маньяк'
    };
    let t = '🏁 *Итог игры внесён*\n\n';
    if (nazvanieKlubaIgry(igra)) t += 'Клуб: *' + md(nazvanieKlubaIgry(igra)) + '*\n';
    if (igra.data_igry) t += 'Дата: *' + formatDataAnonsa(igra.data_igry) + '*\n';
    if (igra.nomer_igry) t += 'Игра вечера: *№' + igra.nomer_igry + '*\n';
    t += 'Код записи: *' + kod + '*\n';
    t += 'Победитель: *' + (pobediteli[igra.pobeditel] || igra.pobeditel || '-') + '*\n\n';
    t += '*Состав:*\n';
    (igra.igroki || []).forEach(i => {
        const em = i.status === 'v_igre' ? '✅' : '💀';
        t += em + ' №' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
    });
    if ((igra.avto_bonusy || []).length) {
        t += '\n*Бонусы:*\n';
        igra.avto_bonusy.forEach(b => {
            const i = igra.igroki.find(p => p.nomer === b.nomer);
            t += '🎁 №' + b.nomer + ' ' + (i?.name || '') + ': +' + b.pts + ' — ' + b.text + '\n';
        });
    }
    t += '\n🏆 Баллы записаны в рейтинг.';
    return t;
}

async function sozdatRuchnuyuIgruIzDrafta(draft, telegram_id) {
    let kod = sgenerirovat_kod();
    while (igry[kod]) kod = sgenerirovat_kod();
    const igra = draft.igra;
    igra.vedushchii_id = telegram_id;
    igra.kolichestvo = igra.igroki.length;
    igra.roli_razdany = true;
    igra.rezhim_rolei = 'ruchnoy_rezultat';
    igra.faza = 'zavershena';
    igra.den = 1;
    igra._nastroyki = {
        ...(igra._nastroyki || {}),
        ruchnoy_rezultat: true,
        data_igry: igra.data_igry || null,
        nomer_igry: igra.nomer_igry || null
    };
    for (const igrok of igra.igroki) {
        await privyazatIgrokaIzBazy(igra, igrok);
    }
    igry[kod] = igra;
    await sohranit_igru(kod);
    return { kod, igra };
}

function tekstVvodaSpiskaMirnyh(igra, kod) {
    const nuzhno = mirnyeOstalosVnesti(igra);
    let t = '\uD83D\uDFE2 *Мирные жители* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n\n';
    t += 'Активные роли уже внесены.\n\n';
    t += 'Осталось мирных: *' + nuzhno + '*\n\n';
    t += 'Добавляй *по одному* — номер или ник:\n_`7` или `Аня`_\n\n';
    t += 'Или отправь *списком* — через запятую или каждый ник с новой строки:\n';
    t += '_`Аня, Оля, Катя`_\n\n';
    t += '_Если игрок есть в боте — привяжем к рейтингу автоматически._\n';
    const sRolyami = (igra.igroki || []).filter(i => i.rol && i.rol !== 'Мирный');
    const uzheMirnye = (igra.igroki || []).filter(i => i.rol === 'Мирный');
    if (sRolyami.length > 0) {
        t += '\nУже с ролями: ' + sRolyami.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    if (uzheMirnye.length > 0) {
        t += 'Уже мирные: ' + uzheMirnye.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    return t;
}

function knopkiMirnyhVvoda(igra, kod) {
    const knopki = [];
    const bezRoli = (igra.igroki || []).filter(i => i.status === 'v_igre' && !i.rol);
    bezRoli.forEach(i => {
        knopki.push([{ text: '\uD83D\uDFE2 \u2116' + i.nomer + ' ' + i.name + ' — мирный', callback_data: 'mirny_igrok_' + kod + '_' + i.nomer }]);
    });
    if (mirnyeOstalosVnesti(igra) > 0) {
        knopki.push([{ text: '\u270D\uFE0F Ввести мирных списком', callback_data: 'mirny_vvod_' + kod }]);
    }
    if (mirnyeOstalosVnesti(igra) <= 0) {
        knopki.push([{ text: '\u2705 Завершить ночь', callback_data: 'mirny_done_' + kod }]);
    }
    return { inline_keyboard: knopki };
}

async function dobavitMirnogoVIgru(chatId, igra, kod, igrok) {
    if (!igrok) return { ok: false, error: 'not_found' };
    if (igrok.rol && igrok.rol !== 'Мирный') {
        return { ok: false, error: 'has_role', rol: igrok.rol, igrok };
    }
    if (mirnyeOstalosVnesti(igra) <= 0) {
        return { ok: false, error: 'full' };
    }
    if (igrok.rol === 'Мирный') {
        return { ok: false, error: 'already', igrok };
    }

    igrok.rol = 'Мирный';
    igrok.status = 'v_igre';
    igrok.foly = igrok.foly || 0;
    await privyazatIgrokaIzBazy(igra, igrok);
    await sohranit_igru(kod);
    return { ok: true, igrok, ostalos: mirnyeOstalosVnesti(igra) };
}

async function soobshitMirnogoDobavlen(chatId, igra, kod, igrok, ostalos) {
    const reyting = igrok.igrok_id ? ' \u2705' : '';
    let t = '\u2705 \u2116' + igrok.nomer + ' ' + igrok.name + ' — *Мирный*' + reyting;
    if (ostalos > 0) t += '\n\nОсталось мирных: *' + ostalos + '*';
    await bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: knopkiMirnyhVvoda(igra, kod)
    });
}

async function vnestiOdnogoMirnogo(chatId, igra, kod, text) {
    if (mirnyeOstalosVnesti(igra) <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return true;
    }

    const vvod = String(text || '').trim();
    if (!vvod) {
        await bot.sendMessage(chatId, '\u274C Отправь номер или ник игрока.', { parse_mode: 'Markdown' });
        return false;
    }

    let igrok = naytiIgrokaPoVvodu(igra, vvod);
    if (!igrok) {
        if ((igra.igroki || []).length >= igra.kolichestvo) {
            await bot.sendMessage(chatId, '\u274C Все места заняты (' + igra.kolichestvo + '). Выбери игрока из состава.', { parse_mode: 'Markdown' });
            return false;
        }
        igrok = {
            telegram_id: null,
            name: vvod,
            nomer: igra.igroki.length + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        };
        igra.igroki.push(igrok);
    }

    const rez = await dobavitMirnogoVIgru(chatId, igra, kod, igrok);
    if (!rez.ok) {
        if (rez.error === 'has_role') {
            await bot.sendMessage(chatId, '\u26A0\uFE0F У \u2116' + rez.igrok.nomer + ' ' + rez.igrok.name + ' уже роль *' + rez.rol + '*', { parse_mode: 'Markdown' });
        } else if (rez.error === 'already') {
            await bot.sendMessage(chatId, '\u2116' + rez.igrok.nomer + ' ' + rez.igrok.name + ' уже *Мирный*', { parse_mode: 'Markdown' });
        }
        return false;
    }

    await soobshitMirnogoDobavlen(chatId, igra, kod, rez.igrok, rez.ostalos);
    if (rez.ostalos <= 0) await zavershitNochZnakomstva(chatId, kod);
    return true;
}

async function vnestiSpisokMirnyh(chatId, igra, kod, text) {
    const nuzhno = mirnyeOstalosVnesti(igra);
    const niki = razobratSpisokNikov(text);

    if (nuzhno <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return true;
    }

    if (niki.length !== nuzhno) {
        await bot.sendMessage(chatId,
            '\u274C Нужно *' + nuzhno + '* ников (мирных по составу), получено: ' + niki.length + '.\n\n' +
            'Отправь списком — каждый ник с новой строки.',
            { parse_mode: 'Markdown' }
        );
        return false;
    }

    const oshibki = [];
    for (const nick of niki) {
        let igrok = naytiIgrokaPoVvodu(igra, nick);
        if (igrok?.rol && igrok.rol !== 'Мирный') {
            oshibki.push(nick + ' (уже роль ' + igrok.rol + ')');
            continue;
        }
        if (!igrok) {
            if ((igra.igroki || []).length >= igra.kolichestvo) {
                oshibki.push(nick + ' (нет свободных мест)');
                continue;
            }
            igrok = {
                telegram_id: null,
                name: nick,
                nomer: igra.igroki.length + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null,
                rol: 'Мирный'
            };
            igra.igroki.push(igrok);
        } else {
            igrok.rol = 'Мирный';
            igrok.status = 'v_igre';
            igrok.foly = igrok.foly || 0;
        }
        await privyazatIgrokaIzBazy(igra, igrok);
    }

    if (oshibki.length > 0) {
        await bot.sendMessage(chatId, '\u26A0\uFE0F Не удалось внести:\n' + oshibki.join('\n'));
        return false;
    }

    await sohranit_igru(kod);
    await zavershitNochZnakomstva(chatId, kod);
    return true;
}

async function nachatVvodMirnyhRuchnoy(chatId, kod) {
    const igra = igry[kod];
    if (!igra) return;

    const ostalos = mirnyeOstalosVnesti(igra);
    if (ostalos <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return;
    }

    sostoyanie[igra.vedushchii_id] = 'noch_mirnye_' + kod;
    await sohranit_igru(kod);
    await bot.sendMessage(chatId, tekstVvodaSpiskaMirnyh(igra, kod), {
        parse_mode: 'Markdown',
        reply_markup: knopkiMirnyhVvoda(igra, kod)
    });
}

async function pokazatShagNochiZnakomstva(chatId, kod, idx) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);
    const roles = poryadokRoleyDlyaNochi(igra);
    if (idx >= roles.length) {
        await nachatVvodMirnyhRuchnoy(chatId, kod);
        return;
    }
    sostoyanie[igra.vedushchii_id] = 'noch_znakomstvo_' + kod + '_' + idx;
    await bot.sendMessage(chatId, tekstShagaNochiZnakomstva(igra, kod, idx), { parse_mode: 'Markdown' });
}

function poluchitResidentovIzNastroek(nastroyki) {
    return Array.isArray(nastroyki?.residenty) ? nastroyki.residenty : [];
}

async function poluchitResidentovKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    return poluchitResidentovIzNastroek(klub?.nastroyki || {});
}

async function ustanovitResidentaKluba(klub_id, igrok_id, dobavit) {
    const { data: klub, error } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    if (error) throw error;

    const nastroyki = klub?.nastroyki || {};
    const residenty = new Set(poluchitResidentovIzNastroek(nastroyki));
    if (dobavit) residenty.add(igrok_id);
    else residenty.delete(igrok_id);

    await supabase
        .from('kluby')
        .update({ nastroyki: { ...nastroyki, residenty: Array.from(residenty) } })
        .eq('id', klub_id);
}

async function dobavitChlenaKlubaEsliNuzhno(klub_id, igrok_id) {
    if (!klub_id || !igrok_id) return;
    const { data: sushch } = await supabase
        .from('chleny_klubov')
        .select('id')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .single();
    if (!sushch) {
        await supabase.from('chleny_klubov').insert({ klub_id, igrok_id, rol: 'igrok' });
    }
}

function dobavitIgrokaVIgru(igra, igrok) {
    if (!igra || !igrok) return { ok: false, reason: 'not_found' };
    if ((igra.igroki || []).some(i => i.igrok_id === igrok.id || (igrok.tg_id && i.telegram_id === igrok.tg_id))) {
        return { ok: false, reason: 'exists' };
    }
    if ((igra.igroki || []).length >= igra.kolichestvo) return { ok: false, reason: 'full' };

    const name = igrok.igrovoy_nik || igrok.imya || 'Игрок';
    const nomer = igra.igroki.length + 1;
    igra.igroki.push({
        telegram_id: igrok.tg_id || null,
        name,
        nomer,
        status: 'v_igre',
        foly: 0,
        igrok_id: igrok.id
    });
    return { ok: true, nomer, name };
}

function ubratIgrokaIzIgryPoId(igra, igrok_id) {
    if (!igra || !igrok_id || igra.roli_razdany) return false;
    const idx = (igra.igroki || []).findIndex(i => i.igrok_id === igrok_id);
    if (idx < 0) return false;
    igra.igroki.splice(idx, 1);
    igra.igroki.forEach((i, index) => { i.nomer = index + 1; });
    return true;
}

function dataIgrovoegoVechera() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

async function poluchitSpisokVecheraKluba(klub_id) {
    if (!klub_id) return null;
    const data_igry = dataIgrovoegoVechera();
    try {
        const { data, error } = await supabase
            .from('igrovye_vechera')
            .select('sostav')
            .eq('klub_id', klub_id)
            .eq('data_igry', data_igry)
            .single();
        if (!error && Array.isArray(data?.sostav) && data.sostav.length > 0) return data.sostav;
    } catch (_) {}

    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    const nastroyki = klub?.nastroyki || {};
    if (nastroyki.vecher_data !== dataIgrovoegoVechera()) return null;
    const spisok = Array.isArray(nastroyki.vecher_spisok) ? nastroyki.vecher_spisok : null;
    if (!spisok || spisok.length === 0) return null;
    return spisok;
}

async function sohranitSpisokVecheraKluba(klub_id, igroki) {
    if (!klub_id || !Array.isArray(igroki) || igroki.length === 0) return;
    const spisok = igroki.map(i => ({
        name: i.name,
        igrok_id: i.igrok_id || null,
        telegram_id: i.telegram_id || null
    }));
    try {
        const { error } = await supabase
            .from('igrovye_vechera')
            .upsert({
                klub_id,
                data_igry: dataIgrovoegoVechera(),
                sostav: spisok,
                istochnik: 'manual',
                updated_at: new Date().toISOString()
            }, { onConflict: 'klub_id,data_igry' });
        if (!error) return;
        console.error('[igrovye_vechera] fallback to kluby.nastroyki:', error.message);
    } catch (e) {
        console.error('[igrovye_vechera] fallback:', e?.message);
    }

    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    const nastroyki = klub?.nastroyki || {};
    await supabase
        .from('kluby')
        .update({
            nastroyki: {
                ...nastroyki,
                vecher_data: dataIgrovoegoVechera(),
                vecher_spisok: spisok
            }
        })
        .eq('id', klub_id);
}

async function zapolnitIgruIzSpiskaVechera(igra, spisok) {
    igra.igroki = [];
    for (let i = 0; i < spisok.length; i++) {
        const row = spisok[i];
        const igrok = {
            telegram_id: row.telegram_id || null,
            name: row.name,
            nomer: i + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: row.igrok_id || null
        };
        await privyazatIgrokaIzBazy(igra, igrok);
        igra.igroki.push(igrok);
    }
}

function tekstVvodaSpiskaIgrokov(igra, kod) {
    let t = '\uD83C\uDFB2 *Игра \u2116' + kod + ' создана*\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83D\uDC65 Мест: *' + igra.kolichestvo + '*\n\n';
    t += '\u270D\uFE0F *Список игроков*\n\n';
    t += 'Отправь *' + igra.kolichestvo + ' ников столбиком* — каждый с новой строки:\n\n';
    t += '`Аня`\n`Оля`\n`Катя`\n\n';
    t += '_Список сохранится для следующих игр этого вечера в клубе._\n';
    t += '_Если игрок есть в боте — привяжем к рейтингу автоматически._';
    return t;
}

async function pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    sostoyanie[telegram_id] = 'lobby_spisok_' + kod;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '\uD83D\uDCF1 Раздать в боте', callback_data: 'rezhim_bot_' + kod }]
        ]}
    };
    const text = tekstVvodaSpiskaIgrokov(igra, kod);
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } else {
        await bot.sendMessage(chatId, text, opts);
    }
}

async function nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    igra.rezhim_rolei = 'karty';
    await zagruzitNazvanieKlubaVIgru(igra);
    await sohranit_igru(kod);

    if ((igra.igroki || []).length >= igra.kolichestvo) {
        await pokazatLobbyIgry(chatId, messageId, kod);
        return;
    }

    if (igra.klub_id) {
        const spisok_vecher = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (spisok_vecher && spisok_vecher.length > 0) {
            await pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok_vecher);
            return;
        }
    }

    sostoyanie[telegram_id] = 'lobby_spisok_' + kod;
    await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
}

async function vnestiSpisokIgrokovLobby(chatId, igra, kod, text) {
    const nuzhno = igra.kolichestvo;
    const niki = razobratSpisokNikov(text);

    if (niki.length !== nuzhno) {
        await bot.sendMessage(chatId,
            '\u274C Нужно *' + nuzhno + '* ников, получено: ' + niki.length + '.\n\n' +
            'Отправь списком — каждый ник с новой строки.',
            { parse_mode: 'Markdown' }
        );
        return false;
    }

    igra.igroki = [];
    for (let i = 0; i < niki.length; i++) {
        const igrok = {
            telegram_id: null,
            name: niki[i],
            nomer: i + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        };
        await privyazatIgrokaIzBazy(igra, igrok);
        igra.igroki.push(igrok);
    }

    if (igra.klub_id) await sohranitSpisokVecheraKluba(igra.klub_id, igra.igroki);
    await sohranit_igru(kod);
    delete sostoyanie[igra.vedushchii_id];

    let t = '\u2705 Состав *' + nuzhno + '* игроков внесён';
    if (igra.klub_id) t += ' и сохранён для этого вечера';
    t += '.\n\n';
    igra.igroki.forEach(i => {
        t += i.nomer + '. ' + i.name + (i.igrok_id ? ' \u2705' : '') + '\n';
    });

    await bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '\uD83C\uDFB4 К лобби', callback_data: 'obnovit_igru_' + kod }],
            [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }]
        ]}
    });
    return true;
}

async function pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);

    let t = '\uD83D\uDCCB *Состав игрового вечера*\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83C\uDFB4 Игра \u2116' + kod + ' · мест: *' + igra.kolichestvo + '*\n\n';
    t += 'На этом вечере уже играли с таким составом:\n\n';
    spisok.forEach((p, i) => {
        t += (i + 1) + '. ' + p.name + '\n';
    });

    const sovpadaet = spisok.length === igra.kolichestvo;
    if (!sovpadaet) {
        t += '\n\u26A0\uFE0F В сохранённом списке *' + spisok.length + '* игроков, в этой игре — *' + igra.kolichestvo + '*.\n';
        t += 'Отредактируй список под число мест в игре.';
    } else {
        t += '\nПодтвердить состав или отредактировать перед ночью знакомства?';
    }

    const knopki = [];
    if (sovpadaet) {
        knopki.push([{ text: '\u2705 Подтвердить список', callback_data: 'vecher_ok_' + kod }]);
    }
    knopki.push([{ text: '\u270F\uFE0F Редактировать список', callback_data: 'vecher_edit_' + kod }]);
    knopki.push([{ text: '\u2B05\uFE0F К лобби', callback_data: 'obnovit_igru_' + kod }]);

    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatVyborResidentovIgry(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra?.klub_id) return;

    const residentyIds = await poluchitResidentovKluba(igra.klub_id);
    if (residentyIds.length === 0) {
        await bot.editMessageText(
            '⭐ *Резиденты клуба*\n\nВ клубе пока нет сохранённых резидентов.\n\nДобавь их в разделе *База игроков*: открой карточку игрока и нажми «Сделать резидентом».',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В лобби', callback_data: 'obnovit_igru_' + kod }]] }
            }
        );
        return;
    }

    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('igroki(id, tg_id, imya, igrovoy_nik, tg_username)')
        .eq('klub_id', igra.klub_id);

    const residenty = (chleny || [])
        .map(c => c.igroki)
        .filter(i => i && residentyIds.includes(i.id))
        .sort((a, b) => (a.igrovoy_nik || a.imya || '').localeCompare(b.igrovoy_nik || b.imya || '', 'ru'));

    let tekst = '⭐ *Добавить резидентов в игру №' + kod + '*\n\n';
    tekst += 'Мест занято: *' + igra.igroki.length + '/' + igra.kolichestvo + '*\n';
    tekst += '_Нажимай на игроков — галочка добавляет/убирает из лобби._\n\n';

    const knopki = [];
    residenty.forEach(i => {
        const uzhe = (igra.igroki || []).some(g => g.igrok_id === i.id || (i.tg_id && g.telegram_id === i.tg_id));
        const name = i.igrovoy_nik || i.imya || 'Игрок';
        const username = i.tg_username ? ' @' + i.tg_username : '';
        knopki.push([{ text: (uzhe ? '✅ ' : '▫️ ') + name + username, callback_data: cbBtn('rezadd_', { kod, igrok_id: i.id }) }]);
    });

    knopki.push([{ text: '⬅️ В лобби', callback_data: 'obnovit_igru_' + kod }]);

    await bot.editMessageText(tekst, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatLobbyIgry(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);

    const rezhim = igra.rezhim_rolei === 'karty' ? '\uD83C\uDFB4 *Физические карты*' : '\uD83D\uDCF1 *Роли в боте*';
    const polno = igra.igroki.length >= igra.kolichestvo;
    const opisanie = igra.rezhim_rolei === 'karty'
        ? (polno
            ? 'Состав внесён — можно начинать ночь знакомства.'
            : 'Внеси *' + igra.kolichestvo + ' игроков* списком — каждый ник с новой строки.')
        : 'Игроки подключаются по коду, бот отправит каждому роль в личку.';
    let tekst = rezhim + '\n\n';
    if (nazvanieKlubaIgry(igra)) tekst += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    tekst += '\uD83C\uDFB4 Игра \u2116' + kod + '\n';
    tekst += '\uD83D\uDC65 Игроков: *' + igra.igroki.length + '/' + igra.kolichestvo + '*\n\n';
    tekst += opisanie + '\n\n';

    let spisok = '';
    igra.igroki.forEach((ig, i) => {
        spisok += (i + 1) + '. ' + (ig.name || ig.imya || 'Игрок') + '\n';
    });
    tekst += spisok || '_Список игроков ещё не внесён_';
    if (!polno) tekst += '\n\n_Осталось: ' + (igra.kolichestvo - igra.igroki.length) + ' игрок(ов)._';


    const knopki = [[{ text: '🔄 Обновить список', callback_data: 'obnovit_igru_' + kod }]];
    if (igra.klub_id) knopki.push([{ text: '⭐ Добавить резидентов', callback_data: cbBtn('rez_', { kod }) }]);
    if (igra.rezhim_rolei === 'bot') {
        knopki.push([{ text: polno ? '🎭 Раздать роли' : '🎭 Раздать роли (ждём игроков)', callback_data: 'razdat_' + kod }]);
    } else {
        if (!polno) {
            knopki.unshift([{ text: '\u270D\uFE0F Внести список столбиком', callback_data: 'lobby_spisok_' + kod }]);
        }
        if (igra.klub_id) {
            knopki.push([{ text: '\uD83D\uDCCB Состав вечера', callback_data: 'vecher_pokaz_' + kod }]);
        }
        if (mirnyeOstalosVnesti(igra) > 0 && (igra.igroki || []).some(i => i.rol && i.rol !== 'Мирный')) {
            knopki.push([{ text: '\uD83D\uDFE2 + Мирный (' + mirnyeOstalosVnesti(igra) + ')', callback_data: 'panel_mirny_' + kod }]);
        }
        knopki.push([{ text: polno ? '\uD83C\uDF19 Начать ночь знакомства' : '\uD83C\uDF19 Ночь (нужен полный состав)', callback_data: 'noch_znakomstvo_' + kod }]);
        knopki.push([{ text: '✍️ Внести роли вручную', callback_data: 'manual_roles_' + kod }]);
        knopki.push([{ text: polno ? '▶️ Начать игру' : '▶️ Начать игру / внести роли', callback_data: 'nachat_igru_' + kod }]);
    }
    knopki.push([{ text: '❌ Отменить', callback_data: 'otmenit_' + kod }]);

    await bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

function aktivnyeIgryVedushchego(telegram_id) {
    return Object.entries(igry)
        .filter(([kod, igra]) => !String(kod).startsWith('archive_') && igra?.vedushchii_id === telegram_id && !igra._ne_sohranyat)
        .map(([kod, igra]) => ({ kod, igra }))
        .sort((a, b) => String(a.kod).localeCompare(String(b.kod)));
}

async function pokazatMoiIgryBystraya(chatId, telegram_id) {
    const aktivnye = aktivnyeIgryVedushchego(telegram_id);
    if (aktivnye.length === 0) {
        await bot.sendMessage(chatId, '🎮 *Мои игры*\n\nАктивных игр пока нет.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                [{ text: '📚 История игр', callback_data: 'istoriya_igr' }]
            ] }
        });
        return;
    }

    let t = '🎮 *Мои активные игры*\n\n';
    const knopki = [];
    aktivnye.forEach(({ kod, igra }) => {
        const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
        const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
        t += '🎴 №' + kod + ' — ' + status + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
        knopki.push([
            { text: '🎮 №' + kod, callback_data: 'open_igra_' + kod },
            { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Стоп', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
            { text: '🗑', callback_data: 'delete_igra_' + kod }
        ]);
    });
    knopki.push([{ text: '📚 История игр', callback_data: 'istoriya_igr' }]);
    await bot.sendMessage(chatId, t, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
}

async function pokazatBystryyVyborIgry(chatId, telegram_id, tip) {
    const aktivnye = aktivnyeIgryVedushchego(telegram_id);
    const onlyStopped = tip === 'resume';
    const igryDlyaKnopok = aktivnye.filter(({ igra }) => onlyStopped ? igra.ostanovlena : true);
    if (igryDlyaKnopok.length === 0) {
        const text = onlyStopped
            ? '▶️ Нет остановленных игр для возобновления.'
            : '🎮 Активных игр пока нет.';
        await bot.sendMessage(chatId, text, bystrayaKlaviaturaVedushchego);
        return;
    }

    const zagolovok = tip === 'pause'
        ? '⏸ *Какую игру остановить?*'
        : tip === 'resume'
            ? '▶️ *Какую игру возобновить?*'
            : '🗑 *Какую игру удалить?*';
    const prefix = tip === 'pause' ? 'stop_igra_' : tip === 'resume' ? 'resume_igra_' : 'delete_igra_';
    const knopki = igryDlyaKnopok.map(({ kod, igra }) => [{
        text: '№' + kod + (igra.ostanovlena ? ' — остановлена' : ''),
        callback_data: prefix + kod
    }]);
    await bot.sendMessage(chatId, zagolovok, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

function aktivnyeIgryKluba(klub_id) {
    return Object.entries(igry)
        .filter(([kod, igra]) => !String(kod).startsWith('archive_') && igra?.klub_id === klub_id && !igra._ne_sohranyat)
        .map(([kod, igra]) => ({ kod, igra }))
        .sort((a, b) => String(a.kod).localeCompare(String(b.kod)));
}

async function poluchitKlubyDlyaIgr(telegram_id) {
    const { data: igrok } = await supabase
        .from('igroki')
        .select('id')
        .eq('tg_id', telegram_id)
        .single();

    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('klub_id, rol, kluby(id, nazvaniye)')
        .eq('igrok_id', igrok?.id)
        .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

    return (chleny || []).filter(c => c.kluby).map(c => c.kluby);
}

async function pokazatIgrovoyVecher(chatId, messageId, klub, telegram_id) {
    const { data: klubFull } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki')
        .eq('id', klub.id)
        .single();
    const klubInfo = klubFull || klub;
    const spisok = await poluchitSpisokVecheraKluba(klubInfo.id);
    const today = dataIgrovoegoVechera();

    let t = '🌙 *Игровой вечер*\n\n';
    t += 'Клуб: *' + (klubInfo.nazvaniye || '') + '*\n';
    t += 'Дата: *' + today + '*\n\n';
    if (spisok?.length) {
        t += '*Состав вечера (' + spisok.length + '):*\n';
        spisok.forEach((p, i) => { t += (i + 1) + '. ' + p.name + '\n'; });
        t += '\n_Новые игры этого вечера будут брать этот состав, а игроки без активной роли станут мирными._';
    } else {
        t += '_Состав вечера ещё не зафиксирован._\n\n';
        t += 'Можно загрузить пришедших из сегодняшнего анонса или внести ники вручную.';
    }

    const knopki = [];
    if (spisok?.length) {
        const tip = klubInfo.nastroyki?.tip_kluba || 'paskal';
        knopki.push([{ text: '🎲 Создать игру на ' + spisok.length, callback_data: 'igra_tip_kol_' + klubInfo.id + '_' + tip + '_' + spisok.length }]);
    }

    const { data: anonsy } = await supabase
        .from('anonsy')
        .select('id, data_igry, vremya')
        .eq('klub_id', klubInfo.id)
        .eq('status', 'aktiven')
        .order('data_igry', { ascending: true })
        .limit(20);
    (anonsy || [])
        .filter(a => (razobrat_datu_anonsa(a.data_igry) || a.data_igry) === today)
        .forEach(a => {
            knopki.push([{ text: '📢 Взять пришедших из анонса ' + (a.vremya || ''), callback_data: cbBtn('vech_an_', { klub_id: klubInfo.id, anons_id: a.id }) }]);
        });

    knopki.push([{ text: '✍️ Внести состав вручную', callback_data: 'vecher_vvod_' + klubInfo.id }]);
    knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatIgryKluba(chatId, messageId, klub) {
    const aktivnye = aktivnyeIgryKluba(klub.id);
    let t = '🏛 *Игры клуба*\n\nКлуб: *' + klub.nazvaniye + '*\n\n';
    const knopki = [];

    if (aktivnye.length === 0) {
        t += '_Активных игр сейчас нет._\n';
    } else {
        t += '*Активные игры:*\n';
        aktivnye.forEach(({ kod, igra }) => {
            const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            const rezhim = igra.rezhim_rolei === 'karty' ? 'физ. карты' : (igra.rezhim_rolei === 'bot' ? 'бот' : 'режим не выбран');
            const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
            t += '🎴 №' + kod + ' — ' + status + ', ' + rezhim + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
            knopki.push([{ text: '🎮 Открыть игру №' + kod, callback_data: 'open_igra_' + kod }]);
            knopki.push([
                { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Остановить', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
                { text: '🗑 Удалить', callback_data: 'delete_igra_' + kod }
            ]);
        });
    }

    knopki.push([{ text: '📚 История клуба', callback_data: 'hist_klub_' + klub.id }]);
    knopki.push([{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]);
    knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

    await bot.editMessageText(t, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function otkrytIgruVedushchego(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) {
        await bot.editMessageText('❌ Игра не найдена. Возможно, она уже завершена.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]] }
        });
        return;
    }

    if (igra.ostanovlena) {
        await bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nМожно возобновить её с того же места или удалить полностью.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }],
                [{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }],
                [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
            ]}
        });
        return;
    }

    if (!igra.rezhim_rolei && !igra.roli_razdany) {
        await bot.editMessageText(
            '🎮 *Игра №' + kod + '*\n\nУ этой игры ещё не выбран режим раздачи ролей. Выбери режим, чтобы продолжить:',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🃏 Физические карты', callback_data: 'rezhim_karty_' + kod }],
                    [{ text: '📱 Раздать в боте', callback_data: 'rezhim_bot_' + kod }],
                    [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
                ]}
            }
        );
        return;
    }

    if (!igra.roli_razdany) {
        await pokazatLobbyIgry(chatId, messageId, kod);
        return;
    }

    await bot.editMessageText('🎮 *Игра №' + kod + '*\n\nОткрой игровую панель:', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
            [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
        ]}
    });
}

function lichnoeVremyaSek(igra) {
    const nastroeno = parseInt(igra?._nastroyki?.minuta_sek, 10);
    if (Number.isFinite(nastroeno)) return Math.min(60, Math.max(40, nastroeno));
    if ((igra?.tip_kluba || 'paskal') === 'big_family') return 40;
    if ((igra?.tip_kluba || 'paskal') === 'paskal') return igra?.kolichestvo > 15 ? 40 : 60;
    return igra?.kolichestvo > 15 ? 40 : 60;
}

const MAFIA_ROLES = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник мафии', 'Консильери'];
const SHERIFF_ROLES = ['Шериф', 'Комиссар', 'Детектив'];
const MAFIA_WIN_BLOCKERS = ['Охотник', 'Стрелок', 'Маньяк'];

function isMafiaRole(rol) {
    return MAFIA_ROLES.includes(rol);
}

function isSheriffRole(rol) {
    return SHERIFF_ROLES.includes(rol);
}

function isPeacefulRole(rol) {
    return !isMafiaRole(rol) && rol !== 'Маньяк';
}

function rolStrelyayushchegoZaMirnyh(rol) {
    return ['Стрелок', 'Охотник'].includes(rol);
}

function dobavitAvtoBonus(igra, nomer, key, pts, text, meta = {}) {
    if (!igra || !nomer || !pts) return;
    if (!Array.isArray(igra.avto_bonusy)) igra.avto_bonusy = [];
    const den = igra.den || 1;
    const tsel = meta.tsel ?? null;
    const exists = igra.avto_bonusy.some(b => b.nomer === nomer && b.key === key && b.den === den && (b.tsel ?? null) === tsel);
    if (exists) return;
    igra.avto_bonusy.push({
        nomer,
        key,
        pts,
        text,
        den,
        ...meta
    });
}

function zapisatDen1Vybyl(igra, igrok) {
    if (!igra || !igrok || (igra.den || 1) !== 1) return;
    if (!Array.isArray(igra.den1_vygolosovany)) igra.den1_vygolosovany = [];
    if (!igra.den1_vygolosovany.includes(igrok.nomer)) igra.den1_vygolosovany.push(igrok.nomer);
}

function maxFolyIgry(igra) {
    const nastroeno = parseInt(igra?.max_foly || igra?._nastroyki?.max_foly, 10);
    return Number.isFinite(nastroeno) ? nastroeno : 4;
}

function nazvanieKlubaIgry(igra) {
    return igra?.klub_nazvaniye || igra?._nastroyki?.klub_nazvaniye || '';
}

async function zagruzitNazvanieKlubaVIgru(igra) {
    if (!igra || !igra.klub_id || nazvanieKlubaIgry(igra)) return nazvanieKlubaIgry(igra);
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', igra.klub_id).single();
    if (klub?.nazvaniye) {
        igra.klub_nazvaniye = klub.nazvaniye;
        igra._nastroyki = { ...(igra._nastroyki || {}), klub_nazvaniye: klub.nazvaniye };
    }
    return nazvanieKlubaIgry(igra);
}

function limitMinShahida(igra) {
    return Math.ceil((igra?.kolichestvo || igra?.igroki?.length || 0) * 0.3);
}

function limitVystrelovEskort(igra) {
    const n = igra?.kolichestvo || igra?.igroki?.length || 0;
    if (n >= 15) return 3;
    if (n >= 12) return 2;
    return 1;
}

function eskortVyboryNochi(igra) {
    return igra?.noch_deystviya?.eskort_vybory || [];
}

function roliDlyaUgadivaniyaEskort() {
    return ALL_ROLE_NAMES.filter(r => r !== 'Путана');
}

function sravnitRoliEskort(ugadannaya, fakticheskaya) {
    const u = normalizovatNazvanieRoli(ugadannaya) || ugadannaya;
    const f = normalizovatNazvanieRoli(fakticheskaya) || fakticheskaya;
    return u === f;
}

function tekstStatusaEskort(igra) {
    const vybory = eskortVyboryNochi(igra);
    const limit = limitVystrelovEskort(igra);
    if (vybory.length === 0) return 'не стреляла (' + limit + ' доступно)';
    const chasti = vybory.map(v => '\u2116' + v.nomer + ' \u2192 ' + v.ugadannaya_rol);
    return chasti.join('; ') + ' (' + vybory.length + '/' + limit + ')';
}

const PRAVILA_PRESET = {
    paskal: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    vip: { doktor_sebya: 'cherez_raz', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: false },
    naila: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    sportivniy: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    big_family: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true }
};

function pravilaIgry(igra) {
    const tip = igra?.tip_kluba || igra?._nastroyki?.tip_kluba || 'paskal';
    const preset = PRAVILA_PRESET[tip] || PRAVILA_PRESET.paskal;
    const custom = igra?._nastroyki?.pravila || {};
    return { ...preset, ...custom };
}

function nazvaniePravilKluba(igra) {
    const tip = igra?.tip_kluba || igra?._nastroyki?.tip_kluba || 'paskal';
    if (tip === 'vip') return 'VIP';
    if (tip === 'sportivniy') return 'Спортивный';
    return 'Pascal';
}

function tekstPravilDoktora(igra) {
    const p = pravilaIgry(igra);
    const sebya = p.doktor_sebya === 'cherez_raz' ? 'себя — через ночь' : 'себя — 2 ночи подряд';
    const drugih = p.doktor_povtor_celi ? 'других — без ограничений' : 'одного игрока — не 2 ночи подряд';
    return drugih + ', ' + sebya;
}

function dvoynoyVystrelMafiyaManyak(d) {
    const maf = (d?.mafiya_tseli || [])[0];
    const man = d?.manyak_tseli;
    return maf != null && man != null && maf === man;
}

function doktorSpasTsel(d, igra, nomer) {
    if (d?.doctor_tseli !== nomer) return false;
    if (pravilaIgry(igra).doktor_dvoynoy_vystrel !== false && dvoynoyVystrelMafiyaManyak(d)) return false;
    return true;
}

function proveritLechitDoktor(igra, nomerTsel) {
    const doctor = igra.igroki.find(i => i.status === 'v_igre' && i.rol === 'Доктор');
    if (!doctor) return { ok: true };
    const pravila = pravilaIgry(igra);
    const proshlaya = igra.doctor_proshlaya_tsel;

    if (nomerTsel !== doctor.nomer && proshlaya === nomerTsel && !pravila.doktor_povtor_celi) {
        return { ok: false, text: 'Доктор не может лечить одного игрока две ночи подряд (VIP).' };
    }
    if (nomerTsel === doctor.nomer) {
        if (pravila.doktor_sebya === 'cherez_raz' && proshlaya === doctor.nomer) {
            return { ok: false, text: 'По правилам VIP доктор лечит себя через ночь.' };
        }
        if (pravila.doktor_sebya === 'dva_podryad' && proshlaya === doctor.nomer && (igra.doctor_sebya_podryad || 0) >= 2) {
            return { ok: false, text: 'Доктор уже лечил себя 2 ночи подряд (Pascal).' };
        }
    }
    return { ok: true };
}

function zapisatIstoriyuDoktora(igra, docTsel) {
    if (!docTsel) return;
    const doctor = igra.igroki.find(i => i.rol === 'Доктор');
    const proshlaya = igra.doctor_proshlaya_tsel;
    igra.doctor_proshlaya_tsel = docTsel;
    if (doctor && docTsel === doctor.nomer) {
        igra.doctor_sebya_podryad = proshlaya === doctor.nomer ? (igra.doctor_sebya_podryad || 0) + 1 : 1;
    } else {
        igra.doctor_sebya_podryad = 0;
    }
}

function primenitNochnyeVystrely(igra, d) {
    const lines = [];
    const ubity_t = [];
    const maf = (d.mafiya_tseli || [])[0] ?? null;
    const man = d.manyak_tseli ?? null;
    const str = d.strelok_tseli ?? null;
    const doctor = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Доктор');
    const manyak = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Маньяк');
    const strelok = igra.igroki.find(x => x.status === 'v_igre' && rolStrelyayushchegoZaMirnyh(x.rol));
    const vseCeli = [...new Set([maf, man, str].filter(n => n != null))];

    for (const nomer of vseCeli) {
        const igrok = igra.igroki.find(x => x.nomer === nomer && x.status === 'v_igre');
        if (!igrok) {
            if (maf === nomer) lines.push('_Мафия стреляла в \u2116' + nomer + ', цель уже не за столом_');
            continue;
        }
        const mafiya = maf === nomer;
        const manyakStr = man === nomer;
        const strelokStr = str === nomer;
        const bessmert = igrok.rol === 'Бессмертный';
        const docSpas = doktorSpasTsel(d, igra, nomer);

        if (mafiya && manyakStr) {
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDCA5 \u2116' + nomer + ' *' + igrok.name + '* — в него стреляли и мафия, и маньяк. Доктор не спасает.');
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && manyak?.status === 'v_igre') {
                manyak.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, manyak);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Маньяка с собой\n');
            }
            continue;
        }
        if (manyakStr) {
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83C\uDFAF Маньяк убил \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ')\n');
            if (manyak && isMafiaRole(igrok.rol)) {
                dobavitAvtoBonus(igra, manyak.nomer, 'bonus_pravilnyy_otstrel_mafii', BALLY_DEFAULT.bonus_pravilnyy_otstrel_mafii, 'Маньяк правильно отстрелил мафию', { tsel: nomer });
            }
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && manyak?.status === 'v_igre') {
                manyak.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, manyak);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Маньяка с собой\n');
            }
            continue;
        }
        if (mafiya) {
            if (bessmert) {
                dobavitAvtoBonus(igra, igrok.nomer, 'bonus_bessmertnyy_prinyal_vystrel', BALLY_DEFAULT.bonus_bessmertnyy_prinyal_vystrel, 'Бессмертный принял выстрел мафии', { tsel: nomer });
                lines.push('\uD83D\uDEE1\uFE0F \u2116' + nomer + ' *' + igrok.name + '* (Бессмертный) — принял выстрел мафии и остался в игре\n');
                continue;
            }
            if (docSpas) {
                if (doctor) dobavitAvtoBonus(igra, doctor.nomer, 'bonus_doctor_spas', BALLY_DEFAULT.bonus_doctor_spas, 'Доктор правильно вылечил цель мафии', { tsel: nomer });
                lines.push('\uD83D\uDC89 \u2116' + nomer + ' *' + igrok.name + '* — спасён доктором\n');
                continue;
            }
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDC80 \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ') — убит мафией\n');
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник' && d.podryvnik_zabiraet) {
                const zabiraet = igra.igroki.find(x => x.nomer === d.podryvnik_zabiraet && x.status === 'v_igre');
                if (zabiraet) {
                    zabiraet.status = 'vybyl';
                    dobavitUnikalnoPoNomeru(ubity_t, zabiraet);
                    lines.push('\uD83D\uDCA5 Подрывник забрал с собой \u2116' + zabiraet.nomer + ' *' + zabiraet.name + '* (' + zabiraet.rol + ')\n');
                    lines.push(primenitSmertShahida(igra, zabiraet, 'noch', ubity_t));
                }
            }
            continue;
        }
        if (strelokStr) {
            if (bessmert) {
                lines.push('\uD83D\uDEE1\uFE0F Стрелок/Охотник стрелял в \u2116' + nomer + ' *' + igrok.name + '* (Бессмертный), цель осталась в игре\n');
                continue;
            }
            if (docSpas) {
                if (doctor) dobavitAvtoBonus(igra, doctor.nomer, 'bonus_doctor_spas', BALLY_DEFAULT.bonus_doctor_spas, 'Доктор правильно вылечил цель ночного выстрела', { tsel: nomer });
                lines.push('\uD83D\uDC89 Стрелок/Охотник стрелял в \u2116' + nomer + ' *' + igrok.name + '*, но Доктор спас цель\n');
                continue;
            }
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDD2B Стрелок/Охотник убил \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ')\n');
            if (strelok && isMafiaRole(igrok.rol)) {
                dobavitAvtoBonus(igra, strelok.nomer, 'bonus_pravilnyy_otstrel_mafii', BALLY_DEFAULT.bonus_pravilnyy_otstrel_mafii, 'Стрелок/Охотник правильно отстрелил мафию', { tsel: nomer });
            } else if (strelok && isPeacefulRole(igrok.rol)) {
                strelok.mirnye_ubitye_strelkom = (strelok.mirnye_ubitye_strelkom || 0) + 1;
                if (strelok.mirnye_ubitye_strelkom >= 2 && strelok.status === 'v_igre') {
                    strelok.status = 'vybyl';
                    dobavitUnikalnoPoNomeru(ubity_t, strelok);
                    lines.push('\u26A0\uFE0F Стрелок/Охотник убил двух мирных и покидает игру\n');
                }
            }
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && strelok?.status === 'v_igre') {
                strelok.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, strelok);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Стрелка/Охотника с собой\n');
            }
        }
    }

    if (maf == null && !(d.mafiya_tseli || []).length) lines.push('_Мафия не выбрала цель_\n');
    return { lines, ubity_t };
}

function dobavitUnikalnoPoNomeru(spisok, igrok) {
    if (!igrok || spisok.some(i => i.nomer === igrok.nomer)) return;
    spisok.push(igrok);
}

function sosediShahida(igra, shahid) {
    const alive = (igra?.igroki || [])
        .filter(i => i.status === 'v_igre' && i.nomer !== shahid.nomer)
        .sort((a, b) => a.nomer - b.nomer);
    if (alive.length < 2) return alive;
    const left = [...alive].reverse().find(i => i.nomer < shahid.nomer) || alive[alive.length - 1];
    const right = alive.find(i => i.nomer > shahid.nomer) || alive[0];
    return [left, right].filter(Boolean);
}

function primenitSmertShahida(igra, shahid, prichina, ubitye) {
    if (!igra || !shahid || shahid.rol !== 'Шахид') return '';
    let tekst = '';

    if (prichina === 'golosovanie' && (igra.den || 1) === 1) {
        const sosedi = sosediShahida(igra, shahid);
        sosedi.forEach(sosed => {
            if (sosed.status === 'v_igre') {
                sosed.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubitye, sosed);
                tekst += '\uD83D\uDCA5 Шахида выголосовали в День 1 — сосед \u2116' + sosed.nomer + ' *' + sosed.name + '* (' + sosed.rol + ') покидает игру\n';
            }
        });
    }

    const miny = Array.isArray(igra.shahid_miny) ? igra.shahid_miny : [];
    miny.forEach(nomer => {
        const zamin = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
        if (zamin) {
            zamin.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubitye, zamin);
            tekst += '\uD83D\uDCA3 Заминированный \u2116' + zamin.nomer + ' *' + zamin.name + '* (' + zamin.rol + ') уходит вместе с Шахидом\n';
        }
    });

    igra.shahid_miny = [];
    return tekst;
}

function mozhetBytLuchshiyHod(igrok) {
    return igrok && !isMafiaRole(igrok.rol) && igrok.rol !== 'Маньяк';
}

function prichinaLuchshegoHoda(source) {
    return source === 'den1' ? 'Выголосован в День 1' : 'Убит в Ночь 1';
}

function poluchitLuchshiyHod(igra, nomer, source) {
    igra.luchshie_hody = igra.luchshie_hody || [];
    let hod = igra.luchshie_hody.find(h => h.igrok_nomer === nomer && h.source === source);
    if (!hod) {
        hod = { igrok_nomer: nomer, source, prichina: prichinaLuchshegoHoda(source), nazvannye: [] };
        igra.luchshie_hody.push(hod);
    }
    return hod;
}

function knopkiLuchshegoHoda(igra, kod, nomer, source, next) {
    const hod = poluchitLuchshiyHod(igra, nomer, source);
    const knopki = (igra.igroki || [])
        .filter(i => i.nomer !== nomer)
        .map(i => [{
            text: (hod.nazvannye.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'lh_toggle_' + kod + '_' + nomer + '_' + i.nomer + '_' + source + '_' + next
        }]);
    knopki.push([{ text: '\u2705 Сохранить лучший ход', callback_data: 'lh_done_' + kod + '_' + nomer + '_' + source + '_' + next }]);
    knopki.push([{ text: '\u23ED\uFE0F Пропустить', callback_data: 'lh_skip_' + kod + '_' + nomer + '_' + source + '_' + next }]);
    return knopki;
}

async function pokazatLuchshiyHod(chatId, messageId, kod, nomer, source, next) {
    const igra = igry[kod];
    if (!igra) return;
    const igrok = igra.igroki.find(i => i.nomer === nomer);
    if (!igrok) return;
    const hod = poluchitLuchshiyHod(igra, nomer, source);
    let t = '\uD83C\uDFC6 *Лучший ход*\n\n';
    t += '\u2116' + igrok.nomer + ' *' + igrok.name + '* — ' + hod.prichina + '\n\n';
    t += 'Отметь игроков, которых он назвал мафией на последнем слове.\n';
    t += 'Бот после игры сам сверит реальные роли и начислит баллы.\n\n';
    t += 'Выбрано: ' + (hod.nazvannye.length ? hod.nazvannye.map(n => '\u2116' + n).join(', ') : '_никого_');
    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopkiLuchshegoHoda(igra, kod, nomer, source, next) }
    });
}

async function prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next) {
    const igra = igry[kod];
    if (!igra) return;
    const pobeditel = opredelitPobeditelya(igra);
    if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;

    if (next === 'noch') {
        igra.faza = 'noch';
        await sohranit_igru(kod);
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
        return;
    }

    if (next === 'day') {
        igra.den = (igra.den || 1) + 1;
        await sohranit_igru(kod);
        await bot.editMessageText('\uD83C\uDF19 *Итоги ночи сохранены.*\n\nМожно начинать день ' + igra.den + '.\n_Сначала выберешь, кто начинает дневные речи._', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }],
                [{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]
            ] }
        });
    }
}

function mozhetKonsilyeriVerbovat(igra) {
    const alive = (igra?.igroki || []).filter(i => i.status === 'v_igre');
    if (alive.length === 0) return false;
    const maf = alive.filter(i => isMafiaRole(i.rol)).length;
    return maf > 0 && (maf / alive.length) < 0.3;
}

function opredelitPobeditelya(igra) {
    const alive = (igra?.igroki || []).filter(i => i.status === 'v_igre');
    const maf = alive.filter(i => isMafiaRole(i.rol)).length;
    const manyak = alive.filter(i => i.rol === 'Маньяк').length;
    const mirnye = alive.length - maf - manyak;

    if (alive.length === 0) return null;
    if (manyak > 0 && alive.length <= 2) return 'manyak';
    if (maf === 0 && manyak === 0) return 'mirnye';
    if (maf === 0 && mirnye === 0 && manyak > 0) return 'manyak';
    if (maf > 0 && maf >= mirnye + manyak) {
        const estBlokiruyushchayaRol = alive.some(i => MAFIA_WIN_BLOCKERS.includes(i.rol));
        if (estBlokiruyushchayaRol) return null;
        return 'mafiya';
    }
    return null;
}

async function zavershitIgruAvto(chatId, messageId, kod, pobeditel) {
    const igra = igry[kod];
    if (!igra || !pobeditel) return false;
    stopTimer(kod);

    const pobeditel_text = pobeditel === 'mirnye' ? '🟢 Мирные'
                         : pobeditel === 'mafiya' ? '🔴 Мафия'
                         : '🎯 Маньяк';

    let svodka = '⚠️ *Возможное завершение игры*\n\n';
    svodka += 'Бот видит возможного победителя: ' + pobeditel_text + '\n\n';
    svodka += 'Игра *не завершена автоматически*, рейтинг не записан.\n';
    svodka += 'Подтверди итог вручную, если игра действительно закончилась.\n\n';
    svodka += '*Сейчас за столом:*\n';
    igra.igroki.forEach(i => {
        const em = i.status === 'v_igre' ? '✅' : '💀';
        svodka += em + ' №' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
    });

    await bot.editMessageText(svodka, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🏁 Подтвердить итог игры', callback_data: 'konec_' + kod }],
            [{ text: '🎮 Продолжить игру', callback_data: 'panel_' + kod }],
            [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
        ]}
    });
    return true;
}

function buildPanelText(igra, kod) {
    const alive = igra.igroki.filter(i => i.status === 'v_igre');
    const faza_names = { ozhidanie: 'Ожидание', znakomstvo: 'Знакомство', den: 'День', noch: 'Ночь', golosovanie: 'Голосование', opravdanie: 'Оправдание' };
    let t = '\uD83C\uDFAE *Игра \u2116' + kod + '* | ' + (faza_names[igra.faza] || '') + ' ' + (igra.den || 1) + '\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83D\uDC65 За столом: *' + alive.length + '*/' + igra.kolichestvo + '\n';
    if (igra.taymer_aktiven && igra.taymer_sekundy > 0) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u23F1 *' + formatTime(igra.taymer_sekundy) + '* — \u2116' + (cur ? cur.nomer : '?') + ' ' + (cur ? cur.name : '') + '\n';
    } else if (igra.tekushchiy_nomer) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u25B6\uFE0F Ход: \u2116' + (cur ? cur.nomer : '?') + ' *' + (cur ? cur.name : '') + '*\n';
    }
    const vystavleny = nominirovannyePoPoryadku(igra);
    if (vystavleny.length && (igra.faza === 'den' || igra.faza === 'znakomstvo')) {
        t += '\n\uD83D\uDCA5 *На голосовании:* ' + vystavleny.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    t += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
    if (igra.faza === 'opravdanie' || igra.faza === 'golosovanie') {
        if (vystavleny.length) {
            t += '\uD83D\uDCA5 *На голосовании (по порядку):*\n';
            vystavleny.forEach((i, idx) => {
                let em = '\uD83D\uDCA5';
                if (igra.tekushchiy_nomer === i.nomer) em = '\u25B6\uFE0F';
                t += (idx + 1) + '. ' + em + ' \u2116' + i.nomer + ' *' + i.name + '*';
                if (i.foly > 0) t += ' [' + i.foly + '\uD83D\uDD34]';
                t += '\n';
            });
        } else {
            t += '_Список на голосование пуст._\n';
        }
    } else {
        igra.igroki.forEach(i => {
            let em = i.status === 'v_igre' ? (i.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            if (igra.tekushchiy_nomer === i.nomer && i.status === 'v_igre') em = '\u25B6\uFE0F';
            if ((igra.naznacheny_golos || []).includes(i.nomer) && i.status === 'v_igre') em = '\uD83D\uDCA5';
            t += em + ' \u2116' + i.nomer + ' *' + i.name + '*';
            if (i.foly > 0) t += ' [' + i.foly + '\uD83D\uDD34]';
            if (igra.zablokirovan_nomer === i.nomer && i.status === 'v_igre') t += ' \uD83D\uDD07';
            t += '\n';
        });
    }
    return t;
}

function poryadokHodaOtStarta(igra, startNomer, poChasovoy) {
    const alive = igra.igroki
        .filter(i => i.status === 'v_igre')
        .map(i => i.nomer)
        .sort((a, b) => a - b);
    let ordered = poChasovoy ? alive : [...alive].reverse();
    if (!startNomer || !ordered.includes(startNomer)) {
        return ordered.filter(n => n !== igra.zablokirovan_nomer);
    }
    const idx = ordered.indexOf(startNomer);
    const rotated = [...ordered.slice(idx), ...ordered.slice(0, idx)];
    return rotated.filter(n => n !== igra.zablokirovan_nomer);
}

function tekstVyboraPervogoHoda(igra, kod, faza) {
    let t = faza === 'znakomstvo'
        ? '\uD83D\uDC4B *Кто начинает представление?*'
        : '\u2600\uFE0F *Кто начинает день ' + (igra.den || 1) + '?*';
    t += ' — Игра \u2116' + kod + '\n\n';
    t += 'Выбери игрока кнопкой или отправь *номер / ник*.\n';
    t += faza === 'znakomstvo'
        ? 'Круг представления пойдёт *по часовой* с этого места.\n\n'
        : 'Дневные речи пойдут *против часовой* с этого места.\n\n';
    igra.igroki.filter(i => i.status === 'v_igre').forEach(i => {
        t += i.nomer + '. ' + i.name + '\n';
    });
    return t;
}

function knopkaKtoNachinaet(faza, den) {
    if (faza === 'znakomstvo') return '\uD83D\uDC4B Кто начинает представление?';
    return '\u2600\uFE0F Кто начинает день ' + (den || 1) + '?';
}

function knopkiVyboraPervogoHoda(igra, kod, faza) {
    const knopki = igra.igroki
        .filter(i => i.status === 'v_igre')
        .map(i => [{
            text: '\u25B6\uFE0F \u2116' + i.nomer + ' ' + i.name,
            callback_data: 'perviy_hod_' + kod + '_' + i.nomer + '_' + faza
        }]);
    knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]);
    return { inline_keyboard: knopki };
}

async function zaprositPervogoHoda(chatId, messageId, kod, faza, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra._zhdat_fazu = faza;
    sostoyanie[telegram_id] = 'perviy_hod_' + kod;
    const text = tekstVyboraPervogoHoda(igra, kod, faza);
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: knopkiVyboraPervogoHoda(igra, kod, faza)
    };
    try {
        if (messageId) {
            await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        } else {
            await bot.sendMessage(chatId, text, opts);
        }
    } catch (_) {
        await bot.sendMessage(chatId, text, opts);
    }
}

async function nachatFazuZnakomstva(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    let nastroyki = igra._nastroyki || {};
    if (igra.klub_id && !nastroyki.tip_kluba) {
        const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', igra.klub_id).single();
        nastroyki = klub?.nastroyki || {};
    }
    igra._nastroyki = nastroyki;
    if (nastroyki.tip_kluba) igra.tip_kluba = nastroyki.tip_kluba;
    igra.max_foly = nastroyki.max_foly || 4;
    igra.faza = 'znakomstvo';
    igra.poryadok_hoda = poryadokHodaOtStarta(igra, igra.perviy_hod_nomer, true);
    igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
    const sek_z = nastroyki.znakomstvo_sek || 15;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'znakomstvo') }
    };
    const text = buildPanelText(igra, kod);
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        zapustitTaymer(chatId, messageId, kod, sek_z);
    } else {
        const msg = await bot.sendMessage(chatId, text, opts);
        zapustitTaymer(chatId, msg.message_id, kod, sek_z);
    }
}

async function nachatFazuDen(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra.faza = 'den';
    igra.poryadok_hoda = poryadokHodaOtStarta(igra, igra.perviy_hod_nomer, false);
    igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
    igra.naznacheny_golos = [];
    igra.golosa_dnya = {};
    const sek_d = lichnoeVremyaSek(igra);
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'den') }
    };
    const text = buildPanelText(igra, kod);
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        zapustitTaymer(chatId, messageId, kod, sek_d);
    } else {
        const msg = await bot.sendMessage(chatId, text, opts);
        zapustitTaymer(chatId, msg.message_id, kod, sek_d);
    }
}

async function ustanovitPervogoHoda(chatId, messageId, kod, nomer, faza, telegram_id) {
    const igra = igry[kod];
    if (!igra) return false;
    const igrok = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
    if (!igrok) return false;
    igra.perviy_hod_nomer = nomer;
    delete igra._zhdat_fazu;
    if (telegram_id) delete sostoyanie[telegram_id];
    else delete sostoyanie[igra.vedushchii_id];
    await sohranit_igru(kod);
    if (faza === 'znakomstvo') await nachatFazuZnakomstva(chatId, messageId, kod);
    else await nachatFazuDen(chatId, messageId, kod);
    return true;
}

async function sleduyushchiy(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);

    const alive = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.nomer);
    const poryadok = igra.poryadok_hoda || alive;
    const idx = poryadok.indexOf(igra.tekushchiy_nomer);
    const next_idx = idx + 1;

    if (next_idx >= poryadok.length) {
        // Все высказались — показываем кнопки конца фазы
        igra.tekushchiy_nomer = null;
        const faza = igra.faza;
        let t = buildPanelText(igra, kod);
        t += '\n\u2705 *Все высказались*\n';
        const knopki = [];
        if (faza === 'znakomstvo') knopki.push([{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }]);
        if (faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 Выставить на голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        }
        if (faza === 'opravdanie') {
            knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
            knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
        }
        knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
        return;
    }

    igra.tekushchiy_nomer = poryadok[next_idx];
    const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
    const nastroyki = igra._nastroyki || {};
    let sekundy = igra.faza === 'znakomstvo' ? (nastroyki.znakomstvo_sek || 15)
        : igra.faza === 'opravdanie' ? (nastroyki.opravdanie_sek || 30)
        : lichnoeVremyaSek(igra);

    const t = buildPanelText(igra, kod);
    const knopki = buildTimerKnopki(kod, igra.faza);
    await bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    zapustitTaymer(chatId, messageId, kod, sekundy);
}

function vystavitIgrokaNaGolos(igra, igrok) {
    if (!igra || !igrok) return { ok: false, error: 'not_found' };
    if (igrok.status !== 'v_igre') return { ok: false, error: 'vybyl' };
    if (estImmunitetOtGolosovaniya(igrok)) return { ok: false, error: 'immunitet' };
    igra.naznacheny_golos = igra.naznacheny_golos || [];
    if (igra.naznacheny_golos.includes(igrok.nomer)) return { ok: true, already: true, igrok };
    igra.naznacheny_golos.push(igrok.nomer);
    return { ok: true, igrok };
}

function buildTimerKnopki(kod, faza) {
    const knopki = [
        [{ text: '\u23ED\uFE0F Пас', callback_data: 'pas_' + kod }, { text: '\u23F9 Стоп', callback_data: 'stop_taymer_' + kod }],
    ];
    if (faza === 'den') {
        const igra_t = igry[kod];
        if (kandidatyNaVystavlenie(igra_t, igra_t?.tekushchiy_nomer).length > 0) {
            knopki.push([{ text: '\uD83D\uDCA5 Выставить (ник)', callback_data: 'vystav_nick_' + kod }]);
        }
    }
    if (faza === 'den') {
        knopki.push([
            { text: '⏱ 40с', callback_data: 'set_minuta_' + kod + '_40' },
            { text: '⏱ 50с', callback_data: 'set_minuta_' + kod + '_50' },
            { text: '⏱ 60с', callback_data: 'set_minuta_' + kod + '_60' }
        ]);
        knopki.push([{ text: '\uD83D\uDCCB Список на голосование', callback_data: 'vybrat_na_golos_' + kod }]);
        knopki.push([{ text: '\uD83C\uDF19 Ночь', callback_data: 'faza_noch_' + kod }]);
    }
    if (faza === 'znakomstvo') {
        const igra_z = igry[kod];
        knopki.push([{ text: knopkaKtoNachinaet('den', igra_z?.den), callback_data: 'faza_den_' + kod }]);
    }
    if (faza === 'opravdanie') {
        knopki.push([{ text: '\u270F\uFE0F Корректировать список', callback_data: 'vybrat_na_golos_' + kod }]);
        knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
    }
    if (faza === 'golosovanie') {
        knopki.push([{ text: '\u270F\uFE0F Корректировать список', callback_data: 'vybrat_na_golos_' + kod }]);
    }
    knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
    return knopki;
}

function estImmunitetOtGolosovaniya(igrok) {
    return !!(igrok?.immunitet || igrok?.immunitet_golos || igrok?.immunitet_do || igrok?.bonus_immunitet);
}

async function podgruzitImmunitetIgrokam(igra) {
    const ids = [...new Set((igra?.igroki || []).map(i => i.igrok_id).filter(Boolean))];
    if (!ids.length) return;
    try {
        const { data, error } = await supabase
            .from('igroki')
            .select('id, immunitet, immunitet_golos, immunitet_do, bonus_immunitet')
            .in('id', ids);
        if (error || !data) return;
        const map = Object.fromEntries(data.map(r => [r.id, r]));
        (igra.igroki || []).forEach(i => {
            const row = i.igrok_id && map[i.igrok_id];
            if (!row) return;
            if (row.immunitet) i.immunitet = row.immunitet;
            if (row.immunitet_golos) i.immunitet_golos = row.immunitet_golos;
            if (row.immunitet_do) i.immunitet_do = row.immunitet_do;
            if (row.bonus_immunitet) i.bonus_immunitet = row.bonus_immunitet;
        });
    } catch (_) {}
}

function tekstImmuniteta(igra) {
    const sImm = (igra.igroki || []).filter(i => i.status === 'v_igre' && estImmunitetOtGolosovaniya(i));
    if (sImm.length === 0) {
        return '\uD83D\uDEE1 *Иммунитет:* _нет_\n';
    }
    return '\uD83D\uDEE1 *Иммунитет:* ' + sImm.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
}

function tekstSpiskaPosleRoley(igra) {
    let t = '*Состав стола:*\n';
    [...(igra.igroki || [])].sort((a, b) => a.nomer - b.nomer).forEach(i => {
        const sh = estImmunitetOtGolosovaniya(i) ? ' \uD83D\uDEE1' : '';
        t += '\u2116' + i.nomer + ' ' + i.name + ' — *' + (i.rol || '?') + '*' + sh + '\n';
    });
    t += '\n' + tekstImmuniteta(igra);
    t += '_Игроков с иммунитетом нельзя выставить на голосование._';
    return t;
}

function kandidatyNaVystavlenie(igra, govoryashchiyNomer) {
    if (!igra) return [];
    const uzhe = new Set(igra.naznacheny_golos || []);
    return (igra.igroki || []).filter(i =>
        i.status === 'v_igre' &&
        !estImmunitetOtGolosovaniya(i) &&
        i.nomer !== govoryashchiyNomer &&
        !uzhe.has(i.nomer)
    );
}

function nominirovannyePoPoryadku(igra) {
    if (!igra) return [];
    return (igra.naznacheny_golos || [])
        .map(n => igra.igroki.find(i => i.nomer === n))
        .filter(i => i && i.status === 'v_igre');
}

function sinhronizirovatSpisokGolosovaniya(igra) {
    if (!igra) return;
    const seen = new Set();
    igra.naznacheny_golos = (igra.naznacheny_golos || []).filter(nomer => {
        if (seen.has(nomer)) return false;
        const igrok = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
        if (!igrok) return false;
        seen.add(nomer);
        return true;
    });
    if (igra.faza === 'opravdanie') {
        igra.poryadok_hoda = [...igra.naznacheny_golos];
        if (!igra.poryadok_hoda.includes(igra.tekushchiy_nomer)) {
            igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
        }
    }
    if (igra.golosa_dnya) {
        const allowed = new Set(igra.naznacheny_golos);
        Object.keys(igra.golosa_dnya).forEach(n => {
            if (!allowed.has(parseInt(n, 10))) delete igra.golosa_dnya[n];
        });
    }
}

function kandidatyDobavitNaGolos(igra) {
    return kandidatyNaVystavlenie(igra, null);
}

function tekstSpiskaNominacii(igra) {
    const nom = nominirovannyePoPoryadku(igra);
    let t = '\uD83D\uDCA5 *Зафиксированный список на голосование*\n\n';
    t += '_Можно корректировать: добавить пропущенного, убрать лишнего и поменять порядок оправданий._\n\n';
    if (nom.length === 0) {
        t += '_Пока никто не выставлен._\n';
        t += '_Номинируй во время речи или нажми «Добавить игрока»._';
    } else {
        t += '*Порядок оправданий:*\n';
        nom.forEach((i, idx) => {
            t += (idx + 1) + '. \u2116' + i.nomer + ' *' + i.name + '*\n';
        });
    }
    return t;
}

function knopkiSpiskaNominacii(igra, kod) {
    const nom = nominirovannyePoPoryadku(igra);
    const knopki = [];
    nom.forEach((i, idx) => {
        const row = [];
        row.push({
            text: '\u274C ' + (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name,
            callback_data: 'golos_toggle_' + kod + '_' + i.nomer
        });
        if (idx > 0) row.push({ text: '\u2B06\uFE0F', callback_data: 'golos_up_' + kod + '_' + i.nomer });
        if (idx < nom.length - 1) row.push({ text: '\u2B07\uFE0F', callback_data: 'golos_down_' + kod + '_' + i.nomer });
        knopki.push(row);
    });
    if (kandidatyDobavitNaGolos(igra).length > 0) {
        knopki.push([{ text: '\u2795 Добавить пропущенного игрока', callback_data: 'golos_dobavit_' + kod }]);
    }
    if (nom.length > 0) {
        const text = igra.faza === 'opravdanie' ? '\u2705 Применить порядок оправданий' : '\u2705 Начать оправдание (' + nom.length + ')';
        knopki.push([{ text, callback_data: 'faza_opravdanie_' + kod }]);
    }
    const back = (igra.faza === 'opravdanie' || igra.faza === 'golosovanie') ? 'timer_back_' + kod : 'panel_' + kod;
    knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: back }]);
    return knopki;
}

function tekstDobavitNaGolos(igra) {
    let t = '\u2795 *Добавить на голосование*\n\n';
    t += '_Выбери игрока — он добавится в конец списка._\n';
    t += '_Игроки с иммунитетом и уже выставленные здесь не показываются._';
    return t;
}

function knopkiDobavitNaGolos(igra, kod) {
    const kandidaty = kandidatyDobavitNaGolos(igra);
    const knopki = kandidaty.map(i => [{
        text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name,
        callback_data: 'golos_add_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2B05\uFE0F К списку', callback_data: 'vybrat_na_golos_' + kod }]);
    return knopki;
}

function tekstVystavleniyaNaGolos(igra) {
    const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
    const kandidaty = kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer);
    let t = '\uD83D\uDCA5 *Выставить на голосование*\n\n';
    if (cur) {
        t += 'Говорит: *№' + cur.nomer + ' ' + cur.name + '*';
        if (igra.taymer_aktiven && igra.taymer_sekundy > 0) {
            t += ' — ⏱ *' + formatTime(igra.taymer_sekundy) + '*';
        }
        t += '\n\n';
    }
    const uzheV = (igra.naznacheny_golos || [])
        .map(n => igra.igroki.find(i => i.nomer === n))
        .filter(i => i && i.status === 'v_igre');
    if (uzheV.length) {
        t += '*Уже на голосовании:* ' + uzheV.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n\n';
    }
    if (kandidaty.length === 0) {
        t += '_Некого выставить — все доступные игроки уже номинированы._';
    } else {
        t += 'Кого выставляет *№' + cur.nomer + ' ' + cur.name + '*?\n';
        t += 'Выбери из списка или отправь *номер / ник*:\n\n';
        kandidaty.forEach(i => { t += i.nomer + '. ' + i.name + '\n'; });
        t += '\n_Таймер идёт — время не останавливается._';
    }
    return t;
}

function knopkiVystavleniyaNaGolos(igra, kod) {
    const kandidaty = kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer);
    const knopki = kandidaty.map(i => [{
        text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name,
        callback_data: 'vystav_pick_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2B05\uFE0F Отмена', callback_data: 'timer_back_' + kod }]);
    return { inline_keyboard: knopki };
}

async function vypolnitVystavlenieNaGolos(chatId, igra, kod, igrok_vg, telegram_id) {
    if (!igrok_vg || igrok_vg.status !== 'v_igre') {
        await bot.sendMessage(chatId, '\u274C Игрок не найден или уже выбыл.');
        return false;
    }
    if ((igra.naznacheny_golos || []).includes(igrok_vg.nomer)) {
        sostoyanie[telegram_id] = 'vystav_golos_' + kod;
        await bot.sendMessage(chatId,
            '\u2139\uFE0F \u2116' + igrok_vg.nomer + ' *' + igrok_vg.name + '* уже на голосовании.\n\n' + tekstVystavleniyaNaGolos(igra),
            { parse_mode: 'Markdown', reply_markup: knopkiVystavleniyaNaGolos(igra, kod) }
        );
        return false;
    }
    const govoryashchiy = igra.igroki.find(i => i.nomer === igra._vystav_ot_nomer);
    if (govoryashchiy && igrok_vg.nomer === govoryashchiy.nomer) {
        await bot.sendMessage(chatId, '\u26A0\uFE0F Нельзя выставить самого себя.');
        return false;
    }
    const rez_vg = vystavitIgrokaNaGolos(igra, igrok_vg);
    if (!rez_vg.ok) {
        const msg_vg = rez_vg.error === 'immunitet'
            ? '\u26A0\uFE0F У этого игрока иммунитет — его нельзя выставить.'
            : rez_vg.error === 'vybyl'
                ? '\u26A0\uFE0F Игрок уже выбыл.'
                : '\u274C Не удалось выставить.';
        await bot.sendMessage(chatId, msg_vg);
        return false;
    }
    delete sostoyanie[telegram_id];
    await sohranit_igru(kod);
    const otKogo = govoryashchiy ? ('\u2116' + govoryashchiy.nomer + ' *' + govoryashchiy.name + '* выставил: ') : '';
    const tekst_vg = '\u2705 ' + otKogo + '\u2116' + igrok_vg.nomer + ' *' + igrok_vg.name + '* на голосовании.';
    const ostalos = igra.taymer_aktiven ? (' \u23F1 ' + formatTime(igra.taymer_sekundy)) : '';
    const knopki_posle = [[{ text: '\uD83D\uDCCB К таймеру', callback_data: 'timer_back_' + kod }]];
    if (kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer).length > 0) {
        knopki_posle.unshift([{ text: '\uD83D\uDCA5 Выставить ещё', callback_data: 'vystav_nick_' + kod }]);
    }
    await bot.sendMessage(chatId, tekst_vg + ostalos, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki_posle }
    });
    obnovitPanelTaymera(kod);
    return true;
}

function tekstGolosovaniyaSPodschetom(igra, kod) {
    const golosa = igra.golosa_dnya || {};
    const naznacheny = nominirovannyePoPoryadku(igra);
    let t = '\uD83D\uDDF3 *Голосование* — Игра \u2116' + kod + '\n\n';
    t += 'Внеси количество голосов за каждого выставленного игрока.\n\n';
    if (naznacheny.length === 0) {
        t += '_Список на голосование пуст._';
    } else {
        t += '*Выставлены (по порядку):*\n';
        naznacheny.forEach((i, idx) => {
            const val = golosa[i.nomer];
            t += (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name + ' — *' + (Number.isFinite(val) ? val : 'не внесено') + '* голос(ов)\n';
        });
    }
    return t;
}

function knopkiGolosovaniyaSPodschetom(igra, kod) {
    const golosa = igra.golosa_dnya || {};
    const naznacheny = nominirovannyePoPoryadku(igra);
    const knopki = naznacheny.map((i, idx) => [{
        text: '\uD83D\uDD22 ' + (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name + ' — ' + (Number.isFinite(golosa[i.nomer]) ? golosa[i.nomer] : '?'),
        callback_data: 'golos_count_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2705 Подвести итог голосования', callback_data: 'golos_itog_auto_' + kod }]);
    knopki.push([{ text: '\u2705 Никто не выбывает', callback_data: 'golos_nikto_' + kod }]);
    knopki.push([{ text: '\u2B05\uFE0F К оправданию', callback_data: 'faza_opravdanie_' + kod }]);
    return knopki;
}

async function pokazat_prehod_k_nochi(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    igra.noch_deystviya = igra.noch_deystviya || {};
    await pokazat_noch_panel(chatId, messageId, kod, null);
}

async function pokazat_noch_panel(chatId, messageId, kod, log_msg) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);
    const d = igra.noch_deystviya || {};
    const roli_alive = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.rol);

    let t = '\uD83C\uDF19 *Ночь ' + (igra.den || 1) + '* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n\n';
    if (log_msg) t += log_msg + '\n\n';
    t += '_Действия:_\n';
    t += (d.mafiya_tseli?.length ? '\u2705' : '\u25A1') + ' Мафия: ' + (d.mafiya_tseli?.length ? '\u2116' + d.mafiya_tseli[0] : 'не выбрала') + '\n';
    if (roli_alive.includes('Дон')) t += (d.don_tseli ? '\u2705' : '\u25A1') + ' Дон: ' + (d.don_tseli ? '\u2116' + d.don_tseli + ' проверен' : 'не проверял') + '\n';
    if (roli_alive.includes('Эскортница')) t += (eskortVyboryNochi(igra).length ? '\u2705' : '\u25A1') + ' Эскортница: ' + tekstStatusaEskort(igra) + '\n';
    if (roli_alive.includes('Консильери')) t += (d.kons_tseli ? '\u2705' : '\u25A1') + ' Консильери: ' + (d.kons_tseli ? '\u2116' + d.kons_tseli + ' завербован' : (mozhetKonsilyeriVerbovat(igra) ? 'может вербовать' : 'ждёт условия <30%')) + '\n';
    if (roli_alive.includes('Доктор')) t += (d.doctor_tseli ? '\u2705' : '\u25A1') + ' Доктор: ' + (d.doctor_tseli ? '\u2116' + d.doctor_tseli : 'не выбрал') + '\n';
    if (roli_alive.some(isSheriffRole)) t += (d.sherif_tseli ? '\u2705' : '\u25A1') + ' Шериф/Комиссар: ' + (d.sherif_tseli ? '\u2116' + d.sherif_tseli + ' проверен' : 'не проверял') + '\n';
    if (roli_alive.includes('Маньяк')) t += (d.manyak_tseli ? '\u2705' : '\u25A1') + ' Маньяк: ' + (d.manyak_tseli ? '\u2116' + d.manyak_tseli : 'не выбрал') + '\n';
    if (roli_alive.some(rolStrelyayushchegoZaMirnyh)) t += (d.strelok_tseli ? '\u2705' : '\u25A1') + ' Стрелок/Охотник: ' + (d.strelok_tseli ? '\u2116' + d.strelok_tseli : 'не выбрал') + '\n';
    if (roli_alive.includes('Затычка')) t += (d.zatychka_tseli ? '\u2705' : '\u25A1') + ' Затычка: ' + (d.zatychka_tseli ? '\u2116' + d.zatychka_tseli + ' заблокирован' : 'не выбрала') + '\n';
    if (roli_alive.includes('Шахид') && (igra.den === 1 || igra.den === 2)) {
        const miny = d.shahid_miny_tseli || igra.shahid_miny || [];
        t += (miny.length ? '\u2705' : '\u25A1') + ' Шахид: ' + (miny.length ? miny.map(n => '\u2116' + n).join(', ') : 'не минировал') + '\n';
    }

    const knopki = [
        [{ text: '\uD83D\uDD2B Мафия убивает', callback_data: 'noch_vybor_maf_' + kod }],
    ];
    if (roli_alive.includes('Дон')) knopki.push([{ text: '\uD83D\uDD0E Дон ищет Шерифа', callback_data: 'noch_vybor_don_' + kod }]);
    if (roli_alive.includes('Эскортница') && eskortVyboryNochi(igra).length < limitVystrelovEskort(igra)) {
        knopki.push([{ text: '\uD83D\uDC8B Эскортница (' + eskortVyboryNochi(igra).length + '/' + limitVystrelovEskort(igra) + ')', callback_data: 'noch_vybor_eskort_' + kod }]);
    }
    if (roli_alive.includes('Консильери') && mozhetKonsilyeriVerbovat(igra)) knopki.push([{ text: '\uD83E\uDD1D Консильери вербует', callback_data: 'noch_vybor_kons_' + kod }]);
    if (roli_alive.includes('Доктор')) knopki.push([{ text: '\uD83D\uDC89 Доктор лечит', callback_data: 'noch_vybor_doc_' + kod }]);
    if (roli_alive.some(isSheriffRole)) knopki.push([{ text: '\uD83D\uDD0D Шериф/Комиссар проверяет', callback_data: 'noch_vybor_sher_' + kod }]);
    if (roli_alive.includes('Маньяк')) knopki.push([{ text: '\uD83C\uDFAF Маньяк стреляет', callback_data: 'noch_vybor_manyak_' + kod }]);
    if (roli_alive.some(rolStrelyayushchegoZaMirnyh)) knopki.push([{ text: '\uD83D\uDD2B Стрелок/Охотник стреляет', callback_data: 'noch_vybor_strelok_' + kod }]);
    if (roli_alive.includes('Затычка')) knopki.push([{ text: '\uD83D\uDD07 Затычка блокирует', callback_data: 'noch_vybor_zat_' + kod }]);
    if (roli_alive.includes('Шахид') && (igra.den === 1 || igra.den === 2)) {
        knopki.push([{ text: igra.den === 1 ? '\uD83D\uDCA3 Шахид минирует' : '\uD83D\uDCA3 Шахид переминирует', callback_data: 'noch_vybor_shahid_' + kod }]);
    }
    knopki.push([{ text: '\uD83C\uDF1F Итоги ночи', callback_data: 'noch_itog_' + kod }]);
    knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);

    bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
}


// ============================================
// ФУНКЦИЯ ЗАПИСИ БАЛЛОВ
// ============================================
async function zapisat_bally(igra, kod) {
    const pobeditel = igra.pobeditel;
    const sportivniy = igra._nastroyki?.sportivniy_rezhim || false;

    // Загружаем настройки баллов клуба
    let ballyConfig = { ...BALLY_DEFAULT };
    if (igra.klub_id) {
        const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', igra.klub_id).single();
        if (klub?.nastroyki?.bally) ballyConfig = { ...BALLY_DEFAULT, ...klub.nastroyki.bally };
    }

    const maf_roli = MAFIA_ROLES;
    const noch_ubity = igra.noch_ubity_pervaya || [];

    const records = [];
    for (const igrok of igra.igroki) {
        if (!igrok.igrok_id) continue; // пропускаем если нет id в БД

        const is_maf = maf_roli.includes(igrok.rol);
        const is_manyak = igrok.rol === 'Маньяк';
        const is_sherif = igrok.rol === 'Шериф';
        const is_doctor = igrok.rol === 'Доктор';
        const is_kamikadze = igrok.rol === 'Камикадзе';
        const vyzhil = igrok.status === 'v_igre';

        // Определяем победу
        let pobeda = false;
        if (pobeditel === 'mirnye' && !is_maf && !is_manyak) pobeda = true;
        if (pobeditel === 'mafiya' && is_maf) pobeda = true;
        if (pobeditel === 'manyak' && is_manyak) pobeda = true;

        let bk = pobeda ? ballyConfig.pobeda_komanda : ballyConfig.porazhenie;
        let bl = 0;
        if (pobeditel === 'mafiya' && is_maf) {
            bk = 0;
            bl += vyzhil ? (ballyConfig.mafiya_pobedila_vyzhil ?? 4) : (ballyConfig.mafiya_pobedila_vybyl ?? 3);
        } else if (pobeditel === 'manyak' && is_manyak) {
            bk = 0;
            bl += ballyConfig.bonus_manyak_pobedil ?? 5;
        } else if (vyzhil && pobeda) {
            bl += ballyConfig.vyzhil ?? 0.25;
        }
        if (is_maf && pobeda && igrok.rol === 'Дон') bl += ballyConfig.bonus_don_pobedil ?? 0;
        if (igrok.bonus_pts) bl += igrok.bonus_pts;

        const bonus_info = {};
        if (igrok.bonus_pts) bonus_info.ruchnoy = { pts: igrok.bonus_pts, text: igrok.bonus_text };
        const avtoBonusy = (igra.avto_bonusy || []).filter(b => b.nomer === igrok.nomer);
        if (avtoBonusy.length > 0) {
            let avtoPts = 0;
            bonus_info.avto = avtoBonusy.map(b => {
                const pts = ballyConfig[b.key] ?? b.pts ?? 0;
                avtoPts += pts;
                return { ...b, pts };
            });
            bl += avtoPts;
        }
        if ((igra.den1_vygolosovany || []).includes(igrok.nomer)) {
            const ptsDen1 = ballyConfig.bonus_den1_vygolosovan ?? 0.25;
            bl += ptsDen1;
            bonus_info.den1_vygolosovan = { pts: ptsDen1, text: 'Выголосован в первый день' };
        }
        const luchshiyHod = (igra.luchshie_hody || []).find(h => h.igrok_nomer === igrok.nomer);
        if (luchshiyHod) {
            const ugadany = (luchshiyHod.nazvannye || []).filter(nomer => {
                const named = igra.igroki.find(x => x.nomer === nomer);
                return named && isMafiaRole(named.rol);
            });
            const ptsLuchshiyHod = ugadany.length * (ballyConfig.luchshiy_hod_za_mafiyu ?? 1);
            if (ptsLuchshiyHod > 0) bl += ptsLuchshiyHod;
            bonus_info.luchshiy_hod = {
                pts: ptsLuchshiyHod,
                prichina: luchshiyHod.prichina,
                nazvannye: luchshiyHod.nazvannye || [],
                ugadany
            };
        }

        const record = {
            kod_igry: kod,
            klub_id: igra.klub_id || null,
            igrok_id: igrok.igrok_id,
            rol: igrok.rol,
            pobedila_komanda: pobeda,
            vyzhil,
            bally_komanda: bk,
            bally_lichnie: bl,
            bally_vsego: bk + bl,
            sportivniy,
            bonus_info
        };
        if (igra.data_igry) record.data_igry = igra.data_igry;
        records.push(record);
    }

    if (records.length > 0) {
        await supabase.from('bally').insert(records);
    }
}

// ============================================
// РЕЙТИНГ КЛУБА
// ============================================
async function pokazat_reyting_kluba(chatId, messageId, klub_id, sportivniy) {
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();

    const { data: top } = await supabase
        .from('bally')
        .select('igrok_id, bally_vsego, igroki(imya, igrovoy_nik)')
        .eq('klub_id', klub_id)
        .eq('sportivniy', sportivniy || false);

    // Суммируем по игроку
    const totals = {};
    (top || []).forEach(row => {
        const id = row.igrok_id;
        if (!totals[id]) totals[id] = { name: row.igroki?.igrovoy_nik || row.igroki?.imya || '?', pts: 0, igr: 0 };
        totals[id].pts += row.bally_vsego;
        totals[id].igr++;
    });

    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts).slice(0, 20);
    const tip = sportivniy ? '\uD83C\uDFC6 Спортивный' : '\uD83C\uDF06 Городской';

    let t = tip + ' рейтинг — *' + (klub?.nazvaniye || '') + '*\n\n';
    if (sorted.length === 0) {
        t += '_Пока нет результатов_';
    } else {
        const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
        sorted.forEach((p, i) => {
            const m = medals[i] || (i + 1) + '.';
            t += m + ' *' + p.name + '* — ' + p.pts + ' очк. (' + p.igr + ' игр)\n';
        });
    }

    bot.editMessageText(t, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '\uD83D\uDCE5 Скачать CSV', callback_data: 'reyting_csv_' + klub_id + '_' + (sportivniy ? '1' : '0') }],
            [{ text: sportivniy ? '\uD83C\uDF06 Городской рейтинг' : '\uD83C\uDFC6 Спортивный рейтинг', callback_data: 'reyting_klub_' + klub_id + '_' + (sportivniy ? '0' : '1') }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'reyting_vybor_kluba' }]
        ]}
    });
}


// ============================================
// ПРЕДПРОСМОТР СОСТАВА РОЛЕЙ
// ============================================
function pokazat_sostav_preview(kolichestvo, tip_kluba, nastroyki_kluba, nazvaniye_kluba = '') {
    // Берём кастомный состав если есть, иначе стандартный
    let sostav;
    const kastomnye = nastroyki_kluba?.kastomnye_sostavy?.[kolichestvo];
    if (kastomnye) {
        sostav = kastomnye;
    } else {
        sostav = poluchit_sostav(kolichestvo, tip_kluba);
    }
    if (!sostav) return null;

    // Группируем роли
    const solo_roli = ['Маньяк'];

    const mafiya = sostav.filter(r => isMafiaRole(r));
    const solo = sostav.filter(r => solo_roli.includes(r));
    const mirnye = sostav.filter(r => !isMafiaRole(r) && !solo_roli.includes(r));

    let t = '\uD83C\uDFB2 *Состав на ' + kolichestvo + ' человек*';
    if (nazvaniye_kluba) t += '\nКлуб: *' + nazvaniye_kluba + '*';
    t += '\n\n';

    t += '\uD83D\uDD34 *Мафия (' + mafiya.length + '):*\n';
    // Считаем уникальные
    const maf_count = {};
    mafiya.forEach(r => { maf_count[r] = (maf_count[r] || 0) + 1; });
    Object.entries(maf_count).forEach(([r, n]) => { t += '  ' + r + (n > 1 ? ' ×' + n : '') + '\n'; });

    t += '\n\uD83D\uDFE2 *Мирные (' + mirnye.length + '):*\n';
    const mir_count = {};
    mirnye.forEach(r => { mir_count[r] = (mir_count[r] || 0) + 1; });
    Object.entries(mir_count).forEach(([r, n]) => { t += '  ' + r + (n > 1 ? ' ×' + n : '') + '\n'; });

    if (solo.length > 0) {
        t += '\n\uD83C\uDFAF *Серые (' + solo.length + '):*\n';
        solo.forEach(r => { t += '  ' + r + '\n'; });
    }

    return { text: t, sostav };
}

// ============================================
// ОБРАБОТКА КНОПОК
// ============================================

bot.on('callback_query', async function(query) {
    try {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const telegram_id = query.from.id;
    const data = query.data;

    console.log('[callback]', telegram_id, data);

    bot.answerCallbackQuery(query.id).catch(() => {});

    // ===== ВОЗВРАТ В МЕНЮ =====
    if (data === 'menu_vedushchego') {
        bot.editMessageText('🎙 *Меню ведущего*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vedushchego
        });
    }

    else if (data === 'menu_igroka') {
        bot.editMessageText('🎴 *Меню игрока*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_igroka
        });
    }

    else if (data === 'menu_vladeltsa') {
        bot.editMessageText('🏛 *Меню собственника*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vladeltsa
        });
    }

    else if (data === 'igrovoy_vecher') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (kluby.length === 0) {
            bot.editMessageText('🌙 *Игровой вечер*\n\nУ тебя пока нет клуба, где ты собственник или ведущая.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }
        if (kluby.length === 1) {
            await pokazatIgrovoyVecher(chatId, messageId, kluby[0], telegram_id);
            return;
        }
        const knopki = kluby.map(k => [{ text: '🌙 ' + k.nazvaniye, callback_data: 'vecher_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🌙 *Игровой вечер*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('vecher_klub_')) {
        const klub_id = data.replace('vecher_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }
        await pokazatIgrovoyVecher(chatId, messageId, klub, telegram_id);
    }

    else if (data.startsWith('vecher_vvod_')) {
        const klub_id = data.replace('vecher_vvod_', '');
        sostoyanie[telegram_id] = 'vecher_vvod_' + klub_id;
        bot.editMessageText(
            '🌙 *Состав игрового вечера*\n\n' +
            'Отправь список игроков через запятую или каждый ник с новой строки.\n\n' +
            'Пример:\n`Аня, Оля, Катя, Мария`',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'igrovoy_vecher' }]] }
            }
        );
    }

    else if (data.startsWith('vech_an_')) {
        const p = cbUnpack(data.replace('vech_an_', ''));
        if (!p) return;
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('status, igroki(id, tg_id, imya, igrovoy_nik)')
            .eq('anons_id', p.anons_id)
            .in('status', ['prishel', 'aktivna'])
            .order('data_zapisi', { ascending: true });
        const rows = zapisi || [];
        const prioritet = rows.some(z => z.status === 'prishel') ? rows.filter(z => z.status === 'prishel') : rows;
        if (prioritet.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'В анонсе нет игроков', show_alert: true });
            return;
        }
        const igrokiVechera = prioritet.map((z, idx) => ({
            telegram_id: z.igroki?.tg_id || null,
            name: z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (idx + 1),
            nomer: idx + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: z.igroki?.id || null
        }));
        await sohranitSpisokVecheraKluba(p.klub_id, igrokiVechera);
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', p.klub_id).single();
        bot.answerCallbackQuery(query.id, { text: 'Состав вечера сохранён: ' + igrokiVechera.length });
        await pokazatIgrovoyVecher(chatId, messageId, klub || { id: p.klub_id, nazvaniye: '' }, telegram_id);
    }

    // ===== МОИ ИГРЫ ВЕДУЩЕЙ =====
    else if (data === 'moi_igry') {
        const aktivnye = aktivnyeIgryVedushchego(telegram_id);
        if (aktivnye.length === 0) {
            bot.editMessageText(
                '🎮 *Мои игры*\n\nАктивных игр пока нет.',
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                    [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
                    [{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]
                  ]}}
            );
            return;
        }

        let t = '🎮 *Мои активные игры*\n\n';
        const knopki = aktivnye.map(({ kod, igra }) => {
            const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            const rezhim = igra.rezhim_rolei === 'karty' ? 'физ. карты' : (igra.rezhim_rolei === 'bot' ? 'бот' : 'режим не выбран');
            const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
            t += '🎴 №' + kod + ' — ' + status + ', ' + rezhim + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
            return [
                { text: '🎮 №' + kod, callback_data: 'open_igra_' + kod },
                { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Стоп', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
                { text: '🗑', callback_data: 'delete_igra_' + kod }
            ];
        });
        knopki.push([{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]);
        knopki.push([{ text: '📚 История игр', callback_data: 'istoriya_igr' }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('open_igra_')) {
        const kod = data.replace('open_igra_', '');
        await otkrytIgruVedushchego(chatId, messageId, kod);
    }

    // ===== ИГРЫ КЛУБА =====
    else if (data === 'igry_kluba') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (kluby.length === 0) {
            bot.editMessageText('🏛 *Игры клуба*\n\nУ тебя пока нет клуба, где ты собственник или ведущая.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            await pokazatIgryKluba(chatId, messageId, kluby[0]);
            return;
        }

        const knopki = kluby.map(k => [{ text: '🏛 ' + k.nazvaniye, callback_data: 'igry_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🏛 *Игры клуба*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('igry_klub_')) {
        const klub_id = data.replace('igry_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }
        await pokazatIgryKluba(chatId, messageId, klub);
    }

    else if (data.startsWith('hist_klub_')) {
        const klub_id = data.replace('hist_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }

        const { data: rows, error } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('klub_id', klub_id)
            .eq('zavershena', true)
            .order('obnovlena_v', { ascending: false })
            .limit(10);

        if (error) {
            bot.editMessageText('❌ Не получилось загрузить историю клуба.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Игры клуба', callback_data: 'igry_klub_' + klub_id }]] }
            });
            return;
        }

        let t = '📚 *История клуба*\n\nКлуб: *' + klub.nazvaniye + '*\n\n';
        const knopki = [];
        if (!rows || rows.length === 0) {
            t += '_Завершённых игр пока нет._';
        } else {
            rows.forEach(row => {
                const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
                const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
                const dataIgry = row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : '';
                const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? 'мирные'
                    : nastroykiRow.pobeditel === 'mafiya' ? 'мафия'
                    : nastroykiRow.pobeditel === 'manyak' ? 'маньяк'
                    : 'не указан';
                t += '🏁 №' + row.kod + ' — ' + dataIgry + ', победитель: ' + pobeditel + ', игроков: ' + igrokiRow.length + '\n';
                knopki.push([{ text: '📋 Игра №' + row.kod, callback_data: 'hist_igra_' + row.kod }]);
            });
        }
        knopki.push([{ text: '⬅️ Игры клуба', callback_data: 'igry_klub_' + klub_id }]);
        knopki.push([{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ИСТОРИЯ ИГР =====
    else if (data === 'istoriya_igr') {
        const { data: rows, error } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('vedushchii_tg_id', telegram_id)
            .eq('zavershena', true)
            .order('obnovlena_v', { ascending: false })
            .limit(10);

        if (error) {
            bot.editMessageText('❌ Не получилось загрузить историю игр.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        if (!rows || rows.length === 0) {
            bot.editMessageText('📚 *История игр*\n\nЗавершённых игр пока нет.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        let t = '📚 *История игр*\n\nПоследние завершённые игры:\n\n';
        const knopki = rows.map(row => {
            const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
            const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
            const dataIgry = row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : '';
            const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? 'мирные'
                : nastroykiRow.pobeditel === 'mafiya' ? 'мафия'
                : nastroykiRow.pobeditel === 'manyak' ? 'маньяк'
                : 'не указан';
            t += '🏁 №' + row.kod + ' — ' + dataIgry + ', победитель: ' + pobeditel + ', игроков: ' + igrokiRow.length + '\n';
            return [{ text: '📋 Игра №' + row.kod, callback_data: 'hist_igra_' + row.kod }];
        });
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('hist_igra_')) {
        const kod = data.replace('hist_igra_', '');
        let { data: row } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('kod', kod)
            .eq('vedushchii_tg_id', telegram_id)
            .single();

        if (!row) {
            const { data: rowByKod } = await supabase
                .from('aktivnye_igry')
                .select('*')
                .eq('kod', kod)
                .single();

            if (rowByKod?.klub_id) {
                const kluby = await poluchitKlubyDlyaIgr(telegram_id);
                if (kluby.some(k => k.id === rowByKod.klub_id)) row = rowByKod;
            }
        }

        if (!row) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }

        const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
        const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
        const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? '🟢 Мирные'
            : nastroykiRow.pobeditel === 'mafiya' ? '🔴 Мафия'
            : nastroykiRow.pobeditel === 'manyak' ? '🎯 Маньяк'
            : 'не указан';
        let t = '📋 *Игра №' + kod + '*\n\n';
        t += 'Дата: ' + (row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : 'не указана') + '\n';
        t += 'Победитель: ' + pobeditel + '\n\n';
        t += '*Состав:*\n';
        igrokiRow.forEach(i => {
            const em = i.status === 'v_igre' ? '✅' : '💀';
            t += em + ' №' + i.nomer + ' ' + i.name + ' — ' + (i.rol || '?') + '\n';
        });

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Удалить из истории', callback_data: 'hist_delete_' + kod }],
                [{ text: '⬅️ История игр', callback_data: 'istoriya_igr' }],
                row.klub_id ? [{ text: '🏛 Игры клуба', callback_data: 'igry_klub_' + row.klub_id }] : [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    else if (data.startsWith('hist_delete_ok_')) {
        const kod = data.replace('hist_delete_ok_', '');
        const rez = await udalitIgruIzIstorii(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Не удалось удалить', show_alert: true });
            return;
        }
        delete igry['archive_' + kod];
        bot.editMessageText('🗑 *Игра №' + kod + ' удалена из истории.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('hist_delete_')) {
        const kod = data.replace('hist_delete_', '');
        bot.editMessageText('🗑 *Удалить игру №' + kod + ' из истории?*\n\nЗапись будет удалена из базы истории игр.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Да, удалить из истории', callback_data: 'hist_delete_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'hist_igra_' + kod }]
            ] }
        });
    }

    // ===== СОГЛАСИЕ: оферта и конфиденциальность =====
    else if (data === 'legal_menu') {
        bot.editMessageText('📄 *Документы Prime Mafia*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_igroka' }]
            ] }
        });
    }

    else if (data === 'legal_offerta') {
        bot.editMessageText(tekstOffertaKratko(), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ Назад', callback_data: 'reg_soglasie_vrat' }]
            ] }
        });
    }

    else if (data === 'legal_privacy') {
        bot.editMessageText(tekstPrivacyKratko(), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '⬅️ Назад', callback_data: 'reg_soglasie_vrat' }]
            ] }
        });
    }

    else if (data === 'reg_soglasie_vrat') {
        const v_reg = ozhidanie_registracii[telegram_id];
        if (v_reg && (v_reg.shag === 'soglasie' || v_reg.shag === 'soglasie_povtor')) {
            await pokazatEkranSoglasiya(chatId, messageId);
            return;
        }
        bot.editMessageText('📄 *Документы Prime Mafia*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_igroka' }]
            ] }
        });
    }

    else if (data === 'reg_soglasie_prinyat') {
        const dannye_s = ozhidanie_registracii[telegram_id];
        if (dannye_s?.shag === 'soglasie_povtor' && dannye_s.igrok_id) {
            await sohranitSoglasiePolzovatelya(dannye_s.igrok_id, telegram_id);
            delete ozhidanie_registracii[telegram_id];
            bot.answerCallbackQuery(query.id, { text: '✅ Согласие принято' });
            bot.editMessageText('✅ *Спасибо!* Условия приняты.\n\nНапиши /start чтобы открыть меню.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }
        if (!dannye_s || dannye_s.shag !== 'soglasie') {
            bot.answerCallbackQuery(query.id, { text: 'Начни регистрацию через /start', show_alert: true });
            return;
        }
        ozhidanie_registracii[telegram_id] = {
            shag: 'imya',
            soglasie_prinyato: true,
            soglasie_versiya: SOGLASIE_VERSIYA,
            soglasie_data: new Date().toISOString()
        };
        bot.answerCallbackQuery(query.id, { text: '✅ Принято' });
        bot.editMessageText(
            '✅ *Спасибо!* Условия приняты.\n\nТеперь введи своё *имя и фамилию*:',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    else if (data === 'reg_soglasie_otkaz') {
        delete ozhidanie_registracii[telegram_id];
        bot.answerCallbackQuery(query.id, { text: 'Без согласия регистрация невозможна' });
        bot.editMessageText(
            '❌ *Регистрация отменена.*\n\nБез принятия оферты и политики конфиденциальности использовать Prime Mafia нельзя.\n\nЕсли передумаешь — напиши /start',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    // ===== РЕГИСТРАЦИЯ: выбор страны =====
    else if (data.startsWith('reg_strana_')) {
        const strana = data.replace('reg_strana_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'gorod') return;
        dannye.strana = strana;
        dannye.shag = 'gorod_vybor';

        // Грузим города этой страны
        const { data: goroda } = await supabase
            .from('goroda')
            .select('id, nazvaniye')
            .eq('strana', strana)
            .order('nazvaniye');

        if (!goroda || goroda.length === 0) {
            bot.editMessageText('❌ Нет городов для этой страны.', {
                chat_id: chatId, message_id: messageId
            });
            return;
        }

        const NA_STRANITSE = 10;
        const pervye = goroda.slice(0, NA_STRANITSE);
        const knopki = [];
        for (let i = 0; i < pervye.length; i += 2) {
            const para = [{ text: pervye[i].nazvaniye, callback_data: 'rg_' + pervye[i].id }];
            if (pervye[i + 1]) para.push({ text: pervye[i + 1].nazvaniye, callback_data: 'rg_' + pervye[i + 1].id });
            knopki.push(para);
        }
        if (goroda.length > NA_STRANITSE) {
            knopki.push([{ text: '➡️ Ещё города', callback_data: 'reg_goroda_' + strana + '_1' }]);
        }
        knopki.push([{ text: '⬅️ Назад', callback_data: 'reg_nazad_strana' }]);

        bot.editMessageText('📍 Выбери свой город (' + strana + '):', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('reg_goroda_')) {
        const parts = data.replace('reg_goroda_', '').split('_');
        const strana = parts.slice(0, -1).join('_');
        const stranitsa = parseInt(parts[parts.length - 1]);
        const NA_STRANITSE = 10;

        const { data: goroda } = await supabase
            .from('goroda').select('id, nazvaniye').eq('strana', strana).order('nazvaniye');

        const slice = goroda.slice(stranitsa * NA_STRANITSE, (stranitsa + 1) * NA_STRANITSE);
        const knopki = [];
        for (let i = 0; i < slice.length; i += 2) {
            const para = [{ text: slice[i].nazvaniye, callback_data: 'rg_' + slice[i].id }];
            if (slice[i + 1]) para.push({ text: slice[i + 1].nazvaniye, callback_data: 'rg_' + slice[i + 1].id });
            knopki.push(para);
        }
        if ((stranitsa + 1) * NA_STRANITSE < goroda.length) {
            knopki.push([{ text: '➡️ Ещё', callback_data: 'reg_goroda_' + strana + '_' + (stranitsa + 1) }]);
        }
        if (stranitsa > 0) {
            knopki.push([{ text: '⬅️ Назад', callback_data: 'reg_goroda_' + strana + '_' + (stranitsa - 1) }]);
        }
        bot.editMessageText('📍 Выбери свой город (' + strana + '):', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('rg_')) {
        const gorod_id = data.replace('rg_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye) return;

        // Берём название города из Supabase
        const { data: gorod_data } = await supabase
            .from('goroda').select('nazvaniye').eq('id', gorod_id).single();
        const gorod_name = gorod_data?.nazvaniye || 'Неизвестно';

        const tg_username = query.from.username || '';

        const insertPayload = {
            tg_id: telegram_id,
            tg_username,
            imya: dannye.imya,
            igrovoy_nik: dannye.igrovoy_nik,
            telefon: dannye.telefon,
            gorod: gorod_name,
            gorod_id: gorod_id,
            soglasie_offerta: !!dannye.soglasie_prinyato,
            soglasie_versiya: dannye.soglasie_versiya || SOGLASIE_VERSIYA,
            soglasie_data: dannye.soglasie_data || new Date().toISOString()
        };

        let { data: novyi_igrok, error } = await supabase
            .from('igroki')
            .insert(insertPayload)
            .select().single();

        if (error && /soglasie/i.test(error.message || '')) {
            delete insertPayload.soglasie_offerta;
            delete insertPayload.soglasie_versiya;
            delete insertPayload.soglasie_data;
            ({ data: novyi_igrok, error } = await supabase.from('igroki').insert(insertPayload).select().single());
        }

        delete ozhidanie_registracii[telegram_id];

        if (error) {
            console.error('Ошибка регистрации:', error);
            bot.editMessageText('❌ Ошибка регистрации. Напиши /start и попробуй снова.', {
                chat_id: chatId, message_id: messageId
            });
            return;
        }

        bot.editMessageText(
            '🎉 *Регистрация завершена!*\n\n' +
            '👤 Имя: ' + dannye.imya + '\n' +
            '🎭 Ник: ' + (dannye.igrovoy_nik || 'не указан') + '\n' +
            '📍 ' + gorod_name + '\n\n' +
            'Добро пожаловать в Prime Mafia!',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );

        setTimeout(() => {
            bot.sendMessage(chatId, '🎴 *Меню игрока*\n\nЧто хочешь сделать?', {
                parse_mode: 'Markdown', ...menu_igroka
            });
        }, 500);
    }

    else if (data === 'reg_nazad_strana') {
        bot.editMessageText('📍 *Выбери свою страну:*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🇷🇺 Россия', callback_data: 'reg_strana_Россия' }],
                    [{ text: '🇧🇾 Беларусь', callback_data: 'reg_strana_Беларусь' }],
                    [{ text: '🇰🇿 Казахстан', callback_data: 'reg_strana_Казахстан' }],
                    [{ text: '🇺🇿 Узбекистан', callback_data: 'reg_strana_Узбекистан' }],
                    [{ text: '🇰🇬 Кыргызстан', callback_data: 'reg_strana_Кыргызстан' }],
                    [{ text: '🇦🇲 Армения', callback_data: 'reg_strana_Армения' }],
                    [{ text: '🇬🇪 Грузия', callback_data: 'reg_strana_Грузия' }],
                    [{ text: '🇦🇿 Азербайджан', callback_data: 'reg_strana_Азербайджан' }]
                ]
            }
        });
    }

    // ===== ИГРОК: анонсы по городу =====
    else if (data === 'anonsy_goroda') {
        const { data: igrok } = await supabase
            .from('igroki').select('gorod').eq('tg_id', telegram_id).single();

        if (!igrok?.gorod) {
            bot.editMessageText('📢 *Анонсы игр*\n\n❌ Город не указан. Укажи город в настройках.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                ]}
            });
            return;
        }

        const segodnya_d = new Date().toISOString().slice(0, 10);
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, kluby(nazvaniye, gorod)')
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(50);

        const filtr = (anonsy || []).filter(a => {
            const gorodKluba = (a.kluby?.gorod || '').trim().toLowerCase();
            const gorodIgroka = (igrok.gorod || '').trim().toLowerCase();
            if (!gorodKluba || !gorodIgroka || gorodKluba !== gorodIgroka) return false;
            const iso = razobrat_datu_anonsa(a.data_igry) || a.data_igry;
            return iso && iso >= segodnya_d;
        }).slice(0, 10);

        if (filtr.length === 0) {
            bot.editMessageText('📢 *Анонсы игр в ' + igrok.gorod + '*\n\n_Пока нет запланированных игр._', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]] }
            });
            return;
        }

        let tekst = '📢 *Анонсы игр в ' + igrok.gorod + '*\n\n';
        const knopki = [];

        filtr.forEach((a, i) => {
            tekst += (i + 1) + '. 🎴 *' + (a.kluby?.nazvaniye || 'Клуб') + '*\n';
            tekst += '   📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
            tekst += '   📍 ' + (a.adres || '') + '\n';
            if (a.kommentariy) tekst += '   💬 ' + a.kommentariy + '\n';
            tekst += '\n';
            knopki.push([{ text: '✍️ Записаться: ' + (a.kluby?.nazvaniye || 'Игра ' + (i+1)), callback_data: 'anons_zapisatsya_' + a.id }]);
        });

        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ИГРОК: настройки =====
    else if (data === 'nastroyki_igroka') {
        const { data: igrok } = await supabase
            .from('igroki').select('imya, gorod, igrovoy_nik').eq('tg_id', telegram_id).single();

        bot.editMessageText(
            '⚙️ *Настройки*\n\n' +
            '👤 Имя: ' + (igrok?.imya || '') + '\n' +
            '🎭 Ник: ' + (igrok?.igrovoy_nik || '_не указан_') + '\n' +
            '📍 Город: ' + (igrok?.gorod || 'не указан'), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
            ]}
        });
    }

    // ===== ИГРОК: редактировать имя =====
    else if (data === 'edit_imya') {
        sostoyanie[telegram_id] = 'edit_imya';
        bot.editMessageText(
            '✏️ *Изменить имя*\n\nВведи новое имя и фамилию:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'nastroyki_igroka' }]] }
        });
    }

    // ===== ИГРОК: редактировать ник =====
    else if (data === 'edit_nik') {
        sostoyanie[telegram_id] = 'edit_nik';
        bot.editMessageText(
            '🎭 *Изменить игровой ник*\n\nВведи свой игровой псевдоним:\n_Пример: Тёмный рыцарь, Лис, Стрелок_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'nastroyki_igroka' }]] }
        });
    }

    // ===== ИГРОК: сменить город =====
    else if (data === 'smenit_gorod') {
        bot.editMessageText('📍 *Выбери новую страну:*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🇷🇺 Россия', callback_data: 'smena_strana_Россия' }],
                    [{ text: '🇧🇾 Беларусь', callback_data: 'smena_strana_Беларусь' }],
                    [{ text: '🇰🇿 Казахстан', callback_data: 'smena_strana_Казахстан' }],
                    [{ text: '🇺🇿 Узбекистан', callback_data: 'smena_strana_Узбекистан' }],
                    [{ text: '🇰🇬 Кыргызстан', callback_data: 'smena_strana_Кыргызстан' }],
                    [{ text: '🇦🇲 Армения', callback_data: 'smena_strana_Армения' }],
                    [{ text: '🇬🇪 Грузия', callback_data: 'smena_strana_Грузия' }],
                    [{ text: '🇦🇿 Азербайджан', callback_data: 'smena_strana_Азербайджан' }],
                    [{ text: '⬅️ Назад', callback_data: 'nastroyki_igroka' }]
                ]
            }
        });
    }

    else if (data.startsWith('smena_strana_')) {
        const strana = data.replace('smena_strana_', '');
        const { data: goroda } = await supabase
            .from('goroda').select('id, nazvaniye').eq('strana', strana).order('nazvaniye');

        const NA_STRANITSE = 10;
        const pervye = goroda.slice(0, NA_STRANITSE);
        const knopki = [];
        for (let i = 0; i < pervye.length; i += 2) {
            const para = [{ text: pervye[i].nazvaniye, callback_data: 'sg_' + pervye[i].id }];
            if (pervye[i + 1]) para.push({ text: pervye[i + 1].nazvaniye, callback_data: 'sg_' + pervye[i + 1].id });
            knopki.push(para);
        }
        if (goroda.length > NA_STRANITSE) {
            knopki.push([{ text: '➡️ Ещё', callback_data: 'smena_goroda_' + strana + '_1' }]);
        }
        knopki.push([{ text: '⬅️ Назад', callback_data: 'smenit_gorod' }]);

        bot.editMessageText('📍 Выбери город (' + strana + '):', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('smena_goroda_')) {
        const parts = data.replace('smena_goroda_', '').split('_');
        const strana = parts.slice(0, -1).join('_');
        const stranitsa = parseInt(parts[parts.length - 1]);
        const NA_STRANITSE = 10;

        const { data: goroda } = await supabase
            .from('goroda').select('id, nazvaniye').eq('strana', strana).order('nazvaniye');

        const slice2 = goroda.slice(stranitsa * NA_STRANITSE, (stranitsa + 1) * NA_STRANITSE);
        const knopki = [];
        for (let i = 0; i < slice2.length; i += 2) {
            const para = [{ text: slice2[i].nazvaniye, callback_data: 'sg_' + slice2[i].id }];
            if (slice2[i + 1]) para.push({ text: slice2[i + 1].nazvaniye, callback_data: 'sg_' + slice2[i + 1].id });
            knopki.push(para);
        }
        if ((stranitsa + 1) * NA_STRANITSE < goroda.length) {
            knopki.push([{ text: '➡️ Ещё', callback_data: 'smena_goroda_' + strana + '_' + (stranitsa + 1) }]);
        }
        if (stranitsa > 0) {
            knopki.push([{ text: '⬅️ Назад', callback_data: 'smena_goroda_' + strana + '_' + (stranitsa - 1) }]);
        }
        bot.editMessageText('📍 Выбери город (' + strana + '):', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('sg_')) {
        const gorod_id = data.replace('sg_', '');
        const { data: gorod_data } = await supabase
            .from('goroda').select('nazvaniye').eq('id', gorod_id).single();
        const gorod = gorod_data?.nazvaniye || 'Неизвестно';

        await supabase.from('igroki').update({ gorod, gorod_id }).eq('tg_id', telegram_id);

        bot.editMessageText('✅ *Город изменён на ' + gorod + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '⬅️ В настройки', callback_data: 'nastroyki_igroka' }]
            ]}
        });
    }

    // ===== ВЕДУЩИЙ: создать игру =====
    else if (data === 'sozdat_igru') {
        // Сначала выбираем клуб
        const { data: igrok, error: err1 } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        console.log('[DEBUG] igrok найден:', igrok?.id, 'err:', err1?.message);
        const { data: chleny, error: err2 } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        console.log('[DEBUG] chleny найдено:', chleny?.length, 'err:', err2?.message);
        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        // Сохраняем клуб если один
        if (kluby.length === 1) {
            bot.editMessageText('🎲 *Создание игры*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\nЭта игра по анонсу?', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 По анонсу', callback_data: 'igra_anons_' + kluby[0].id }],
                    [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + kluby[0].id }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]
                ]}
            });
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'igra_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🎲 *Создание игры*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('igra_klub_')) {
        const klub_id = data.replace('igra_klub_', '');
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        bot.editMessageText('🎲 *Создание игры*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\nЭта игра по анонсу?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📢 По анонсу', callback_data: 'igra_anons_' + klub_id }],
                [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + klub_id }],
                [{ text: '⬅️ Назад', callback_data: 'sozdat_igru' }]
            ]}
        });
    }

    else if (data.startsWith('igra_anons_')) {
        const klub_id = data.replace('igra_anons_', '');

        // Загружаем активные анонсы клуба
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres')
            .eq('klub_id', klub_id)
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(10);

        if (!anonsy || anonsy.length === 0) {
            bot.editMessageText('🎲 *Создание игры*\n\n❌ Нет активных анонсов.\n\nСначала создай анонс или начни игру без анонса.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 Создать анонс', callback_data: 'anons_vybor_kluba' }],
                    [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + klub_id }],
                    [{ text: '⬅️ Назад', callback_data: 'sozdat_igru' }]
                ]}
            });
            return;
        }

        const knopki = anonsy.map(a => [{
            text: '📅 ' + a.data_igry + ' ' + (a.vremya || '') + ' — ' + (a.adres || ''),
            callback_data: cbBtn('iva_', { klub_id, anons_id: a.id })
        }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'igra_klub_' + klub_id }]);

        bot.editMessageText('🎲 *Выбери анонс:*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('iva_')) {
        const p = cbUnpack(data.replace('iva_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Нажми снова', show_alert: true }); return; }
        const { klub_id, anons_id } = p;
        bot.editMessageText('🎲 *Создание игры*\n\nНа сколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '8', callback_data: cbBtn('in_', { klub_id, anons_id, k: 8 }) },
                     { text: '9', callback_data: cbBtn('in_', { klub_id, anons_id, k: 9 }) },
                     { text: '10', callback_data: cbBtn('in_', { klub_id, anons_id, k: 10 }) },
                     { text: '11', callback_data: cbBtn('in_', { klub_id, anons_id, k: 11 }) }],
                    [{ text: '12', callback_data: cbBtn('in_', { klub_id, anons_id, k: 12 }) },
                     { text: '13', callback_data: cbBtn('in_', { klub_id, anons_id, k: 13 }) },
                     { text: '14', callback_data: cbBtn('in_', { klub_id, anons_id, k: 14 }) },
                     { text: '15', callback_data: cbBtn('in_', { klub_id, anons_id, k: 15 }) }],
                    [{ text: '16', callback_data: cbBtn('in_', { klub_id, anons_id, k: 16 }) },
                     { text: '17', callback_data: cbBtn('in_', { klub_id, anons_id, k: 17 }) },
                     { text: '18', callback_data: cbBtn('in_', { klub_id, anons_id, k: 18 }) }],
                    [{ text: '19', callback_data: cbBtn('in_', { klub_id, anons_id, k: 19 }) },
                     { text: '20', callback_data: cbBtn('in_', { klub_id, anons_id, k: 20 }) }],
                    [{ text: '⬅️ Назад', callback_data: 'igra_anons_' + klub_id }]
                ]
            }
        });
    }

    else if (data.startsWith('igra_vybr_anons_')) {
        const parts = data.replace('igra_vybr_anons_', '').split('_');
        const klub_id = parts[0];
        const anons_id = parts[1];
        bot.editMessageText('🎲 *Создание игры*\n\nНа сколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '8', callback_data: cbBtn('in_', { klub_id, anons_id, k: 8 }) },
                     { text: '9', callback_data: cbBtn('in_', { klub_id, anons_id, k: 9 }) },
                     { text: '10', callback_data: cbBtn('in_', { klub_id, anons_id, k: 10 }) },
                     { text: '11', callback_data: cbBtn('in_', { klub_id, anons_id, k: 11 }) }],
                    [{ text: '12', callback_data: cbBtn('in_', { klub_id, anons_id, k: 12 }) },
                     { text: '13', callback_data: cbBtn('in_', { klub_id, anons_id, k: 13 }) },
                     { text: '14', callback_data: cbBtn('in_', { klub_id, anons_id, k: 14 }) },
                     { text: '15', callback_data: cbBtn('in_', { klub_id, anons_id, k: 15 }) }],
                    [{ text: '16', callback_data: cbBtn('in_', { klub_id, anons_id, k: 16 }) },
                     { text: '17', callback_data: cbBtn('in_', { klub_id, anons_id, k: 17 }) },
                     { text: '18', callback_data: cbBtn('in_', { klub_id, anons_id, k: 18 }) }],
                    [{ text: '19', callback_data: cbBtn('in_', { klub_id, anons_id, k: 19 }) },
                     { text: '20', callback_data: cbBtn('in_', { klub_id, anons_id, k: 20 }) }],
                    [{ text: '⬅️ Назад', callback_data: 'igra_anons_' + klub_id }]
                ]
            }
        });
    }

    // ===== ВЫБОР ТИПА ПРАВИЛ ДЛЯ ИГРЫ =====
    else if (data.startsWith('igra_tip_') && !data.startsWith('igra_tip_kol_')) {
        const parts_it = data.replace('igra_tip_', '').split('_');
        const klub_id_it = parts_it[0];
        const tip_it = parts_it.slice(1).join('_');
        // Сохраняем тип и переходим к выбору количества
        const { data: klub_it } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id_it).single();
        const kol_knopki = [];
        const dostupnye = tip_it === 'sportivniy' ? [10] : [8,9,10,11,12,13,14,15,16,17,18,19,20];
        for (let i = 0; i < dostupnye.length; i += 4) {
            kol_knopki.push(dostupnye.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'igra_tip_kol_' + klub_id_it + '_' + tip_it + '_' + n })));
        }
        kol_knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_bez_anons_' + klub_id_it }]);
        bot.editMessageText(
            '\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_it?.nazvaniye || '') + '*\n\nСколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kol_knopki }
        });
    }

    else if (data.startsWith('igra_tip_kol_')) {
        const parts_itk = data.replace('igra_tip_kol_', '').split('_');
        const klub_id_itk = parts_itk[0];
        const kolichestvo_itk = parseInt(parts_itk[parts_itk.length - 1]);
        const tip_itk = parts_itk.slice(1, -1).join('_');
        const { data: klub_itk } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id_itk).single();

        // Показываем предпросмотр состава перед созданием игры
        const preview = pokazat_sostav_preview(kolichestvo_itk, tip_itk, klub_itk?.nastroyki, klub_itk?.nazvaniye || '');
        if (!preview) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Нет состава для ' + kolichestvo_itk + ' игроков', show_alert: true });
            return;
        }

        const preview_key = klub_id_itk + '_' + tip_itk + '_' + kolichestvo_itk;
        // Сохраняем кастомный состав во временное хранилище
        if (!igry['preview_' + preview_key]) {
            igry['preview_' + preview_key] = {
                sostav: [...preview.sostav],
                original: [...preview.sostav],
                klub_id: klub_id_itk,
                klub_nazvaniye: klub_itk?.nazvaniye || '',
                tip_kluba: tip_itk,
                kolichestvo: kolichestvo_itk,
                _ne_sohranyat: true
            };
        }

        bot.editMessageText(
            preview.text + '\n\n' +
            '_Дальше внеси список игроков столбиком — каждый ник с новой строки._',
            {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Создать игру', callback_data: 'sostav_ok_' + preview_key }],
                [{ text: '\u2699\uFE0F Состав ролей', callback_data: 'sostav_edit_' + preview_key }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_' + klub_id_itk + '_' + tip_itk }]
            ]}
        });
    }

    // ===== СОСТАВ: подтвердить и создать игру =====
    else if (data.startsWith('sostav_ok_')) {
        const preview_key = data.replace('sostav_ok_', '');
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Сессия истекла, начни заново', show_alert: true });
            return;
        }

        const kod = sgenerirovat_kod();
        igry[kod] = {
            kolichestvo: preview_data.kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            klub_id: preview_data.klub_id,
            klub_nazvaniye: preview_data.klub_nazvaniye || '',
            tip_kluba: preview_data.tip_kluba,
            sportivniy: preview_data.tip_kluba === 'sportivniy',
            rezhim_rolei: null,
            _sostav_custom: preview_data.sostav
        };
        delete igry['preview_' + preview_key];
        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    // ===== СОСТАВ: редактировать роли =====
    else if (data.startsWith('sostav_edit_')) {
        const preview_key = data.replace('sostav_edit_', '');
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Сессия истекла', show_alert: true });
            return;
        }

        const sostav = preview_data.sostav;
        let t = '\u270F\uFE0F *Редактировать состав*\n\n';
        t += '_Нажми на роль чтобы заменить:_\n\n';
        sostav.forEach((r, i) => {
            const solo = ['Маньяк'];
            const em = isMafiaRole(r) ? '\uD83D\uDD34' : (solo.includes(r) ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
            t += (i + 1) + '. ' + em + ' ' + r + '\n';
        });

        const knopki_edit = sostav.map((r, i) => [{
            text: (i + 1) + '. ' + r + ' ✏️',
            callback_data: 'sostav_zamenit_' + preview_key + '_' + i
        }]);
        knopki_edit.push([{ text: '\uD83D\uDD04 Сбросить', callback_data: 'sostav_reset_' + preview_key }]);
        knopki_edit.push([{ text: '\u2705 Готово', callback_data: 'sostav_ok_' + preview_key }]);
        knopki_edit.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_kol_' + preview_data.klub_id + '_' + preview_data.tip_kluba + '_' + preview_data.kolichestvo }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_edit }
        });
    }

    // ===== СОСТАВ: выбрать замену для роли =====
    else if (data.startsWith('sostav_zamenit_')) {
        const rest = data.replace('sostav_zamenit_', '');
        // preview_key может содержать _ так что берём последний элемент как индекс
        const last_under = rest.lastIndexOf('_');
        const preview_key = rest.substring(0, last_under);
        const rol_idx = parseInt(rest.substring(last_under + 1));
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) return;

        const tekushchaya = preview_data.sostav[rol_idx];

        // Все доступные роли
        const vse_roli = ['Дон', 'Мафия', 'Путана', 'Подрывник мафии', 'Консильери', 'Эскортница',
                          'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                          'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
                          'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
                          'Мстительный родственник', 'Маньяк', 'Мирный'];

        const knopki_zam = vse_roli.map((r, ri) => [{
            text: (r === tekushchaya ? '\u2705 ' : '') + r,
            callback_data: 'sostav_set_' + preview_key + '_' + rol_idx + '_' + ri
        }]);
        knopki_zam.push([{ text: '\u2B05\uFE0F Отмена', callback_data: 'sostav_edit_' + preview_key }]);

        bot.editMessageText(
            '\u270F\uFE0F Меняем позицию ' + (rol_idx + 1) + ': *' + tekushchaya + '*\n\nВыбери новую роль:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_zam }
        });
    }

    // ===== СОСТАВ: установить новую роль =====
    else if (data.startsWith('sostav_set_')) {
        const rest_s = data.replace('sostav_set_', '');
        // Формат: preview_key_idx_rolname (rolname может содержать пробелы заменим их)
        // Ищем индекс как цифру перед названием роли
        const parts_s = rest_s.split('_');
        // preview_key = klub_id + '_' + tip + '_' + kolichestvo
        // затем idx, затем роль (может быть несколько слов через _)
        // Берём первые 3 части как preview_key, 4-ю как idx, остальное как роль
        const klub_id_s = parts_s[0];
        const tip_s = parts_s[1];
        const kol_s = parts_s[2];
        const idx_s = parseInt(parts_s[3]);
        const vse_roli_s = ['Дон', 'Мафия', 'Путана', 'Подрывник мафии', 'Консильери', 'Эскортница',
            'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
            'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
            'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
            'Мстительный родственник', 'Маньяк', 'Мирный'];
        const rol_ri = parseInt(parts_s[4], 10);
        const new_rol = vse_roli_s[rol_ri] || parts_s.slice(4).join(' ');
        const preview_key_s = klub_id_s + '_' + tip_s + '_' + kol_s;
        const preview_data_s = igry['preview_' + preview_key_s];
        if (!preview_data_s) return;

        const old_rol = preview_data_s.sostav[idx_s];
        preview_data_s.sostav[idx_s] = new_rol;

        bot.answerCallbackQuery(query.id, { text: old_rol + ' → ' + new_rol });

        // Возвращаемся к редактору
        const sostav_s = preview_data_s.sostav;
        let t_s = '\u270F\uFE0F *Редактировать состав*\n\n_Нажми на роль чтобы заменить:_\n\n';
        sostav_s.forEach((r, i) => {
            const em_s = isMafiaRole(r) ? '\uD83D\uDD34' : (r === 'Маньяк' ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
            t_s += (i + 1) + '. ' + em_s + ' ' + r + '\n';
        });
        const kk_s = sostav_s.map((r, i) => [{ text: (i + 1) + '. ' + r + ' \u270F\uFE0F', callback_data: 'sostav_zamenit_' + preview_key_s + '_' + i }]);
        kk_s.push([{ text: '\uD83D\uDD04 Сбросить', callback_data: 'sostav_reset_' + preview_key_s }]);
        kk_s.push([{ text: '\u2705 Готово', callback_data: 'sostav_ok_' + preview_key_s }]);
        kk_s.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_kol_' + preview_key_s }]);
        bot.editMessageText(t_s, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kk_s } });
    }

    // ===== СОСТАВ: сбросить к стандарту =====
    else if (data.startsWith('sostav_reset_')) {
        const preview_key_r = data.replace('sostav_reset_', '');
        const preview_data_r = igry['preview_' + preview_key_r];
        if (!preview_data_r) return;
        preview_data_r.sostav = [...preview_data_r.original];
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD04 Состав сброшен к стандарту' });
        // Показываем предпросмотр снова
        const preview_r = pokazat_sostav_preview(preview_data_r.kolichestvo, preview_data_r.tip_kluba, {}, preview_data_r.klub_nazvaniye || '');
        bot.editMessageText(
            preview_r.text + '\n\n' +
            '_Дальше внеси список игроков столбиком — каждый ник с новой строки._',
            {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Создать игру', callback_data: 'sostav_ok_' + preview_key_r }],
                [{ text: '\u2699\uFE0F Состав ролей', callback_data: 'sostav_edit_' + preview_key_r }],
            ]}
        });
    }

    else if (data.startsWith('igra_bez_anons_')) {
        const klub_id = data.replace('igra_bez_anons_', '');
        const { data: klub_bz } = await supabase.from('kluby').select('nazvaniye, sportivniy_rezhim, nastroyki').eq('id', klub_id).single();
        const tip_kluba_bz = klub_bz?.nastroyki?.tip_kluba || 'paskal';
        const kol_knopki = [];
        const dostupnye = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        for (let i = 0; i < dostupnye.length; i += 4) {
            kol_knopki.push(dostupnye.slice(i, i + 4).map(n => ({
                text: String(n),
                callback_data: 'igra_tip_kol_' + klub_id + '_' + tip_kluba_bz + '_' + n
            })));
        }
        if (klub_bz?.sportivniy_rezhim) {
            kol_knopki.push([{ text: '\uD83C\uDFC6 Спортивная — 10', callback_data: 'igra_tip_kol_' + klub_id + '_sportivniy_10' }]);
        }
        kol_knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_klub_' + klub_id }]);
        bot.editMessageText(
            '\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_bz?.nazvaniye || '') + '*\n\nСколько игроков?',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kol_knopki } }
        );
    }

    else if (data.startsWith('big_family_info_')) {
        const klub_id_bf = data.replace('big_family_info_', '');
        bot.editMessageText(
            '\uD83D\uDCD5 *Big Family*\n\n' +
            'Правила загружены и отделены от Паскаля.\n\n' +
            'Уже понятно из документа:\n' +
            '— дневная речь 40 секунд\n' +
            '— роли: Дон, Мафия, Путана, Комиссар, Доктор, Любовница, Бессмертный, Подрывник, Снайпер, Маньяк\n' +
            '— Подрывник играет за мирных и забирает игрока, если его убила мафия\n' +
            '— Снайпер имеет один выстрел за игру\n' +
            '— Любовница может обезвредить Маньяка\n\n' +
            'Чтобы включить создание игр Big Family без риска, нужны точные составы по количеству игроков.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_bez_anons_' + klub_id_bf }]] }
            }
        );
    }

    else if (data.startsWith('in_')) {
        const p = cbUnpack(data.replace('in_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Нажми снова', show_alert: true }); return; }
        const klub_id = p.klub_id;
        const anons_id = p.anons_id;
        const kolichestvo = parseInt(p.k, 10);
        const { data: klub_in } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
        const kod = sgenerirovat_kod();
        igry[kod] = {
            kod,
            klub_id,
            klub_nazvaniye: klub_in?.nazvaniye || '',
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            tip_kluba: klub_in?.nastroyki?.tip_kluba || 'paskal',
            rezhim_rolei: null
        };
        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('igra_n_')) {
        const parts = data.replace('igra_n_', '').split('_');
        const klub_id = parts[0];
        const anons_id = parts[1]; // 'null' или uuid
        const kolichestvo = parseInt(parts[2]);
        const { data: klub_n } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
        const kod = sgenerirovat_kod();

        // Сохраняем игру в памяти
        igry[kod] = {
            kod,
            klub_id,
            klub_nazvaniye: klub_n?.nazvaniye || '',
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            tip_kluba: klub_n?.nastroyki?.tip_kluba || 'paskal',
            rezhim_rolei: null // 'karty' или 'bot'
        };

        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('rezhim_karty_')) {
        const kod = data.replace('rezhim_karty_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('rezhim_bot_')) {
        const kod = data.replace('rezhim_bot_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        delete sostoyanie[telegram_id];
        igra.rezhim_rolei = 'bot';
        await sohranit_igru(kod);
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('obnovit_igru_')) {
        const kod = data.replace('obnovit_igru_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        delete sostoyanie[telegram_id];
        if (igra.rezhim_rolei === 'karty' && (igra.igroki || []).length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id);
            await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
            return;
        }
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('vecher_ok_')) {
        const kod = data.replace('vecher_ok_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        const spisok_vo = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (!spisok_vo || spisok_vo.length !== igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, { text: 'Число игроков не совпадает — отредактируй список', show_alert: true });
            return;
        }
        await zapolnitIgruIzSpiskaVechera(igra, spisok_vo);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Состав подтверждён' });
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('vecher_edit_')) {
        const kod = data.replace('vecher_edit_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        bot.answerCallbackQuery(query.id);
        await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('vecher_pokaz_')) {
        const kod = data.replace('vecher_pokaz_', '');
        const igra = igry[kod];
        if (!igra?.klub_id) { bot.answerCallbackQuery(query.id, { text: 'Нет привязки к клубу', show_alert: true }); return; }
        const spisok_vp = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (!spisok_vp || spisok_vp.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Состав вечера ещё не сохранён', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id);
        await pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok_vp);
    }

    else if (data.startsWith('lobby_spisok_')) {
        const kod = data.replace('lobby_spisok_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        bot.answerCallbackQuery(query.id);
        await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('status_')) {
        const kod = data.replace('status_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('rez_')) {
        const p = cbUnpack(data.replace('rez_', ''));
        if (!p) return;
        await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
    }

    else if (data.startsWith('rezadd_')) {
        const p = cbUnpack(data.replace('rezadd_', ''));
        if (!p) return;
        const igra = igry[p.kod];
        if (!igra) { bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true }); return; }

        const { data: igrok_rez } = await supabase
            .from('igroki')
            .select('id, tg_id, imya, igrovoy_nik')
            .eq('id', p.igrok_id)
            .single();

        const uzheVigre = (igra.igroki || []).some(i => i.igrok_id === igrok_rez?.id || (igrok_rez?.tg_id && i.telegram_id === igrok_rez.tg_id));
        if (uzheVigre) {
            if (ubratIgrokaIzIgryPoId(igra, igrok_rez?.id)) {
                await sohranit_igru(p.kod);
                bot.answerCallbackQuery(query.id, { text: 'Убран из лобби' });
            } else {
                bot.answerCallbackQuery(query.id, { text: 'Игрок уже в игре' });
            }
            await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
            return;
        }

        const rezultat = dobavitIgrokaVIgru(igra, igrok_rez);
        if (rezultat.reason === 'exists') {
            bot.answerCallbackQuery(query.id, { text: 'Уже добавлен' });
        } else if (rezultat.reason === 'full') {
            bot.answerCallbackQuery(query.id, { text: 'Все места заняты', show_alert: true });
        } else if (rezultat.ok) {
            if (igra.klub_id && igrok_rez?.id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, igrok_rez.id);
            await sohranit_igru(p.kod);
            bot.answerCallbackQuery(query.id, { text: 'Добавлен: №' + rezultat.nomer + ' ' + rezultat.name });
        }
        await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
    }

    else if (data.startsWith('manual_roles_')) {
        const kod = data.replace('manual_roles_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        sostoyanie[telegram_id] = 'manual_roles_' + kod;
        bot.editMessageText(
            '✍️ *Внеси роли вручную*\n\n' +
            'Пришли одним сообщением список на *' + igra.kolichestvo + '* игроков.\n\n' +
            'Формат:\n' +
            '`1. Аня — Дон`\n' +
            '`2. Оля — Мафия`\n' +
            '`3. Катя — Мирный`\n\n' +
            'После этого бот откроет игровую панель и таймеры. Игрокам ничего отправляться не будет.',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'obnovit_igru_' + kod }]] }
            }
        );
    }

    else if (data.startsWith('nachat_igru_')) {
        const kod = data.replace('nachat_igru_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if (igra.igroki.length < igra.kolichestvo) {
            if (igra.rezhim_rolei === 'karty') {
                await bot.editMessageText(
                    '🃏 *Физические карты*\n\n' +
                    'Сейчас подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '.\n' +
                    'Для физической игры можно не ждать подключений.\n\n' +
                    'Начни ночь знакомства: сначала активные роли, затем мирных без роли — для рейтинга.',
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [
                            [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }],
                            [{ text: '✍️ Внести роли списком', callback_data: 'manual_roles_' + kod }],
                            [{ text: '⬅️ Назад', callback_data: 'obnovit_igru_' + kod }]
                        ] }
                    }
                );
                return;
            }
            bot.answerCallbackQuery(query.id, {
                text: 'Подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '. Дождись всех игроков.',
                show_alert: true
            });
            return;
        }
        igra.rezhim_rolei = 'karty';
        igra.roli_razdany = true;
        igra.den = 1;
        igra.igroki.forEach(i => {
            i.status = 'v_igre';
            i.foly = i.foly || 0;
        });
        await sohranit_igru(kod);
        await bot.editMessageText('🃏 *Игра начата с физическими картами!*\n\nРоли раздаёт ведущий за столом.\nТеперь можно открыть игровую панель и запустить знакомство.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }],
                [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }],
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    else if (data.startsWith('noch_znakomstvo_')) {
        const kod = data.replace('noch_znakomstvo_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if ((igra.igroki || []).length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, {
                text: 'Сначала внеси полный состав (' + (igra.igroki || []).length + '/' + igra.kolichestvo + ')',
                show_alert: true
            });
            return;
        }
        igra.rezhim_rolei = 'karty';
        igra.den = 1;
        igra.igroki.forEach(i => { delete i.rol; });
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDF19 Ночь знакомства' });
        await bot.editMessageText('\uD83C\uDF19 *Ночь знакомства началась.*\n\nСначала по очереди внесём активные роли из состава. Затем отдельным шагом — *мирных без роли*, чтобы они попали в рейтинг.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        await pokazatShagNochiZnakomstva(chatId, kod, 0);
    }

    // ===== ВНЕСТИ РЕЗУЛЬТАТЫ =====
    else if (data === 'vnesti_rezultaty') {
        const klubyDostupa = await poluchitKlubyDlyaIgr(telegram_id);
        const klubIdsDostupa = new Set(klubyDostupa.map(k => k.id));
        const aktivnye = Object.entries(igry)
            .filter(([kod, igra]) => !String(kod).startsWith('archive_') && !igra._ne_sohranyat && (
                igra?.vedushchii_id === telegram_id || (igra?.klub_id && klubIdsDostupa.has(igra.klub_id))
            ))
            .map(([kod, igra]) => ({ kod, igra }));

        if (aktivnye.length === 0) {
            bot.editMessageText(
                '\uD83D\uDCCB *Внести результаты игры*\n\nАктивных игр пока нет.\n\nМожно создать игру или внести результат уже сыгранной игры без прохождения процесса.',
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: '✍️ Внести прошедшую игру', callback_data: 'rez_manual_start' }],
                        [{ text: '\uD83C\uDFB2 Создать игру', callback_data: 'sozdat_igru' }],
                        [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vedushchego' }]
                    ]}
                }
            );
            return;
        }

        let t_rez = '\uD83D\uDCCB *Внести результаты игры*\n\nВыбери игру, которую нужно завершить:\n\n';
        const knopki_rez = aktivnye.map(({ kod, igra }) => {
            const v_igre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            t_rez += '\uD83C\uDFAE №' + kod + ' — день ' + (igra.den || 1) + ', за столом ' + v_igre + '/' + (igra.kolichestvo || igra.igroki?.length || 0) + '\n';
            return [{ text: '\uD83C\uDFC1 Завершить игру №' + kod, callback_data: 'konec_' + kod }];
        });
        knopki_rez.push([{ text: '✍️ Внести прошедшую игру без процесса', callback_data: 'rez_manual_start' }]);
        knopki_rez.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(
            t_rez,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_rez } }
        );
    }

    else if (data === 'rez_manual_start') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (!kluby.length) {
            bot.answerCallbackQuery(query.id, { text: 'Нет клуба для внесения результата', show_alert: true });
            return;
        }
        if (kluby.length === 1) {
            ozhidanie_registracii[telegram_id] = { shag: 'manual_result_date', klub_id: kluby[0].id };
            bot.editMessageText('📅 *Дата игры*\n\nВведи дату игры или напиши `сегодня`.\n\nПример: `01.06.2026`', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'vnesti_rezultaty' }]] }
            });
            return;
        }
        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'rez_manual_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'vnesti_rezultaty' }]);
        bot.editMessageText('✍️ *Внести прошедшую игру*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('rez_manual_klub_')) {
        const klub_id = data.replace('rez_manual_klub_', '');
        ozhidanie_registracii[telegram_id] = { shag: 'manual_result_date', klub_id };
        bot.editMessageText('📅 *Дата игры*\n\nВведи дату игры или напиши `сегодня`.\n\nПример: `01.06.2026`', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'vnesti_rezultaty' }]] }
        });
    }

    else if (data.startsWith('rez_manual_win_')) {
        const pobeditel = data.replace('rez_manual_win_', '');
        const draft = ruchnyeRezultaty[telegram_id];
        if (!draft?.igra) {
            bot.answerCallbackQuery(query.id, { text: 'Черновик не найден', show_alert: true });
            return;
        }
        draft.igra.pobeditel = pobeditel;
        draft.bonus_voprosy = ruchnyeBonusVoprosy(draft.igra);
        draft.bonus_idx = 0;
        bot.answerCallbackQuery(query.id, { text: 'Победитель выбран' });
        if (!draft.bonus_voprosy.length) {
            const { kod, igra } = await sozdatRuchnuyuIgruIzDrafta(draft, telegram_id);
            await zapisat_bally(igra, kod);
            const svodka = tekstItogaRuchnoyIgry(igra, kod);
            igry['archive_' + kod] = { ...igra, _final_text: svodka };
            delete igry[kod];
            delete ruchnyeRezultaty[telegram_id];
            await zavershit_igru_v_db(kod);
            bot.editMessageText(svodka, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📣 Текст для публикации', callback_data: 'publish_itog_' + kod }],
                    [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
                ] }
            });
            return;
        }
        bot.editMessageText(tekstVoprosaRuchnogoBonusa(draft), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiRuchnogoBonusa()
        });
    }

    else if (data === 'rez_bonus_yes' || data === 'rez_bonus_no') {
        const draft = ruchnyeRezultaty[telegram_id];
        if (!draft?.igra || !draft.bonus_voprosy) {
            bot.answerCallbackQuery(query.id, { text: 'Черновик не найден', show_alert: true });
            return;
        }
        const q = draft.bonus_voprosy[draft.bonus_idx];
        if (data === 'rez_bonus_yes' && q) {
            dobavitAvtoBonus(draft.igra, q.nomer, q.key, BALLY_DEFAULT[q.key] ?? 0, q.bonusText || q.text);
        }
        draft.bonus_idx += 1;
        bot.answerCallbackQuery(query.id, { text: data === 'rez_bonus_yes' ? 'Бонус добавлен' : 'Пропущено' });
        if (draft.bonus_idx < draft.bonus_voprosy.length) {
            bot.editMessageText(tekstVoprosaRuchnogoBonusa(draft), {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: knopkiRuchnogoBonusa()
            });
            return;
        }
        const { kod, igra } = await sozdatRuchnuyuIgruIzDrafta(draft, telegram_id);
        await zapisat_bally(igra, kod);
        const svodka = tekstItogaRuchnoyIgry(igra, kod);
        igry['archive_' + kod] = { ...igra, _final_text: svodka };
        delete igry[kod];
        delete ruchnyeRezultaty[telegram_id];
        await zavershit_igru_v_db(kod);
        bot.editMessageText(svodka, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📣 Текст для публикации', callback_data: 'publish_itog_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('publish_itog_')) {
        const kod = data.replace('publish_itog_', '');
        const igra = igry['archive_' + kod];
        const textPub = igra?._final_text || 'Итог игры №' + kod + ' уже записан в рейтинг.';
        bot.answerCallbackQuery(query.id, { text: 'Текст готов' });
        bot.sendMessage(chatId, '📣 *Текст для публикации:*\n\n' + textPub, { parse_mode: 'Markdown' });
    }

    // ===== ВЕДУЩИЙ: раздать роли =====
    else if (data.startsWith('razdat_')) {
        const kod = data.replace('razdat_', '');
        const igra = igry[kod];

        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if (igra.roli_razdany) { bot.sendMessage(chatId, '⚠️ Роли уже розданы.'); return; }
        if (igra.igroki.length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, {
                text: 'Подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '. Дождись всех игроков.',
                show_alert: true
            });
            return;
        }

        const tip_kluba = igra.tip_kluba || 'paskal';
        const sostav = igra._sostav_custom || poluchit_sostav(igra.kolichestvo, tip_kluba);
        if (!sostav) { bot.sendMessage(chatId, '\u274C Нет состава для ' + igra.kolichestvo + ' игроков'); return; }
        let peremeshannye = peremeshat(sostav);
        // Если спортивный режим — уже обработано через poluchit_sostav


        for (let i = 0; i < igra.igroki.length; i++) {
            igra.igroki[i].rol = peremeshannye[i];
            igra.igroki[i].status = 'v_igre';
            igra.igroki[i].foly = 0;
        }
        igra.roli_razdany = true;
        igra.den = 1;
        await sohranit_igru(kod);

        for (const igrok of igra.igroki) {
            const opisanie = roli_opisaniya[igrok.rol] || ('\uD83C\uDFAD *Роль: ' + igrok.rol + '*');
            const is_maf_player = isMafiaRole(igrok.rol);
            const komanda_mafii = is_maf_player
                ? igra.igroki
                    .filter(i => isMafiaRole(i.rol))
                    .map(i => '№' + i.nomer + ' ' + i.name + ' — ' + i.rol)
                    .join('\n')
                : '';
            const reply_markup_role = is_maf_player
                ? { inline_keyboard: [[{ text: '\uD83D\uDC40 Посмотреть свою команду', callback_data: 'moya_komanda_' + kod }]] }
                : undefined;
            const foto_id = roli_foto[igrok.rol];
            const tekst_roli = opisanie + '\n\n' +
                '\uD83C\uDFB4 Игра \u2116' + kod + '\n' +
                (nazvanieKlubaIgry(igra) ? '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n' : '') +
                '\uD83D\uDC64 Ты — игрок \u2116' + igrok.nomer + '\n\n' +
                (komanda_mafii ? '\uD83D\uDD34 *Твоя команда:*\n' + komanda_mafii + '\n\n' : '') +
                '\uD83E\uDD2B _Никому не показывай!_';
            if (foto_id) {
                bot.sendPhoto(igrok.telegram_id, foto_id, {
                    caption: tekst_roli,
                    parse_mode: 'Markdown',
                    protect_content: true,
                    ...(reply_markup_role ? { reply_markup: reply_markup_role } : {})
                });
            } else {
                bot.sendMessage(igrok.telegram_id, tekst_roli, {
                    parse_mode: 'Markdown',
                    protect_content: true,
                    ...(reply_markup_role ? { reply_markup: reply_markup_role } : {})
                });
            }
        }

        let svodka = '🎴 *Роли разданы!*\n\n' +
                     '🎴 Игра №' + kod + '\n' +
                     (nazvanieKlubaIgry(igra) ? '🏛 Клуб: *' + nazvanieKlubaIgry(igra) + '*\n' : '') +
                     '👥 Игроков: ' + igra.kolichestvo + '\n\n' +
                     '*Раскладка (только для тебя):*\n' +
                     '─────────────────\n';

        for (const igrok of igra.igroki) {
            svodka += '№' + igrok.nomer + ' ' + igrok.name + ' → *' + igrok.rol + '*\n';
        }
        svodka += '─────────────────\n✅ Каждому отправлена роль в личку.';

        bot.sendMessage(chatId, svodka, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }


    // ===== ИГРОВАЯ ПАНЕЛЬ =====
    else if (data.startsWith('panel_') && !data.startsWith('panel_foly_')) {
        const kod = data.replace('panel_', '');
        const igra = igry[kod];
        if (!igra) {
            bot.editMessageText('\u274C Игра не найдена. Возможно сервер перезапустился.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }
        await zagruzitNazvanieKlubaVIgru(igra);

        if (igra.ostanovlena) {
            bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nТаймеры не идут. Можно возобновить игру или удалить её.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }],
                    [{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }],
                    [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
                ]}
            });
            return;
        }

        const v_igre = igra.igroki.filter(i => i.status === 'v_igre').length;
        let tekst = '\uD83C\uDFAE *Игра \u2116' + kod + '* | День ' + (igra.den || 1) + '\n';
        if (nazvanieKlubaIgry(igra)) tekst += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
        tekst += '\uD83D\uDC65 В игре: *' + v_igre + '*/' + igra.kolichestvo + '\n';
        tekst += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';

        igra.igroki.forEach(igrok => {
            let emoji = igrok.status === 'v_igre' ? (igrok.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            tekst += emoji + ' \u2116' + igrok.nomer + ' *' + igrok.name + '* — ' + (igrok.rol || '?');
            if (igrok.foly > 0) tekst += ' [' + igrok.foly + ' фол]';
            tekst += '\n';
        });

        const knopki = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбыл', callback_data: 'vybyl_' + kod + '_' + i.nomer }]);

        // Кнопки фаз
        if (!igra.faza || igra.faza === 'ozhidanie') {
            knopki.push([{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }]);
            knopki.push([{ text: knopkaKtoNachinaet('den', igra.den || 1), callback_data: 'faza_den_' + kod }]);
        } else if (igra.faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 На голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        } else if (igra.faza === 'noch') {
            knopki.push([{ text: '\uD83C\uDF19 Панель ночи', callback_data: 'noch_panel_' + kod }]);
        }
        if (igra.rezhim_rolei === 'karty' && !igra.roli_razdany && mirnyeOstalosVnesti(igra) > 0
            && (igra.igroki || []).some(i => i.rol && i.rol !== 'Мирный')) {
            knopki.push([{ text: '\uD83D\uDFE2 + Мирный житель (' + mirnyeOstalosVnesti(igra) + ')', callback_data: 'panel_mirny_' + kod }]);
        }
        knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
        knopki.push(...knopkiUpravleniyaIgroi(kod));
        knopki.push([{ text: '\uD83D\uDD04 Обновить', callback_data: 'panel_' + kod }]);
        knopki.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПАНЕЛЬ ФОЛОВ =====
    else if (data.startsWith('panel_mirny_')) {
        const kod = data.replace('panel_mirny_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (mirnyeOstalosVnesti(igra) <= 0) {
            bot.answerCallbackQuery(query.id, { text: 'Все мирные уже внесены', show_alert: true });
            return;
        }
        sostoyanie[telegram_id] = 'noch_mirnye_' + kod;
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiMirnyhVvoda(igra, kod)
        });
    }

    else if (data.startsWith('mirny_igrok_')) {
        const parts_mi = data.replace('mirny_igrok_', '').split('_');
        const kod = parts_mi[0];
        const nomer_mi = parseInt(parts_mi[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_mi = igra.igroki.find(i => i.nomer === nomer_mi);
        const rez_mi = await dobavitMirnogoVIgru(chatId, igra, kod, igrok_mi);
        if (!rez_mi.ok) {
            const msg_mi = rez_mi.error === 'has_role'
                ? 'У игрока уже роль ' + rez_mi.rol
                : rez_mi.error === 'already'
                    ? 'Уже мирный'
                    : 'Не удалось добавить';
            bot.answerCallbackQuery(query.id, { text: msg_mi, show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: '\u2116' + igrok_mi.nomer + ' — Мирный' });
        if (rez_mi.ostalos <= 0) {
            await bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod) + '\n\n\u2705 *Все мирные внесены.*', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2705 Завершить ночь', callback_data: 'mirny_done_' + kod }]] }
            });
            return;
        }
        bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiMirnyhVvoda(igra, kod)
        });
    }

    else if (data.startsWith('mirny_vvod_')) {
        const kod = data.replace('mirny_vvod_', '');
        const igra = igry[kod];
        if (!igra) return;
        sostoyanie[telegram_id] = 'noch_mirnye_' + kod;
        bot.answerCallbackQuery(query.id, { text: 'Отправь номер или ник' });
        bot.sendMessage(chatId,
            '\u270D\uFE0F Отправь *номер / ник* одного игрока без роли или список мирных через запятую.\n\n' +
            'Пример: `Аня, Оля, Катя`\n\n' +
            'Осталось мирных: *' + mirnyeOstalosVnesti(igra) + '*',
            { parse_mode: 'Markdown', reply_markup: knopkiMirnyhVvoda(igra, kod) }
        );
    }

    else if (data.startsWith('mirny_done_')) {
        const kod = data.replace('mirny_done_', '');
        const igra = igry[kod];
        if (!igra) return;
        const ostalos_md = mirnyeOstalosVnesti(igra);
        if (ostalos_md > 0) {
            bot.answerCallbackQuery(query.id, {
                text: 'Осталось мирных: ' + ostalos_md + '. Добавь всех или введи списком.',
                show_alert: true
            });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Завершаем ночь' });
        await zavershitNochZnakomstva(chatId, kod);
    }

    else if (data.startsWith('panel_foly_')) {
        const kod = data.replace('panel_foly_', '');
        const igra = igry[kod];
        if (!igra) return;

        const knopki = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/' + maxFolyIgry(igra) + ')', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki.push([{
            text: igra.faza === 'opravdanie' ? '\u2B05\uFE0F К оправданию' : '\u2B05\uFE0F К панели',
            callback_data: igra.faza === 'opravdanie' ? 'timer_back_' + kod : 'panel_' + kod
        }]);

        bot.editMessageText('\u26A0\uFE0F *Выдать фол* — Игра \u2116' + kod + '\n\nВыбери игрока:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ОТМЕТИТЬ ВЫБЫВШЕГО =====
    else if (data.startsWith('vybyl_')) {
        const parts = data.replace('vybyl_', '').split('_');
        const kod = parts[0];
        const nomer = parseInt(parts[1]);
        const igra = igry[kod];
        if (!igra) return;

        const igrok = igra.igroki.find(i => i.nomer === nomer);
        if (!igrok) return;
        igrok.status = 'vybyl';
        const ubitye_ruchn = [igrok];
        const shahid_effect_ruchn = primenitSmertShahida(igra, igrok, 'ruchnoy', ubitye_ruchn);

        if (igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '\uD83D\uDC80 *Ты выбыл из игры \u2116' + kod + '*\n\nТвоя роль была: *' + igrok.rol + '*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        ubitye_ruchn
            .filter(i => i.nomer !== igrok.nomer)
            .forEach(i => {
                if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            });

        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 \u2116' + nomer + ' ' + igrok.name + ' выбыл' });
        await sohranit_igru(kod);
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;

        const v_igre2 = igra.igroki.filter(i => i.status === 'v_igre').length;
        let tekst2 = '\uD83C\uDFAE *Игра \u2116' + kod + '* | День ' + (igra.den || 1) + '\n';
        tekst2 += '\uD83D\uDC65 В игре: *' + v_igre2 + '*/' + igra.kolichestvo + '\n';
        tekst2 += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
        igra.igroki.forEach(i => {
            let em = i.status === 'v_igre' ? (i.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            tekst2 += em + ' \u2116' + i.nomer + ' *' + i.name + '* — ' + (i.rol || '?');
            if (i.foly > 0) tekst2 += ' [' + i.foly + ' фол]';
            tekst2 += '\n';
        });
        if (shahid_effect_ruchn) tekst2 += '\n' + shahid_effect_ruchn;

        const knopki2 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбыл', callback_data: 'vybyl_' + kod + '_' + i.nomer }]);
        knopki2.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki2.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
        knopki2.push(...knopkiStopIgraTest(kod));
        knopki2.push([{ text: '\uD83D\uDD04 Обновить', callback_data: 'panel_' + kod }]);
        knopki2.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(tekst2, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki2 }
        });
    }

    // ===== ВЫДАТЬ ФОЛ =====
    else if (data.startsWith('fol_')) {
        const parts = data.replace('fol_', '').split('_');
        const kod = parts[0];
        const nomer = parseInt(parts[1]);
        const igra = igry[kod];
        if (!igra) return;

        const igrok = igra.igroki.find(i => i.nomer === nomer);
        if (!igrok || igrok.status !== 'v_igre') return;

        igrok.foly = (igrok.foly || 0) + 1;

        const max_foly = maxFolyIgry(igra);
        let shahid_effect_fol = '';
        if (igrok.foly >= max_foly) {
            igrok.status = 'vybyl';
            const ubitye_fol = [igrok];
            shahid_effect_fol = primenitSmertShahida(igra, igrok, 'fol', ubitye_fol);
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\uD83D\uDEAB *Ты удалён из игры \u2116' + kod + '* за ' + max_foly + ' фола.\n\nТвоя роль была: *' + igrok.rol + '*',
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            ubitye_fol
                .filter(i => i.nomer !== igrok.nomer)
                .forEach(i => {
                    if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
                });
            bot.answerCallbackQuery(query.id, { text: '\uD83D\uDEAB ' + igrok.name + ' удалён за ' + max_foly + ' фола!', show_alert: true });
            await sohranit_igru(kod);
            const pobeditel = opredelitPobeditelya(igra);
            if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        } else {
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\u26A0\uFE0F *Фол ' + igrok.foly + '/' + max_foly + '* в игре \u2116' + kod,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            bot.answerCallbackQuery(query.id, { text: '\u26A0\uFE0F Фол ' + igrok.foly + '/' + max_foly + ' — ' + igrok.name });
        }

        const knopki3 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/' + maxFolyIgry(igra) + ')', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki3.push([{
            text: igra.faza === 'opravdanie' ? '\u2B05\uFE0F К оправданию' : '\u2B05\uFE0F К панели',
            callback_data: igra.faza === 'opravdanie' ? 'timer_back_' + kod : 'panel_' + kod
        }]);

        bot.editMessageText('\u26A0\uFE0F *Выдать фол* — Игра \u2116' + kod + '\n\n' + (shahid_effect_fol ? shahid_effect_fol + '\n' : '') + 'Выбери игрока:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki3 }
        });
    }

    // ===== ЗАВЕРШИТЬ ИГРУ =====
    else if (data.startsWith('konec_')) {
        const kod = data.replace('konec_', '');
        const igra = igry[kod];
        if (!igra) return;

        bot.editMessageText(
            '\uD83C\uDFC1 *Завершить игру \u2116' + kod + '?*\n\nКто победил?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDFE2 Победили мирные', callback_data: 'itog_' + kod + '_mirnye' }],
                [{ text: '\uD83D\uDD34 Победила мафия', callback_data: 'itog_' + kod + '_mafiya' }],
                [{ text: '\uD83C\uDFAF Победил маньяк', callback_data: 'itog_' + kod + '_manyak' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]
            ]}
        });
    }

    // ===== ИТОГ ИГРЫ =====
    else if (data.startsWith('itog_')) {
        const parts = data.replace('itog_', '').split('_');
        const kod = parts[0];
        const pobeditel = parts[1];
        const igra = igry[kod];
        if (!igra) return;

        igra.pobeditel = pobeditel;
        const pobeditel_text = pobeditel === 'mirnye' ? '\uD83D\uDFE2 Мирные' :
                               pobeditel === 'mafiya' ? '\uD83D\uDD34 Мафия' : '\uD83C\uDFAF Маньяк';

        // Уведомляем игроков
        for (const igrok of igra.igroki) {
            bot.sendMessage(igrok.telegram_id,
                '\uD83C\uDFC1 *Игра \u2116' + kod + ' завершена!*\n\nПобедитель: ' + pobeditel_text + '\nТвоя роль: *' + igrok.rol + '*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        // Рассчитываем баллы автоматически
        await zapisat_bally(igra, kod);

        let svodka = '\uD83C\uDFC1 *Игра завершена!*\n\n';
        svodka += 'Победитель: ' + pobeditel_text + '\n\n';
        svodka += '*Итог:*\n';
        igra.igroki.forEach(i => {
            const em = i.status === 'v_igre' ? '\u2705' : '\uD83D\uDC80';
            svodka += em + ' \u2116' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
        });
        svodka += '\n\uD83C\uDFC6 Баллы записаны в рейтинг!';

        // Сохраняем для добавления ручных бонусов
        igry['archive_' + kod] = { ...igra };
        delete igry[kod];
        await zavershit_igru_v_db(kod);

        bot.editMessageText(svodka, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDF81 Добавить бонусы', callback_data: 'bonusy_' + kod }],
                [{ text: '\uD83C\uDFB2 Новая игра', callback_data: 'sozdat_igru' }],
                [{ text: '\uD83C\uDFE0 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    // ===== РУЧНЫЕ БОНУСЫ ПОСЛЕ ИГРЫ =====
    else if (data.startsWith('bonusy_')) {
        const kod = data.replace('bonusy_', '');
        const igra = igry['archive_' + kod];
        if (!igra) { bot.answerCallbackQuery(query.id, { text: 'Игра не найдена' }); return; }

        let t = '\uD83C\uDF81 *Бонусы* — Игра \u2116' + kod + '\n\n';
        t += '_Нажми на игрока чтобы добавить бонус:_\n\n';
        igra.igroki.forEach(i => {
            const bonus = i.bonus_text ? ' +' + i.bonus_pts + ' (' + i.bonus_text + ')' : '';
            t += '\u2116' + i.nomer + ' ' + i.name + ' [' + i.rol + ']' + bonus + '\n';
        });

        const knopki = igra.igroki.map(i => [{
            text: '\uD83C\uDF81 \u2116' + i.nomer + ' ' + i.name + (i.bonus_pts ? ' +' + i.bonus_pts : ''),
            callback_data: 'bonus_igrok_' + kod + '_' + i.nomer
        }]);
        knopki.push([{ text: '\u2705 Готово', callback_data: 'bonusy_done_' + kod }]);
        knopki.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    // ===== ВЫБРАТЬ ИГРОКА ДЛЯ БОНУСА =====
    else if (data.startsWith('bonus_igrok_')) {
        const parts_b = data.replace('bonus_igrok_', '').split('_');
        const kod = parts_b[0];
        const nomer_b = parseInt(parts_b[1]);
        const igra = igry['archive_' + kod];
        if (!igra) return;
        const igrok_b = igra.igroki.find(i => i.nomer === nomer_b);
        if (!igrok_b) return;

        sostoyanie[telegram_id] = 'bonus_vvod_' + kod + '_' + nomer_b;
        bot.editMessageText(
            '\uD83C\uDF81 *Бонус для \u2116' + nomer_b + ' ' + igrok_b.name + '*\n\n' +
            'Введи количество очков (например: 2) и через пробел причину:\n_Пример: 2 лучший игрок вечера_',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Отмена', callback_data: 'bonusy_' + kod }]] } }
        );
    }

    // ===== БОНУСЫ ГОТОВО — СОХРАНИТЬ =====
    else if (data.startsWith('bonusy_done_')) {
        const kod = data.replace('bonusy_done_', '');
        delete igry['archive_' + kod];
        bot.editMessageText('\u2705 *Все бонусы сохранены!*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFB2 Новая игра', callback_data: 'sozdat_igru' }],
                [{ text: '\uD83C\uDFE0 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }


    // ===== ФАЗА: ЗНАКОМСТВО =====
    else if (data.startsWith('faza_znakomstvo_')) {
        const kod = data.replace('faza_znakomstvo_', '');
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id);
        await zaprositPervogoHoda(chatId, messageId, kod, 'znakomstvo', telegram_id);
    }

    // ===== ФАЗА: ДЕНЬ =====
    else if (data.startsWith('faza_den_')) {
        const kod = data.replace('faza_den_', '');
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id);
        await zaprositPervogoHoda(chatId, messageId, kod, 'den', telegram_id);
    }

    else if (data.startsWith('perviy_hod_')) {
        const rest_ph = data.replace('perviy_hod_', '');
        const parts_ph = rest_ph.split('_');
        const faza_ph = parts_ph.pop();
        const nomer_ph = parseInt(parts_ph.pop(), 10);
        const kod_ph = parts_ph.join('_');
        const igra_ph = igry[kod_ph];
        if (!igra_ph || !Number.isFinite(nomer_ph)) return;
        bot.answerCallbackQuery(query.id, { text: 'Старт с №' + nomer_ph });
        await ustanovitPervogoHoda(chatId, messageId, kod_ph, nomer_ph, faza_ph, telegram_id);
    }

    // ===== ТАЙМЕР: личное время 40-60 секунд =====
    else if (data.startsWith('set_minuta_')) {
        const parts = data.replace('set_minuta_', '').split('_');
        const kod = parts[0];
        const sek = Math.min(60, Math.max(40, parseInt(parts[1], 10) || 60));
        const igra = igry[kod];
        if (!igra) return;
        igra._nastroyki = igra._nastroyki || {};
        igra._nastroyki.minuta_sek = sek;
        if (igra.faza === 'den' && igra.taymer_aktiven) igra.taymer_sekundy = sek;
        bot.answerCallbackQuery(query.id, { text: 'Личное время: ' + sek + ' сек' });
        await bot.editMessageText(buildPanelText(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
        });
    }

    // ===== ТАЙМЕР: ПАС =====
    else if (data.startsWith('pas_')) {
        const kod = data.replace('pas_', '');
        bot.answerCallbackQuery(query.id, { text: '\u23ED\uFE0F Пас — следующий' });
        sleduyushchiy(chatId, messageId, kod);
    }

    // ===== ТАЙМЕР: СТОП =====
    else if (data.startsWith('stop_taymer_')) {
        const kod = data.replace('stop_taymer_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        bot.answerCallbackQuery(query.id, { text: '\u23F9 Таймер остановлен' });
        bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) } });
    }

    // ===== ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ ПО НИКУ (во время минуты) =====
    else if (data.startsWith('vystav_nick_')) {
        const kod = data.replace('vystav_nick_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (igra.faza !== 'den' && igra.faza !== 'znakomstvo') {
            bot.answerCallbackQuery(query.id, { text: 'Сейчас не идёт круг речи', show_alert: true });
            return;
        }
        if (!igra.tekushchiy_nomer) {
            bot.answerCallbackQuery(query.id, { text: 'Сейчас никто не говорит', show_alert: true });
            return;
        }
        if (kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer).length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Все доступные игроки уже номинированы', show_alert: true });
            return;
        }
        igra._vystav_ot_nomer = igra.tekushchiy_nomer;
        sostoyanie[telegram_id] = 'vystav_golos_' + kod;
        bot.answerCallbackQuery(query.id, { text: 'Выбери игрока' });
        bot.sendMessage(chatId, tekstVystavleniyaNaGolos(igra), {
            parse_mode: 'Markdown',
            reply_markup: knopkiVystavleniyaNaGolos(igra, kod)
        });
    }

    else if (data.startsWith('vystav_pick_')) {
        const rest = data.replace('vystav_pick_', '');
        const pos = rest.lastIndexOf('_');
        const kod = rest.slice(0, pos);
        const nomer = parseInt(rest.slice(pos + 1), 10);
        const igra = igry[kod];
        if (!igra || !Number.isFinite(nomer)) return;
        const igrok = igra.igroki.find(i => i.nomer === nomer);
        bot.answerCallbackQuery(query.id, { text: 'Выставляю…' });
        await vypolnitVystavlenieNaGolos(chatId, igra, kod, igrok, telegram_id);
    }

    else if (data.startsWith('timer_back_')) {
        const kod = data.replace('timer_back_', '');
        delete sostoyanie[telegram_id];
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id, { text: 'К таймеру' });
        const msgId = igra._taymer_message_id || messageId;
        const cId = igra._taymer_chat_id || chatId;
        await bot.editMessageText(buildPanelText(igra, kod), {
            chat_id: cId, message_id: msgId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
        });
        if (!igra.taymer_aktiven && igra.tekushchiy_nomer) {
            const nastroyki = igra._nastroyki || {};
            const sek = igra.taymer_sekundy > 0
                ? igra.taymer_sekundy
                : (igra.faza === 'znakomstvo' ? (nastroyki.znakomstvo_sek || 15)
                    : igra.faza === 'opravdanie' ? (nastroyki.opravdanie_sek || 30)
                    : lichnoeVremyaSek(igra));
            zapustitTaymer(cId, msgId, kod, sek);
        }
    }

    // ===== ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ =====
    else if (data.startsWith('vybrat_na_golos_')) {
        const kod = data.replace('vybrat_na_golos_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_dobavit_')) {
        const kod = data.replace('golos_dobavit_', '');
        const igra = igry[kod];
        if (!igra) return;
        const kandidaty = kandidatyDobavitNaGolos(igra);
        if (kandidaty.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Некого добавить', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(tekstDobavitNaGolos(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiDobavitNaGolos(igra, kod) }
        });
    }

    // ===== НАЗНАЧИТЬ НА ГОЛОСОВАНИЕ (убрать из списка) =====
    else if (data.startsWith('golos_toggle_')) {
        const parts_n = data.replace('golos_toggle_', '').split('_');
        const kod = parts_n[0];
        const nomer_n = parseInt(parts_n[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const idx_n = igra.naznacheny_golos.indexOf(nomer_n);
        if (idx_n >= 0) {
            igra.naznacheny_golos.splice(idx_n, 1);
            bot.answerCallbackQuery(query.id, { text: 'Убран из списка' });
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Игрок не в списке', show_alert: true });
            return;
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_up_') || data.startsWith('golos_down_')) {
        const up = data.startsWith('golos_up_');
        const rest = data.replace(up ? 'golos_up_' : 'golos_down_', '');
        const parts_mv = rest.split('_');
        const kod = parts_mv[0];
        const nomer_mv = parseInt(parts_mv[1], 10);
        const igra = igry[kod];
        if (!igra || !Number.isFinite(nomer_mv)) return;
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const idx_mv = igra.naznacheny_golos.indexOf(nomer_mv);
        const nextIdx = up ? idx_mv - 1 : idx_mv + 1;
        if (idx_mv < 0 || nextIdx < 0 || nextIdx >= igra.naznacheny_golos.length) {
            bot.answerCallbackQuery(query.id, { text: 'Порядок не изменён' });
            return;
        }
        [igra.naznacheny_golos[idx_mv], igra.naznacheny_golos[nextIdx]] = [igra.naznacheny_golos[nextIdx], igra.naznacheny_golos[idx_mv]];
        sinhronizirovatSpisokGolosovaniya(igra);
        bot.answerCallbackQuery(query.id, { text: 'Порядок обновлён' });
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_add_')) {
        const parts_a = data.replace('golos_add_', '').split('_');
        const kod = parts_a[0];
        const nomer_a = parseInt(parts_a[1]);
        const igra = igry[kod];
        if (!igra) return;
        const kandidat_a = igra.igroki.find(i => i.nomer === nomer_a);
        if (!kandidat_a || kandidat_a.status !== 'v_igre') {
            bot.answerCallbackQuery(query.id, { text: 'Игрок не найден', show_alert: true });
            return;
        }
        if (estImmunitetOtGolosovaniya(kandidat_a)) {
            bot.answerCallbackQuery(query.id, { text: 'У игрока иммунитет', show_alert: true });
            return;
        }
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        if (!igra.naznacheny_golos.includes(nomer_a)) {
            igra.naznacheny_golos.push(nomer_a);
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDCA5 Добавлен' });
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    // ===== ФАЗА: ОПРАВДАНИЕ =====
    else if (data.startsWith('faza_opravdanie_')) {
        const kod = data.replace('faza_opravdanie_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        if (!igra.naznacheny_golos || igra.naznacheny_golos.length === 0) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Никто не выставлен', show_alert: true }); return;
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        igra.faza = 'opravdanie';
        igra.poryadok_hoda = [...igra.naznacheny_golos];
        igra.tekushchiy_nomer = igra.poryadok_hoda[0];
        igra.naznacheny_golos.forEach(nomer => {
            const i = igra.igroki.find(x => x.nomer === nomer);
            if (i?.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDCA5 *Тебя выставили на голосование!*\n\nГотовь оправдание.', { parse_mode: 'Markdown' }).catch(() => {});
        });
        const sek_op = igra._nastroyki?.opravdanie_sek || 30;
        await bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'opravdanie') } });
        zapustitTaymer(chatId, messageId, kod, sek_op);
    }

    // ===== ФАЗА: ГОЛОСОВАНИЕ =====
    else if (data.startsWith('faza_golosovanie_')) {
        const kod = data.replace('faza_golosovanie_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        igra.faza = 'golosovanie';
        igra.tekushchiy_nomer = null;
        igra.golosa_dnya = {};
        const naznacheny_v = (igra.naznacheny_golos || []).map(n => igra.igroki.find(x => x.nomer === n)).filter(Boolean);
        if (naznacheny_v.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Некого выводить на голосование', show_alert: true });
            return;
        }
        bot.editMessageText(tekstGolosovaniyaSPodschetom(igra, kod), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra, kod) }
        });
    }

    // ===== ГОЛОСОВАНИЕ: внести количество голосов =====
    else if (data.startsWith('golos_count_')) {
        const parts_gc = data.replace('golos_count_', '').split('_');
        const kod = parts_gc[0];
        const nomer_gc = parseInt(parts_gc[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_gc = igra.igroki.find(i => i.nomer === nomer_gc);
        if (!igrok_gc) return;
        sostoyanie[telegram_id] = 'golos_count_' + kod + '_' + nomer_gc;
        bot.editMessageText(
            '\uD83D\uDD22 *Голоса за \u2116' + nomer_gc + ' ' + igrok_gc.name + '*\n\n' +
            'Введи число голосов одним сообщением:',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад к голосованию', callback_data: 'faza_golosovanie_' + kod }]] }
            }
        );
    }

    // ===== ГОЛОСОВАНИЕ: автоматический итог =====
    else if (data.startsWith('golos_itog_auto_')) {
        const kod = data.replace('golos_itog_auto_', '');
        const igra = igry[kod];
        if (!igra) return;
        const naznacheny = (igra.naznacheny_golos || [])
            .map(n => igra.igroki.find(i => i.nomer === n))
            .filter(Boolean);
        const golosa = igra.golosa_dnya || {};
        const neVneseny = naznacheny.filter(i => !Number.isFinite(golosa[i.nomer]));
        if (neVneseny.length > 0) {
            bot.answerCallbackQuery(query.id, { text: 'Внеси голоса за всех выставленных.', show_alert: true });
            return;
        }
        const max = Math.max(...naznacheny.map(i => golosa[i.nomer] || 0));
        const lidery = naznacheny.filter(i => (golosa[i.nomer] || 0) === max);

        if (lidery.length !== 1 || max === 0) {
            let t_eq = '\uD83D\uDDF3 *Итог голосования:* равенство\n\n';
            lidery.forEach(i => { t_eq += '\u2116' + i.nomer + ' ' + i.name + ' — ' + (golosa[i.nomer] || 0) + ' голос(ов)\n'; });

            if (!igra.peregolosovanie_aktivno) {
                igra.peregolosovanie_aktivno = true;
                igra.naznacheny_golos = lidery.map(i => i.nomer);
                igra.golosa_dnya = {};
                await sohranit_igru(kod);
                t_eq += '\n\uD83D\uDD01 Назначено *переголосование* только между игроками с равным результатом.';
                bot.editMessageText(t_eq + '\n\n' + tekstGolosovaniyaSPodschetom(igra, kod), {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra, kod) }
                });
                return;
            }

            igra.peregolosovanie_finalisty = lidery.map(i => i.nomer);
            await sohranit_igru(kod);
            t_eq += '\n\u26A0\uFE0F Равенство повторилось. Стол должен решить: оставить всех или удалить всех спорных игроков.';
            bot.editMessageText(t_eq, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\u2705 Оставить всех', callback_data: 'golos_ostavit_spor_' + kod }],
                    [{ text: '\uD83D\uDC80 Все спорные покидают стол', callback_data: 'golos_vybyli_spor_' + kod }]
                ] }
            });
            return;
        }

        const vybyv = lidery[0];
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 Выбывает \u2116' + vybyv.nomer });
        const igrok_gv = vybyv;
        const ubitye_gv = [];
        let shahid_effect_gv = '';
        igrok_gv.status = 'vybyl';
        zapisatDen1Vybyl(igra, igrok_gv);
        dobavitUnikalnoPoNomeru(ubitye_gv, igrok_gv);
        shahid_effect_gv = primenitSmertShahida(igra, igrok_gv, 'golosovanie', ubitye_gv);
        if (igrok_gv.telegram_id) bot.sendMessage(igrok_gv.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + igrok_gv.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        ubitye_gv
            .filter(i => i.nomer !== igrok_gv.nomer)
            .forEach(i => {
                if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        if ((igra.den || 1) === 1 && mozhetBytLuchshiyHod(igrok_gv)) {
            await pokazatLuchshiyHod(chatId, messageId, kod, igrok_gv.nomer, 'den1', 'noch');
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.faza = 'noch';
        if (shahid_effect_gv) await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC80 Голосование: \u2116' + igrok_gv.nomer + ' выбыл\n' + shahid_effect_gv);
        else await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ПЕРЕГОЛОСОВАНИЕ: оставить спорных игроков =====
    else if (data.startsWith('golos_ostavit_spor_')) {
        const kod = data.replace('golos_ostavit_spor_', '');
        const igra = igry[kod];
        if (!igra) return;
        const finalisty = (igra.peregolosovanie_finalisty || [])
            .map(n => igra.igroki.find(i => i.nomer === n))
            .filter(Boolean);
        let t = '\u2705 *Решение стола:* оставить игроков\n\n';
        finalisty.forEach(i => { t += '\u2116' + i.nomer + ' ' + i.name + ' остаётся в игре\n'; });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Игроки остаются' });
        bot.editMessageText(t, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF19 К ночи', callback_data: 'faza_noch_' + kod }]] }
        });
    }

    // ===== ПЕРЕГОЛОСОВАНИЕ: все спорные покидают стол =====
    else if (data.startsWith('golos_vybyli_spor_')) {
        const kod = data.replace('golos_vybyli_spor_', '');
        const igra = igry[kod];
        if (!igra) return;
        const finalisty = (igra.peregolosovanie_finalisty || [])
            .map(n => igra.igroki.find(i => i.nomer === n && i.status === 'v_igre'))
            .filter(Boolean);
        const ubitye_spor = [];
        let effect_text = '';
        let t = '\uD83D\uDC80 *Решение стола:* спорные игроки покидают стол\n\n';
        finalisty.forEach(i => {
            i.status = 'vybyl';
            zapisatDen1Vybyl(igra, i);
            dobavitUnikalnoPoNomeru(ubitye_spor, i);
            t += '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' (' + i.rol + ')\n';
            effect_text += primenitSmertShahida(igra, i, 'golosovanie', ubitye_spor);
        });
        if (effect_text) t += '\n' + effect_text;
        ubitye_spor.forEach(i => {
            if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Спорные игроки выбыли' });
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        bot.editMessageText(t, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF19 К ночи', callback_data: 'faza_noch_' + kod }]] }
        });
    }

    // ===== ГОЛОСОВАНИЕ: ВЫБЫЛ =====
    else if (data.startsWith('golos_vybyl_')) {
        const parts_gv = data.replace('golos_vybyl_', '').split('_');
        const kod = parts_gv[0];
        const nomer_gv = parseInt(parts_gv[1]);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_gv = igra.igroki.find(i => i.nomer === nomer_gv);
        const ubitye_gv = [];
        let shahid_effect_gv = '';
        if (igrok_gv) {
            igrok_gv.status = 'vybyl';
            zapisatDen1Vybyl(igra, igrok_gv);
            dobavitUnikalnoPoNomeru(ubitye_gv, igrok_gv);
            shahid_effect_gv = primenitSmertShahida(igra, igrok_gv, 'golosovanie', ubitye_gv);
            if (igrok_gv.telegram_id) bot.sendMessage(igrok_gv.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + igrok_gv.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            ubitye_gv
                .filter(i => i.nomer !== igrok_gv.nomer)
                .forEach(i => {
                    if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
                });
        }
        igra.naznacheny_golos = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 ' + (igrok_gv?.name || '') + ' выбыл' });
        if ((igra.den || 1) === 1 && mozhetBytLuchshiyHod(igrok_gv)) {
            await pokazatLuchshiyHod(chatId, messageId, kod, nomer_gv, 'den1', 'noch');
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.faza = 'noch';
        if (shahid_effect_gv) await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC80 Голосование: \u2116' + nomer_gv + ' выбыл\n' + shahid_effect_gv);
        else await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ГОЛОСОВАНИЕ: НИКТО =====
    else if (data.startsWith('golos_nikto_')) {
        const kod = data.replace('golos_nikto_', '');
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        bot.answerCallbackQuery(query.id, { text: '\u2705 Никто не выбыл' });
        igra.faza = 'noch';
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ФАЗА: НОЧЬ (переход) =====
    else if (data.startsWith('faza_noch_')) {
        const kod = data.replace('faza_noch_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        igra.faza = 'noch';
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== НОЧЬ: выбор цели мафии =====
    else if (data.startsWith('noch_vybor_maf_')) {
        const kod = data.replace('noch_vybor_maf_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_maf = igra.igroki.filter(i => i.status === 'v_igre' && !isMafiaRole(i.rol));
        const knopki_maf = alive_maf.map(i => [{ text: '\uD83D\uDD2B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_maf_' + kod + '_' + i.nomer }]);
        knopki_maf.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD2B *Мафия: выбери жертву*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_maf } });
    }

    // ===== НОЧЬ: мафия выбрала жертву =====
    else if (data.startsWith('noch_maf_')) {
        const parts_nm = data.replace('noch_maf_', '').split('_');
        const kod = parts_nm[0]; const nomer_nm = parseInt(parts_nm[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.mafiya_tseli = [nomer_nm];
        const zhertva_nm = igra.igroki.find(i => i.nomer === nomer_nm);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD2B Цель: ' + (zhertva_nm?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD2B Мафия выбрала \u2116' + nomer_nm);
    }

    // ===== НОЧЬ: выбор цели Дона =====
    else if (data.startsWith('noch_vybor_don_')) {
        const kod = data.replace('noch_vybor_don_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_don = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Дон');
        const knopki_don = alive_don.map(i => [{ text: '\uD83D\uDD0E \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_don_' + kod + '_' + i.nomer }]);
        knopki_don.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD0E *Дон: кого проверить на Шерифа?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_don } });
    }

    // ===== НОЧЬ: Дон проверил =====
    else if (data.startsWith('noch_don_')) {
        const parts_ndon = data.replace('noch_don_', '').split('_');
        const kod = parts_ndon[0];
        const nomer_ndon = parseInt(parts_ndon[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.don_tseli = nomer_ndon;
        const tsel_ndon = igra.igroki.find(i => i.nomer === nomer_ndon);
        const result_don = tsel_ndon && isSheriffRole(tsel_ndon.rol) ? '\uD83D\uDD0D ШЕРИФ/КОМИССАР' : '\u2705 Не шериф';
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD0E \u2116' + nomer_ndon + ': ' + result_don, show_alert: true });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD0E Дон проверил \u2116' + nomer_ndon + ': ' + result_don);
    }

    // ===== НОЧЬ: выбор цели Консильери =====
    else if (data.startsWith('noch_vybor_kons_')) {
        const kod = data.replace('noch_vybor_kons_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (!mozhetKonsilyeriVerbovat(igra)) {
            bot.answerCallbackQuery(query.id, { text: 'Вербовка доступна, когда мафии меньше 30% стола.', show_alert: true });
            return;
        }
        const mirnyeBezRoli = igra.igroki.filter(i => i.status === 'v_igre' && i.rol === 'Мирный');
        if (mirnyeBezRoli.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Нет обычных мирных для вербовки.', show_alert: true });
            return;
        }
        const knopki_kons = mirnyeBezRoli.map(i => [{ text: '\uD83E\uDD1D \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_kons_' + kod + '_' + i.nomer }]);
        knopki_kons.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83E\uDD1D *Консильери: кого завербовать?*\n\nМожно выбрать только обычного мирного без роли.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_kons }
        });
    }

    // ===== НОЧЬ: Консильери завербовал =====
    else if (data.startsWith('noch_kons_')) {
        const parts_nk = data.replace('noch_kons_', '').split('_');
        const kod = parts_nk[0];
        const nomer_nk = parseInt(parts_nk[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_kons = igra.igroki.find(i => i.nomer === nomer_nk);
        if (!tsel_kons || tsel_kons.status !== 'v_igre' || tsel_kons.rol !== 'Мирный') {
            bot.answerCallbackQuery(query.id, { text: 'Можно завербовать только обычного мирного.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.kons_tseli = nomer_nk;
        bot.answerCallbackQuery(query.id, { text: '\uD83E\uDD1D Цель: ' + tsel_kons.name });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83E\uDD1D Консильери выбрал \u2116' + nomer_nk);
    }

    // ===== НОЧЬ: выбор цели доктора =====
    else if (data.startsWith('noch_vybor_doc_')) {
        const kod = data.replace('noch_vybor_doc_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_doc = igra.igroki.filter(i => i.status === 'v_igre');
        const knopki_doc = alive_doc.map(i => [{ text: '\uD83D\uDC89 \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_doc_' + kod + '_' + i.nomer }]);
        knopki_doc.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDC89 *Доктор: кого лечить?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_doc } });
    }

    // ===== НОЧЬ: доктор выбрал =====
    else if (data.startsWith('noch_doc_')) {
        const parts_nd = data.replace('noch_doc_', '').split('_');
        const kod = parts_nd[0]; const nomer_nd = parseInt(parts_nd[1]);
        const igra = igry[kod];
        if (!igra) return;
        const proverkaDoc = proveritLechitDoktor(igra, nomer_nd);
        if (!proverkaDoc.ok) {
            bot.answerCallbackQuery(query.id, { text: proverkaDoc.text, show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.doctor_tseli = nomer_nd;
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC89 Вылечит \u2116' + nomer_nd });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC89 Доктор лечит \u2116' + nomer_nd);
    }

    // ===== НОЧЬ: выбор цели шерифа =====
    else if (data.startsWith('noch_vybor_sher_')) {
        const kod = data.replace('noch_vybor_sher_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_sher = igra.igroki.filter(i => i.status === 'v_igre');
        const knopki_sher = alive_sher.map(i => [{ text: '\uD83D\uDD0D \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_sher_' + kod + '_' + i.nomer }]);
        knopki_sher.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD0D *Шериф: кого проверить?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sher } });
    }

    // ===== НОЧЬ: шериф проверил =====
    else if (data.startsWith('noch_sher_')) {
        const parts_ns = data.replace('noch_sher_', '').split('_');
        const kod = parts_ns[0]; const nomer_ns = parseInt(parts_ns[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.sherif_tseli = nomer_ns;
        const tseli_s = igra.igroki.find(i => i.nomer === nomer_ns);
        const is_maf = tseli_s && isMafiaRole(tseli_s.rol);
        const result_s = is_maf ? '\uD83D\uDD34 МАФИЯ' : '\u2705 Мирный';
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD0D \u2116' + nomer_ns + ': ' + result_s, show_alert: true });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD0D Шериф проверил \u2116' + nomer_ns + ': ' + result_s);
    }

    // ===== НОЧЬ: выбор цели Маньяка =====
    else if (data.startsWith('noch_vybor_manyak_')) {
        const kod = data.replace('noch_vybor_manyak_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_manyak = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Маньяк');
        const knopki_manyak = alive_manyak.map(i => [{ text: '\uD83C\uDFAF \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_manyak_' + kod + '_' + i.nomer }]);
        knopki_manyak.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83C\uDFAF *Маньяк: выбери жертву*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_manyak } });
    }

    // ===== НОЧЬ: Маньяк выбрал жертву =====
    else if (data.startsWith('noch_manyak_')) {
        const parts_nm = data.replace('noch_manyak_', '').split('_');
        const kod = parts_nm[0];
        const nomer_nm = parseInt(parts_nm[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.manyak_tseli = nomer_nm;
        const zhertva_nm = igra.igroki.find(i => i.nomer === nomer_nm);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFAF Цель: ' + (zhertva_nm?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83C\uDFAF Маньяк выбрал \u2116' + nomer_nm);
    }

    // ===== НОЧЬ: выбор цели Стрелка/Охотника =====
    else if (data.startsWith('noch_vybor_strelok_')) {
        const kod = data.replace('noch_vybor_strelok_', '');
        const igra = igry[kod];
        if (!igra) return;
        const strelok = igra.igroki.find(i => i.status === 'v_igre' && rolStrelyayushchegoZaMirnyh(i.rol));
        const alive_strelok = igra.igroki.filter(i => i.status === 'v_igre' && i.nomer !== strelok?.nomer);
        const knopki_strelok = alive_strelok.map(i => [{ text: '\uD83D\uDD2B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_strelok_' + kod + '_' + i.nomer }]);
        knopki_strelok.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD2B *Стрелок/Охотник: выбери цель*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_strelok } });
    }

    // ===== НОЧЬ: Стрелок/Охотник выбрал цель =====
    else if (data.startsWith('noch_strelok_')) {
        const parts_ns = data.replace('noch_strelok_', '').split('_');
        const kod = parts_ns[0];
        const nomer_ns = parseInt(parts_ns[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.strelok_tseli = nomer_ns;
        const zhertva_ns = igra.igroki.find(i => i.nomer === nomer_ns);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD2B Цель: ' + (zhertva_ns?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD2B Стрелок/Охотник выбрал \u2116' + nomer_ns);
    }

    // ===== НОЧЬ: выбор цели Эскортницы =====
    else if (data.startsWith('noch_vybor_eskort_')) {
        const kod = data.replace('noch_vybor_eskort_', '');
        const igra = igry[kod];
        if (!igra) return;
        const limit = limitVystrelovEskort(igra);
        const vybory = eskortVyboryNochi(igra);
        if (vybory.length >= limit) {
            bot.answerCallbackQuery(query.id, { text: 'Лимит выстрелов эскортницы на эту ночь исчерпан.', show_alert: true });
            return;
        }
        const eskort = igra.igroki.find(i => i.status === 'v_igre' && i.rol === 'Эскортница');
        const uzhe = new Set(vybory.map(v => v.nomer));
        const kandidaty = igra.igroki.filter(i => i.status === 'v_igre' && i.nomer !== eskort?.nomer && !uzhe.has(i.nomer));
        if (kandidaty.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Нет игроков для выбора.', show_alert: true });
            return;
        }
        const knopki_esk = kandidaty.map(i => [{ text: '\uD83D\uDC8B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_eskort_pick_' + kod + '_' + i.nomer }]);
        knopki_esk.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDC8B *Эскортница: выбери игрока*\n\nВыстрел ' + (vybory.length + 1) + ' из ' + limit,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_esk } }
        );
    }

    // ===== НОЧЬ: Эскортница выбрала игрока — угадываем роль =====
    else if (data.startsWith('noch_eskort_pick_')) {
        const parts_ep = data.replace('noch_eskort_pick_', '').split('_');
        const kod = parts_ep[0];
        const nomer_ep = parseInt(parts_ep[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_ep = igra.igroki.find(i => i.nomer === nomer_ep && i.status === 'v_igre');
        if (!tsel_ep) {
            bot.answerCallbackQuery(query.id, { text: 'Игрок уже не в игре.', show_alert: true });
            return;
        }
        const roli_esk = roliDlyaUgadivaniyaEskort();
        const knopki_rol = [];
        for (let idx = 0; idx < roli_esk.length; idx += 2) {
            const row = [{ text: roli_esk[idx], callback_data: 'noch_eskort_rol_' + kod + '_' + nomer_ep + '_' + idx }];
            if (roli_esk[idx + 1]) row.push({ text: roli_esk[idx + 1], callback_data: 'noch_eskort_rol_' + kod + '_' + nomer_ep + '_' + (idx + 1) });
            knopki_rol.push(row);
        }
        knopki_rol.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_vybor_eskort_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDC8B *Эскортница называет роль*\n\nИгрок: \u2116' + nomer_ep + ' *' + tsel_ep.name + '*\nКакую роль назвала?',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_rol } }
        );
    }

    // ===== НОЧЬ: Эскортница назвала роль =====
    else if (data.startsWith('noch_eskort_rol_')) {
        const parts_er = data.replace('noch_eskort_rol_', '').split('_');
        const kod = parts_er[0];
        const nomer_er = parseInt(parts_er[1]);
        const idx_er = parseInt(parts_er[2]);
        const igra = igry[kod];
        if (!igra) return;
        const roli_esk = roliDlyaUgadivaniyaEskort();
        const ugadannaya = roli_esk[idx_er];
        if (!ugadannaya) {
            bot.answerCallbackQuery(query.id, { text: 'Роль не найдена.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        if (!Array.isArray(igra.noch_deystviya.eskort_vybory)) igra.noch_deystviya.eskort_vybory = [];
        igra.noch_deystviya.eskort_vybory.push({ nomer: nomer_er, ugadannaya_rol: ugadannaya });
        bot.answerCallbackQuery(query.id, { text: '\u2116' + nomer_er + ': ' + ugadannaya });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC8B Эскортница: \u2116' + nomer_er + ' \u2192 *' + ugadannaya + '*');
    }


    // ===== НОЧЬ: выбор цели Затычки =====
    else if (data.startsWith('noch_vybor_zat_')) {
        const kod = data.replace('noch_vybor_zat_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_zat = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Затычка');
        const knopki_zat = alive_zat.map(i => [{ text: '\uD83D\uDD07 \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_zat_' + kod + '_' + i.nomer }]);
        knopki_zat.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD07 *Затычка: кого заблокировать?*\n\n_Игрок лишится речи и права голосовать_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_zat }
        });
    }

    // ===== НОЧЬ: Затычка выбрала цель =====
    else if (data.startsWith('noch_zat_')) {
        const parts_nz = data.replace('noch_zat_', '').split('_');
        const kod = parts_nz[0];
        const nomer_nz = parseInt(parts_nz[1]);
        const igra = igry[kod];
        if (!igra) return;

        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.zatychka_tseli = nomer_nz;

        // Запоминаем заблокированного для следующего дня
        igra.zablokirovan_nomer = nomer_nz;

        const tseli_nz = igra.igroki.find(i => i.nomer === nomer_nz);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD07 ' + (tseli_nz?.name || '') + ' заблокирован' });

        // Уведомляем заблокированного
        if (tseli_nz?.telegram_id) {
            bot.sendMessage(tseli_nz.telegram_id,
                '\uD83D\uDD07 *Затычка заблокировала тебя этой ночью.*\n\nЗавтра ты не сможешь говорить на своей минуте и голосовать.\nНо тебя всё ещё могут выставить на голосование.',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD07 Затычка заблокировала \u2116' + nomer_nz);
    }

    // ===== НОЧЬ: Шахид минирует / переминирует =====
    else if (data.startsWith('noch_vybor_shahid_')) {
        const kod = data.replace('noch_vybor_shahid_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (!(igra.den === 1 || igra.den === 2)) {
            bot.answerCallbackQuery(query.id, { text: 'Шахид минирует только в Н1 и Н2.', show_alert: true });
            return;
        }

        igra.noch_deystviya = igra.noch_deystviya || {};
        const vybrany = igra.noch_deystviya.shahid_miny_tseli || (igra.den === 2 ? [...(igra.shahid_miny || [])] : []);
        igra.noch_deystviya.shahid_miny_tseli = vybrany;
        const limit = limitMinShahida(igra);
        const alive_sh = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Шахид');
        const knopki_sh = alive_sh.map(i => [{
            text: (vybrany.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'noch_shahid_toggle_' + kod + '_' + i.nomer
        }]);
        knopki_sh.push([{ text: '\u2705 Готово (' + vybrany.length + '/' + limit + ')', callback_data: 'noch_panel_' + kod }]);
        knopki_sh.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDCA3 *Шахид: ' + (igra.den === 1 ? 'минирование' : 'переминирование') + '*\n\n' +
            'Выбери до *' + limit + '* игроков — 30% стола.\n' +
            'Сейчас выбрано: *' + vybrany.length + '/' + limit + '*',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sh } }
        );
    }

    else if (data.startsWith('noch_shahid_toggle_')) {
        const parts_sh = data.replace('noch_shahid_toggle_', '').split('_');
        const kod = parts_sh[0];
        const nomer_sh = parseInt(parts_sh[1]);
        const igra = igry[kod];
        if (!igra) return;

        igra.noch_deystviya = igra.noch_deystviya || {};
        const limit = limitMinShahida(igra);
        const vybrany = igra.noch_deystviya.shahid_miny_tseli || (igra.den === 2 ? [...(igra.shahid_miny || [])] : []);
        const idx = vybrany.indexOf(nomer_sh);
        if (idx >= 0) {
            vybrany.splice(idx, 1);
            bot.answerCallbackQuery(query.id, { text: 'Снято' });
        } else {
            if (vybrany.length >= limit) {
                bot.answerCallbackQuery(query.id, { text: 'Можно выбрать максимум ' + limit, show_alert: true });
                return;
            }
            vybrany.push(nomer_sh);
            bot.answerCallbackQuery(query.id, { text: 'Заминирован №' + nomer_sh });
        }
        igra.noch_deystviya.shahid_miny_tseli = vybrany;
        await sohranit_igru(kod);

        const alive_sh = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Шахид');
        const knopki_sh = alive_sh.map(i => [{
            text: (vybrany.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'noch_shahid_toggle_' + kod + '_' + i.nomer
        }]);
        knopki_sh.push([{ text: '\u2705 Готово (' + vybrany.length + '/' + limit + ')', callback_data: 'noch_panel_' + kod }]);
        knopki_sh.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDCA3 *Шахид: ' + (igra.den === 1 ? 'минирование' : 'переминирование') + '*\n\n' +
            'Выбери до *' + limit + '* игроков — 30% стола.\n' +
            'Сейчас выбрано: *' + vybrany.length + '/' + limit + '*',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sh } }
        );
    }

    // ===== НОЧЬ: итоги =====
    else if (data.startsWith('noch_itog_')) {
        const kod = data.replace('noch_itog_', '');
        const igra = igry[kod];
        if (!igra) return;
        const d = igra.noch_deystviya || {};
        const maf_t = d.mafiya_tseli || [];
        const doc_t = d.doctor_tseli;
        const ubityPodryvnik = maf_t
            .map(nomer => igra.igroki.find(x => x.nomer === nomer))
            .find(i => i && i.rol === 'Подрывник' && doc_t !== i.nomer);
        if (ubityPodryvnik && !d.podryvnik_zabiraet) {
            const kandidatyPodryvnika = igra.igroki.filter(x => x.status === 'v_igre');
            if (kandidatyPodryvnika.length > 0) {
                const knopki_podryv = kandidatyPodryvnika.map(i => [{
                    text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name + ' — ' + i.rol,
                    callback_data: 'noch_podryv_' + kod + '_' + i.nomer
                }]);
                knopki_podryv.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
                bot.editMessageText(
                    '\uD83D\uDCA5 *Подрывника убила мафия!*\n\n' +
                    '\u2116' + ubityPodryvnik.nomer + ' *' + ubityPodryvnik.name + '* выбирает, кого забрать с собой:',
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: knopki_podryv }
                    }
                );
                return;
            }
        }
        let itog_t = '\uD83C\uDF19 *Итоги ночи ' + (igra.den || 1) + ':*\n\n';
        if (d.don_tseli) {
            const proverka_don = igra.igroki.find(x => x.nomer === d.don_tseli);
            const don = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Дон');
            if ((igra.den || 1) === 1 && don && proverka_don && isSheriffRole(proverka_don.rol)) {
                dobavitAvtoBonus(igra, don.nomer, 'bonus_don_nashel_sherifa_n1', BALLY_DEFAULT.bonus_don_nashel_sherifa_n1, 'Дон нашёл Шерифа/Комиссара в первую ночь', { tsel: d.don_tseli });
            }
            itog_t += '\uD83D\uDD0E Дон проверил \u2116' + d.don_tseli + ': ' + (proverka_don && isSheriffRole(proverka_don.rol) ? 'Шериф/Комиссар' : 'не Шериф') + '\n';
        }
        if (d.sherif_tseli) {
            const proverka_sher = igra.igroki.find(x => x.nomer === d.sherif_tseli);
            const sherif = igra.igroki.find(x => x.status === 'v_igre' && isSheriffRole(x.rol));
            if (sherif && proverka_sher && isMafiaRole(proverka_sher.rol)) {
                dobavitAvtoBonus(igra, sherif.nomer, 'bonus_sheriff_nashel_maf', BALLY_DEFAULT.bonus_sheriff_nashel_maf, 'Шериф/Комиссар нашёл мафию', { tsel: d.sherif_tseli });
            }
            itog_t += '\uD83D\uDD0D Шериф проверил \u2116' + d.sherif_tseli + ': ' + (proverka_sher && isMafiaRole(proverka_sher.rol) ? 'Мафия' : 'мирный') + '\n';
        }
        if (d.kons_tseli) {
            const zaverbovan = igra.igroki.find(x => x.nomer === d.kons_tseli && x.status === 'v_igre' && x.rol === 'Мирный');
            if (zaverbovan) {
                zaverbovan.rol = 'Мафия';
                itog_t += '\uD83E\uDD1D Консильери завербовал \u2116' + d.kons_tseli + ' *' + zaverbovan.name + '* в мафию\n';
                if (zaverbovan.telegram_id) {
                    bot.sendMessage(zaverbovan.telegram_id,
                        '\uD83D\uDD34 *Тебя завербовала мафия.*\n\nТеперь ты играешь за команду мафии.',
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }
            }
        }
        if (d.shahid_miny_tseli) {
            igra.shahid_miny = [...d.shahid_miny_tseli];
            itog_t += '\uD83D\uDCA3 Шахид ' + ((igra.den || 1) === 1 ? 'заминировал' : 'переминировал') + ': ' + igra.shahid_miny.map(n => '\u2116' + n).join(', ') + '\n';
        }
        const vystrely = primenitNochnyeVystrely(igra, d);
        vystrely.lines.forEach(line => { itog_t += line; });
        const ubity_t = vystrely.ubity_t;
        const eskortVybory = d.eskort_vybory || [];
        const eskortNoch = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Эскортница');
        eskortVybory.forEach(v => {
            const tselEsk = igra.igroki.find(x => x.nomer === v.nomer);
            if (!tselEsk || tselEsk.status !== 'v_igre') {
                itog_t += '\uD83D\uDC8B Эскортница: \u2116' + v.nomer + ' \u2192 ' + v.ugadannaya_rol + ' (игрок уже не за столом)\n';
                return;
            }
            if (sravnitRoliEskort(v.ugadannaya_rol, tselEsk.rol)) {
                tselEsk.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, tselEsk);
                if (eskortNoch) {
                    dobavitAvtoBonus(igra, eskortNoch.nomer, 'bonus_eskort_ugadala_rol', BALLY_DEFAULT.bonus_eskort_ugadala_rol, 'Эскортница угадала роль игрока', { tsel: tselEsk.nomer, rol: tselEsk.rol });
                }
                itog_t += '\uD83D\uDC8B Эскортница угадала: \u2116' + tselEsk.nomer + ' *' + tselEsk.name + '* — ' + tselEsk.rol + '. Не пережил утро.\n';
                itog_t += primenitSmertShahida(igra, tselEsk, 'noch', ubity_t);
            } else {
                itog_t += '\uD83D\uDC8B Эскортница промахнулась: \u2116' + tselEsk.nomer + ' *' + tselEsk.name + '* не ' + v.ugadannaya_rol + '\n';
            }
        });
        const v_igre_t = igra.igroki.filter(i => i.status === 'v_igre');
        itog_t += '\n\uD83D\uDC65 *За столом: ' + v_igre_t.length + '*\n';
        v_igre_t.forEach(i => { itog_t += '\u2705 \u2116' + i.nomer + ' ' + i.name + '\n'; });
        ubity_t.forEach(i => { bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Тебя убили ночью.*\n\nТвоя роль: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {}); });
        zapisatIstoriyuDoktora(igra, doc_t);
        igra.noch_deystviya = {};
        const kandidatLuchshegoHoda = (igra.den || 1) === 1 ? ubity_t.find(mozhetBytLuchshiyHod) : null;
        if (kandidatLuchshegoHoda) {
            await sohranit_igru(kod);
            await bot.editMessageText(itog_t + '\n\n\uD83D\uDDE3 Последнее слово: можно зафиксировать лучший ход.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\uD83C\uDFC6 Лучший ход \u2116' + kandidatLuchshegoHoda.nomer, callback_data: 'lh_start_' + kod + '_' + kandidatLuchshegoHoda.nomer + '_night1_day' }],
                    [{ text: '\u23ED\uFE0F Без лучшего хода', callback_data: 'lh_skip_' + kod + '_' + kandidatLuchshegoHoda.nomer + '_night1_day' }]
                ] }
            });
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.den = (igra.den || 1) + 1;
        await sohranit_igru(kod);
        bot.editMessageText(itog_t + '\n\n_Сначала выберешь, кто начинает дневные речи._', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }],
            [{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]
        ]}});
    }

    // ===== НОЧЬ: панель =====
    else if (data.startsWith('noch_panel_')) {
        const kod = data.replace('noch_panel_', '');
        const igra = igry[kod];
        if (!igra) return;
        await pokazat_noch_panel(chatId, messageId, kod, null);
    }

    // ===== ЛУЧШИЙ ХОД: фиксация на последнем слове =====
    else if (data.startsWith('lh_start_')) {
        const parts_lh = data.replace('lh_start_', '').split('_');
        const kod = parts_lh[0];
        const nomer_lh = parseInt(parts_lh[1]);
        const source_lh = parts_lh[2];
        const next_lh = parts_lh[3];
        const igra = igry[kod];
        if (!igra) return;
        const igrok_lh = igra.igroki.find(i => i.nomer === nomer_lh);
        if (!mozhetBytLuchshiyHod(igrok_lh)) {
            bot.answerCallbackQuery(query.id, { text: 'Лучший ход доступен только мирному игроку.', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFC6 Лучший ход' });
        await pokazatLuchshiyHod(chatId, messageId, kod, nomer_lh, source_lh, next_lh);
    }

    else if (data.startsWith('lh_toggle_')) {
        const parts_lht = data.replace('lh_toggle_', '').split('_');
        const kod = parts_lht[0];
        const nomer_lh = parseInt(parts_lht[1]);
        const tsel_lh = parseInt(parts_lht[2]);
        const source_lh = parts_lht[3];
        const next_lh = parts_lht[4];
        const igra = igry[kod];
        if (!igra) return;
        const hod = poluchitLuchshiyHod(igra, nomer_lh, source_lh);
        const idx = hod.nazvannye.indexOf(tsel_lh);
        if (idx >= 0) {
            hod.nazvannye.splice(idx, 1);
            bot.answerCallbackQuery(query.id, { text: 'Снято' });
        } else {
            hod.nazvannye.push(tsel_lh);
            bot.answerCallbackQuery(query.id, { text: 'Добавлено №' + tsel_lh });
        }
        await sohranit_igru(kod);
        await pokazatLuchshiyHod(chatId, messageId, kod, nomer_lh, source_lh, next_lh);
    }

    else if (data.startsWith('lh_done_')) {
        const parts_lhd = data.replace('lh_done_', '').split('_');
        const kod = parts_lhd[0];
        const nomer_lh = parseInt(parts_lhd[1]);
        const source_lh = parts_lhd[2];
        const next_lh = parts_lhd[3];
        const igra = igry[kod];
        if (!igra) return;
        poluchitLuchshiyHod(igra, nomer_lh, source_lh);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFC6 Лучший ход сохранён' });
        await prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next_lh);
    }

    else if (data.startsWith('lh_skip_')) {
        const parts_lhs = data.replace('lh_skip_', '').split('_');
        const kod = parts_lhs[0];
        const nomer_lh = parseInt(parts_lhs[1]);
        const source_lh = parts_lhs[2];
        const next_lh = parts_lhs[3];
        const igra = igry[kod];
        if (!igra) return;
        igra.luchshie_hody = (igra.luchshie_hody || []).filter(h => !(h.igrok_nomer === nomer_lh && h.source === source_lh));
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Без лучшего хода' });
        await prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next_lh);
    }

    // ===== НОЧЬ: Подрывник выбрал кого забрать =====
    else if (data.startsWith('noch_podryv_')) {
        const parts_np = data.replace('noch_podryv_', '').split('_');
        const kod = parts_np[0];
        const nomer_np = parseInt(parts_np[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_np = igra.igroki.find(i => i.nomer === nomer_np && i.status === 'v_igre');
        if (!tsel_np) {
            bot.answerCallbackQuery(query.id, { text: 'Можно выбрать только живого игрока.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.podryvnik_zabiraet = nomer_np;
        bot.answerCallbackQuery(query.id, { text: 'Подрывник заберёт ' + tsel_np.name });
        await sohranit_igru(kod);
        bot.editMessageText(
            '\uD83D\uDCA5 Подрывник выбрал \u2116' + nomer_np + ' *' + tsel_np.name + '*.\n\nТеперь можно показать итоги ночи.',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF1F Итоги ночи', callback_data: 'noch_itog_' + kod }]] }
            }
        );
    }


    // ===== РЕЙТИНГ: выбор клуба =====
    else if (data === 'reyting_vybor_kluba') {
        const { data: igrok_r } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_r } = await supabase.from('chleny_klubov').select('klub_id, rol, kluby(id, nazvaniye)').eq('igrok_id', igrok_r?.id).in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);
        const kluby_r = (chleny_r || []).filter(c => c.kluby).map(c => c.kluby);
        if (kluby_r.length === 0) { bot.editMessageText('\u274C Нет клубов', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]] } }); return; }
        if (kluby_r.length === 1) { await pokazat_reyting_kluba(chatId, messageId, kluby_r[0].id, false); return; }
        const knopki_r = kluby_r.map(k => [{ text: '\uD83C\uDFC6 ' + k.nazvaniye, callback_data: 'reyting_klub_' + k.id + '_0' }]);
        knopki_r.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('\uD83C\uDFC6 *Рейтинг*\n\nВыбери клуб:', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_r } });
    }

    else if (data.startsWith('reyting_klub_')) {
        const parts_rk = data.replace('reyting_klub_', '').split('_');
        const klub_id_rk = parts_rk[0];
        const sport_rk = parts_rk[1] === '1';
        await pokazat_reyting_kluba(chatId, messageId, klub_id_rk, sport_rk);
    }

    // ===== РЕЙТИНГ: скачать CSV =====
    else if (data.startsWith('reyting_csv_')) {
        const parts_csv = data.replace('reyting_csv_', '').split('_');
        const klub_id_csv = parts_csv[0];
        const sport_csv = parts_csv[1] === '1';

        const { data: klub_csv } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id_csv).single();
        const { data: rows_csv } = await supabase.from('bally').select('igrok_id, rol, pobedila_komanda, vyzhil, bally_komanda, bally_lichnie, bally_vsego, data_igry, igroki(imya, igrovoy_nik)').eq('klub_id', klub_id_csv).eq('sportivniy', sport_csv).order('data_igry', { ascending: false });

        let csv = 'Имя,Ник,Роль,Победа,Выжил,Баллы команды,Личные баллы,Итого,Дата\n';
        (rows_csv || []).forEach(r => {
            const name = r.igroki?.imya || '';
            const nik = r.igroki?.igrovoy_nik || '';
            const date = r.data_igry ? r.data_igry.slice(0, 10) : '';
            csv += [name, nik, r.rol, r.pobedila_komanda ? 'Да' : 'Нет', r.vyzhil ? 'Да' : 'Нет', r.bally_komanda, r.bally_lichnie, r.bally_vsego, date].join(',') + '\n';
        });

        // Сохраняем временный файл и отправляем
        const fs = require('fs');
        const path = require('path');
        const fname = '/tmp/rating_' + klub_id_csv + '_' + Date.now() + '.csv';
        fs.writeFileSync(fname, '\uFEFF' + csv, 'utf8'); // BOM для Excel
        await bot.sendDocument(chatId, fname, {}, { filename: (klub_csv?.nazvaniye || 'klub') + '_rating.csv', contentType: 'text/csv' });
        fs.unlinkSync(fname);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDCE5 CSV отправлен' });
    }

    // ===== НАСТРОЙКИ КЛУБА =====
    else if (data === 'nastroyki_kluba_v') {
        const { data: igrok_nk } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_nk } = await supabase.from('chleny_klubov').select('klub_id, kluby(id, nazvaniye, nastroyki, sportivniy_rezhim)').eq('igrok_id', igrok_nk?.id).eq('rol', 'vladyelets');
        const klub_nk = chleny_nk?.[0]?.kluby;
        if (!klub_nk) { bot.answerCallbackQuery(query.id, { text: '\u274C Нет клуба' }); return; }

        const sport = klub_nk.sportivniy_rezhim;
        const n = klub_nk.nastroyki || {};
        let t = '\u2699\uFE0F *Настройки клуба — ' + klub_nk.nazvaniye + '*\n\n';
        t += '\uD83C\uDFC6 Спортивный режим: ' + (sport ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t += '\uD83D\uDC4B Знакомство: ' + (n.znakomstvo_sek || 10) + ' сек\n';
        t += '\u26A0\uFE0F Оправдание: ' + (n.opravdanie_sek || 30) + ' сек\n';
        t += '\uD83D\uDD34 Макс. фолов: ' + (n.max_foly || 4) + '\n';
        const tipPrav = n.tip_kluba || 'paskal';
        t += '\uD83D\uDCDC Правила: *' + (tipPrav === 'vip' ? 'VIP' : tipPrav === 'sportivniy' ? 'Спортивный' : 'Pascal') + '*\n';
        t += '\uD83D\uDC89 Доктор: ' + tekstPravilDoktora({ tip_kluba: tipPrav, _nastroyki: n }) + '\n\n';
        t += '*Баллы:*\n';
        const b = n.bally || BALLY_DEFAULT;
        t += '\uD83D\uDFE2 Победа команды: +' + (b.pobeda_komanda ?? 3) + '\n';
        t += '\uD83D\uDFE1 Выжил: +' + (b.vyzhil ?? 1) + '\n';
        t += '\uD83D\uDD34 Дон победил: +' + (b.bonus_don_pobedil ?? 2) + '\n';
        t += '\uD83C\uDFAF Маньяк победил: +' + (b.bonus_manyak_pobedil ?? 5) + '\n';

        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_nk.id }],
            [{ text: tipPrav === 'vip' ? '\uD83D\uDCCB Переключить на Pascal' : '\uD83D\uDCCB Переключить на VIP', callback_data: 'toggle_tip_kluba_' + klub_nk.id }],
            [{ text: '\uD83C\uDFA8 Стилизация клуба — 5000₽ навсегда', callback_data: 'stil_klub_' + klub_nk.id }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_nk.id }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_nk.id }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    else if (data.startsWith('stil_klub_')) {
        const klub_id_st = data.replace('stil_klub_', '');
        const { data: klub_st } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('id', klub_id_st)
            .single();
        bot.editMessageText(tekstStilizatsiiKluba(klub_st?.nazvaniye || 'клуб'), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDCAC Хочу подключить', callback_data: 'stil_zayavka_' + klub_id_st }],
                [{ text: '\u2B05\uFE0F В настройки клуба', callback_data: 'nastroyki_kluba_v' }]
            ] }
        });
    }

    else if (data.startsWith('stil_zayavka_')) {
        const klub_id_sz = data.replace('stil_zayavka_', '');
        const { data: klub_sz } = await supabase
            .from('kluby')
            .select('nazvaniye')
            .eq('id', klub_id_sz)
            .single();
        bot.answerCallbackQuery(query.id, { text: 'Заявка отправлена', show_alert: true });
        if (ADMIN_TG_ID) {
            bot.sendMessage(ADMIN_TG_ID,
                '🎨 *Заявка на стилизацию клуба*\n\n' +
                'Клуб: *' + (klub_sz?.nazvaniye || klub_id_sz) + '*\n' +
                'TG ведущего/собственника: `' + telegram_id + '`\n' +
                'Стоимость: 5000₽ навсегда',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.editMessageText(
            '✅ *Заявка принята!*\n\n' +
            'Мы свяжемся с тобой и согласуем цвета, стиль и детали интерфейса клуба.\n\n' +
            'Стоимость стилизации: *5000₽ один раз, навсегда*.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\uD83D\uDCAC Написать в поддержку', callback_data: 'podderzhka' }],
                    [{ text: '\u2699\uFE0F Настройки клуба', callback_data: 'nastroyki_kluba_v' }]
                ] }
            }
        );
    }

    else if (data.startsWith('tarif_klub_')) {
        const klub_id_tar = data.replace('tarif_klub_', '');
        const { data: klub_tar } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('id', klub_id_tar)
            .single();
        bot.editMessageText(tekstTestovoyNedeli(klub_tar?.nazvaniye || 'клуб'), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + klub_id_tar }],
                [{ text: '🎨 Стилизация клуба — 5000₽', callback_data: 'stil_klub_' + klub_id_tar }],
                [{ text: '⬅️ В настройки клуба', callback_data: 'nastroyki_kluba_v' }]
            ] }
        });
    }

    else if (data.startsWith('tarif_zayavka_')) {
        const klub_id_tz = data.replace('tarif_zayavka_', '');
        const { data: klub_tz } = await supabase
            .from('kluby')
            .select('nazvaniye')
            .eq('id', klub_id_tz)
            .single();
        bot.answerCallbackQuery(query.id, { text: 'Заявка отправлена', show_alert: true });
        if (ADMIN_TG_ID) {
            bot.sendMessage(ADMIN_TG_ID,
                '💳 *Заявка на тариф клуба*\n\n' +
                'Клуб: *' + md(klub_tz?.nazvaniye || klub_id_tz) + '*\n' +
                'TG ведущего/собственника: `' + telegram_id + '`\n\n' +
                'Интерес: тариф после тестовой недели / 3 месяца / годовая подписка.',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.editMessageText(
            '✅ *Заявка на подключение тарифа принята!*\n\n' +
            'Мы свяжемся с тобой и подберём формат: разовые игры, пакет 12 игр, подписка на 3 месяца или год.\n\n' +
            'Для 3 месяцев действует скидка, для года — максимальная скидка.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🎁 О тестовой неделе', callback_data: 'tarif_klub_' + klub_id_tz }],
                    [{ text: '⚙️ Настройки клуба', callback_data: 'nastroyki_kluba_v' }]
                ] }
            }
        );
    }

    // ===== TOGGLE ТИП ПРАВИЛ КЛУБА (Pascal / VIP) =====
    else if (data.startsWith('toggle_tip_kluba_')) {
        const klub_id_tt = data.replace('toggle_tip_kluba_', '');
        const { data: k_tt } = await supabase.from('kluby').select('nastroyki, nazvaniye, sportivniy_rezhim').eq('id', klub_id_tt).single();
        const nastroyki_tt = k_tt?.nastroyki || {};
        const new_tip = (nastroyki_tt.tip_kluba || 'paskal') === 'vip' ? 'paskal' : 'vip';
        await supabase.from('kluby').update({ nastroyki: { ...nastroyki_tt, tip_kluba: new_tip } }).eq('id', klub_id_tt);
        bot.answerCallbackQuery(query.id, { text: new_tip === 'vip' ? 'Правила VIP' : 'Правила Pascal', show_alert: true });
        const sport_tt = k_tt?.sportivniy_rezhim;
        const b = nastroyki_tt.bally || BALLY_DEFAULT;
        let t_tt = '\u2699\uFE0F *Настройки клуба — ' + k_tt.nazvaniye + '*\n\n';
        t_tt += '\uD83C\uDFC6 Спортивный режим: ' + (sport_tt ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t_tt += '\uD83D\uDC4B Знакомство: ' + (nastroyki_tt.znakomstvo_sek || 10) + ' сек\n';
        t_tt += '\u26A0\uFE0F Оправдание: ' + (nastroyki_tt.opravdanie_sek || 30) + ' сек\n';
        t_tt += '\uD83D\uDD34 Макс. фолов: ' + (nastroyki_tt.max_foly || 4) + '\n';
        t_tt += '\uD83D\uDCDC Правила: *' + (new_tip === 'vip' ? 'VIP' : 'Pascal') + '*\n';
        t_tt += '\uD83D\uDC89 Доктор: ' + tekstPravilDoktora({ tip_kluba: new_tip, _nastroyki: nastroyki_tt }) + '\n\n';
        t_tt += '*Баллы:*\n';
        t_tt += '\uD83D\uDFE2 Победа команды: +' + (b.pobeda_komanda ?? 3) + '\n';
        t_tt += '\uD83D\uDFE1 Выжил: +' + (b.vyzhil ?? 1) + '\n';
        bot.editMessageText(t_tt, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport_tt ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_id_tt }],
            [{ text: new_tip === 'vip' ? '\uD83D\uDCCB Переключить на Pascal' : '\uD83D\uDCCB Переключить на VIP', callback_data: 'toggle_tip_kluba_' + klub_id_tt }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_id_tt }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_id_tt }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    // ===== TOGGLE СПОРТИВНЫЙ РЕЖИМ =====
    else if (data.startsWith('toggle_sport_')) {
        const klub_id_ts = data.replace('toggle_sport_', '');
        const { data: k_ts } = await supabase.from('kluby').select('sportivniy_rezhim').eq('id', klub_id_ts).single();
        const new_val = !k_ts?.sportivniy_rezhim;
        await supabase.from('kluby').update({ sportivniy_rezhim: new_val }).eq('id', klub_id_ts);
        bot.answerCallbackQuery(query.id, { text: new_val ? '\uD83C\uDFC6 Спортивный режим включён!' : '\u274C Спортивный режим выключен', show_alert: true });
        // Обновляем настройки
        const fake_data = 'nastroyki_kluba_v';
        const fakeQuery = { ...query, data: fake_data };
        // Re-trigger
        const { data: igrok_ts } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_ts } = await supabase.from('chleny_klubov').select('klub_id, kluby(id, nazvaniye, nastroyki, sportivniy_rezhim)').eq('igrok_id', igrok_ts?.id).eq('rol', 'vladyelets');
        const klub_ts = chleny_ts?.[0]?.kluby;
        if (!klub_ts) return;
        const sport_ts = klub_ts.sportivniy_rezhim;
        const n_ts = klub_ts.nastroyki || {};
        let t_ts = '\u2699\uFE0F *Настройки клуба — ' + klub_ts.nazvaniye + '*\n\n';
        t_ts += '\uD83C\uDFC6 Спортивный режим: ' + (sport_ts ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t_ts += '\uD83D\uDC4B Знакомство: ' + (n_ts.znakomstvo_sek || 10) + ' сек\n';
        t_ts += '\u26A0\uFE0F Оправдание: ' + (n_ts.opravdanie_sek || 30) + ' сек\n';
        t_ts += '\uD83D\uDD34 Макс. фолов: ' + (n_ts.max_foly || 4) + '\n';
        bot.editMessageText(t_ts, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport_ts ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_ts.id }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_ts.id }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_ts.id }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    // ===== ИЗМЕНИТЬ БАЛЛЫ =====
    else if (data.startsWith('edit_bally_')) {
        const klub_id_eb = data.replace('edit_bally_', '');
        sostoyanie[telegram_id] = 'edit_bally_json_' + klub_id_eb;
        bot.editMessageText(
            '\uD83C\uDFC6 *Настройка баллов*\n\nОтправь JSON с настройками, например:\n\n`{"pobeda_komanda":3,"vyzhil":1,"bonus_don_pobedil":2,"bonus_manyak_pobedil":4}`\n\n_Можно указать только те поля что хочешь изменить._',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Отмена', callback_data: 'nastroyki_kluba_v' }]] } }
        );
    }

    // ===== РЕЙТИНГ ИГРОКА =====
    else if (data === 'moy_reyting') {
        const { data: igrok_mr } = await supabase.from('igroki').select('id, imya, igrovoy_nik').eq('tg_id', telegram_id).single();
        if (!igrok_mr) { bot.answerCallbackQuery(query.id, { text: '\u274C Зарегистрируйся сначала' }); return; }

        const { data: rows_mr } = await supabase.from('bally').select('bally_vsego, rol, pobedila_komanda, klub_id, kluby(nazvaniye)').eq('igrok_id', igrok_mr.id).order('data_igry', { ascending: false }).limit(50);

        const vsego_igr = (rows_mr || []).length;
        const vsego_pts = (rows_mr || []).reduce((s, r) => s + r.bally_vsego, 0);
        const pobedy = (rows_mr || []).filter(r => r.pobedila_komanda).length;
        const klubyIgroka = [...new Set((rows_mr || []).map(r => r.klub_id).filter(Boolean))];

        let t_mr = '\uD83C\uDFC6 *Мой рейтинг*\n\n';
        t_mr += '\uD83D\uDC64 ' + (igrok_mr.igrovoy_nik || igrok_mr.imya) + '\n\n';
        t_mr += '\uD83C\uDFB2 Игр сыграно: *' + vsego_igr + '*\n';
        t_mr += '🎴 Клубов: *' + klubyIgroka.length + '*\n';
        t_mr += '\uD83C\uDFC6 Побед: *' + pobedy + '*\n';
        t_mr += '\u2B50 Очков всего: *' + vsego_pts + '*\n\n';

        // Последние 5 игр
        if (rows_mr && rows_mr.length > 0) {
            t_mr += '*Последние игры:*\n';
            rows_mr.slice(0, 5).forEach(r => {
                const em = r.pobedila_komanda ? '\u2705' : '\u274C';
                t_mr += em + ' ' + r.rol + ' — ' + r.bally_vsego + ' очк. (' + (r.kluby?.nazvaniye || '') + ')\n';
            });
        }

        bot.editMessageText(t_mr, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_igroka' }]] } });
    }


    // ===== ИГРОК: посмотреть свою команду (только мафия) =====
    else if (data.startsWith('moya_komanda_')) {
        const kod = data.replace('moya_komanda_', '');
        // Ищем игру — может быть активная или архив
        const igra = igry[kod] || igry['archive_' + kod];
        if (!igra) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Игра не найдена или уже завершена', show_alert: true });
            return;
        }

        // Проверяем что запрашивающий — мафия
        const igrok_req = igra.igroki.find(i => i.telegram_id === telegram_id);
        if (!igrok_req || !isMafiaRole(igrok_req.rol)) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Только команда мафии может это видеть', show_alert: true });
            return;
        }

        // Собираем всю мафию
        const komanda = igra.igroki.filter(i => isMafiaRole(i.rol));
        let t = '\uD83D\uDD34 *Твоя команда — Игра \u2116' + kod + '*\n\n';
        komanda.forEach(i => {
            const status = i.status === 'v_igre' ? '\u2705 в игре' : '\uD83D\uDC80 выбыл';
            t += '\u2116' + i.nomer + ' *' + i.name + '* — ' + i.rol + ' ' + status + '\n';
        });
        t += '\n\uD83E\uDD2B _Только для тебя!_';

        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, t, {
            parse_mode: 'Markdown',
            protect_content: true,
            reply_markup: { inline_keyboard: [[{ text: '\uD83D\uDC40 Обновить', callback_data: 'moya_komanda_' + kod }]] }
        });
    }


    // ===== РЕЖИМ "ИГРАТЬ С ДРУЗЬЯМИ" =====
    else if (data === 'druzya_menu') {
        bot.editMessageText(
            '\uD83C\uDFAE *Играть с друзьями*\n\n' +
            'Личная игра без клуба и без рейтинга: создаёшь код, друзья подключаются, бот раздаёт роли.\n\n' +
            '\uD83C\uDFC6 *Спортивная* — классика на 10 ролей\n' +
            '\uD83C\uDF06 *Городская* — любительская игра на 8–20 ролей\n\n' +
            '\uD83D\uDCB0 *Стоимость: 99 ₽ за игру*\n' +
            '_Оплата — при создании игры_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFB2 Создать игру (99 ₽)', callback_data: 'druzya_sozdat' }],
                [{ text: '\uD83D\uDD11 Войти по коду', callback_data: 'druzya_voiti' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_igroka' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: выбор правил =====
    else if (data === 'druzya_sozdat') {
        bot.editMessageText(
            '\uD83C\uDFB2 *Создать игру с друзьями*\n\nВыбери формат игры:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFC6 Спортивная', callback_data: 'druzya_tip_sportivniy' }],
                [{ text: '\uD83C\uDF06 Городская', callback_data: 'druzya_tip_gorodskaya' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: выбор количества =====
    else if (data.startsWith('druzya_tip_')) {
        const tip_d = data.replace('druzya_tip_', '');
        const tip_names_d = { gorodskaya: 'Городская', sportivniy: 'Спортивная' };
        const vse_kol = tip_d === 'sportivniy' ? [10] : [8,9,10,11,12,13,14,15,16,17,18,19,20];
        const rows_d = [];
        for (let i = 0; i < vse_kol.length; i += 4) {
            rows_d.push(vse_kol.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'druzya_kol_' + tip_d + '_' + n })));
        }
        rows_d.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_sozdat' }]);

        bot.editMessageText(
            '\uD83C\uDFB2 *' + (tip_names_d[tip_d] || tip_d) + '*\n\nВыбери количество ролей:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows_d }
        });
    }

    // ===== ДРУЗЬЯ: предпросмотр и "оплата" =====
    else if (data.startsWith('druzya_kol_')) {
        const parts_dk = data.replace('druzya_kol_', '').split('_');
        const tip_dk = parts_dk[0];
        const kol_dk = parseInt(parts_dk[1]);
        const sostav_tip_dk = tip_dk === 'sportivniy' ? 'sportivniy' : 'paskal';

        const preview_dk = pokazat_sostav_preview(kol_dk, sostav_tip_dk, {});
        if (!preview_dk) { bot.answerCallbackQuery(query.id, { text: '\u274C Нет состава', show_alert: true }); return; }

        bot.editMessageText(
            preview_dk.text + '\n\n' +
            '\uD83D\uDCB0 *Стоимость: 99 ₽*\n' +
            '_Нажми "Оплатить и создать" для запуска_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDCB3 Оплатить и создать (99 ₽)', callback_data: 'druzya_oplata_' + tip_dk + '_' + kol_dk }],
                [{ text: '\u270F\uFE0F Изменить количество ролей', callback_data: 'druzya_tip_' + tip_dk }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_tip_' + tip_dk }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: "оплата" (заглушка) → создать игру =====
    else if (data.startsWith('druzya_oplata_')) {
        const parts_op = data.replace('druzya_oplata_', '').split('_');
        const tip_op = parts_op[0];
        const kol_op = parseInt(parts_op[1]);
        const sostav_tip_op = tip_op === 'sportivniy' ? 'sportivniy' : 'paskal';

        // ЗАГЛУШКА ОПЛАТЫ — в будущем подключить ЮKassa/Telegram Stars
        // Пока создаём игру бесплатно для тестирования
        const kod = sgenerirovat_kod();
        const preview_op = pokazat_sostav_preview(kol_op, sostav_tip_op, {});

        igry[kod] = {
            kolichestvo: kol_op,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            klub_id: null,
            tip_kluba: sostav_tip_op,
            sportivniy: tip_op === 'sportivniy',
            rezhim_rolei: 'bot',
            _sostav_custom: preview_op?.sostav,
            _druzya_rezhim: true, // режим "с друзьями" — без рейтинга
            _oplacheno: true
        };
        await sohranit_igru(kod);

        // Создаём ссылку для приглашения
        const bot_username = (await bot.getMe()).username;
        const invite_link = 'https://t.me/' + bot_username + '?start=join_' + kod;

        bot.editMessageText(
            '\uD83C\uDFAE *Игра создана!*\n\n' +
            '\uD83D\uDD11 Код игры: *' + kod + '*\n' +
            '\uD83D\uDC65 Мест: ' + kol_op + '\n\n' +
            '\uD83D\uDCE4 *Ссылка для друзей:*\n' + invite_link + '\n\n' +
            '_Отправь эту ссылку друзьям — они нажмут и сразу войдут в игру_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDC65 ' + igry[kod].igroki.length + '/' + kol_op + ' подключились', callback_data: 'status_' + kod }],
                [{ text: '\uD83C\uDFAD Раздать роли', callback_data: 'razdat_' + kod }],
                [{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }],
                [{ text: '\uD83C\uDFE0 В меню', callback_data: 'menu_igroka' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: войти по коду =====
    else if (data === 'druzya_voiti') {
        sostoyanie[telegram_id] = 'vvodit_kod_druzya';
        bot.editMessageText(
            '\uD83D\uDD11 *Войти в игру друга*\n\nВведи код игры:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]] }
        });
    }

    // ===== УПРАВЛЕНИЕ АКТИВНОЙ ИГРОЙ =====
    else if (data.startsWith('stop_igra_ok_')) {
        const kod = data.replace('stop_igra_ok_', '');
        const rez = await ostanovitIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, {
                text: rez.error === 'access' ? '❌ Нет доступа' : 'Игра не найдена',
                show_alert: true
            });
            return;
        }
        bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nМожно возобновить её позже из «Мои игры».', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '▶️ Возобновить', callback_data: 'resume_igra_' + kod }],
                [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('stop_igra_')) {
        const kod = data.replace('stop_igra_', '');
        if (!igry[kod]) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        bot.editMessageText('⏸ *Остановить игру №' + kod + '?*\n\nТаймер остановится, игра останется в «Мои игры», её можно будет возобновить.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, остановить', callback_data: 'stop_igra_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'panel_' + kod }]
            ]}
        });
    }

    else if (data.startsWith('resume_igra_')) {
        const kod = data.replace('resume_igra_', '');
        const rez = await vozobnovitIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Игра не найдена', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Игра возобновлена' });
        await otkrytIgruVedushchego(chatId, messageId, kod);
    }

    else if (data.startsWith('delete_igra_ok_')) {
        const kod = data.replace('delete_igra_ok_', '');
        const rez = await udalitAktivnuyuIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Не удалось удалить', show_alert: true });
            return;
        }
        bot.editMessageText('🗑 *Игра №' + kod + ' удалена.*\n\nОна удалена из активных игр и базы.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('delete_igra_')) {
        const kod = data.replace('delete_igra_', '');
        if (!igry[kod]) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        bot.editMessageText('🗑 *Удалить игру №' + kod + '?*\n\nЭто удалит игру полностью. Рейтинг не будет записан.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Да, удалить игру', callback_data: 'delete_igra_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'panel_' + kod }]
            ] }
        });
    }

    // ===== ВЕДУЩИЙ: отменить игру =====
    else if (data.startsWith('otmenit_')) {
        const kod = data.replace('otmenit_', '');
        const igra = igry[kod];

        if (igra) {
            for (const igrok of igra.igroki) {
                if (igrok.telegram_id) bot.sendMessage(igrok.telegram_id, '❌ Ведущий отменил игру №' + kod).catch(() => {});
            }
            delete igry[kod];
            await supabase.from('aktivnye_igry').delete().eq('kod', kod);
        }

        bot.editMessageText('❌ *Игра отменена.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] }
        });
    }

    // ===== ИГРОК: войти в игру =====
    else if (data === 'voiti_v_igru') {
        sostoyanie[telegram_id] = 'vvodit_kod';
        bot.editMessageText('🎮 *Введи код игры*\n\n_4 цифры от ведущего:_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_igroka' }]] }
        });
    }

    // ===== ПОДДЕРЖКА =====
    else if (data === 'podderzhka') {
        const text = '💬 *Поддержка*\n\n' +
                     'Если что-то не работает или есть идеи — пиши!\n\n' +
                     '*Контакты:*\n' +
                     '📧 Email: silena005@gmail.com\n' +
                     '💬 Telegram: @prime\\_mafia\\_sochi\n\n' +
                     '⏱ Отвечаем в течение 24 часов';

        bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]] }
        });
    }

    // ===== СОБСТВЕННИК: аналитика (заглушка) =====
    else if (data === 'analitika') {
        bot.editMessageText('📊 *Аналитика*\n\n_Раздел в разработке_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== СОБСТВЕННИК: база игроков =====
    else if (data === 'baza_igrokov') {
        // Находим клубы, где пользователь — собственник
        const { data: kluby } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('owner_tg_id', telegram_id);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('👥 *База игроков*\n\n❌ У вас нет клубов в собственности.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            // Один клуб — сразу к списку игроков
            await pokazat_bazu_igrokov(chatId, messageId, kluby[0].id, 0, '');
            return;
        }

        // Несколько клубов — выбор
        const knopki = kluby.map(k => [
            { text: '🎴 ' + k.nazvaniye, callback_data: cbBtn('bk_', { klub_id: k.id, page: 0 }) }
        ]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

        bot.editMessageText('👥 *База игроков*\n\nВыберите клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('bk_')) {
        const p = cbUnpack(data.replace('bk_', ''));
        if (!p) return;
        await pokazat_bazu_igrokov(chatId, messageId, p.klub_id, p.page || 0, '');
    }

    else if (data.startsWith('baza_klub_')) {
        const rest = data.replace('baza_klub_', '');
        const li = rest.lastIndexOf('_');
        const klub_id = rest.substring(0, li);
        const stranitsa = parseInt(rest.substring(li + 1), 10) || 0;
        const filtr = sostoyanie['baza_filtr_' + telegram_id] || '';
        await pokazat_bazu_igrokov(chatId, messageId, klub_id, stranitsa, filtr);
    }

    else if (data.startsWith('baza_poisk_')) {
        const klub_id = data.replace('baza_poisk_', '');
        sostoyanie[telegram_id] = 'baza_poisk_' + klub_id;
        bot.editMessageText('🔍 *Поиск игрока*\n\nВведите часть имени или никнейма:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '⬅️ Отмена', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }
            ]] }
        });
    }

    else if (data.startsWith('baza_sbros_')) {
        const klub_id = data.replace('baza_sbros_', '');
        delete sostoyanie['baza_filtr_' + telegram_id];
        await pokazat_bazu_igrokov(chatId, messageId, klub_id, 0, '');
    }

    else if (data === 'baza_noop') {
        // Кнопка-индикатор страницы — ничего не делаем
        return;
    }

    // ===== СОБСТВЕННИК: создать клуб (начинаем с выбора страны) =====
    else if (data === 'sozdat_klub') {
        await pokazat_vybor_strany(chatId, messageId);
    }

    // ===== ВЫБОР СТРАНЫ =====
    else if (data.startsWith('vstrana_')) {
        // Формат: vstrana_<код>_<страница>
        const ostatok = data.replace('vstrana_', '');
        const podstroka = ostatok.split('_');
        const kod_strany = podstroka[0];
        const stranitsa = parseInt(podstroka[1]) || 0;
        const kody = {
            'RU': 'Россия',
            'BY': 'Беларусь',
            'KZ': 'Казахстан',
            'UZ': 'Узбекистан',
            'KG': 'Кыргызстан',
            'AM': 'Армения',
            'GE': 'Грузия',
            'AZ': 'Азербайджан'
        };
        const strana = kody[kod_strany];
        if (!strana) {
            bot.editMessageText('❌ Неизвестная страна.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
            });
            return;
        }
        await pokazat_vybor_goroda(chatId, messageId, strana, stranitsa, kod_strany);
    }

    // ===== ВЫБОР ГОРОДА =====
    else if (data.startsWith('vgorod_')) {
        // Формат: vgorod_<gorod_id>
        const gorod_id = data.replace('vgorod_', '');
        ozhidanie_registracii[telegram_id] = { shag: 'sozdat_klub_nazvanie', gorod_id: gorod_id };
        bot.editMessageText('➕ *Создание клуба*\n\nГород выбран ✅\n\nТеперь введи название клуба:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== МОЕГО ГОРОДА НЕТ =====
    else if (data === 'goroda_net') {
        bot.editMessageText('ℹ️ *Моего города нет*\n\nНапиши нам в поддержку, и мы добавим твой город:\n\n📧 silena005@gmail.com\n💬 @prime\\_mafia\\_sochi', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
        });
    }

    // ===== СОБСТВЕННИК: карточка игрока =====
    else if (data.startsWith('ip_')) {
        const p = cbUnpack(data.replace('ip_', ''));
        if (!p) return;
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('igrok_')) {
        const chasti = data.replace('igrok_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    else if (data.startsWith('res_')) {
        const p = cbUnpack(data.replace('res_', ''));
        if (!p) return;
        try {
            await ustanovitResidentaKluba(p.klub_id, p.igrok_id, p.on);
            bot.answerCallbackQuery(query.id, { text: p.on ? 'Добавлен в резиденты' : 'Убран из резидентов' });
            await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
        } catch (e) {
            console.error('Ошибка резидента:', e);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка сохранения', show_alert: true });
        }
    }

    // ===== СОБСТВЕННИК: сделать ведущим =====
    else if (data.startsWith('vd_')) {
        const p = cbUnpack(data.replace('vd_', ''));
        if (!p) {
            bot.answerCallbackQuery(query.id, { text: 'Нажми /start и повтори', show_alert: true });
            return;
        }
        const rez = await naznachitVedushchegoVKlube(p.klub_id, p.igrok_id);
        if (!rez.ok) {
            const msg = rez.error === 'owner'
                ? '❌ Собственника нельзя понизить до ведущего'
                : '❌ ' + (rez.error || 'Ошибка назначения');
            bot.answerCallbackQuery(query.id, { text: msg, show_alert: true });
            return;
        }
        if (!rez.already) await uvedomitONaznacheniiVedushchego(p.igrok_id, p.klub_id);
        bot.answerCallbackQuery(query.id, { text: rez.already ? 'Уже ведущий' : '✅ Назначен ведущим' });
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('vedushii_')) {
        const chasti = data.replace('vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        const rez = await naznachitVedushchegoVKlube(klub_id, igrok_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'owner' ? '❌ Это собственник' : '❌ Ошибка', show_alert: true });
            return;
        }
        if (!rez.already) await uvedomitONaznacheniiVedushchego(igrok_id, klub_id);
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    // ===== СОБСТВЕННИК: снять роль ведущего =====
    else if (data.startsWith('sv_')) {
        const p = cbUnpack(data.replace('sv_', ''));
        if (!p) return;
        const { error } = await supabase.from('chleny_klubov').update({ rol: 'igrok' })
            .eq('klub_id', p.klub_id).eq('igrok_id', p.igrok_id);
        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('snyat_vedushii_')) {
        const chasti = data.replace('snyat_vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        const { error } = await supabase.from('chleny_klubov').update({ rol: 'igrok' })
            .eq('klub_id', klub_id).eq('igrok_id', igrok_id);
        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    // ===== АНОНС: выбор клуба =====
    else if (data === 'anons_vybor_kluba') {
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('📢 *Создать анонс*\n\n❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            sostoyanie[telegram_id] = 'anons_data_' + kluby[0].id;
            bot.editMessageText('📢 *Создание анонса*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\n📅 Введи дату игры:\n_Пример: 15 мая или 15.05.2026_', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'anons_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('📢 *Создать анонс*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('anons_klub_')) {
        const klub_id = data.replace('anons_klub_', '');
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'anons_data_' + klub_id;
        bot.editMessageText('📢 *Создание анонса*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\n📅 Введи дату игры:\n_Пример: 15 мая или 15.05.2026_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== АНОНС: пропустить комментарий =====
    else if (data === 'anons_skip_komment') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'anons_komment') return;
        dannye.kommentariy = '';
        delete ozhidanie_registracii[telegram_id];
        await sohranit_anons(chatId, telegram_id, dannye);
    }

    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО =====
    else if (data === 'naznachit_vedushchego') {
        console.log('[DEBUG] naznachit_vedushchego вызван, tg_id:', telegram_id);
        const kluby = await klubyVladeltsa(telegram_id);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            sostoyanie[telegram_id] = 'naznach_poisk_' + kluby[0].id;
            bot.editMessageText(
                '🎤 *Назначить ведущего*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\nВведи имя, @username или номер телефона игрока\n_или перешли его контакт из телефонной книги:_', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'naznachit_v_klube_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('🎤 *Назначить ведущего*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('naznachit_v_klube_')) {
        const klub_id = data.replace('naznachit_v_klube_', '');
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;
        bot.editMessageText(
            '🎤 *Назначить ведущего*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\nВведи имя, @username или номер телефона игрока\n_или перешли его контакт из телефонной книги:_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    else if (data.startsWith('ncfm_')) {
        const parsed = igrokIdIzNcfm(data);
        if (!parsed?.igrok_id) {
            bot.answerCallbackQuery(query.id, { text: 'Повтори поиск ведущего', show_alert: true });
            return;
        }
        const igrok_id = parsed.igrok_id;
        let klub_id = parsed.klub_id || klubIdIzSostoyaniyaNaznacha(telegram_id);
        if (!klub_id) {
            const resolved = await klubIdDlyaNaznacheniyaVedushchego(telegram_id, igrok_id);
            if (!resolved.klub_id) {
                bot.answerCallbackQuery(query.id, { text: 'Сначала выбери клуб', show_alert: true });
                return;
            }
            klub_id = resolved.klub_id;
        }

        const { data: igrok } = await supabase
            .from('igroki').select('imya, tg_username, telefon').eq('id', igrok_id).single();

        const { data: klub } = await supabase
            .from('kluby').select('nazvaniye').eq('id', klub_id).single();

        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;

        bot.editMessageText(
            '🎤 *Назначить ведущего?*\n\n' +
            '👤 *' + (igrok?.imya || '') + '*' +
            (igrok?.tg_username ? '\n@' + igrok.tg_username : '') +
            (igrok?.telefon ? '\n📱 ' + igrok.telefon : '') +
            '\n\nКлуб: *' + (klub?.nazvaniye || '') + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, назначить', callback_data: callbackNaznacheniyaVedushchego(igrok_id) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('naznach_podtverd_')) {
        const parts = data.replace('naznach_podtverd_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');

        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;

        const { data: igrok } = await supabase
            .from('igroki').select('imya, tg_username, telefon').eq('id', igrok_id).single();

        const { data: klub } = await supabase
            .from('kluby').select('nazvaniye').eq('id', klub_id).single();

        bot.editMessageText(
            '🎤 *Назначить ведущего?*\n\n' +
            '👤 *' + (igrok?.imya || '') + '*' +
            (igrok?.tg_username ? '\n@' + igrok.tg_username : '') +
            (igrok?.telefon ? '\n📱 ' + igrok.telefon : '') +
            '\n\nКлуб: *' + (klub?.nazvaniye || '') + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, назначить', callback_data: callbackNaznacheniyaVedushchego(igrok_id) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('nda_')) {
        const igrok_id = data.replace('nda_', '');
        if (!/^[0-9a-f-]{36}$/i.test(igrok_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Повтори поиск', show_alert: true });
            return;
        }
        const resolved = await klubIdDlyaNaznacheniyaVedushchego(telegram_id, igrok_id);
        if (!resolved.klub_id) {
            bot.answerCallbackQuery(query.id, {
                text: resolved.error === 'pick_club' ? 'Сначала выбери клуб' : 'Нет доступа к клубу',
                show_alert: true
            });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, resolved.klub_id, igrok_id);
    }

    else if (data === 'naznach_da') {
        const pending = sostoyanie[telegram_id]?.naznach_podtv;
        if (!pending?.klub_id || !pending?.igrok_id) {
            bot.answerCallbackQuery(query.id, { text: 'Нажми «Да» в новом сообщении или повтори поиск', show_alert: true });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, pending.klub_id, pending.igrok_id);
    }

    else if (data.startsWith('nok_')) {
        const p = cbUnpack(data.replace('nok_', ''));
        if (!p) {
            bot.answerCallbackQuery(query.id, { text: 'Кнопка устарела — повтори поиск', show_alert: true });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('naznach_ok_')) {
        const parts = data.replace('naznach_ok_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, klub_id, igrok_id);
    }

    // ===== МОИ АНОНСЫ =====
    else if (data === 'moi_anonsy_vse' || data.startsWith('moi_anonsy_')) {
        const klub_id = data === 'moi_anonsy_vse' ? null : data.replace('moi_anonsy_', '');

        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        const { data: klubyVlad } = await supabase
            .from('chleny_klubov')
            .select('klub_id')
            .eq('igrok_id', igrok?.id)
            .eq('rol', 'vladyelets');

        const klubIds = (klubyVlad || []).map(c => c.klub_id).filter(Boolean);
        if (klubIds.length === 0) {
            bot.editMessageText('📋 *Мои анонсы*\n\n❌ Нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        let query = supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, status, kluby(nazvaniye)')
            .in('klub_id', klub_id ? [klub_id] : klubIds)
            .order('data_igry', { ascending: false })
            .limit(10);

        const { data: anonsy } = await query;

        if (!anonsy || anonsy.length === 0) {
            bot.editMessageText('📋 *Мои анонсы*\n\n_Анонсов пока нет._', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 Создать анонс', callback_data: 'anons_vybor_kluba' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]
                ]}
            });
            return;
        }

        let tekst = '📋 *Мои анонсы*\n\n';
        const knopki = [];

        anonsy.forEach((a, i) => {
            const status_emoji = a.status === 'aktiven' ? '🟢' : '🔴';
            tekst += (i + 1) + '. ' + status_emoji + ' *' + (a.kluby?.nazvaniye || '') + '*\n';
            tekst += '   📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
            tekst += '   📍 ' + (a.adres || '') + '\n\n';
            const dataTxt = formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry);
            knopki.push([{ text: status_emoji + ' ' + dataTxt + ' ' + (a.vremya || '') + ' — ' + (a.kluby?.nazvaniye || ''), callback_data: 'anons_card_' + a.id }]);
        });

        knopki.push([{ text: '📢 Создать новый', callback_data: 'anons_vybor_kluba' }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== КАРТОЧКА АНОНСА =====
    else if (data.startsWith('anons_card_')) {
        const anons_id = data.replace('anons_card_', '');
        await pokazat_kartochku_anонса(chatId, messageId, anons_id);
    }

    // ===== УДАЛИТЬ АНОНС: подтверждение =====
    else if (data.startsWith('anons_delete_confirm_')) {
        const anons_id = data.replace('anons_delete_confirm_', '');
        bot.editMessageText('🗑 *Удалить анонс?*\n\nЭто действие нельзя отменить. Все записи на этот анонс также будут удалены.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, удалить', callback_data: 'anons_delete_' + anons_id }],
                [{ text: '⬅️ Отмена', callback_data: 'anons_card_' + anons_id }]
            ]}
        });
    }

    else if (data.startsWith('anons_delete_')) {
        const anons_id = data.replace('anons_delete_', '');
        const { error } = await supabase.from('anonsy').delete().eq('id', anons_id);

        if (error) {
            bot.editMessageText('❌ Ошибка удаления.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'moi_anonsy_vse' }]] }
            });
            return;
        }

        bot.editMessageText('✅ *Анонс удалён.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_vse' }], [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== РЕДАКТИРОВАТЬ АНОНС =====
    else if (data.startsWith('anons_edit_')) {
        const anons_id = data.replace('anons_edit_', '');
        bot.editMessageText('✏️ *Редактирование анонса*\n\nЧто хочешь изменить?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📅 Дата', callback_data: 'anons_edit_data_' + anons_id }],
                [{ text: '🕐 Время', callback_data: 'anons_edit_vremya_' + anons_id }],
                [{ text: '📍 Место проведения', callback_data: 'anons_edit_adres_' + anons_id }],
                [{ text: '💬 Комментарий', callback_data: 'anons_edit_komment_' + anons_id }],
                [{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]
            ]}
        });
    }

    else if (data.startsWith('anons_edit_data_')) {
        const anons_id = data.replace('anons_edit_data_', '');
        sostoyanie[telegram_id] = 'anons_upd_data_' + anons_id;
        bot.editMessageText('📅 Введи новую дату:\n_Пример: 15 мая или 15.05.2026_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_vremya_')) {
        const anons_id = data.replace('anons_edit_vremya_', '');
        sostoyanie[telegram_id] = 'anons_upd_vremya_' + anons_id;
        bot.editMessageText('🕐 Введи новое время:\n_Пример: 19:00_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_adres_')) {
        const anons_id = data.replace('anons_edit_adres_', '');
        sostoyanie[telegram_id] = 'anons_upd_adres_' + anons_id;
        bot.editMessageText('📍 Введи новое место проведения:\n_Пример: Ресторан Паскаль, ул. Воровского 19_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_komment_')) {
        const anons_id = data.replace('anons_edit_komment_', '');
        sostoyanie[telegram_id] = 'anons_upd_komment_' + anons_id;
        bot.editMessageText('💬 Введи новый комментарий:\n_Пример: Играем 3 игры, стоимость 1000₽_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    // ===== АНОНС: записаться на игру =====
    else if (data.startsWith('anons_zapisatsya_')) {
        const anons_id = data.replace('anons_zapisatsya_', '');
        const { data: igrok } = await supabase
            .from('igroki').select('id, imya').eq('tg_id', telegram_id).single();

        if (!igrok) {
            bot.answerCallbackQuery(query.id, { text: '❌ Сначала зарегистрируйся через /start', show_alert: true });
            return;
        }

        // Проверяем не записан ли уже
        const { data: sushchestvuyushchaya } = await supabase
            .from('zapisi_na_anons')
            .select('id, status')
            .eq('anons_id', anons_id)
            .eq('igrok_id', igrok.id)
            .single();

        if (sushchestvuyushchaya && sushchestvuyushchaya.status === 'aktivna') {
            bot.answerCallbackQuery(query.id);
            // Показываем с кнопкой отмены
            bot.editMessageReplyMarkup({
                inline_keyboard: [
                    [{ text: '❌ Отменить запись', callback_data: 'anons_otmenit_' + anons_id }],
                    [{ text: '⬅️ Назад', callback_data: 'anonsy_goroda' }]
                ]
            }, { chat_id: chatId, message_id: messageId });
            bot.answerCallbackQuery(query.id, { text: '✅ Ты уже записан!', show_alert: true });
            return;
        }

        const { error } = await supabase
            .from('zapisi_na_anons')
            .insert({ anons_id, igrok_id: igrok.id, status: 'aktivna' });

        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка записи. Попробуй ещё раз.', show_alert: true });
            return;
        }

        bot.answerCallbackQuery(query.id, { text: '🎉 Ты записан на игру!', show_alert: true });

        // Меняем кнопку на "Отменить запись"
        bot.editMessageReplyMarkup({
            inline_keyboard: [
                [{ text: '❌ Отменить запись', callback_data: 'anons_otmenit_' + anons_id }],
                [{ text: '⬅️ Назад', callback_data: 'anonsy_goroda' }]
            ]
        }, { chat_id: chatId, message_id: messageId });

        // Уведомляем ведущего
        const { data: anons } = await supabase
            .from('anonsy')
            .select('vedushchiy_id, data_igry, vremya, igroki(tg_id)')
            .eq('id', anons_id)
            .single();

        if (anons?.vedushchiy_id) {
            const { data: vedushchiy } = await supabase
                .from('igroki').select('tg_id').eq('id', anons.vedushchiy_id).single();
            if (vedushchiy?.tg_id) {
                // Считаем сколько записалось
                const { count } = await supabase
                    .from('zapisi_na_anons')
                    .select('id', { count: 'exact' })
                    .eq('anons_id', anons_id)
                    .eq('status', 'aktivna');

                bot.sendMessage(vedushchiy.tg_id,
                    '📝 *Новая запись на игру!*\n\n' +
                    '👤 ' + igrok.imya + '\n' +
                    '📅 ' + (anons.data_igry || '') + ' ' + (anons.vremya || '') + '\n' +
                    '👥 Всего записалось: ' + count,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    }

    // ===== АНОНС: список записавшихся с отметкой посещаемости =====
    else if (data.startsWith('anons_spisok_')) {
        const anons_id = data.replace('anons_spisok_', '');

        const { data: anons } = await supabase
            .from('anonsy')
            .select('data_igry, vremya, klub_id, kluby(nazvaniye)')
            .eq('id', anons_id)
            .single();

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';

        if (vse.length === 0) {
            tekst += '_Пока никто не записался._\n';
        } else {
            tekst += '_Отметь кто пришёл:_\n';
            vse.forEach((z, i) => {
                const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
                let statusEmoji = '⬜️';
                if (z.status === 'prishel') statusEmoji = '✅';
                if (z.status === 'ne_prishel') statusEmoji = '❌';
                tekst += statusEmoji + ' ' + (i + 1) + '. ' + nik + '\n';
            });
        }

        if (prishli.length > 0) {
            tekst += '\n👥 Пришли: *' + prishli.length + '*';
        }

        // Кнопки для каждого игрока
        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            if (z.status === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });

        // Кнопка начать игру если есть пришедшие
        if (prishli.length >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishli.length + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishli.length > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 игроков (' + prishli.length + '/8)', callback_data: 'baza_noop' }]);
        }

        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПОСЕЩАЕМОСТЬ: отметить пришёл =====
    else if (data.startsWith('pd_')) {
        const p = cbUnpack(data.replace('pd_', ''));
        if (!p) return;
        const zapis_id = p.zapis_id;
        const anons_id = p.anons_id;

        await supabase.from('zapisi_na_anons').update({ status: 'prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '✅ Отмечен как пришедший' });

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            let st = z.id === zapis_id ? '✅' : (z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️'));
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + (prishli.length) + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            }
            return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);
        bot.editMessageText(tekst, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    else if (data.startsWith('pris_da_')) {
        const parts = data.replace('pris_da_', '').split('_');
        const zapis_id = parts[0];
        const anons_id = parts.slice(1).join('_');

        await supabase.from('zapisi_na_anons').update({ status: 'prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '✅ Отмечен как пришедший' });

        // Обновляем список
        const fakeCb = { ...query, data: 'anons_spisok_' + anons_id };
        const fakeQuery = { message: query.message, from: query.from, id: query.id, data: 'anons_spisok_' + anons_id };
        // Перезагружаем список
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            let st = z.id === zapis_id ? '✅' : (z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️'));
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + (prishli.length) + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПОСЕЩАЕМОСТЬ: отметить не пришёл =====
    else if (data.startsWith('pn_')) {
        const p = cbUnpack(data.replace('pn_', ''));
        if (!p) return;
        const zapis_id = p.zapis_id;
        const anons_id = p.anons_id;

        await supabase.from('zapisi_na_anons').update({ status: 'ne_prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '❌ Отмечен как не пришедший' });

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');
        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            const st = z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️');
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + prishli.length + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            if (z.status === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            }
            return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);
        bot.editMessageText(tekst, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    else if (data.startsWith('pris_net_')) {
        const parts = data.replace('pris_net_', '').split('_');
        const zapis_id = parts[0];
        const anons_id = parts.slice(1).join('_');

        await supabase.from('zapisi_na_anons').update({ status: 'ne_prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '❌ Отмечен как не пришедший' });

        // Обновляем список (та же логика)
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel' || (z.id !== zapis_id && z.status === 'prishel'));

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            const st = z.id === zapis_id ? 'ne_prishel' : z.status;
            let emoji = st === 'prishel' ? '✅' : (st === 'ne_prishel' ? '❌' : '⬜️');
            tekst += emoji + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        const prishliCount = vse.filter(z => (z.id === zapis_id ? false : z.status === 'prishel')).length;
        if (prishliCount > 0) tekst += '\n👥 Пришли: *' + prishliCount + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'ne_prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: (st === 'ne_prishel' ? '❌' : '⬜️') + ' ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== НАЧАТЬ ИГРУ ИЗ АНОНСА =====
    else if (data.startsWith('gia_')) {
        const anons_id = data.replace('gia_', '');

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('igroki(id, imya, tg_id, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .eq('status', 'prishel');

        const igroki_prishli = (zapisi || []).filter(z => z.igroki?.tg_id);

        if (igroki_prishli.length < 8) {
            bot.answerCallbackQuery(query.id, { text: '❌ Нужно минимум 8 игроков', show_alert: true });
            return;
        }

        // Показываем выбор количества игроков
        const n = igroki_prishli.length;
        bot.editMessageText(
            '🎲 *Начать игру*\n\n' +
            '👥 Пришли: ' + n + ' игроков\n\n' +
            'Сколько играют? (можно меньше чем пришло)',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        ...Array.from({ length: n - 7 }, (_, i) => {
                            const k = i + 8;
                            return [{ text: k + ' игроков', callback_data: 'igra_kol_' + anons_id + '_' + k }];
                        }),
                        [{ text: '⬅️ Назад', callback_data: 'anons_spisok_' + anons_id }]
                    ]
                }
            }
        );
    }

    // ===== ВЫБОР КОЛИЧЕСТВА ИЗ АНОНСА — создать игру =====
    else if (data.startsWith('igra_kol_')) {
        const parts = data.replace('igra_kol_', '').split('_');
        const kolichestvo = parseInt(parts[parts.length - 1]);
        const anons_id = parts.slice(0, -1).join('_');

        if (!sostavy[kolichestvo]) {
            bot.answerCallbackQuery(query.id, { text: '❌ Нет состава для ' + kolichestvo + ' игроков', show_alert: true });
            return;
        }

        const kod = sgenerirovat_kod();
        // Загружаем тип клуба
        let tip_kl = 'paskal';
        if (anons_id) {
            const { data: an_kl } = await supabase.from('anonsy').select('klub_id, kluby(tip, nastroyki)').eq('id', anons_id).single();
            tip_kl = an_kl?.kluby?.nastroyki?.tip_kluba || an_kl?.kluby?.tip || 'paskal';
        }
        igry[kod] = {
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            anons_id,
            tip_kluba: tip_kl
        };

        bot.editMessageText(
            '🎲 *Игра создана!*\n\n' +
            '🔑 Код игры: *' + kod + '*\n' +
            '👥 Мест: ' + kolichestvo + '\n\n' +
            '_Игроки вводят этот код в боте чтобы войти_\n\n' +
            'Или нажми кнопку ниже чтобы скопировать сообщение для игроков:',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👥 ' + igry[kod].igroki.length + '/' + kolichestvo + ' подключились', callback_data: 'status_' + kod }],
                        [{ text: '🎴 Раздать роли', callback_data: 'razdat_' + kod }],
                        [{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]
                    ]
                }
            }
        );
    }

    // ===== АНОНС: отменить запись =====
    else if (data.startsWith('anons_otmenit_')) {
        const anons_id = data.replace('anons_otmenit_', '');
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        await supabase
            .from('zapisi_na_anons')
            .update({ status: 'otmenena' })
            .eq('anons_id', anons_id)
            .eq('igrok_id', igrok?.id);

        bot.answerCallbackQuery(query.id, { text: '✅ Запись отменена.', show_alert: true });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор клуба =====
    else if (data === 'roli_vybor_kluba') {
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        // Ищем клубы где пользователь — собственник или ведущий
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('🎭 *Управление ролями*\n\n❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            await pokazat_roli_kluba(chatId, messageId, kluby[0].id);
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'roli_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('🎭 *Управление ролями*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('roli_klub_')) {
        const klub_id = data.replace('roli_klub_', '');
        await pokazat_roli_kluba(chatId, messageId, klub_id);
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: добавить роль =====
    else if (data.startsWith('rol_dobavit_')) {
        const klub_id = data.replace('rol_dobavit_', '');
        sostoyanie[telegram_id] = 'rol_nazvanie_' + klub_id;
        bot.editMessageText('🎭 *Новая роль*\n\nВведи название роли:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + klub_id }]] }
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор стороны =====
    else if (data.startsWith('rol_st_')) {
        const storona_kod = data.replace('rol_st_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_storona') return;

        const storony = { mirnye: '👨‍👩‍👧 Мирные', mafiya: '🔫 Мафия', solo: '🎯 Сам за себя' };
        dannye.storona = storona_kod;
        dannye.storona_text = storony[storona_kod] || storona_kod;
        dannye.shag = 'rol_deystvie';

        bot.editMessageText(
            '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie + '\n*Сторона:* ' + dannye.storona_text + '\n\nВыбери действие:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔪 Убить', callback_data: 'rol_dey_ubit' }],
                    [{ text: '💊 Спасти', callback_data: 'rol_dey_spasti' }],
                    [{ text: '🔍 Проверить', callback_data: 'rol_dey_proverit' }],
                    [{ text: '✨ Иное', callback_data: 'rol_dey_inoe' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
                ]
            }
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор действия =====
    else if (data.startsWith('rol_dey_')) {
        const deystvie_kod = data.replace('rol_dey_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_deystvie') return;

        if (deystvie_kod === 'inoe') {
            // Иное — сохраняем как есть и сразу к количеству раз
            dannye.deystvie = 'inoe';
            dannye.deystvie_text = '✨ Иное';
            dannye.shag = 'rol_kolichestvo';
            sostoyanie[telegram_id] = 'rol_kolichestvo_' + dannye.klub_id;
            bot.editMessageText(
                '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie +
                '\n*Сторона:* ' + dannye.storona_text +
                '\n*Действие:* ' + dannye.deystvie_text +
                '\n\n_Напомни: опиши правила этой роли и пришли нам для добавления в систему._\n\nСколько раз за игру (введи число или напиши "каждую ночь"):', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔁 Каждую ночь', callback_data: 'rol_kol_kazhduu' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
                ]}
            });
            return;
        }

        const deystviya = { ubit: '🔪 Убить', spasti: '💊 Спасти', proverit: '🔍 Проверить' };
        dannye.deystvie = deystvie_kod;
        dannye.deystvie_text = deystviya[deystvie_kod] || deystvie_kod;
        dannye.shag = 'rol_kolichestvo';
        sostoyanie[telegram_id] = 'rol_kolichestvo_' + dannye.klub_id;

        bot.editMessageText(
            '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie +
            '\n*Сторона:* ' + dannye.storona_text +
            '\n*Действие:* ' + dannye.deystvie_text +
            '\n\nСколько раз за игру?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🔁 Каждую ночь', callback_data: 'rol_kol_kazhduu' }],
                [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
            ]}
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: каждую ночь =====
    else if (data === 'rol_kol_kazhduu') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_kolichestvo') return;
        delete sostoyanie[telegram_id];
        dannye.kolichestvo_raz = 'каждую ночь';
        dannye.shag = 'gotovo';
        await sohranit_rol(chatId, telegram_id, dannye.klub_id, dannye);
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: удалить роль =====
    else if (data.startsWith('rol_udalit_')) {
        const parts = data.replace('rol_udalit_', '').split('_');
        const klub_id = parts[0];
        const rol_index = parseInt(parts[1]);

        const { data: klub } = await supabase
            .from('kluby').select('nastroyki').eq('id', klub_id).single();

        const nastroyki = klub?.nastroyki || {};
        const roli = nastroyki.kastomnye_roli || [];
        roli.splice(rol_index, 1);
        nastroyki.kastomnye_roli = roli;

        await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);
        await pokazat_roli_kluba(chatId, messageId, klub_id);
    }

    } catch (e) {
        console.error('[callback error]', query?.data, e?.message || e);
        bot.answerCallbackQuery(query.id, { text: 'Ошибка. Нажми /start', show_alert: true }).catch(() => {});
    }
});

// ============================================
// БАЗА ИГРОКОВ — функция отображения
// ============================================

async function pokazat_bazu_igrokov(chatId, messageId, klub_id, stranitsa, filtr) {
    const NA_STRANITSE = 10;

    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    if (!klub) {
        bot.editMessageText('❌ Клуб не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    const { data: chleny, error } = await supabase
        .from('chleny_klubov')
        .select('rol, igroki(id, imya, tg_username, telefon)')
        .eq('klub_id', klub_id);

    if (error) {
        console.error('Ошибка загрузки базы:', error);
        bot.editMessageText('❌ Ошибка загрузки базы игроков.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    let igroki_spisok = (chleny || [])
        .filter(c => c.igroki)
        .map(c => ({ ...c.igroki, rol: c.rol }));

    if (filtr) {
        const f = filtr.toLowerCase();
        const tolko_cifry = filtr.replace(/\D/g, '');
        const poisk_telefon = tolko_cifry.length >= 6 ? tolko_cifry.slice(-10) : null;

        igroki_spisok = igroki_spisok.filter(i => {
            if ((i.imya || '').toLowerCase().includes(f)) return true;
            if ((i.tg_username || '').toLowerCase().includes(f)) return true;
            if (poisk_telefon && (i.telefon || '').replace(/\D/g, '').slice(-10).includes(poisk_telefon)) return true;
            return false;
        });
    }

    igroki_spisok.sort((a, b) => (a.imya || '').localeCompare(b.imya || '', 'ru'));

    const vsego = igroki_spisok.length;
    const stranits_vsego = Math.max(1, Math.ceil(vsego / NA_STRANITSE));
    if (stranitsa >= stranits_vsego) stranitsa = stranits_vsego - 1;
    if (stranitsa < 0) stranitsa = 0;

    const ot = stranitsa * NA_STRANITSE;
    const do_ = Math.min(ot + NA_STRANITSE, vsego);
    const na_stranitse = igroki_spisok.slice(ot, do_);

    const residenty = new Set(poluchitResidentovIzNastroek(klub.nastroyki || {}));

    let tekst = '👥 *База игроков* — ' + klub.nazvaniye + '\n';
    if (filtr) tekst += '🔍 _Фильтр: ' + filtr + '_\n';
    tekst += '\n';

    if (vsego === 0) {
        tekst += filtr ? '_Никого не найдено по запросу._' : '_В клубе пока нет игроков._';
    } else {
        tekst += '_Всего: ' + vsego + ' • Страница ' + (stranitsa + 1) + '/' + stranits_vsego + '_\n';
        tekst += '_Нажми на игрока для управления._';
    }

    const knopki = [];

    na_stranitse.forEach((i) => {
        const rol_emoji = i.rol === 'vladyelets' ? '👑 '
                        : isVedushchiy(i.rol) ? '🎤 '
                        : '';
        const rez_emoji = residenty.has(i.id) ? '⭐ ' : '';
        const username = i.tg_username ? ' (@' + i.tg_username + ')' : '';
        const knopka_text = rez_emoji + rol_emoji + (i.imya || 'Без имени') + username;
        knopki.push([{
            text: knopka_text,
            callback_data: cbBtn('ip_', { klub_id, igrok_id: i.id })
        }]);
    });

    if (stranits_vsego > 1) {
        const navig = [];
        if (stranitsa > 0) navig.push({ text: '⬅️', callback_data: cbBtn('bk_', { klub_id, page: stranitsa - 1 }) });
        navig.push({ text: (stranitsa + 1) + '/' + stranits_vsego, callback_data: 'baza_noop' });
        if (stranitsa < stranits_vsego - 1) navig.push({ text: '➡️', callback_data: cbBtn('bk_', { klub_id, page: stranitsa + 1 }) });
        knopki.push(navig);
    }

    knopki.push([{ text: '🔍 Поиск', callback_data: 'baza_poisk_' + klub_id }]);
    if (filtr) knopki.push([{ text: '✖️ Сбросить фильтр', callback_data: 'baza_sbros_' + klub_id }]);
    knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// КАРТОЧКА ИГРОКА
// ============================================

async function pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id) {
    const { data: igrok } = await supabase
        .from('igroki')
        .select('imya, tg_username, telefon')
        .eq('id', igrok_id)
        .single();

    if (!igrok) {
        bot.editMessageText('❌ Игрок не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }]] }
        });
        return;
    }

    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('rol')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .single();

    const rol = chlen?.rol || 'igrok';
    const rol_text = rol === 'vladyelets' ? '👑 Собственник'
                    : isVedushchiy(rol) ? '🎤 Ведущий'
                    : '🎴 Игрок';

    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    const residenty = new Set(poluchitResidentovIzNastroek(klub?.nastroyki || {}));
    const rezident = residenty.has(igrok_id);

    let tekst = '👤 *Карточка игрока*\n\n';
    tekst += '*Имя:* ' + (igrok.imya || 'Без имени') + '\n';
    if (igrok.tg_username) tekst += '*Telegram:* @' + igrok.tg_username.replace(/_/g, '\\_') + '\n';
    if (igrok.telefon) tekst += '*Телефон:* ' + igrok.telefon + '\n';
    tekst += '*Роль в клубе ' + (klub?.nazvaniye || '') + ':* ' + rol_text + '\n';
    tekst += '*Резидент:* ' + (rezident ? '⭐ Да' : 'нет');

    const knopki = [];

    if (rol === 'vladyelets') {
        knopki.push([{ text: '⚠️ Это собственник клуба', callback_data: 'baza_noop' }]);
    } else if (isVedushchiy(rol)) {
        knopki.push([{ text: '↩️ Снять роль ведущего', callback_data: cbBtn('sv_', { klub_id, igrok_id }) }]);
    } else {
        knopki.push([{ text: '🎤 Сделать ведущим', callback_data: cbBtn('vd_', { klub_id, igrok_id }) }]);
    }

    knopki.push([{
        text: rezident ? '☆ Убрать из резидентов' : '⭐ Сделать резидентом',
        callback_data: cbBtn('res_', { klub_id, igrok_id, on: !rezident })
    }]);
    knopki.push([{ text: '⬅️ К списку', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// ВЫБОР СТРАНЫ И ГОРОДА (ПРИ СОЗДАНИИ КЛУБА)
// ============================================

async function pokazat_vybor_strany(chatId, messageId) {
    const strany = [
        { kod: 'RU', flag: '🇷🇺', nazvaniye: 'Россия' },
        { kod: 'BY', flag: '🇧🇾', nazvaniye: 'Беларусь' },
        { kod: 'KZ', flag: '🇰🇿', nazvaniye: 'Казахстан' },
        { kod: 'UZ', flag: '🇺🇿', nazvaniye: 'Узбекистан' },
        { kod: 'KG', flag: '🇰🇬', nazvaniye: 'Кыргызстан' },
        { kod: 'AM', flag: '🇦🇲', nazvaniye: 'Армения' },
        { kod: 'GE', flag: '🇬🇪', nazvaniye: 'Грузия' },
        { kod: 'AZ', flag: '🇦🇿', nazvaniye: 'Азербайджан' }
    ];

    const knopki = strany.map(s => [{
        text: s.flag + ' ' + s.nazvaniye,
        callback_data: 'vstrana_' + s.kod + '_0'
    }]);
    knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

    bot.editMessageText('➕ *Создание клуба*\n\nВыбери страну:', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazat_vybor_goroda(chatId, messageId, strana, stranitsa, kod_strany) {
    const NA_STRANITSE = 10;

    // Если kod_strany не передан — выведём из названия страны
    if (!kod_strany) {
        const obratno = {
            'Россия': 'RU', 'Беларусь': 'BY', 'Казахстан': 'KZ',
            'Узбекистан': 'UZ', 'Кыргызстан': 'KG', 'Армения': 'AM',
            'Грузия': 'GE', 'Азербайджан': 'AZ'
        };
        kod_strany = obratno[strana] || 'RU';
    }

    const { data: goroda, error } = await supabase
        .from('goroda')
        .select('id, nazvaniye')
        .eq('strana', strana)
        .order('nazvaniye', { ascending: true });

    if (error) {
        console.error('Ошибка загрузки городов:', error);
        bot.editMessageText('❌ Ошибка загрузки городов.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
        });
        return;
    }

    const vsego = (goroda || []).length;
    if (vsego === 0) {
        bot.editMessageText('⚠️ Список городов пуст. Напиши в поддержку.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
        });
        return;
    }

    const stranits_vsego = Math.max(1, Math.ceil(vsego / NA_STRANITSE));
    if (stranitsa >= stranits_vsego) stranitsa = stranits_vsego - 1;
    if (stranitsa < 0) stranitsa = 0;

    const ot = stranitsa * NA_STRANITSE;
    const na_stranitse = goroda.slice(ot, ot + NA_STRANITSE);

    const knopki = na_stranitse.map(g => [{
        text: g.nazvaniye,
        callback_data: 'vgorod_' + g.id
    }]);

    if (stranits_vsego > 1) {
        const navig = [];
        if (stranitsa > 0) navig.push({ text: '⬅️', callback_data: 'vstrana_' + kod_strany + '_' + (stranitsa - 1) });
        navig.push({ text: (stranitsa + 1) + '/' + stranits_vsego, callback_data: 'baza_noop' });
        if (stranitsa < stranits_vsego - 1) navig.push({ text: '➡️', callback_data: 'vstrana_' + kod_strany + '_' + (stranitsa + 1) });
        knopki.push(navig);
    }

    knopki.push([{ text: '❔ Моего города нет', callback_data: 'goroda_net' }]);
    knopki.push([{ text: '⬅️ К выбору страны', callback_data: 'sozdat_klub' }]);

    const tekst = '➕ *Создание клуба*\n\nСтрана: *' + strana + '*\nВыбери город:';

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// КОНСТРУКТОР РОЛЕЙ — функции
// ============================================

async function pokazat_roli_kluba(chatId, messageId, klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    if (!klub) {
        bot.editMessageText('❌ Клуб не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'roli_vybor_kluba' }]] }
        });
        return;
    }

    const roli = klub.nastroyki?.kastomnye_roli || [];
    const storony = { mirnye: '👨‍👩‍👧', mafiya: '🔫', solo: '🎯' };

    let tekst = '🎭 *Роли клуба — ' + klub.nazvaniye + '*\n\n';

    if (roli.length === 0) {
        tekst += '_Кастомных ролей пока нет._\n\n_Стандартные роли: Дон, Мафия, Шериф, Доктор и другие._';
    } else {
        tekst += '_Кастомные роли:_\n\n';
        roli.forEach((r, i) => {
            const emoji = storony[r.storona] || '❓';
            tekst += (i + 1) + '. ' + emoji + ' *' + r.nazvanie + '*';
            tekst += ' — ' + (r.deystvie_text || r.deystvie);
            tekst += ', ' + r.kolichestvo_raz + ' раз\n';
        });
    }

    const knopki = [];

    // Кнопки удаления для каждой роли
    roli.forEach((r, i) => {
        knopki.push([{ text: '🗑 Удалить: ' + r.nazvanie, callback_data: 'rol_udalit_' + klub_id + '_' + i }]);
    });

    knopki.push([{ text: '➕ Добавить роль', callback_data: 'rol_dobavit_' + klub_id }]);
    knopki.push([{ text: '⬅️ Назад', callback_data: 'roli_vybor_kluba' }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function sohranit_rol(chatId, tg_id, klub_id, dannye) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();

    const nastroyki = klub?.nastroyki || {};
    const roli = nastroyki.kastomnye_roli || [];

    roli.push({
        nazvanie: dannye.nazvanie,
        storona: dannye.storona,
        storona_text: dannye.storona_text,
        deystvie: dannye.deystvie,
        deystvie_text: dannye.deystvie_text,
        kolichestvo_raz: dannye.kolichestvo_raz
    });

    nastroyki.kastomnye_roli = roli;

    const { error } = await supabase
        .from('kluby')
        .update({ nastroyki })
        .eq('id', klub_id);

    delete ozhidanie_registracii[tg_id];

    if (error) {
        console.error('Ошибка сохранения роли:', error);
        bot.sendMessage(chatId, '❌ Ошибка сохранения роли. Попробуй ещё раз.');
        return;
    }

    const soobsh = await bot.sendMessage(chatId,
        '✅ *Роль добавлена!*\n\n' +
        '🎭 *' + dannye.nazvanie + '*\n' +
        'Сторона: ' + dannye.storona_text + '\n' +
        'Действие: ' + (dannye.deystvie_text || dannye.deystvie) + '\n' +
        'Раз за игру: ' + dannye.kolichestvo_raz,
        { parse_mode: 'Markdown' }
    );

    setTimeout(async () => {
        await pokazat_roli_kluba(chatId, soobsh.message_id, klub_id);
    }, 500);
}

// ============================================
// АНОНСЫ — функции
// ============================================

async function sohranit_anons(chatId, tg_id, dannye) {
    const { data: igrok } = await supabase
        .from('igroki').select('id').eq('tg_id', tg_id).single();

    const { data: klub } = await supabase
        .from('kluby').select('nazvaniye, gorod, strana').eq('id', dannye.klub_id).single();

    const { data: anons, error } = await supabase
        .from('anonsy')
        .insert({
            klub_id: dannye.klub_id,
            vedushchiy_id: igrok?.id,
            data_igry: dannye.data_igry,
            vremya: dannye.vremya,
            adres: dannye.adres,
            kommentariy: dannye.kommentariy || null,
            status: 'aktiven'
        })
        .select()
        .single();

    if (error) {
        console.error('Ошибка сохранения анонса:', error);
        bot.sendMessage(chatId, '❌ Ошибка создания анонса. Попробуй ещё раз.');
        return;
    }

    const tekst =
        '📢 *Анонс создан!*\n\n' +
        '🎴 *' + (klub?.nazvaniye || '') + '*\n' +
        '📅 ' + formatDataAnonsa(dannye.data_igry) + ' в ' + dannye.vremya + '\n' +
        '📍 ' + dannye.adres +
        (dannye.kommentariy ? '\n💬 ' + dannye.kommentariy : '') +
        '\n\n_Игроки из ' + (klub?.gorod || 'вашего города') + ' увидят этот анонс в своём меню._';

    bot.sendMessage(chatId, tekst, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Редактировать', callback_data: 'anons_edit_' + anons.id }],
                [{ text: '🗑 Удалить анонс', callback_data: 'anons_delete_confirm_' + anons.id }],
                [{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_' + dannye.klub_id }],
                [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
            ]
        }
    });
}

async function pokazat_kartochku_anонса(chatId, messageId, anons_id) {
    const { data: a } = await supabase
        .from('anonsy')
        .select('id, data_igry, vremya, adres, kommentariy, status, klub_id, kluby(nazvaniye)')
        .eq('id', anons_id)
        .single();

    if (!a) {
        bot.editMessageText('❌ Анонс не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'moi_anonsy_vse' }]] }
        });
        return;
    }

    const status_emoji = a.status === 'aktiven' ? '🟢 Активен' : '🔴 Неактивен';
    let tekst = '📢 *' + (a.kluby?.nazvaniye || '') + '*\n\n';
    tekst += '📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
    tekst += '📍 ' + (a.adres || '') + '\n';
    if (a.kommentariy) tekst += '💬 ' + a.kommentariy + '\n';
    tekst += '\nСтатус: ' + status_emoji;

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '👥 Список записавшихся', callback_data: 'anons_spisok_' + a.id }],
            [{ text: '✏️ Редактировать', callback_data: 'anons_edit_' + a.id }],
            [{ text: '🗑 Удалить', callback_data: 'anons_delete_confirm_' + a.id }],
            [{ text: '⬅️ Мои анонсы', callback_data: 'moi_anonsy_' + a.klub_id }]
        ]}
    });
}

(async function initTelegram() {
    console.log('Запуск Telegram polling...');
    try {
        const me = await bot.getMe();
        console.log('🤖 @' + (me.username || me.id));
        await zapustitPolling();
        console.log('🎴 PrimeMafia бот запущен (polling)');
    } catch (e) {
        if (etoOshibka409(e)) {
            await perezapuskPosle409();
            console.log('🎴 Polling перезапущен после 409');
        } else {
            console.error('❌ Ошибка Telegram (бот на порту ' + PORT + ' жив, polling нет):', e.message || e);
        }
    }
})();
