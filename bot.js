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
    console.log('❌ TELEGRAM_TOKEN не найден в .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('🎴 PrimeMafia бот запущен!');

// ============================================
// СОСТАВЫ
// ============================================

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

// ============================================
// ПАМЯТЬ БОТА (временная, до полного перехода на БД)
// ============================================

const sostoyanie = {}; // { telegram_id: 'vvodit_kod' | 'baza_poisk_<klub_id>' }
const igry = {};       // активные игры в памяти

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
            [{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_vladeltsa = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 Аналитика', callback_data: 'analitika' }],
            [{ text: '👥 База игроков', callback_data: 'baza_igrokov' }],
            [{ text: '📢 Создать анонс игры', callback_data: 'anons_vybor_kluba' }],
            [{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_vse' }],
            [{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }],
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

bot.onText(/\/start/, async function(msg) {
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
        } else if (rol === 'vedushchiy') {
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
        bot.sendMessage(chatId,
            '👋 *Добро пожаловать в Prime Mafia!*\n\n' +
            'Для регистрации введи своё *имя и фамилию*:',
            { parse_mode: 'Markdown' }
        );
    }
});

// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================

bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const text = (msg.text || '').trim();

    // Игнорируем команды
    if (text.startsWith('/')) return;

    // ===== РЕГИСТРАЦИЯ: шаг 1 — имя =====
    if (ozhidanie_registracii[tg_id]?.shag === 'imya') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Введи настоящее имя (минимум 2 символа).');
            return;
        }
        ozhidanie_registracii[tg_id].imya = text;
        ozhidanie_registracii[tg_id].shag = 'telefon';

        bot.sendMessage(chatId,
            `✅ Отлично, *${text}*!\n\n` +
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
        if (pole === 'data') update.data_igry = text.trim();
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
        delete sostoyanie[tg_id];
        ozhidanie_registracii[tg_id] = { shag: 'anons_vremya', klub_id, data_igry: text.trim() };
        bot.sendMessage(chatId, '📢 *Создание анонса*\n\n*Дата:* ' + text.trim() + '\n\n🕐 Введи время игры:\n_Пример: 19:00_', {
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
            bot.sendMessage(igra.vedushchii_id,
                '🎉 *Все игроки в сборе!*\n\nМожно раздавать роли.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🎴 Раздать роли', callback_data: 'razdat_' + kod }
                        ]]
                    }
                }
            );
        }
    }
});

// ============================================
// ОБРАБОТКА КНОПОК
// ============================================

