const supabase = require('./supabase');
const { md, dataIgrovoegoVechera, formatDatyRu } = require('./helpers');
const tarify = require('./tarify');

const TEST_LIMIT_IGRY = 2;
const TEST_LIMIT_DNEY = 10;
const ENFORCE_TRIAL_LIMITS = process.env.ENFORCE_TRIAL_LIMITS === 'true';

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
        '— *' + TEST_LIMIT_DNEY + ' календарных дней* с момента создания клуба;\n' +
        '— лимит списывается только при *реальном старте* игры:\n' +
        '  раздача ролей в боте, «Начать игру» с физическими картами или ночь знакомства;\n' +
        '— создание игры и лобби тест не тратят.\n\n' +
        tarify.tekstTestovoyNedeliPosle() + '\n\n' +
        '_Подключение — заявка в Telegram, счёт вручную (СБП / перевод)._';
}

function tekstPaywallPosleTesta() {
    return '⏳ *Тестовая неделя завершена*\n\n' +
        'Бесплатный период клуба закончился: использованы 2 тестовые игры или прошло ' + TEST_LIMIT_DNEY + ' дней.\n\n' +
        'Чтобы продолжить:\n' +
        tarify.tekstTarifovSpisok() + '\n\n' +
        'Нажми «Подключить тариф» — заявка придёт нам в Telegram, свяжемся и оформим пакет.';
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

function effectiveTarifId(nastroyki) {
    const id = nastroyki?.tarif_id;
    if (id && tarify.FUNKTSII[id]) return id;
    if (nastroyki?.tarif_status === 'test' || nastroyki?.test?.nachalo) return 'test';
    if (nastroyki?.tarif_status === 'oplachen' && nastroyki?.tarif_id) return nastroyki.tarif_id;
    if (nastroyki?.tarif_status === 'oplachen') return 'start';
    return 'none';
}

async function poluchitTarifKluba(klub_id) {
    const n = await poluchitNastroykiKlubaBilling(klub_id);
    return effectiveTarifId(n);
}

async function mozhnoFunktsiyuKluba(klub_id, feature) {
    const tid = await poluchitTarifKluba(klub_id);
    return tarify.mozhnoFunktsiyu(tid, feature);
}

module.exports = {
    TEST_LIMIT_IGRY,
    TEST_LIMIT_DNEY,
    ENFORCE_TRIAL_LIMITS,
    dataOkonchaniyaTesta,
    poluchitNastroykiKlubaBilling,
    sohranitNastroykiKlubaBilling,
    nachatTestovuyuNedelyuKluba,
    raschetStatusaTarifa,
    tekstTestovoyNedeli,
    tekstPaywallPosleTesta,
    proveritStartPlatnoyIgry,
    effectiveTarifId,
    poluchitTarifKluba,
    mozhnoFunktsiyuKluba
};
