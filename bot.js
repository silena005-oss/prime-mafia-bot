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
    12: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    13: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный'],
    14: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    15: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    16: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    17: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Любовница', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Охотник', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── ВИП (городская профессиональная) ─────────────
// Мафия: Дон, Путана, Подрывник, Мафия
// Мирные: Комиссар, Доктор, Стрелок, Стрелочник, Камикадзе, Любовница, Мирный
// Сам за себя: Маньяк
const sostavy_vip = {
    8:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Маньяк', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    10: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    11: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Маньяк', 'Мирный', 'Мирный'],
    12: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Маньяк', 'Мирный', 'Мирный'],
    13: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Маньяк', 'Мирный'],
    14: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    15: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    16: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный'],
    17: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Путана', 'Подрывник', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
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
    'Путана': '\uD83D\uDD34 *Путана (Эскортница)*\n\nЧасть мафии. Ночью можешь 2-3 раза убрать игровую роль. Угадала — игрок уходит. Промахнулась — он остаётся.',
    'Эскортница': '\uD83D\uDD34 *Эскортница*\n\nЧасть мафии. Можешь блокировать роль игрока на одну ночь.',
    'Подрывник': '\uD83D\uDD34 *Подрывник*\n\nЧасть мафии. Если в тебя выстрелит Стрелок или Маньяк — вы оба выбываете.',
    'Консильери': '\uD83D\uDD34 *Консильери*\n\nЧасть мафии. Советник Дона.',
    // Мирные
    'Шериф': '\uD83D\uDFE2 *Шериф*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия.',
    'Комиссар': '\uD83D\uDFE2 *Комиссар (Детектив)*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Детектив': '\uD83D\uDFE2 *Детектив*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Доктор': '\uD83D\uDFE2 *Доктор*\n\nКаждую ночь спасаешь одного игрока от убийства. Нельзя лечить одного два раза подряд. Можно лечить себя.',
    'Охотник': '\uD83D\uDFE2 *Охотник (Стрелок)*\n\nКаждую ночь можешь выстрелить в игрока. Убил 2 мирных — выбываешь сам.',
    'Стрелок': '\uD83D\uDFE2 *Стрелок*\n\nКаждую ночь можешь выстрелить. Убил 2 мирных — выбываешь. За правильный отстрел мафии +0.5 балла.',
    'Стрелочник': '\uD83D\uDFE2 *Стрелочник*\n\nЕсли в тебя стреляли ночью — можешь перекинуть выстрел на другого. Попал в мафию — уходит мафия. Попал в мирного — уходишь ты.',
    'Камикадзе': '\uD83D\uDFE2 *Камикадзе*\n\nКаждую ночь идёшь к игроку. Пошёл к мафии — вы оба выбываете. К мирному/маньяку — ничего.',
    'Бессмертный': '\uD83D\uDFE2 *Бессмертный — Мирный житель*\n\nПросыпаешься только в первую ночь для знакомства с ведущим.\n\n\uD83D\uDEE1\uFE0F Не может быть убит ночью обычными выстрелами.\n\u274C Умирает только от: Путаны / выстрела Маньяка / голосования днём.\n\n\uD83C\uDFAF Задача: притягивай выстрелы на себя, спасай мирных жителей.',
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
    pobeda_komanda: 3,
    porazhenie: 0,
    vyzhil: 1,
    ubit_v_pervuyu_noch: 0,
    bonus_sheriff_ubil_maf: 2,
    bonus_doctor_spas: 1,
    bonus_kamikadze: 3,
    bonus_don_pobedil: 2,
    bonus_manyak_pobedil: 5
};

// ============================================
// ПАМЯТЬ БОТА (временная, до полного перехода на БД)
// ============================================

const sostoyanie = {}; // { telegram_id: 'vvodit_kod' | 'baza_poisk_<klub_id>' }
const igry = {};       // активные игры в памяти (кэш)

// ============================================
// ПЕРСИСТЕНТНОСТЬ ИГР
// ============================================

