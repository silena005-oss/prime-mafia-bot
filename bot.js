// ============================================
// PrimeMafia — Telegram бот
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
// ПАМЯТЬ БОТА
// ============================================

const sostoyanie = {};
const igry = {};
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
    do { kod = String(Math.floor(1000 + Math.random() * 9000)); } while (igry[kod]);
    return kod;
}

// ============================================
// МЕНЮ
// ============================================

const menu_vedushchego = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_igroka = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }]
        ]
    }
};

const menu_vladeltsa = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 Аналитика', callback_data: 'analitika' }],
            [{ text: '👥 База игроков', callback_data: 'baza_igrokov' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }],
            [{ text: '🔑 Передать права на клуб', callback_data: 'peredat_prava' }]
        ]
    }
};

const menu_kolichestva = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '8', callback_data: 'create_8' }, { text: '9', callback_data: 'create_9' }, { text: '10', callback_data: 'create_10' }, { text: '11', callback_data: 'create_11' }],
            [{ text: '12', callback_data: 'create_12' }, { text: '13', callback_data: 'create_13' }, { text: '14', callback_data: 'create_14' }, { text: '15', callback_data: 'create_15' }],
            [{ text: '16', callback_data: 'create_16' }, { text: '17', callback_data: 'create_17' }, { text: '18', callback_data: 'create_18' }],
            [{ text: '19', callback_data: 'create_19' }, { text: '20', callback_data: 'create_20' }],
            [{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]
        ]
    }
};

// ============================================
// КОМАНДА /start
// ============================================

bot.onText(/\/start/, async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;

    const { data: igrok } = await supabase.from('igroki').select('*').eq('tg_id', tg_id).single();

    if (igrok) {
        const { data: membership } = await supabase
            .from('chleny_klubov').select('rol').eq('igrok_id', igrok.id)
            .order('dobavlen_v', { ascending: false }).limit(1).single();

        const rol = membership?.rol || 'igrok';

        if (rol === 'vladyelets') {
            bot.sendMessage(chatId, `🏛 *Привет, ${igrok.imya}!*\n\nМеню собственника`, { parse_mode: 'Markdown', ...menu_vladeltsa });
        } else if (rol === 'vedushchiy') {
            bot.sendMessage(chatId, `🎭 *Привет, ${igrok.imya}!*\n\nМеню ведущего`, { parse_mode: 'Markdown', ...menu_vedushchego });
        } else {
            bot.sendMessage(chatId, `🎴 *Привет, ${igrok.imya}!*\n\nМеню игрока`, { parse_mode: 'Markdown', ...menu_igroka });
        }
    } else {
        ozhidanie_registracii[tg_id] = { shag: 'imya' };
        bot.sendMessage(chatId, '👋 *Добро пожаловать в Prime Mafia!*\n\nДля регистрации введи своё *имя и фамилию*:', { parse_mode: 'Markdown' });
    }
});

// ============================================
// ОБРАБОТКА СООБЩЕНИЙ
// ============================================

bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const text = (msg.text || '').trim();

    if (text.startsWith('/')) return;

    // Регистрация: имя
    if (ozhidanie_registracii[tg_id]?.shag === 'imya') {
        if (text.length < 2) { bot.sendMessage(chatId, '❌ Введи настоящее имя (минимум 2 символа).'); return; }
        ozhidanie_registracii[tg_id].imya = text;
        ozhidanie_registracii[tg_id].shag = 'telefon';
        bot.sendMessage(chatId, `✅ Отлично, *${text}*!\n\nТеперь поделись номером телефона:`, {
            parse_mode: 'Markdown',
            reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
        return;
    }

    // Регистрация: телефон
    if (msg.contact && ozhidanie_registracii[tg_id]?.shag === 'telefon') {
        const { imya } = ozhidanie_registracii[tg_id];
        const telefon = msg.contact.phone_number;
        const tg_username = msg.from.username || '';
        const { error } = await supabase.from('igroki').insert({ tg_id, tg_username, imya, telefon });
        delete ozhidanie_registracii[tg_id];
        if (error) {
            console.error('Ошибка сохранения:', error);
            bot.sendMessage(chatId, '❌ Ошибка регистрации. Попробуй — /start', { reply_markup: { remove_keyboard: true } });
            return;
        }
        bot.sendMessage(chatId, `🎉 *Регистрация завершена!*\n\n👤 ${imya}\n📱 ${telefon}\n\nДобро пожаловать в Prime Mafia!`, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
        setTimeout(() => bot.sendMessage(chatId, '🎴 *Меню игрока*\n\nЧто хочешь сделать?', { parse_mode: 'Markdown', ...menu_igroka }), 500);
        return;
    }

    // Передача прав: ввод username
    if (ozhidanie_registracii[tg_id]?.shag === 'peredat_prava') {
        const novyi_username = text.replace('@', '').trim();
        const { data: novyi_igrok } = await supabase.from('igroki').select('*').eq('tg_username', novyi_username).single();
        if (!novyi_igrok) {
            bot.sendMessage(chatId, `❌ Игрок @${novyi_username} не найден.\n\nОн должен сначала зарегистрироваться в боте.`);
            delete ozhidanie_registracii[tg_id];
            return;
        }
        const { data: klub } = await supabase.from('kluby').select('*').eq('owner_tg_id', tg_id).single();
        if (!klub) { bot.sendMessage(chatId, '❌ Клуб не найден.'); delete ozhidanie_registracii[tg_id]; return; }

        await supabase.from('kluby').update({ owner_tg_id: novyi_igrok.tg_id }).eq('id', klub.id);
        const { data: staryy } = await supabase.from('igroki').select('id').eq('tg_id', tg_id).single();
        await supabase.from('chleny_klubov').update({ rol: 'igrok' }).eq('igrok_id', staryy.id).eq('klub_id', klub.id);
        await supabase.from('chleny_klubov').upsert({ klub_id: klub.id, igrok_id: novyi_igrok.id, rol: 'vladyelets' }, { onConflict: 'klub_id,igrok_id' });

        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId, `✅ *Права переданы!*\n\nКлуб *${klub.nazvaniye}* теперь принадлежит @${novyi_username}.`, { parse_mode: 'Markdown', ...menu_igroka });
        bot.sendMessage(novyi_igrok.tg_id, `🎉 *Поздравляем!*\n\nВам переданы права на клуб *${klub.nazvaniye}*.`, { parse_mode: 'Markdown', ...menu_vladeltsa });
        return;
    }

    // Ввод кода игры
    if (sostoyanie[tg_id] === 'vvodit_kod') {
        const kod = text;
        if (!/^\d{4}$/.test(kod)) { bot.sendMessage(chatId, '❌ Код должен быть из 4 цифр.'); return; }
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра с кодом *' + kod + '* не найдена.', { parse_mode: 'Markdown' }); return; }
        if (igra.roli_razdany) { bot.sendMessage(chatId, '⚠️ Эта игра уже началась.'); delete sostoyanie[tg_id]; return; }
        if (igra.igroki.find(i => i.telegram_id === tg_id)) { bot.sendMessage(chatId, '⚠️ Ты уже в этой игре.'); delete sostoyanie[tg_id]; return; }
        if (igra.igroki.length >= igra.kolichestvo) { bot.sendMessage(chatId, '❌ Все места заняты.'); delete sostoyanie[tg_id]; return; }

        const nomer = igra.igroki.length + 1;
        const name = msg.from.first_name || 'Игрок ' + nomer;
        igra.igroki.push({ telegram_id: tg_id, name, nomer });
        delete sostoyanie[tg_id];

        bot.sendMessage(chatId, '✅ *Ты подключён!*\n\n🎴 Игра №' + kod + '\n👤 Номер: *' + nomer + '*\n👥 ' + igra.igroki.length + '/' + igra.kolichestvo + '\n\n_Жди раздачи ролей..._', { parse_mode: 'Markdown' });
        bot.sendMessage(igra.vedushchii_id, '👤 *Подключился №' + nomer + '* — ' + name + '\n👥 ' + igra.igroki.length + '/' + igra.kolichestvo, { parse_mode: 'Markdown' });

        if (igra.igroki.length === igra.kolichestvo) {
            bot.sendMessage(igra.vedushchii_id, '🎉 *Все в сборе!* Можно раздавать роли.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴 Раздать роли', callback_data: 'razdat_' + kod }]] } });
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

    if (data === 'menu_vedushchego') {
        bot.editMessageText('🎙 *Меню ведущего*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...menu_vedushchego });
    } else if (data === 'menu_igroka') {
        bot.editMessageText('🎴 *Меню игрока*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...menu_igroka });
    } else if (data === 'menu_vladeltsa') {
        bot.editMessageText('🏛 *Меню собственника*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...menu_vladeltsa });
    } else if (data === 'peredat_prava') {
        ozhidanie_registracii[telegram_id] = { shag: 'peredat_prava' };
        bot.editMessageText('🔑 *Передача прав*\n\n⚠️ После передачи ты потеряешь права собственника.\n\nВведи *@username* нового владельца:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
    } else if (data === 'sozdat_igru') {
        bot.editMessageText('🎲 *На сколько игроков?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...menu_kolichestva });
    } else if (data.startsWith('create_')) {
        const kolichestvo = parseInt(data.replace('create_', ''));
        const kod = sgenerirovat_kod();
        igry[kod] = { kod, kolichestvo, vedushchii_id: telegram_id, igroki: [], roli_razdany: false };
        bot.editMessageText('✅ *Игра создана!*\n\n🎴 Код: *' + kod + '*\n👥 Мест: ' + kolichestvo + '\n\n_Жди игроков..._', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'otmenit_' + kod }], [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] }
        });
    } else if (data.startsWith('razdat_')) {
        const kod = data.replace('razdat_', '');
        const igra = igry[kod];
        if (!igra || igra.roli_razdany) { bot.sendMessage(chatId, igra ? '⚠️ Роли уже розданы.' : '❌ Игра не найдена.'); return; }
        const peremeshannye = peremeshat(sostavy[igra.kolichestvo]);
        for (let i = 0; i < igra.igroki.length; i++) igra.igroki[i].rol = peremeshannye[i];
        igra.roli_razdany = true;
        for (const igrok of igra.igroki) {
            bot.sendMessage(igrok.telegram_id, '🎭 *Твоя роль:*\n\n*' + igrok.rol + '*\n\n🎴 Игра №' + kod + '\n👤 Ты №' + igrok.nomer + '\n\n🤫 _Никому не показывай!_', { parse_mode: 'Markdown' });
        }
        let svodka = '🎴 *Роли разданы!*\n\n';
        for (const igrok of igra.igroki) svodka += '№' + igrok.nomer + ' ' + igrok.name + ' → *' + igrok.rol + '*\n';
        bot.sendMessage(chatId, svodka, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] } });
    } else if (data.startsWith('otmenit_')) {
        const kod = data.replace('otmenit_', '');
        const igra = igry[kod];
        if (igra) { for (const i of igra.igroki) bot.sendMessage(i.telegram_id, '❌ Игра №' + kod + ' отменена.'); delete igry[kod]; }
        bot.editMessageText('❌ *Игра отменена.*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] } });
    } else if (data === 'voiti_v_igru') {
        sostoyanie[telegram_id] = 'vvodit_kod';
        bot.editMessageText('🎮 *Введи код игры*\n\n_4 цифры от ведущего:_', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_igroka' }]] } });
    } else if (data === 'podderzhka') {
        bot.editMessageText('💬 *Поддержка*\n\n📧 silena005@gmail.com\n💬 @prime\\_mafia\\_sochi\n\n⏱ Ответим в течение 24 часов', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]] } });
    } else if (data === 'analitika') {
        bot.editMessageText('📊 *Аналитика*\n\n_Раздел в разработке_', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] } });
    } else if (data === 'baza_igrokov') {
        bot.editMessageText('👥 *База игроков*\n\n_Раздел в разработке_', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] } });
    }
});
