const MAFIA_ROLES = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник мафии', 'Консильери'];

function isMafiaRole(rol) {
    return MAFIA_ROLES.includes(rol);
}

function sluchaynyy(spisok) {
    if (!spisok?.length) return '';
    return spisok[Math.floor(Math.random() * spisok.length)];
}

function imenaSpiskom(igroki) {
    return (igroki || []).map(i => i.name).filter(Boolean).join(', ');
}

function analizKonteksta(igra, pobeditel) {
    const igroki = igra?.igroki || [];
    const maf = igroki.filter(i => isMafiaRole(i.rol));
    const mir = igroki.filter(i => !isMafiaRole(i.rol) && i.rol !== 'Маньяк');
    const manyak = igroki.filter(i => i.rol === 'Маньяк');
    const alive = igroki.filter(i => i.status === 'v_igre');
    return {
        pobeditel,
        total: igroki.length,
        mafCount: maf.length,
        mirCount: mir.length,
        manyakCount: manyak.length,
        maf,
        mir,
        manyak,
        aliveMaf: maf.filter(i => i.status === 'v_igre'),
        aliveMir: mir.filter(i => i.status === 'v_igre'),
        aliveManyak: manyak.filter(i => i.status === 'v_igre')
    };
}

const FRAZY = {
    mirnye_pobeda_igrok: [
        'Город вздохнул с облегчением — мафия не дожила до рассвета, а ты дожил до победы.',
        'Мирные спят спокойно, а ты можешь не спать от радости: стол ваш!',
        'Сегодня правда оказалась сильнее лжи — и ты в команде победителей.',
        'Город спасён. В следующий раз мафия будет злее — а ты уже в истории вечера.',
        'Красивый финал для мирных: стол чист, совесть чиста, рейтинг растёт.'
    ],
    mirnye_porazhenie_igrok: [
        'Мафия перехитрила город — но ты сыграл честно, и это тоже про мафию.',
        'Не ваш вечер, зато история для разбора на следующей игре уже готова.',
        'Город пал. Зато теперь знаешь, кому не стоит доверять с первого круга.',
        'Мирные проиграли, но стол был живой — это главное.',
        'Поражение — тоже опыт. Следующая партия начнётся с твоей мести.'
    ],
    mafiya_pobeda_mnogo: [
        'Чёрная команда взяла стол штурмом — мафии было много, и они не упустили шанс.',
        'Фееричная победа мафии: город даже не понял, где его обманули.',
        'Стол утонул в красном — большая мафия сыграла как единый организм.',
        'Много мафии — много хаоса. Город проиграл ещё до финального голосования.',
        'Когда мафии столько, мирным остаётся только надеяться на чудо. Не случилось.'
    ],
    mafiya_pobeda_malo: [
        'Маленькая мафия — большой криминальный гений. Стол их.',
        'Двое-трое в тени перевернули весь город. Классика.',
        'Мафии было мало, но хватило, чтобы город снова ошибся.',
        'Компактная команда — идеальный финал для чёрных.'
    ],
    mafiya_pobeda_igrok: [
        'Тёмная сторона смеётся последней — и ты в её рядах.',
        'Город доверился тебе. Ошибка города — твоя победа.',
        'Красиво отыграли: мафия забрала вечер, а ты забрал рейтинг.',
        'Ночь была длинной, утро — чёрным. Поздравляем, мафия.'
    ],
    mafiya_porazhenie_igrok: [
        'Мафия не дожила до финала — бывает даже у лучших.',
        'План был гениальный. План не сработал.',
        'Чёрная команда раскрыта. В следующий раз — тише в тени.',
        'Не ваш черёд править городом. Мирные оказались умнее.'
    ],
    manyak_pobeda: [
        'Один против всех — и он остался. Маньяк забрал вечер.',
        'Серый одиночка сделал то, что не смогла ни мафия, ни город.',
        'Финал для одного: стол пуст, маньяк доволен.',
        'Никому нельзя доверять — особенно когда побеждает маньяк.',
        'Холодная, красивая, одинокая победа. Классика серой команды.'
    ],
    manyak_porazhenie: [
        'Маньяк не дожил до триумфа — город или мафия успели раньше.',
        'Серый одиночка был близок, но стол оказался сильнее.',
        'Почти идеальный план маньяка — «почти» не считается.'
    ],
    vedushchiy: {
        mirnye: [
            'Мирные забрали вечер — город выдохнул.',
            'Чистая победа мирных. Красивый финал для ведущего.',
            'Мафия не прошла проверку на прочность — мирные у стола.',
            'Город победил. Можно смело публиковать итог в чат.'
        ],
        mafiya_mnogo: [
            'Мафии было много — и они забрали стол феерично.',
            'Чёрная команда доминировала. Яркий финал для публикации.',
            'Город не устоял против большой мафии — драматичный итог.',
            'Когда мафии много, финал всегда громкий. Так и случилось.'
        ],
        mafiya_malo: [
            'Мало мафии — много хитрости. Чёрные победили.',
            'Компактная мафия переиграла весь стол.',
            'Классическая победа маленькой команды.'
        ],
        manyak: [
            'Маньяк забрал вечер — финал для запоминания.',
            'Серый одиночка победил. Редкий и красивый исход.',
            'Стол опустел, остался только маньяк. Драма на максимум.'
        ]
    }
};