// Сохранить игру в Supabase
async function sohranit_igru(kod) {
    const igra = igry[kod];
    if (!igra || igra._ne_sohranyat) return;
    try {
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
            nastroyki: JSON.stringify(igra._nastroyki || {}),
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
        await supabase.from('aktivnye_igry').update({ zavershena: true, obnovlena_v: new Date().toISOString() }).eq('kod', kod);
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
                igry[row.kod] = {
                    kolichestvo: row.kolichestvo,
                    vedushchii_id: row.vedushchii_tg_id,
                    klub_id: row.klub_id,
                    tip_kluba: row.tip_kluba || 'paskal',
                    sportivniy: row.sportivniy || false,
                    igroki: typeof row.igroki === 'string' ? JSON.parse(row.igroki) : (row.igroki || []),
                    faza: row.faza || 'ozhidanie',
                    den: row.den || 1,
                    _nastroyki: typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki) : (row.nastroyki || {}),
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
            [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
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
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_vladeltsa = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 Аналитика', callback_data: 'analitika' }],
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
        const { data: membership } = await supabase
            .from('chleny_klubov')
            .select('rol')
            .eq('igrok_id', igrok.id)
            .order('dobavlen_v', { ascending: false })
            .limit(1)
            .single();

        const rol = membership?.rol || 'igrok';

        if (rol === 'vladyelets') {
            bot.sendMessage(chatId, `🏛 *Привет, ${igrok.imya}!*\n\nМеню собственника`, {
                parse_mode: 'Markdown', ...menu_vladeltsa
            });
        } else if (isVedushchiy(rol)) {
            bot.sendMessage(chatId, `🎭 *Привет, ${igrok.imya}!*\n\nМеню ведущего`, {
                parse_mode: 'Markdown', ...menu_vedushchego
            });
        } else {
            bot.sendMessage(chatId, `🎴 *Привет, ${igrok.imya}!*\n\nМеню игрока`, {
                parse_mode: 'Markdown', ...menu_igroka
            });
        }
    } else {
        // Новый пользователь — начинаем регистрацию
        ozhidanie_registracii[tg_id] = { shag: 'imya' };
        return bot.sendMessage(chatId,
            '👋 *Добро пожаловать в Prime Mafia!*\n\n' +
            'Для регистрации введи своё *имя и фамилию*:',
            { parse_mode: 'Markdown' }
        );
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

bot.on('photo', async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        if (msg.caption) {
            bot.sendMessage(msg.chat.id, '❌ Загрузка картинок ролей доступна только администратору.\n\nНапиши /admin — там инструкция.');
        }
        return;
    }

    // Проверяем caption — должно быть название роли
    const caption = msg.caption?.trim();
    if (!caption) {
        bot.sendMessage(msg.chat.id, 
            '📸 Фото получено, но нет подписи!\n\nОтправь фото с подписью = название роли\nПример подпись: *Дон*',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Берём лучшее качество (последний элемент массива)
    const file_id = msg.photo[msg.photo.length - 1].file_id;
    roli_foto[caption] = file_id;

    // Сохраняем в Supabase для постоянства
    try {
        await supabase.from('nastroyki_app').upsert({
            klyuch: 'rol_foto_' + caption,
            znachenie: file_id
        }, { onConflict: 'klyuch' });
    } catch(e) {
        console.log('Supabase save error (table may not exist):', e.message);
    }

    bot.sendMessage(msg.chat.id,
        '✅ *' + caption + '* — file_id сохранён!\n\n`' + file_id + '`',
        { parse_mode: 'Markdown' }
    );
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
        'Отправь фото с *подписью* = точное название роли\n' +
        '_Пример подписи: Дон_\n\n' +
        '📋 /roles\\_status — какие роли уже загружены',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/roles_status/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) return;

    // Загружаем из Supabase
    const { data: rows } = await supabase.from('nastroyki_app')
        .select('klyuch, znachenie')
        .like('klyuch', 'rol_foto_%');

    const loaded = (rows || []).map(r => r.klyuch.replace('rol_foto_', ''));
    const all_roli = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери',
                      'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                      'Стрелочник', 'Камикадзе', 'Затычка', 'Шахид', 'Бессмертный',
                      'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
                      'Мстительный родственник', 'Маньяк', 'Мирный'];

    let t = '📸 *Статус загрузки картинок:*\n\n';
    all_roli.forEach(r => {
        t += (loaded.includes(r) ? '✅' : '❌') + ' ' + r + '\n';
    });
    t += '\n*Загружено: ' + loaded.length + '/' + all_roli.length + '*';

    bot.sendMessage(msg.chat.id, t, { parse_mode: 'Markdown' });
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

bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const text = (msg.text || '').trim();

    // Игнорируем команды
    if (text.startsWith('/')) return;

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ведущая вручную вносит игроков и роли =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('manual_roles_')) {
        const kod = sostoyanie[tg_id].replace('manual_roles_', '');
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
        igra.rezhim_rolei = 'karty';
        igra.roli_razdany = true;
        igra.den = 1;
        delete sostoyanie[tg_id];
        await sohranit_igru(kod);

        let svodka = '✅ *Роли внесены вручную!*\n\n';
        svodka += '🎴 Игра №' + kod + '\n';
        svodka += '👥 Игроков: ' + igra.kolichestvo + '\n\n';
        igra.igroki.forEach(i => {
            svodka += '№' + i.nomer + ' ' + i.name + ' — *' + i.rol + '*\n';
        });

        bot.sendMessage(chatId, svodka, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '👋 Начать знакомство', callback_data: 'faza_znakomstvo_' + kod }]
            ]}
        });
        return;
    }

    // ===== РЕГИСТРАЦИЯ: шаг 1 — имя =====
    if (ozhidanie_registracii[tg_id]?.shag === 'imya') {
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

        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId,
            `✅ *Клуб создан!*\n\n🎴 ${nazvaniye}\n\nТеперь ты собственник этого клуба.`,
            { parse_mode: 'Markdown', ...menu_vladeltsa }
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
    if (msg.contact && sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('naznach_poisk_')) {
        const klub_id = sostoyanie[tg_id].replace('naznach_poisk_', '');
        delete sostoyanie[tg_id];
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
            callback_data: cbBtn('ncfm_', { klub_id, igrok_id: i.id })
        }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

        bot.sendMessage(chatId, '✅ Нашёл! Выбери кого назначить ведущим:', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО: поиск по имени/телефону =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('naznach_poisk_')) {
        const klub_id = sostoyanie[tg_id].replace('naznach_poisk_', '');
        delete sostoyanie[tg_id];
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
            callback_data: cbBtn('ncfm_', { klub_id, igrok_id: i.id })
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

        const nomer = igra.igroki.length + 1;
        const name = msg.from.first_name || 'Игрок ' + nomer;

        igra.igroki.push({ telegram_id: tg_id, name: name, nomer: nomer });
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
                ? { text: '▶️ Начать игру', callback_data: 'nachat_igru_' + kod }
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
            return { name: 'Игрок ' + (index + 1), rol };
        }
        if (lower.endsWith(rolLower)) {
            const name = bezNomera.slice(0, bezNomera.length - rol.length)
                .replace(/[—–\-:|,]+$/g, '')
                .trim();
            if (name) return { name, rol };
        }
    }

    return null;
}

async function pokazatLobbyIgry(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;

    const rezhim = igra.rezhim_rolei === 'karty' ? '🃏 *Физические карты*' : '📱 *Роли в боте*';
    const opisanie = igra.rezhim_rolei === 'karty'
        ? 'Игроки могут подключиться по коду, либо ведущая может внести игроков и роли вручную.'
        : 'Игроки подключаются по коду, бот отправит каждому роль в личку.';

    let spisok = '';
    igra.igroki.forEach((ig, i) => {
        spisok += (i + 1) + '. ' + (ig.name || ig.imya || 'Игрок') + '\n';
    });

    const polno = igra.igroki.length >= igra.kolichestvo;
    let tekst = rezhim + '\n\n';
    tekst += '🎴 Код игры: *' + kod + '*\n';
    tekst += '👥 Подключено: *' + igra.igroki.length + '/' + igra.kolichestvo + '*\n\n';
    tekst += opisanie + '\n\n';
    tekst += spisok || '_Никто ещё не подключился_';
    if (!polno) tekst += '\n\n_Ждём ещё ' + (igra.kolichestvo - igra.igroki.length) + ' игрок(ов)._';

    const knopki = [[{ text: '🔄 Обновить список', callback_data: 'obnovit_igru_' + kod }]];
    if (igra.rezhim_rolei === 'bot') {
        knopki.push([{ text: polno ? '🎭 Раздать роли' : '🎭 Раздать роли (ждём игроков)', callback_data: 'razdat_' + kod }]);
    } else {
        knopki.push([{ text: '✍️ Внести роли вручную', callback_data: 'manual_roles_' + kod }]);
        knopki.push([{ text: polno ? '▶️ Начать игру' : '▶️ Начать игру / внести роли', callback_data: 'nachat_igru_' + kod }]);
    }
    knopki.push([{ text: '❌ Отменить', callback_data: 'otmenit_' + kod }]);

    await bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

function lichnoeVremyaSek(igra) {
    const nastroeno = parseInt(igra?._nastroyki?.minuta_sek, 10);
    if (Number.isFinite(nastroeno)) return Math.min(60, Math.max(40, nastroeno));
    return igra?.kolichestvo > 15 ? 40 : 60;
}

function opredelitPobeditelya(igra) {
    const mafRoles = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
    const alive = (igra?.igroki || []).filter(i => i.status === 'v_igre');
    const maf = alive.filter(i => mafRoles.includes(i.rol)).length;
    const manyak = alive.filter(i => i.rol === 'Маньяк').length;
    const mirnye = alive.length - maf - manyak;

    if (alive.length === 0) return null;
    if (manyak > 0 && alive.length === 1) return 'manyak';
    if (maf === 0 && manyak === 0) return 'mirnye';
    if (maf === 0 && mirnye === 0 && manyak > 0) return 'manyak';
    if (maf > 0 && maf >= mirnye + manyak) return 'mafiya';
    return null;
}

async function zavershitIgruAvto(chatId, messageId, kod, pobeditel) {
    const igra = igry[kod];
    if (!igra || !pobeditel) return false;
    stopTimer(kod);
    igra.pobeditel = pobeditel;

    const pobeditel_text = pobeditel === 'mirnye' ? '🟢 Мирные'
                         : pobeditel === 'mafiya' ? '🔴 Мафия'
                         : '🎯 Маньяк';

    for (const igrok of igra.igroki) {
        bot.sendMessage(igrok.telegram_id,
            '🏁 *Игра №' + kod + ' завершена!*\n\nПобедитель: ' + pobeditel_text + '\nТвоя роль: *' + igrok.rol + '*',
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }

    await zapisat_bally(igra, kod);

    let svodka = '🏁 *Игра завершена автоматически!*\n\n';
    svodka += 'Победитель: ' + pobeditel_text + '\n\n';
    svodka += '*Итог:*\n';
    igra.igroki.forEach(i => {
        const em = i.status === 'v_igre' ? '✅' : '💀';
        svodka += em + ' №' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
    });
    svodka += '\n🏆 Баллы записаны в рейтинг!';

    igry['archive_' + kod] = { ...igra };
    delete igry[kod];
    await zavershit_igru_v_db(kod);

    await bot.editMessageText(svodka, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🎁 Добавить бонусы', callback_data: 'bonusy_' + kod }],
            [{ text: '🎲 Новая игра', callback_data: 'sozdat_igru' }],
            [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
        ]}
    });
    return true;
}

