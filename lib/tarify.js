const PLANY = [
    {
        id: 'mini',
        name: 'Mini',
        price: 3999,
        razovo: 3999,
        games: 10,
        vedushchie: 1,
        features: '1 ведущий · до 10 игр · таймеры, фазы, голосование, рейтинг (без рассылки приглашений)'
    },
    {
        id: 'start',
        name: 'Start',
        price: 7900,
        games: 12,
        vedushchie: 2,
        features: '2 ведущих · анонсы и рассылка приглашений базе, рейтинг и история'
    },
    {
        id: 'club',
        name: 'Club',
        price: 12900,
        games: 12,
        vedushchie: 2,
        features: 'Свои правила, анонсы, рассылка приглашений, отчёт вечера'
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 19900,
        games: 30,
        vedushchie: 5,
        features: 'До 30 игр · рассылка, анонсы, расширенная статистика, приоритет'
    }
];

const NETWORK = {
    id: 'network',
    name: 'Network',
    priceFrom: 35000,
    features: 'Сеть клубов, города, отдельные рейтинги, внедрение'
};

const STILIZATSIYA_PRICE = 5000;

/** Доступ к функциям по тарифу (test = полный доступ на пробный период). */
const FUNKTSII = {
    none: { rassylka_priglasheniy: false, anonsy: false, publikaciya_gruppa: false },
    mini: { rassylka_priglasheniy: false, anonsy: false, publikaciya_gruppa: true },
    test: { rassylka_priglasheniy: true, anonsy: true, publikaciya_gruppa: true },
    start: { rassylka_priglasheniy: true, anonsy: true, publikaciya_gruppa: true },
    club: { rassylka_priglasheniy: true, anonsy: true, publikaciya_gruppa: true },
    pro: { rassylka_priglasheniy: true, anonsy: true, publikaciya_gruppa: true },
    network: { rassylka_priglasheniy: true, anonsy: true, publikaciya_gruppa: true }
};

function mozhnoFunktsiyu(tarifId, feature) {
    const id = FUNKTSII[tarifId] ? tarifId : 'none';
    return !!FUNKTSII[id][feature];
}

function tekstOgranicheniyaTarifa(feature) {
    if (feature === 'rassylka_priglasheniy') {
        return '📨 *Рассылка приглашений* доступна с тарифа *Start* (7 900 ₽/мес) и выше.\n\n' +
            'На *Mini* (3 999 ₽) — игры, рейтинг и публикация итогов в группу; приглашения в личку базе клуба — в Start+.\n\n' +
            '«💳 Подключить тариф» в настройках клуба.';
    }
    if (feature === 'anonsy') {
        return '📢 *Анонсы и запись на игру* — с тарифа *Start* и выше.\n\n' +
            'Mini — ведение игр и рейтинг без массовых анонсов.\n\n' +
            '«💳 Подключить тариф» в настройках клуба.';
    }
    return 'Эта функция недоступна на вашем тарифе. «💳 Подключить тариф» в настройках клуба.';
}