function detailPobedy(ctx) {
    if (ctx.pobeditel === 'mirnye') {
        const kto = ctx.mir.length ? imenaSpiskom(ctx.mir) : imenaSpiskom(ctx.aliveMir);
        return kto ? '🟢 Победили мирные: ' + kto : '🟢 Победили мирные';
    }
    if (ctx.pobeditel === 'mafiya') {
        if (!ctx.maf.length) return '🔴 Победила команда мафии';
        return '🔴 Победила мафия:\n' + ctx.maf.map(i => '• ' + i.name + ' — ' + i.rol).join('\n');
    }
    if (ctx.pobeditel === 'manyak') {
        const m = ctx.manyak[0];
        return m ? '🎯 Победил маньяк: ' + m.name : '🎯 Победил маньяк';
    }
    return '';
}

function sformirovatItogDlyaIgroka(ctx, won, role) {
    const detail = detailPobedy(ctx);
    let phrase = '';
    let title = '';
    let emoji = '🏁';

    if (ctx.pobeditel === 'mirnye') {
        if (won) {
            phrase = sluchaynyy(FRAZY.mirnye_pobeda_igrok);
            title = 'Победа мирных!';
            emoji = '🟢';
        } else {
            phrase = sluchaynyy(FRAZY.mirnye_porazhenie_igrok);
            title = 'Мирные проиграли';
            emoji = '🌃';
        }
    } else if (ctx.pobeditel === 'mafiya') {
        if (won) {
            phrase = ctx.mafCount >= 3
                ? sluchaynyy(FRAZY.mafiya_pobeda_mnogo)
                : sluchaynyy([...FRAZY.mafiya_pobeda_malo, ...FRAZY.mafiya_pobeda_igrok]);
            title = 'Победа мафии!';
            emoji = '🔴';
        } else {
            phrase = sluchaynyy(FRAZY.mafiya_porazhenie_igrok);
            title = 'Мафия проиграла';
            emoji = '🕵️';
        }
    } else if (ctx.pobeditel === 'manyak') {
        if (won) {
            phrase = sluchaynyy(FRAZY.manyak_pobeda);
            title = 'Маньяк победил!';
            emoji = '🎯';
        } else {
            phrase = sluchaynyy(FRAZY.manyak_porazhenie);
            title = 'Маньяк не успел';
            emoji = '🌑';
        }
    }

    return {
        title,
        emoji,
        phrase,
        detail,
        role: role || null,
        won: !!won
    };
}

function sformirovatItogDlyaVedushchego(ctx, kod) {
    let pool = FRAZY.vedushchiy.mirnye;
    if (ctx.pobeditel === 'mafiya') {
        pool = ctx.mafCount >= 3 ? FRAZY.vedushchiy.mafiya_mnogo : FRAZY.vedushchiy.mafiya_malo;
    } else if (ctx.pobeditel === 'manyak') {
        pool = FRAZY.vedushchiy.manyak;
    }
    return {
        title: 'Игра №' + kod + ' завершена',
        emoji: ctx.pobeditel === 'mafiya' ? '🔴' : ctx.pobeditel === 'manyak' ? '🎯' : '🟢',
        phrase: sluchaynyy(pool),
        detail: detailPobedy(ctx),
        is_host: true,
        won: null
    };
}

function uvedomitMiniApp(igra, kod, pobeditel, miniappEvents) {
    if (igra?.rezhim_rolei !== 'bot' || !miniappEvents) return;
    const ctx = analizKonteksta(igra, pobeditel);
    const ts = Date.now();

    for (const igrok of igra.igroki || []) {
        if (!igrok.telegram_id) continue;
        const is_maf = isMafiaRole(igrok.rol);
        const is_manyak = igrok.rol === 'Маньяк';
        let won = false;
        if (pobeditel === 'mirnye' && !is_maf && !is_manyak) won = true;
        if (pobeditel === 'mafiya' && is_maf) won = true;
        if (pobeditel === 'manyak' && is_manyak) won = true;

        const pack = sformirovatItogDlyaIgroka(ctx, won, igrok.rol);
        if (igrok.telegram_id === igra.vedushchii_id) pack.is_host = true;
        miniappEvents.set(igrok.telegram_id, {
            type: won ? 'victory' : 'game_end',
            pobeditel,
            kod,
            ts,
            ...pack
        });
    }

    if (igra.vedushchii_id && !(igra.igroki || []).some(i => i.telegram_id === igra.vedushchii_id)) {
        const pack = sformirovatItogDlyaVedushchego(ctx, kod);
        miniappEvents.set(igra.vedushchii_id, {
            type: 'game_result',
            pobeditel,
            kod,
            ts,
            ...pack
        });
    }
}

module.exports = {
    analizKonteksta,
    sformirovatItogDlyaIgroka,
    sformirovatItogDlyaVedushchego,
    uvedomitMiniApp
};