function buildPanelText(igra, kod) {
    const alive = igra.igroki.filter(i => i.status === 'v_igre');
    const faza_names = { ozhidanie: 'Ожидание', znakomstvo: 'Знакомство', den: 'День', noch: 'Ночь', golosovanie: 'Голосование', opravdanie: 'Оправдание' };
    let t = '\uD83C\uDFAE *Игра \u2116' + kod + '* | ' + (faza_names[igra.faza] || '') + ' ' + (igra.den || 1) + '\n';
    t += '\uD83D\uDC65 За столом: *' + alive.length + '*/' + igra.kolichestvo + '\n';
    if (igra.taymer_aktiven && igra.taymer_sekundy > 0) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u23F1 *' + formatTime(igra.taymer_sekundy) + '* — \u2116' + (cur ? cur.nomer : '?') + ' ' + (cur ? cur.name : '') + '\n';
    } else if (igra.tekushchiy_nomer) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u25B6\uFE0F Ход: \u2116' + (cur ? cur.nomer : '?') + ' *' + (cur ? cur.name : '') + '*\n';
    }
    t += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
    igra.igroki.forEach(i => {
        let em = i.status === 'v_igre' ? (i.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
        if (igra.tekushchiy_nomer === i.nomer && i.status === 'v_igre') em = '\u25B6\uFE0F';
        if ((igra.naznacheny_golos || []).includes(i.nomer) && i.status === 'v_igre') em = '\uD83D\uDCA5';
        t += em + ' \u2116' + i.nomer + ' *' + i.name + '*';
        if (i.foly > 0) t += ' [' + i.foly + '\uD83D\uDD34]';
        if (igra.zablokirovan_nomer === i.nomer && i.status === 'v_igre') t += ' \uD83D\uDD07';
        t += '\n';
    });
    return t;
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
        if (faza === 'znakomstvo') knopki.push([{ text: '\uD83C\uDF1E Начать день', callback_data: 'faza_den_' + kod }]);
        if (faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 Выставить на голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        }
        if (faza === 'opravdanie') knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
        knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
        return;
    }

    igra.tekushchiy_nomer = poryadok[next_idx];
    const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
    const nastroyki = igra._nastroyki || {};
    let sekundy = igra.faza === 'znakomstvo' ? (nastroyki.znakomstvo_sek || 15)
        : igra.faza === 'opravdanie' ? (nastroyki.opravdanie_sek || 25)
        : lichnoeVremyaSek(igra);

    const t = buildPanelText(igra, kod);
    const knopki = buildTimerKnopki(kod, igra.faza);
    await bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    zapustitTaymer(chatId, messageId, kod, sekundy);
}

function buildTimerKnopki(kod, faza) {
    const knopki = [
        [{ text: '\u23ED\uFE0F Пас', callback_data: 'pas_' + kod }, { text: '\u23F9 Стоп', callback_data: 'stop_taymer_' + kod }],
    ];
    if (faza === 'den') {
        knopki.push([
            { text: '⏱ 40с', callback_data: 'set_minuta_' + kod + '_40' },
            { text: '⏱ 50с', callback_data: 'set_minuta_' + kod + '_50' },
            { text: '⏱ 60с', callback_data: 'set_minuta_' + kod + '_60' }
        ]);
        knopki.push([{ text: '\uD83D\uDCA5 На голосование', callback_data: 'vybrat_na_golos_' + kod }]);
        knopki.push([{ text: '\uD83C\uDF19 Ночь', callback_data: 'faza_noch_' + kod }]);
    }
    if (faza === 'znakomstvo') knopki.push([{ text: '\uD83C\uDF1E К дню', callback_data: 'faza_den_' + kod }]);
    if (faza === 'opravdanie') knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
    knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
    return knopki;
}