function formatRub(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function tekstPlana(p) {
    let line = '*' + p.name + '* — *' + formatRub(p.price) + '₽/мес* · ' + p.games + ' игр';
    if (p.razovo) line += ' · разово *' + formatRub(p.razovo) + '₽*';
    return line + '\n' + p.features;
}

function tekstTarifovKratko() {
    return PLANY.map(tekstPlana).join('\n\n') +
        '\n\n*Network* — от *' + formatRub(NETWORK.priceFrom) + '₽/мес*\n' + NETWORK.features;
}

function tekstTarifovSpisok() {
    const rows = PLANY.map(p => '— *' + p.name + '* — *' + formatRub(p.price) + '₽/мес*: ' + p.games + ' игр');
    rows.push('— *Network* — от *' + formatRub(NETWORK.priceFrom) + '₽/мес*');
    return rows.join('\n');
}

function tekstTestovoyNedeliPosle() {
    return 'После теста — *4 тарифа*:\n\n' +
        PLANY.map(tekstPlana).join('\n\n') + '\n\n' +
        '🎨 Стилизация (карты + тема клуба) — *' + formatRub(STILIZATSIYA_PRICE) + '₽* один раз.\n\n' +
        '_Карты и стиль Prime Mafia в тарифе уже есть бесплатно; 5000 ₽ — только свой брендбук клуба._\n\n' +
        '_Подключение — заявка в Telegram._';
}

function tekstPaywall() {
    return 'Чтобы продолжить:\n' + tekstTarifovSpisok() + '\n\n' +
        'Нажми «Подключить тариф» — оформим пакет вручную.';
}

function tekstZayavkiAdmin() {
    return PLANY.map(p => p.name + ' ' + formatRub(p.price) + '₽/' + p.games + ' игр').join(', ') +
        ', Network от ' + formatRub(NETWORK.priceFrom) + '₽';
}

function planPoId(id) {
    return PLANY.find(p => p.id === id) || PLANY[0];
}

function tekstVozrazhenieDorogo(opts = {}) {
    const igrokov = opts.igrokov || 12;
    const vhod = opts.vhod || 1000;
    const vyruchka = igrokov * vhod;
    const mini = planPoId('mini');
    return 'Понимаю. Посчитаем на вашем формате:\n\n' +
        igrokov + ' игроков × ' + formatRub(vhod) + ' ₽ ≈ *' + formatRub(vyruchka) + ' ₽* за вечер.\n\n' +
        '*Mini* — *' + formatRub(mini.price) + ' ₽/мес* (' + mini.games + ' игр, 1 ведущий) ≈ *' +
        Math.round(mini.price / mini.games) + ' ₽* за игру.\n\n' +
        'Бот экономит ведущему 30–60 мин после игры: фазы, таймеры, голосование, рейтинг.\n' +
        'Окупается с *одного* вечера.\n\n' +
        'Можем начать с Mini на месяц — или сразу Start 7 900 ₽, если нужен второй ведущий.';
}

/** Экономия vs бумажные карты. Карты Prime Mafia в продукте бесплатны; 5000 ₽ — только брендбук чужого клуба. */
function tekstEkonomiyaKart() {
    return 'Отдельный счёт, который часто забывают:\n\n' +
        '🃏 *Бумажные карты клуба*\n' +
        'дизайн + ламинация + печать ≈ *10 000 ₽*\n' +
        '+ ждать тираж, править колоду, возить с собой.\n\n' +
        '📱 *Maf Assist by Prime Mafia*\n' +
        '— готовые красивые карты *Prime Mafia* уже в боте и mini app — *бесплатно*;\n' +
        '— *начать проводить игры можно сегодня* — тест 2 игры бесплатно;\n' +
        '— если нужны *ваши* карты и цвета клуба (брендбук) — стилизация *' +
        formatRub(STILIZATSIYA_PRICE) + ' ₽ один раз* (не каждый тираж).\n\n' +
        'То есть на старте не ждёте печать и не платите 10к «на входе» — открываете клуб и ведёте вечер.';
}

function tekstUpsellStilizasii() {
    return 'Стиль и карты *Prime Mafia* в приложении — *бесплатно*, они уже красивые.\n\n' +
        'Платно только если клуб хочет *свой* бренд:\n' +
        '— загрузить свои карты ролей (как бумажная колода);\n' +
        '— цвета и тему интерфейса под клуб;\n' +
        '— игроки видят «ваш» стол, не общий.\n\n' +
        'Стоимость своей стилизации: *' + formatRub(STILIZATSIYA_PRICE) + ' ₽* один раз.\n' +
        'Сравнение с бумагой: дизайн + ламинация + печать ≈ *10 000 ₽* и ждать тираж.\n\n' +
        'На тесте можно играть сразу на картах Prime Mafia. Свой брендбук — когда будете готовы.';
}

function tekstSkriptaBigFamily() {
    const mini = planPoId('mini');
    return 'Антон, привет! Как прошла игра с ботом?\n\n' +
        'Для *Big Family* уже заложен ваш формат:\n' +
        '— 1 минута представления на игрока;\n' +
        '— круг с *№1*;\n' +
        '— после представлений сразу выставление и голосование.\n\n' +
        '*Mini* — ' + formatRub(mini.price) + ' ₽/мес, ' + mini.games + ' игр, 1 ведущий — таймеры, фазы, рейтинг.\n\n' +
        '12 игроков × 1 000 ₽ ≈ 12 000 ₽ за вечер — бот окупается с одной игры.\n\n' +
        'Подключим Mini на месяц и пройдём следующий вечер вместе?';
}

module.exports = {
    PLANY,
    NETWORK,
    FUNKTSII,
    STILIZATSIYA_PRICE,
    formatRub,
    planPoId,
    mozhnoFunktsiyu,
    tekstOgranicheniyaTarifa,
    tekstTarifovKratko,
    tekstTarifovSpisok,
    tekstTestovoyNedeliPosle,
    tekstPaywall,
    tekstZayavkiAdmin,
    tekstVozrazhenieDorogo,
    tekstEkonomiyaKart,
    tekstUpsellStilizasii,
    tekstSkriptaBigFamily
};