bot.on('callback_query', async function(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const telegram_id = query.from.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

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
            '👤 ' + dannye.imya + '\n' +
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

        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, kluby(nazvaniye)')
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(10);

        // Фильтруем по городу клуба
        const filtr = (anonsy || []).filter(a => {
            // Пока фильтруем через adres содержащий город (упрощённо)
            // В будущем — через gorod_id клуба
            return true;
        });

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
            tekst += '   📅 ' + a.data_igry + ' в ' + (a.vremya || '') + '\n';
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
            .from('igroki').select('imya, gorod').eq('tg_id', telegram_id).single();

        bot.editMessageText(
            '⚙️ *Настройки*\n\n' +
            '👤 ' + (igrok?.imya || '') + '\n' +
            '📍 Город: ' + (igrok?.gorod || 'не указан'), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
            ]}
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
        bot.editMessageText('🎲 *На сколько игроков игра?*', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_kolichestva
        });
    }

    else if (data.startsWith('create_')) {
        const kolichestvo = parseInt(data.replace('create_', ''));
        const kod = sgenerirovat_kod();

        igry[kod] = {
            kod: kod,
            kolichestvo: kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false
        };

        const text = '✅ *Игра создана!*\n\n' +
                     '🎴 Код игры: *' + kod + '*\n' +
                     '👥 Мест: ' + kolichestvo + '\n\n' +
                     '*Передай код игрокам.*\n' +
                     'Подключено: 0/' + kolichestvo + '\n\n' +
                     '_Жди пока все подключатся..._';

        bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить игру', callback_data: 'otmenit_' + kod }],
                    [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
                ]
            }
        });
    }

    // ===== ВЕДУЩИЙ: раздать роли =====
    else if (data.startsWith('razdat_')) {
        const kod = data.replace('razdat_', '');
        const igra = igry[kod];

        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if (igra.roli_razdany) { bot.sendMessage(chatId, '⚠️ Роли уже розданы.'); return; }

        const sostav = sostavy[igra.kolichestvo];
        const peremeshannye = peremeshat(sostav);

        for (let i = 0; i < igra.igroki.length; i++) {
            igra.igroki[i].rol = peremeshannye[i];
        }
        igra.roli_razdany = true;

        for (const igrok of igra.igroki) {
            bot.sendMessage(igrok.telegram_id,
                '🎭 *Твоя роль:*\n\n*' + igrok.rol + '*\n\n' +
                '🎴 Игра №' + kod + '\n' +
                '👤 Ты — игрок №' + igrok.nomer + '\n\n' +
                '🤫 _Никому не показывай!_',
                { parse_mode: 'Markdown' }
            );
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
            reply_markup: { inline_keyboard: [[{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] }
        });
    }

    // ===== ВЕДУЩИЙ: отменить игру =====
    else if (data.startsWith('otmenit_')) {
        const kod = data.replace('otmenit_', '');
        const igra = igry[kod];

        if (igra) {
            for (const igrok of igra.igroki) {
                bot.sendMessage(igrok.telegram_id, '❌ Ведущий отменил игру №' + kod);
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
            { text: '🎴 ' + k.nazvaniye, callback_data: 'baza_klub_' + k.id + '_0' }
        ]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

        bot.editMessageText('👥 *База игроков*\n\nВыберите клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('baza_klub_')) {
        // Формат: baza_klub_<klub_id>_<page>
        const chasti = data.replace('baza_klub_', '').split('_');
        const klub_id = chasti[0];
        const stranitsa = parseInt(chasti[1]) || 0;
        const filtr = sostoyanie['baza_filtr_' + telegram_id] || '';
        await pokazat_bazu_igrokov(chatId, messageId, klub_id, stranitsa, filtr);
    }

    else if (data.startsWith('baza_poisk_')) {
        const klub_id = data.replace('baza_poisk_', '');
        sostoyanie[telegram_id] = 'baza_poisk_' + klub_id;
        bot.editMessageText('🔍 *Поиск игрока*\n\nВведите часть имени или никнейма:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '⬅️ Отмена', callback_data: 'baza_klub_' + klub_id + '_0' }
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
    else if (data.startsWith('igrok_')) {
        const chasti = data.replace('igrok_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti[1];
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    // ===== СОБСТВЕННИК: сделать ведущим =====
    else if (data.startsWith('vedushii_')) {
        const chasti = data.replace('vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti[1];

        const { error } = await supabase
            .from('chleny_klubov')
            .update({ rol: 'vedushchii' })
            .eq('klub_id', klub_id)
            .eq('igrok_id', igrok_id);

        if (error) {
            console.error('Ошибка назначения ведущего:', error);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    // ===== СОБСТВЕННИК: снять роль ведущего =====
    else if (data.startsWith('snyat_vedushii_')) {
        const chasti = data.replace('snyat_vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti[1];

        const { error } = await supabase
            .from('chleny_klubov')
            .update({ rol: 'igrok' })
            .eq('klub_id', klub_id)
            .eq('igrok_id', igrok_id);

        if (error) {
            console.error('Ошибка снятия роли:', error);
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
            .in('rol', ['vladyelets', 'vedushchiy']);

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

    // ===== МОИ АНОНСЫ =====
    else if (data === 'moi_anonsy_vse' || data.startsWith('moi_anonsy_')) {
        const klub_id = data === 'moi_anonsy_vse' ? null : data.replace('moi_anonsy_', '');

        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        let query = supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, status, kluby(nazvaniye)')
            .eq('vedushchiy_id', igrok?.id)
            .order('data_igry', { ascending: false })
            .limit(10);

        if (klub_id) query = query.eq('klub_id', klub_id);

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
            tekst += '   📅 ' + a.data_igry + ' в ' + (a.vremya || '') + '\n';
            tekst += '   📍 ' + (a.adres || '') + '\n\n';
            knopki.push([{ text: status_emoji + ' ' + a.data_igry + ' ' + (a.vremya || '') + ' — ' + (a.kluby?.nazvaniye || ''), callback_data: 'anons_card_' + a.id }]);
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
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

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
            bot.answerCallbackQuery(query.id, { text: '✅ Ты уже записан на эту игру!', show_alert: true });
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
            .in('rol', ['vladyelets', 'vedushchii']);

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
        igroki_spisok = igroki_spisok.filter(i =>
            (i.imya || '').toLowerCase().includes(f) ||
            (i.tg_username || '').toLowerCase().includes(f)
        );
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
                        : i.rol === 'vedushchii' ? '🎤 '
                        : '';
        const username = i.tg_username ? ' (@' + i.tg_username + ')' : '';
        const knopka_text = rol_emoji + (i.imya || 'Без имени') + username;
        knopki.push([{
            text: knopka_text,
            callback_data: 'igrok_' + klub_id + '_' + i.id
        }]);
    });

    if (stranits_vsego > 1) {
        const navig = [];
        if (stranitsa > 0) navig.push({ text: '⬅️', callback_data: 'baza_klub_' + klub_id + '_' + (stranitsa - 1) });
        navig.push({ text: (stranitsa + 1) + '/' + stranits_vsego, callback_data: 'baza_noop' });
        if (stranitsa < stranits_vsego - 1) navig.push({ text: '➡️', callback_data: 'baza_klub_' + klub_id + '_' + (stranitsa + 1) });
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
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'baza_klub_' + klub_id + '_0' }]] }
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
                    : rol === 'vedushchii' ? '🎤 Ведущий'
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
    } else if (rol === 'vedushchii') {
        knopki.push([{ text: '↩️ Снять роль ведущего', callback_data: 'snyat_vedushii_' + klub_id + '_' + igrok_id }]);
    } else {
        knopki.push([{ text: '🎤 Сделать ведущим', callback_data: 'vedushii_' + klub_id + '_' + igrok_id }]);
    }

    knopki.push([{ text: '⬅️ К списку', callback_data: 'baza_klub_' + klub_id + '_0' }]);

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
        '📅 ' + dannye.data_igry + ' в ' + dannye.vremya + '\n' +
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
    tekst += '📅 ' + a.data_igry + ' в ' + (a.vremya || '') + '\n';
    tekst += '📍 ' + (a.adres || '') + '\n';
    if (a.kommentariy) tekst += '💬 ' + a.kommentariy + '\n';
    tekst += '\nСтатус: ' + status_emoji;

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '✏️ Редактировать', callback_data: 'anons_edit_' + a.id }],
            [{ text: '🗑 Удалить', callback_data: 'anons_delete_confirm_' + a.id }],
            [{ text: '⬅️ Мои анонсы', callback_data: 'moi_anonsy_' + a.klub_id }]
        ]}
    });
}