function zapustitTaymer(chatId, messageId, kod, sekundy) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra.taymer_sekundy = sekundy;
    igra.taymer_aktiven = true;

    igra._interval = setInterval(async () => {
        const ig = igry[kod];
        if (!ig || !ig.taymer_aktiven) { clearInterval(igra._interval); return; }
        ig.taymer_sekundy--;

        if (ig.taymer_sekundy % 5 === 0 || ig.taymer_sekundy <= 10) {
            bot.editMessageText(buildPanelText(ig, kod), {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buildTimerKnopki(kod, ig.faza) }
            }).catch(() => {});
        }

        if (ig.taymer_sekundy <= 0) {
            stopTimer(kod);
            sleduyushchiy(chatId, messageId, kod);
        }
    }, 1000);
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
    const d = igra.noch_deystviya || {};
    const roli_alive = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.rol);

    let t = '\uD83C\uDF19 *Ночь ' + (igra.den || 1) + '* — Игра \u2116' + kod + '\n\n';
    if (log_msg) t += log_msg + '\n\n';
    t += '_Действия:_\n';
    t += (d.mafiya_tseli?.length ? '\u2705' : '\u25A1') + ' Мафия: ' + (d.mafiya_tseli?.length ? '\u2116' + d.mafiya_tseli[0] : 'не выбрала') + '\n';
    if (roli_alive.includes('Доктор')) t += (d.doctor_tseli ? '\u2705' : '\u25A1') + ' Доктор: ' + (d.doctor_tseli ? '\u2116' + d.doctor_tseli : 'не выбрал') + '\n';
    if (roli_alive.includes('Шериф') || roli_alive.includes('Комиссар') || roli_alive.includes('Детектив')) t += (d.sherif_tseli ? '\u2705' : '\u25A1') + ' Шериф/Комиссар: ' + (d.sherif_tseli ? '\u2116' + d.sherif_tseli + ' проверен' : 'не проверял') + '\n';
    if (roli_alive.includes('Затычка')) t += (d.zatychka_tseli ? '\u2705' : '\u25A1') + ' Затычка: ' + (d.zatychka_tseli ? '\u2116' + d.zatychka_tseli + ' заблокирован' : 'не выбрала') + '\n';

    const knopki = [
        [{ text: '\uD83D\uDD2B Мафия убивает', callback_data: 'noch_vybor_maf_' + kod }],
    ];
    if (roli_alive.includes('Доктор')) knopki.push([{ text: '\uD83D\uDC89 Доктор лечит', callback_data: 'noch_vybor_doc_' + kod }]);
    if (roli_alive.includes('Шериф') || roli_alive.includes('Комиссар') || roli_alive.includes('Детектив')) knopki.push([{ text: '\uD83D\uDD0D Шериф/Комиссар проверяет', callback_data: 'noch_vybor_sher_' + kod }]);
    if (roli_alive.includes('Затычка')) knopki.push([{ text: '\uD83D\uDD07 Затычка блокирует', callback_data: 'noch_vybor_zat_' + kod }]);
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

    const maf_roli = ['Дон', 'Мафия', 'Консильери', 'Эскортница'];
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
        if (vyzhil && pobeda) bl += ballyConfig.vyzhil;
        if (is_maf && pobeda && igrok.rol === 'Дон') bl += ballyConfig.bonus_don_pobedil || 2;
        if (is_manyak && pobeda) bl += ballyConfig.bonus_manyak_pobedil || 4;
        if (igrok.bonus_pts) bl += igrok.bonus_pts;

        const bonus_info = {};
        if (igrok.bonus_pts) bonus_info.ruchnoy = { pts: igrok.bonus_pts, text: igrok.bonus_text };

        records.push({
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
        });
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
function pokazat_sostav_preview(kolichestvo, tip_kluba, nastroyki_kluba) {
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
    const maf_roli = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
    const solo_roli = ['Маньяк'];

    const mafiya = sostav.filter(r => maf_roli.includes(r));
    const solo = sostav.filter(r => solo_roli.includes(r));
    const mirnye = sostav.filter(r => !maf_roli.includes(r) && !solo_roli.includes(r));

    const tip_names = { paskal: 'Паскаль', vip: 'VIP', naila: 'Наиля', sportivniy: 'Спортивная' };

    let t = '\uD83C\uDFB2 *Состав на ' + kolichestvo + ' человек*';
    t += ' — ' + (tip_names[tip_kluba] || tip_kluba) + '\n\n';

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

        const { data: novyi_igrok, error } = await supabase
            .from('igroki')
            .insert({
                tg_id: telegram_id,
                tg_username,
                imya: dannye.imya,
                igrovoy_nik: dannye.igrovoy_nik,
                telefon: dannye.telefon,
                gorod: gorod_name,
                gorod_id: gorod_id
            })
            .select().single();

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
        const tip_it = parts_it[1];
        // Сохраняем тип и переходим к выбору количества
        const { data: klub_it } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id_it).single();
        const tip_names = { paskal: 'Паскаль', vip: 'VIP', naila: 'Наиля (Москва)', sportivniy: 'Спортивная' };
        const kol_knopki = [];
        const dostupnye = tip_it === 'sportivniy' ? [10] : [8,9,10,11,12,13,14,15,16,17,18,19,20];
        for (let i = 0; i < dostupnye.length; i += 4) {
            kol_knopki.push(dostupnye.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'igra_tip_kol_' + klub_id_it + '_' + tip_it + '_' + n })));
        }
        kol_knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_bez_anons_' + klub_id_it }]);
        bot.editMessageText(
            '\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_it?.nazvaniye || '') + '*\n\uD83D\uDCCB Правила: *' + (tip_names[tip_it] || tip_it) + '*\n\nСколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kol_knopki }
        });
    }

    else if (data.startsWith('igra_tip_kol_')) {
        const parts_itk = data.replace('igra_tip_kol_', '').split('_');
        const klub_id_itk = parts_itk[0];
        const tip_itk = parts_itk[1];
        const kolichestvo_itk = parseInt(parts_itk[2]);
        const { data: klub_itk } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id_itk).single();

        // Показываем предпросмотр состава перед созданием игры
        const preview = pokazat_sostav_preview(kolichestvo_itk, tip_itk, klub_itk?.nastroyki);
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
                tip_kluba: tip_itk,
                kolichestvo: kolichestvo_itk,
                _ne_sohranyat: true
            };
        }

        bot.editMessageText(preview.text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Подтвердить состав', callback_data: 'sostav_ok_' + preview_key }],
                [{ text: '\u270F\uFE0F Изменить роли', callback_data: 'sostav_edit_' + preview_key }],
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
            tip_kluba: preview_data.tip_kluba,
            sportivniy: preview_data.tip_kluba === 'sportivniy',
            rezhim_rolei: null,
            _sostav_custom: preview_data.sostav
        };
        delete igry['preview_' + preview_key];
        await sohranit_igru(kod);

        bot.editMessageText(
            '\uD83C\uDFB2 *Игра создана!*\n\n' +
            '\uD83D\uDD11 Код игры: *' + kod + '*\n' +
            '\uD83D\uDC65 Мест: ' + preview_data.kolichestvo + '\n\n' +
            'Выбери режим раздачи карт:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🃏 Физические карты', callback_data: 'rezhim_karty_' + kod }],
                [{ text: '📱 Раздать роли в боте', callback_data: 'rezhim_bot_' + kod }],
                [{ text: '❌ Отменить игру', callback_data: 'otmenit_' + kod }],
                [{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
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
            const maf_roli = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
            const solo = ['Маньяк'];
            const em = maf_roli.includes(r) ? '\uD83D\uDD34' : (solo.includes(r) ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
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
        const vse_roli = ['Дон', 'Мафия', 'Путана', 'Подрывник', 'Консильери', 'Эскортница',
                          'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                          'Стрелочник', 'Камикадзе', 'Затычка', 'Шахид', 'Бессмертный',
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
        const vse_roli_s = ['Дон', 'Мафия', 'Путана', 'Подрывник', 'Консильери', 'Эскортница',
            'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
            'Стрелочник', 'Камикадзе', 'Затычка', 'Шахид', 'Бессмертный',
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
            const maf_r = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
            const em_s = maf_r.includes(r) ? '\uD83D\uDD34' : (r === 'Маньяк' ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
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
        const preview_r = pokazat_sostav_preview(preview_data_r.kolichestvo, preview_data_r.tip_kluba, {});
        bot.editMessageText(preview_r.text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Подтвердить состав', callback_data: 'sostav_ok_' + preview_key_r }],
                [{ text: '\u270F\uFE0F Изменить роли', callback_data: 'sostav_edit_' + preview_key_r }],
            ]}
        });
    }

    else if (data.startsWith('igra_bez_anons_')) {
        const klub_id = data.replace('igra_bez_anons_', '');
        const { data: klub_bz } = await supabase.from('kluby').select('nazvaniye, sportivniy_rezhim').eq('id', klub_id).single();
        const sport_ok = klub_bz?.sportivniy_rezhim;
        const knopki_tip = [
            [{ text: '\uD83C\uDFAD Паскаль', callback_data: 'igra_tip_' + klub_id + '_paskal' }],
            [{ text: '\uD83C\uDFD9 VIP (городская)', callback_data: 'igra_tip_' + klub_id + '_vip' }],
            [{ text: '\uD83C\uDF06 Наиля / Москва', callback_data: 'igra_tip_' + klub_id + '_naila' }],
        ];
        if (sport_ok) knopki_tip.push([{ text: '\uD83C\uDFC6 Спортивная (10 чел)', callback_data: 'igra_tip_' + klub_id + '_sportivniy' }]);
        knopki_tip.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_klub_' + klub_id }]);
        bot.editMessageText('\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_bz?.nazvaniye || '') + '*\n\nКакие правила?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_tip }
        });
    }

    else if (data.startsWith('in_')) {
        const p = cbUnpack(data.replace('in_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Нажми снова', show_alert: true }); return; }
        const klub_id = p.klub_id;
        const anons_id = p.anons_id;
        const kolichestvo = parseInt(p.k, 10);
        const kod = sgenerirovat_kod();
        igry[kod] = {
            kod,
            klub_id,
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            rezhim_rolei: null
        };
        bot.editMessageText(
            '✅ *Игра создана!*\n\n🎴 Код игры: *' + kod + '*\n👥 Мест: ' + kolichestvo + '\n\nВыбери режим раздачи ролей:',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🃏 Физические карты (Паскаль)', callback_data: 'rezhim_karty_' + kod }],
                        [{ text: '📱 Раздать в боте', callback_data: 'rezhim_bot_' + kod }],
                        [{ text: '❌ Отменить игру', callback_data: 'otmenit_' + kod }]
                    ]
                }
            }
        );
    }

    else if (data.startsWith('igra_n_')) {
        const parts = data.replace('igra_n_', '').split('_');
        const klub_id = parts[0];
        const anons_id = parts[1]; // 'null' или uuid
        const kolichestvo = parseInt(parts[2]);
        const kod = sgenerirovat_kod();

        // Сохраняем игру в памяти
        igry[kod] = {
            kod,
            klub_id,
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            rezhim_rolei: null // 'karty' или 'bot'
        };

        const text = '✅ *Игра создана!*\n\n' +
                     '🎴 Код игры: *' + kod + '*\n' +
                     '👥 Мест: ' + kolichestvo + '\n\n' +
                     'Выбери режим раздачи ролей:';

        bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🃏 Физические карты (Паскаль)', callback_data: 'rezhim_karty_' + kod }],
                    [{ text: '📱 Раздать в боте', callback_data: 'rezhim_bot_' + kod }],
                    [{ text: '❌ Отменить игру', callback_data: 'otmenit_' + kod }]
                ]
            }
        });
    }

    else if (data.startsWith('rezhim_karty_')) {
        const kod = data.replace('rezhim_karty_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        igra.rezhim_rolei = 'karty';
        await sohranit_igru(kod);
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('rezhim_bot_')) {
        const kod = data.replace('rezhim_bot_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        igra.rezhim_rolei = 'bot';
        await sohranit_igru(kod);
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('obnovit_igru_')) {
        const kod = data.replace('obnovit_igru_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('status_')) {
        const kod = data.replace('status_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await pokazatLobbyIgry(chatId, messageId, kod);
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
                sostoyanie[telegram_id] = 'manual_roles_' + kod;
                await bot.editMessageText(
                    '✍️ *Внеси роли вручную*\n\n' +
                    'Сейчас подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '.\n' +
                    'Для физической игры можно не ждать подключений — пришли список на *' + igra.kolichestvo + '* игроков.\n\n' +
                    'Формат:\n' +
                    '`1. Аня — Дон`\n' +
                    '`2. Оля — Мафия`\n' +
                    '`3. Катя — Мирный`\n\n' +
                    'После этого откроется игровая панель.',
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'obnovit_igru_' + kod }]] }
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
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    // ===== ВНЕСТИ РЕЗУЛЬТАТЫ =====
    else if (data === 'vnesti_rezultaty') {
        bot.editMessageText(
            '📋 *Внести результаты игры*\n\n_Функция в разработке._\n\nСкоро здесь можно будет внести результаты прошедшей игры: состав, победитель, баллы игроков.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]] }
        });
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
            const maf_roli_check = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
            const is_maf_player = maf_roli_check.includes(igrok.rol);
            const komanda_mafii = is_maf_player
                ? igra.igroki
                    .filter(i => maf_roli_check.includes(i.rol))
                    .map(i => '№' + i.nomer + ' ' + i.name + ' — ' + i.rol)
                    .join('\n')
                : '';
            const reply_markup_role = is_maf_player
                ? { inline_keyboard: [[{ text: '\uD83D\uDC40 Посмотреть свою команду', callback_data: 'moya_komanda_' + kod }]] }
                : undefined;
            const foto_id = roli_foto[igrok.rol];
            const tekst_roli = opisanie + '\n\n' +
                '\uD83C\uDFB4 Игра \u2116' + kod + '\n' +
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

        const v_igre = igra.igroki.filter(i => i.status === 'v_igre').length;
        let tekst = '\uD83C\uDFAE *Игра \u2116' + kod + '* | День ' + (igra.den || 1) + '\n';
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
            knopki.push([{ text: '\uD83D\uDC4B Начать знакомство', callback_data: 'faza_znakomstvo_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF1E Пропустить к дню', callback_data: 'faza_den_' + kod }]);
        } else if (igra.faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 На голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        } else if (igra.faza === 'noch') {
            knopki.push([{ text: '\uD83C\uDF19 Панель ночи', callback_data: 'noch_panel_' + kod }]);
        }
        knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
        knopki.push([{ text: '\uD83D\uDD04 Обновить', callback_data: 'panel_' + kod }]);
        knopki.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПАНЕЛЬ ФОЛОВ =====
    else if (data.startsWith('panel_foly_')) {
        const kod = data.replace('panel_foly_', '');
        const igra = igry[kod];
        if (!igra) return;

        const knopki = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/3)', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki.push([{ text: '\u2B05\uFE0F К панели', callback_data: 'panel_' + kod }]);

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

        if (igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '\uD83D\uDC80 *Ты выбыл из игры \u2116' + kod + '*\n\nТвоя роль была: *' + igrok.rol + '*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

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

        const knopki2 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбыл', callback_data: 'vybyl_' + kod + '_' + i.nomer }]);
        knopki2.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki2.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
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

        if (igrok.foly >= (igra.max_foly || 3)) {
            igrok.status = 'vybyl';
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\uD83D\uDEAB *Ты удалён из игры \u2116' + kod + '* за 3 фола.\n\nТвоя роль была: *' + igrok.rol + '*',
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            bot.answerCallbackQuery(query.id, { text: '\uD83D\uDEAB ' + igrok.name + ' удалён за 3 фола!', show_alert: true });
            await sohranit_igru(kod);
            const pobeditel = opredelitPobeditelya(igra);
            if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        } else {
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\u26A0\uFE0F *Фол ' + igrok.foly + '/3* в игре \u2116' + kod,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            bot.answerCallbackQuery(query.id, { text: '\u26A0\uFE0F Фол ' + igrok.foly + '/3 — ' + igrok.name });
        }

        const knopki3 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/3)', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki3.push([{ text: '\u2B05\uFE0F К панели', callback_data: 'panel_' + kod }]);

        bot.editMessageText('\u26A0\uFE0F *Выдать фол* — Игра \u2116' + kod + '\n\nВыбери игрока:', {
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
        let nastroyki = {};
        if (igra.klub_id) {
            const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', igra.klub_id).single();
            nastroyki = klub?.nastroyki || {};
        }
        igra._nastroyki = nastroyki;
        igra.max_foly = nastroyki.max_foly || 3;
        igra.faza = 'znakomstvo';
        const alive_z = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.nomer);
        igra.poryadok_hoda = alive_z;
        igra.tekushchiy_nomer = alive_z[0];
        const sek_z = nastroyki.znakomstvo_sek || 15;
        await bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'znakomstvo') } });
        zapustitTaymer(chatId, messageId, kod, sek_z);
    }

    // ===== ФАЗА: ДЕНЬ =====
    else if (data.startsWith('faza_den_')) {
        const kod = data.replace('faza_den_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        igra.faza = 'den';
        // Знакомство идет по часовой стрелке (1 -> N), дневная минута - против часовой.
        const alive_d = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.nomer).reverse();
        // Заблокированный Затычкой пропускает личную минуту.
        igra.poryadok_hoda = alive_d.filter(n => n !== igra.zablokirovan_nomer);
        igra.tekushchiy_nomer = igra.poryadok_hoda[0];
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const sek_d = lichnoeVremyaSek(igra);
        await bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'den') } });
        zapustitTaymer(chatId, messageId, kod, sek_d);
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

    // ===== ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ =====
    else if (data.startsWith('vybrat_na_golos_')) {
        const kod = data.replace('vybrat_na_golos_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        const alive_g = igra.igroki.filter(i => i.status === 'v_igre');
        const uzhe_g = igra.naznacheny_golos || [];
        const knopki_g = alive_g.map(i => [{ text: (uzhe_g.includes(i.nomer) ? '\uD83D\uDCA5 ' : '') + '\u2116' + i.nomer + ' ' + i.name, callback_data: 'golos_toggle_' + kod + '_' + i.nomer }]);
        knopki_g.push([{ text: '\u2705 Начать оправдание (' + uzhe_g.length + ')', callback_data: 'faza_opravdanie_' + kod }]);
        knopki_g.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]);
        bot.editMessageText('\uD83D\uDCA5 *Выставить на голосование*\n\nВыбери игроков:', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_g } });
    }

    // ===== НАЗНАЧИТЬ НА ГОЛОСОВАНИЕ (тоггл) =====
    else if (data.startsWith('golos_toggle_')) {
        const parts_n = data.replace('golos_toggle_', '').split('_');
        const kod = parts_n[0];
        const nomer_n = parseInt(parts_n[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const idx_n = igra.naznacheny_golos.indexOf(nomer_n);
        if (idx_n >= 0) { igra.naznacheny_golos.splice(idx_n, 1); bot.answerCallbackQuery(query.id, { text: 'Снято' }); }
        else { igra.naznacheny_golos.push(nomer_n); bot.answerCallbackQuery(query.id, { text: '\uD83D\uDCA5 Выставлен' }); }
        const alive_n = igra.igroki.filter(i => i.status === 'v_igre');
        const knopki_n = alive_n.map(i => [{ text: (igra.naznacheny_golos.includes(i.nomer) ? '\uD83D\uDCA5 ' : '') + '\u2116' + i.nomer + ' ' + i.name, callback_data: 'golos_toggle_' + kod + '_' + i.nomer }]);
        knopki_n.push([{ text: '\u2705 Начать оправдание (' + igra.naznacheny_golos.length + ')', callback_data: 'faza_opravdanie_' + kod }]);
        knopki_n.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]);
        bot.editMessageText('\uD83D\uDCA5 *Выставить на голосование*\n\nВыбраны: ' + igra.naznacheny_golos.length, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_n } });
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
        igra.faza = 'opravdanie';
        igra.poryadok_hoda = [...igra.naznacheny_golos];
        igra.tekushchiy_nomer = igra.poryadok_hoda[0];
        igra.naznacheny_golos.forEach(nomer => {
            const i = igra.igroki.find(x => x.nomer === nomer);
            if (i?.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDCA5 *Тебя выставили на голосование!*\n\nГотовь оправдание.', { parse_mode: 'Markdown' }).catch(() => {});
        });
        const sek_op = igra._nastroyki?.opravdanie_sek || 25;
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
        const naznacheny_v = (igra.naznacheny_golos || []).map(n => igra.igroki.find(x => x.nomer === n)).filter(Boolean);
        let t_v = '\uD83D\uDDF3 *Голосование*\n\nКто выбывает?\n\n';
        naznacheny_v.forEach((i, idx) => { t_v += (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name + '\n'; });
        const knopki_v = naznacheny_v.map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбывает', callback_data: 'golos_vybyl_' + kod + '_' + i.nomer }]);
        knopki_v.push([{ text: '\u2705 Никто не выбывает', callback_data: 'golos_nikto_' + kod }]);
        knopki_v.push([{ text: '\uD83C\uDF19 К ночи', callback_data: 'faza_noch_' + kod }]);
        bot.editMessageText(t_v, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_v } });
    }

    // ===== ГОЛОСОВАНИЕ: ВЫБЫЛ =====
    else if (data.startsWith('golos_vybyl_')) {
        const parts_gv = data.replace('golos_vybyl_', '').split('_');
        const kod = parts_gv[0];
        const nomer_gv = parseInt(parts_gv[1]);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_gv = igra.igroki.find(i => i.nomer === nomer_gv);
        if (igrok_gv) {
            igrok_gv.status = 'vybyl';
            if (igrok_gv.telegram_id) bot.sendMessage(igrok_gv.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + igrok_gv.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        }
        igra.naznacheny_golos = [];
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 ' + (igrok_gv?.name || '') + ' выбыл' });
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.faza = 'noch';
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ГОЛОСОВАНИЕ: НИКТО =====
    else if (data.startsWith('golos_nikto_')) {
        const kod = data.replace('golos_nikto_', '');
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = [];
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
        await sohranit_igru(kod);
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== НОЧЬ: выбор цели мафии =====
    else if (data.startsWith('noch_vybor_maf_')) {
        const kod = data.replace('noch_vybor_maf_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_maf = igra.igroki.filter(i => i.status === 'v_igre' && !['Дон', 'Мафия', 'Эскортница'].includes(i.rol));
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
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD2B Мафия выбрала \u2116' + nomer_nm);
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
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.doctor_tseli = nomer_nd;
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC89 Вылечит \u2116' + nomer_nd });
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
        const is_maf = tseli_s && ['Дон', 'Мафия', 'Эскортница'].includes(tseli_s.rol);
        const result_s = is_maf ? '\uD83D\uDD34 МАФИЯ' : '\u2705 Мирный';
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD0D \u2116' + nomer_ns + ': ' + result_s, show_alert: true });
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD0D Шериф проверил \u2116' + nomer_ns + ': ' + result_s);
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

        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD07 Затычка заблокировала \u2116' + nomer_nz);
    }

    // ===== НОЧЬ: итоги =====
    else if (data.startsWith('noch_itog_')) {
        const kod = data.replace('noch_itog_', '');
        const igra = igry[kod];
        if (!igra) return;
        const d = igra.noch_deystviya || {};
        const maf_t = d.mafiya_tseli || [];
        const doc_t = d.doctor_tseli;
        let itog_t = '\uD83C\uDF19 *Итоги ночи ' + (igra.den || 1) + ':*\n\n';
        const ubity_t = [];
        maf_t.forEach(nomer => {
            const i = igra.igroki.find(x => x.nomer === nomer);
            if (!i) return;
            if (doc_t === nomer) { itog_t += '\uD83D\uDC89 \u2116' + nomer + ' *' + i.name + '* — спасён доктором\n'; }
            else { i.status = 'vybyl'; ubity_t.push(i); itog_t += '\uD83D\uDC80 \u2116' + nomer + ' *' + i.name + '* (' + i.rol + ') — убит\n'; }
        });
        if (maf_t.length === 0) itog_t += '_Мафия не выбрала цель_\n';
        const v_igre_t = igra.igroki.filter(i => i.status === 'v_igre');
        itog_t += '\n\uD83D\uDC65 *За столом: ' + v_igre_t.length + '*\n';
        v_igre_t.forEach(i => { itog_t += '\u2705 \u2116' + i.nomer + ' ' + i.name + '\n'; });
        ubity_t.forEach(i => { bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Тебя убили ночью.*\n\nТвоя роль: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {}); });
        igra.noch_deystviya = {};
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.den = (igra.den || 1) + 1;
        await sohranit_igru(kod);
        bot.editMessageText(itog_t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '\uD83C\uDF1E Начать день ' + igra.den, callback_data: 'faza_den_' + kod }],
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
        t += '\u26A0\uFE0F Оправдание: ' + (n.opravdanie_sek || 25) + ' сек\n';
        t += '\uD83D\uDD34 Макс. фолов: ' + (n.max_foly || 3) + '\n\n';
        t += '*Баллы:*\n';
        const b = n.bally || BALLY_DEFAULT;
        t += '\uD83D\uDFE2 Победа команды: +' + (b.pobeda_komanda ?? 3) + '\n';
        t += '\uD83D\uDFE1 Выжил: +' + (b.vyzhil ?? 1) + '\n';
        t += '\uD83D\uDD34 Дон победил: +' + (b.bonus_don_pobedil ?? 2) + '\n';
        t += '\uD83C\uDFAF Маньяк победил: +' + (b.bonus_manyak_pobedil ?? 5) + '\n';

        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_nk.id }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_nk.id }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_nk.id }],
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
        t_ts += '\u26A0\uFE0F Оправдание: ' + (n_ts.opravdanie_sek || 25) + ' сек\n';
        t_ts += '\uD83D\uDD34 Макс. фолов: ' + (n_ts.max_foly || 3) + '\n';
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

        let t_mr = '\uD83C\uDFC6 *Мой рейтинг*\n\n';
        t_mr += '\uD83D\uDC64 ' + (igrok_mr.igrovoy_nik || igrok_mr.imya) + '\n\n';
        t_mr += '\uD83C\uDFB2 Игр сыграно: *' + vsego_igr + '*\n';
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
        const maf_roli_k = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник', 'Консильери'];
        if (!igrok_req || !maf_roli_k.includes(igrok_req.rol)) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Только команда мафии может это видеть', show_alert: true });
            return;
        }

        // Собираем всю мафию
        const komanda = igra.igroki.filter(i => maf_roli_k.includes(i.rol));
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
            'Создай личную игру и пригласи друзей по коду.\n\n' +
            '\uD83D\uDCCB Правила на выбор — Паскаль, ВИП или Наиля\n' +
            '\uD83D\uDC65 От 8 до 20 игроков\n' +
            '\uD83C\uDFC6 Без рейтинга — просто для удовольствия\n\n' +
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
            '\uD83C\uDFB2 *Создать игру с друзьями*\n\nКакие правила?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFAD Паскаль', callback_data: 'druzya_tip_paskal' }],
                [{ text: '\uD83C\uDFD9 VIP (городская)', callback_data: 'druzya_tip_vip' }],
                [{ text: '\uD83C\uDF06 Наиля / Москва', callback_data: 'druzya_tip_naila' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: выбор количества =====
    else if (data.startsWith('druzya_tip_')) {
        const tip_d = data.replace('druzya_tip_', '');
        const tip_names_d = { paskal: 'Паскаль', vip: 'VIP', naila: 'Наиля' };
        const kol_knopki_d = [];
        for (let i = 0; i < 13; i += 4) {
            kol_knopki_d.push([8,9,10,11].slice(i > 0 ? i-8 : 0, i > 0 ? i-4 : 4).filter(n => n).map(n => ({
                text: String(n), callback_data: 'druzya_kol_' + tip_d + '_' + n
            })));
        }
        // Проще — строки по 4
        const vse_kol = [8,9,10,11,12,13,14,15,16,17,18,19,20];
        const rows_d = [];
        for (let i = 0; i < vse_kol.length; i += 4) {
            rows_d.push(vse_kol.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'druzya_kol_' + tip_d + '_' + n })));
        }
        rows_d.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_sozdat' }]);

        bot.editMessageText(
            '\uD83C\uDFB2 *' + (tip_names_d[tip_d] || tip_d) + '*\n\nСколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows_d }
        });
    }

    // ===== ДРУЗЬЯ: предпросмотр и "оплата" =====
    else if (data.startsWith('druzya_kol_')) {
        const parts_dk = data.replace('druzya_kol_', '').split('_');
        const tip_dk = parts_dk[0];
        const kol_dk = parseInt(parts_dk[1]);

        const preview_dk = pokazat_sostav_preview(kol_dk, tip_dk, {});
        if (!preview_dk) { bot.answerCallbackQuery(query.id, { text: '\u274C Нет состава', show_alert: true }); return; }

        bot.editMessageText(
            preview_dk.text + '\n\n' +
            '\uD83D\uDCB0 *Стоимость: 99 ₽*\n' +
            '_Нажми "Оплатить и создать" для запуска_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDCB3 Оплатить и создать (99 ₽)', callback_data: 'druzya_oplata_' + tip_dk + '_' + kol_dk }],
                [{ text: '\u270F\uFE0F Изменить состав', callback_data: 'druzya_edit_' + tip_dk + '_' + kol_dk }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_tip_' + tip_dk }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: "оплата" (заглушка) → создать игру =====
    else if (data.startsWith('druzya_oplata_')) {
        const parts_op = data.replace('druzya_oplata_', '').split('_');
        const tip_op = parts_op[0];
        const kol_op = parseInt(parts_op[1]);

        // ЗАГЛУШКА ОПЛАТЫ — в будущем подключить ЮKassa/Telegram Stars
        // Пока создаём игру бесплатно для тестирования
        const kod = sgenerirovat_kod();
        const preview_op = pokazat_sostav_preview(kol_op, tip_op, {});

        igry[kod] = {
            kolichestvo: kol_op,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            klub_id: null,
            tip_kluba: tip_op,
            sportivniy: false,
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
    else if (data === 'druzya_войти') {
        sostoyanie[telegram_id] = 'vvodit_kod_druzya';
        bot.editMessageText(
            '\uD83D\uDD11 *Войти в игру друга*\n\nВведи код игры:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]] }
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

    // ===== СОБСТВЕННИК: сделать ведущим =====
    else if (data.startsWith('vd_')) {
        const p = cbUnpack(data.replace('vd_', ''));
        if (!p) return;
        const { error } = await supabase.from('chleny_klubov').update({ rol: ROL_VEDUSHCHIY })
            .eq('klub_id', p.klub_id).eq('igrok_id', p.igrok_id);
        if (error) {
            console.error('Ошибка назначения ведущего:', error);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('vedushii_')) {
        const chasti = data.replace('vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        const { error } = await supabase.from('chleny_klubov').update({ rol: ROL_VEDUSHCHIY })
            .eq('klub_id', klub_id).eq('igrok_id', igrok_id);
        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
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
        const { data: igrok, error: err1 } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .eq('rol', 'vladyelets');

        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            // Сразу к поиску
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
        const p = cbUnpack(data.replace('ncfm_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Повтори поиск', show_alert: true }); return; }
        const klub_id = p.klub_id;
        const igrok_id = p.igrok_id;

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
                [{ text: '✅ Да, назначить', callback_data: cbBtn('nok_', { klub_id, igrok_id }) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('naznach_podtverd_')) {
        const parts = data.replace('naznach_podtverd_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');

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
                [{ text: '✅ Да, назначить', callback_data: cbBtn('nok_', { klub_id, igrok_id }) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('nok_')) {
        const p = cbUnpack(data.replace('nok_', ''));
        if (!p) return;
        const klub_id = p.klub_id;
        const igrok_id = p.igrok_id;

        const { data: sushch } = await supabase
            .from('chleny_klubov')
            .select('id, rol')
            .eq('klub_id', klub_id)
            .eq('igrok_id', igrok_id)
            .single();

        if (sushch) {
            await supabase.from('chleny_klubov').update({ rol: ROL_VEDUSHCHIY }).eq('id', sushch.id);
        } else {
            await supabase.from('chleny_klubov').insert({ klub_id, igrok_id, rol: ROL_VEDUSHCHIY });
        }

        const { data: igrok } = await supabase.from('igroki').select('imya, tg_id').eq('id', igrok_id).single();
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();

        bot.editMessageText('✅ *' + (igrok?.imya || 'Игрок') + '* назначен ведущим!', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎤 Назначить ещё', callback_data: 'naznachit_vedushchego' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
            ]}
        });
        if (igrok?.tg_id) {
            bot.sendMessage(igrok.tg_id,
                '🎤 *Вас назначили ведущим!*\n\n🎴 Клуб: *' + (klub?.nazvaniye || '') + '*\n\nНапиши /start чтобы открыть меню ведущего.',
                { parse_mode: 'Markdown' }
            );
        }
    }

    else if (data.startsWith('naznach_ok_')) {
        const parts = data.replace('naznach_ok_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');

        // Проверяем есть ли уже в клубе
        const { data: sushch } = await supabase
            .from('chleny_klubov')
            .select('id, rol')
            .eq('klub_id', klub_id)
            .eq('igrok_id', igrok_id)
            .single();

        if (sushch) {
            // Обновляем роль
            await supabase.from('chleny_klubov')
                .update({ rol: ROL_VEDUSHCHIY })
                .eq('id', sushch.id);
        } else {
            // Добавляем в клуб
            await supabase.from('chleny_klubov')
                .insert({ klub_id, igrok_id, rol: ROL_VEDUSHCHIY });
        }

        const { data: igrok } = await supabase
            .from('igroki').select('imya, tg_id').eq('id', igrok_id).single();

        const { data: klub } = await supabase
            .from('kluby').select('nazvaniye').eq('id', klub_id).single();

        bot.editMessageText('✅ *' + (igrok?.imya || 'Игрок') + '* назначен ведущим!', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎤 Назначить ещё', callback_data: 'naznachit_vedushchego' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
            ]}
        });

        // Уведомляем ведущего
        if (igrok?.tg_id) {
            bot.sendMessage(igrok.tg_id,
                '🎤 *Вас назначили ведущим!*\n\n' +
                '🎴 Клуб: *' + (klub?.nazvaniye || '') + '*\n\n' +
                'Теперь вам доступно меню ведущего. Напиши /start чтобы открыть его.',
                { parse_mode: 'Markdown' }
            );
        }
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
        .select('nazvaniye')
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
        const username = i.tg_username ? ' (@' + i.tg_username + ')' : '';
        const knopka_text = rol_emoji + (i.imya || 'Без имени') + username;
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
        .select('nazvaniye')
        .eq('id', klub_id)
        .single();

    let tekst = '👤 *Карточка игрока*\n\n';
    tekst += '*Имя:* ' + (igrok.imya || 'Без имени') + '\n';
    if (igrok.tg_username) tekst += '*Telegram:* @' + igrok.tg_username.replace(/_/g, '\\_') + '\n';
    if (igrok.telefon) tekst += '*Телефон:* ' + igrok.telefon + '\n';
    tekst += '*Роль в клубе ' + (klub?.nazvaniye || '') + ':* ' + rol_text;

    const knopki = [];

    if (rol === 'vladyelets') {
        knopki.push([{ text: '⚠️ Это собственник клуба', callback_data: 'baza_noop' }]);
    } else if (isVedushchiy(rol)) {
        knopki.push([{ text: '↩️ Снять роль ведущего', callback_data: cbBtn('sv_', { klub_id, igrok_id }) }]);
    } else {
        knopki.push([{ text: '🎤 Сделать ведущим', callback_data: cbBtn('vd_', { klub_id, igrok_id }) }]);
    }

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
