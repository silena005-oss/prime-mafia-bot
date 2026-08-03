const supabase = require('./supabase');
const { md, dataIgrovoegoVechera, formatDatyRu } = require('./helpers');
const tarify = require('./tarify');

const TEST_LIMIT_IGRY = 2;
const TEST_LIMIT_DNEY = 10;

/** Свои клубы разработчика — без тестового/платного лимита. */
function etoDevKlubPoNazvaniyu(nazvaniye) {
    const name = String(nazvaniye || '')
        .toLowerCase()
        .replace(/[‐‑‒–—―_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return /pascal|паскал|paskal|prime\s*mafia|прайм\s*мафия/.test(name);
}

function naRailwayBilling() {
    return !!(
        process.env.RAILWAY_ENVIRONMENT_NAME ||
        process.env.RAILWAY_PROJECT_ID ||
        process.env.RAILWAY_SERVICE_ID ||
        process.env.RAILWAY_STATIC_URL
    );
}

// На Railway лимиты теста включены по умолчанию; локально — только при ENFORCE_TRIAL_LIMITS=true
const ENFORCE_TRIAL_LIMITS = process.env.ENFORCE_TRIAL_LIMITS === 'true'
    || (naRailwayBilling() && process.env.ENFORCE_TRIAL_LIMITS !== 'false');

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

function tekstPaketProdazhKluba(nazvanieKluba, nastroyki = {}) {
    const st = raschetStatusaTarifa(nastroyki);
    const tid = effectiveTarifId(nastroyki);
    const plan = (tid && tid !== 'test' && tid !== 'none') ? tarify.planPoId(tid) : null;

    let t = '💳 *Maf Assist by Prime Mafia*\n';
    t += '_Тариф и пакет клуба_\n\n';
    t += '🏛 Клуб: *' + md(nazvaniyeili(nazvanieKluba)) + '*\n\n';
    t += '📌 *Статус сейчас*\n' + st.tekst + '\n';
    if (plan) t += 'Пакет: *' + plan.name + '*\n';
    t += '\n';
    t += '✨ *Что получает клуб*\n';
    t += '— стол ведущего: фазы, таймеры, голосование, ночь;\n';
    t += '— рейтинг и история сразу после игры;\n';
    t += '— mini app для игроков;\n';
    t += '— карты *Prime Mafia* в тарифе *бесплатно*.\n\n';
    t += '📦 *Пакеты*\n';
    for (const p of tarify.PLANY.filter(x => ['mini', 'start', 'club'].includes(x.id))) {
        t += '\n*' + p.name + '* — *' + tarify.formatRub(p.price) + ' ₽/мес*';
        if (p.razovo) t += ' · или разово *' + tarify.formatRub(p.razovo) + ' ₽*';
        t += '\n' + p.games + ' игр · ' + p.vedushchie + ' вед.\n';
        t += '_' + p.features + '_\n';
    }
    t += '\n🎨 Свой брендбук клуба — *' + tarify.formatRub(tarify.STILIZATSIYA_PRICE) + ' ₽* один раз.\n';
    t += '\n_Выбери пакет ниже — заявка придёт нам в Telegram. Оплата: СБП / перевод._';
    return t;
}

function nazvaniyeili(name) {
    return name || 'клуб';
}

function knopkiPaketProdazhKluba(klub_id, opts = {}) {
    const back = opts.back || 'menu_vladeltsa';
    return [
        [{ text: 'Mini — 3 999 ₽/мес', callback_data: 'tarif_plan_' + klub_id + '_mini' }],
        [{ text: 'Start — 7 900 ₽/мес', callback_data: 'tarif_plan_' + klub_id + '_start' }],
        [{ text: 'Club — 12 900 ₽/мес', callback_data: 'tarif_plan_' + klub_id + '_club' }],
        [{ text: '💳 Заявка — подберём пакет', callback_data: 'tarif_zayavka_' + klub_id }],
        [{ text: '🎁 Как работает тест', callback_data: 'tarif_test_' + klub_id }],
        [{ text: '🎨 Брендбук — 5 000 ₽', callback_data: 'stil_klub_' + klub_id }],
        [{ text: '⬅️ Назад', callback_data: back }]
    ];
}

function tekstPaywallPosleTesta() {
    return '⏳ *Тестовая неделя завершена*\n\n' +
        'Бесплатный период клуба закончился: использованы 2 тестовые игры или прошло ' + TEST_LIMIT_DNEY + ' дней.\n\n' +
        'Чтобы продолжить — выбери пакет *Mini / Start / Club* на экране тарифа.\n\n' +
        tarify.tekstTarifovSpisok() + '\n\n' +
        'Нажми «💳 Тариф и пакет» — оформим в Telegram (СБП / перевод).';
}

/** Очередь на процесс: один биллинг клуба за раз (Railway обычно 1 реплика). */
const billingLocks = new Map();

async function sBillingLockom(klub_id, fn) {
    const key = String(klub_id);
    const start = Date.now();
    while (billingLocks.get(key)) {
        if (Date.now() - start > 8000) throw new Error('billing_lock_timeout');
        await new Promise(r => setTimeout(r, 15));
    }
    billingLocks.set(key, true);
    try {
        return await fn();
    } finally {
        billingLocks.delete(key);
    }
}

/**
 * Optimistic concurrency: update только если igry_balans ещё равен expected.
 * Защищает от двойного списания при параллельном старте двух игр.
 */
async function atomarnoSpisatBalansIgry(klub_id) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const { data: row } = await supabase
            .from('kluby')
            .select('nastroyki')
            .eq('id', klub_id)
            .single();
        const nastroyki = { ...(row?.nastroyki || {}) };
        const balans = parseInt(nastroyki.igry_balans, 10) || 0;
        if (balans <= 0) return { ok: false, tip: 'no_balans', nastroyki };
        const expected = balans;
        nastroyki.igry_balans = balans - 1;
        const { data: updated, error } = await supabase
            .from('kluby')
            .update({ nastroyki })
            .eq('id', klub_id)
            .eq('nastroyki->>igry_balans', String(expected))
            .select('id')
            .maybeSingle();
        if (error) {
            console.error('[billing balans]', error.message);
            return { ok: false, tip: 'db_error', nastroyki };
        }
        if (updated) {
            return { ok: true, tip: 'balans', balans: nastroyki.igry_balans, nastroyki };
        }
    }
    return { ok: false, tip: 'race' };
}

async function atomarnoSpisatTestovuyuIgru(klub_id) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const { data: row } = await supabase
            .from('kluby')
            .select('nastroyki')
            .eq('id', klub_id)
            .single();
        const nastroyki = { ...(row?.nastroyki || {}) };
        const st = raschetStatusaTarifa(nastroyki);
        if (!(st.mozhno && st.tip === 'test')) {
            return { ok: false, tip: st.tip || 'test_block', nastroyki, st };
        }
        const expected = nastroyki.test.igry_ispolzovano || 0;
        nastroyki.test = {
            ...nastroyki.test,
            igry_ispolzovano: expected + 1
        };
        const { data: updated, error } = await supabase
            .from('kluby')
            .update({ nastroyki })
            .eq('id', klub_id)
            .eq('nastroyki->test->>igry_ispolzovano', String(expected))
            .select('id')
            .maybeSingle();
        if (error) {
            console.warn('[billing test filter]', error.message);
            break;
        }
        if (updated) {
            const posle = raschetStatusaTarifa(nastroyki);
            return { ok: true, tip: 'test', nastroyki, info: posle.tekst };
        }
    }
    // Fallback RMW: вызывающий должен держать sBillingLockom
    const nastroyki = await poluchitNastroykiKlubaBilling(klub_id);
    const st = raschetStatusaTarifa(nastroyki);
    if (!(st.mozhno && st.tip === 'test')) {
        return { ok: false, tip: st.tip || 'test_block', nastroyki, st };
    }
    nastroyki.test.igry_ispolzovano = (nastroyki.test.igry_ispolzovano || 0) + 1;
    await sohranitNastroykiKlubaBilling(klub_id, nastroyki);
    const posle = raschetStatusaTarifa(nastroyki);
    return { ok: true, tip: 'test', nastroyki, info: posle.tekst };
}

async function proveritStartPlatnoyIgry(igra, kod) {
    if (!igra?.klub_id || igra._druzya_rezhim || igra._slot_oplaty) {
        return { ok: true };
    }

    // Быстрый путь: название уже в объекте игры (без лишнего round-trip)
    if (etoDevKlubPoNazvaniyu(igra.klub_nazvaniye) || igra._nastroyki?.bez_limita_tarifa) {
        igra._slot_oplaty = true;
        return { ok: true, tip: 'dev', klub_id: igra.klub_id };
    }

    return sBillingLockom(igra.klub_id, async () => {
        const { data: klubRow } = await supabase
            .from('kluby')
            .select('nazvaniye, nastroyki')
            .eq('id', igra.klub_id)
            .maybeSingle();
        const name = klubRow?.nazvaniye || igra.klub_nazvaniye || '';
        const nastroykiRaw = klubRow?.nastroyki || {};

        if (etoDevKlubPoNazvaniyu(name) || nastroykiRaw.bez_limita_tarifa) {
            // Самовосстановление: снимем тест в БД, чтобы paywall не всплывал снова
            if (etoDevKlubPoNazvaniyu(name) && !nastroykiRaw.bez_limita_tarifa) {
                await otkrytPolnyyDostupKluba(igra.klub_id).catch((e) => {
                    console.error('[billing auto-grant]', e?.message || e);
                });
            }
            igra._slot_oplaty = true;
            if (!igra.klub_nazvaniye && name) igra.klub_nazvaniye = name;
            return { ok: true, tip: 'dev', klub_id: igra.klub_id };
        }

        const nastroyki = { ...nastroykiRaw };
        const st = raschetStatusaTarifa(nastroyki);

        if (st.tip === 'oplachen' && st.balans > 0) {
            const rez = await atomarnoSpisatBalansIgry(igra.klub_id);
            if (!rez.ok) {
                if (!ENFORCE_TRIAL_LIMITS) {
                    return { ok: true, tip: 'soft', preduprezhdenie: st.tekst, klub_id: igra.klub_id };
                }
                return { ok: false, paywall: tekstPaywallPosleTesta(), klub_id: igra.klub_id };
            }
            igra._slot_oplaty = true;
            return {
                ok: true,
                tip: 'balans',
                info: 'Списана 1 игра с пакета. Осталось: ' + rez.balans,
                klub_id: igra.klub_id
            };
        }
        if (st.tip === 'oplachen' && nastroyki.tarif_status === 'oplachen') {
            igra._slot_oplaty = true;
            return { ok: true, tip: 'oplachen', klub_id: igra.klub_id };
        }

        if (st.mozhno && st.tip === 'test') {
            const rez = await atomarnoSpisatTestovuyuIgru(igra.klub_id);
            if (!rez.ok) {
                if (!ENFORCE_TRIAL_LIMITS) {
                    return { ok: true, tip: 'soft', preduprezhdenie: st.tekst, klub_id: igra.klub_id };
                }
                return { ok: false, paywall: tekstPaywallPosleTesta(), klub_id: igra.klub_id };
            }
            igra._slot_oplaty = true;
            return { ok: true, tip: 'test', info: rez.info, klub_id: igra.klub_id };
        }

        if (!ENFORCE_TRIAL_LIMITS) {
            return { ok: true, tip: 'soft', preduprezhdenie: st.tekst, klub_id: igra.klub_id };
        }

        console.warn('[billing paywall]', igra.klub_id, name, st.tip);
        return { ok: false, paywall: tekstPaywallPosleTesta(), klub_id: igra.klub_id };
    });
}

function effectiveTarifId(nastroyki) {
    if (nastroyki?.bez_limita_tarifa) return 'network';
    const id = nastroyki?.tarif_id;
    if (id && tarify.FUNKTSII[id]) return id;
    if (nastroyki?.tarif_status === 'test' || nastroyki?.test?.nachalo) return 'test';
    if (nastroyki?.tarif_status === 'oplachen' && nastroyki?.tarif_id) return nastroyki.tarif_id;
    if (nastroyki?.tarif_status === 'oplachen') return 'start';
    return 'none';
}

async function poluchitTarifKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .maybeSingle();
    if (etoDevKlubPoNazvaniyu(klub?.nazvaniye)) return 'network';
    return effectiveTarifId(klub?.nastroyki || {});
}

async function mozhnoFunktsiyuKluba(klub_id, feature) {
    const tid = await poluchitTarifKluba(klub_id);
    return tarify.mozhnoFunktsiyu(tid, feature);
}

/**
 * Снять тест и открыть полный доступ (Network, без списания игр).
 * Возвращает { ok, changed, nazvaniye } или { ok:false, error }.
 */
async function otkrytPolnyyDostupKluba(klub_id, opts = {}) {
    if (!klub_id) return { ok: false, error: 'no_id' };
    const { data: klub, error } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki')
        .eq('id', klub_id)
        .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!klub) return { ok: false, error: 'not_found' };

    const n = { ...(klub.nastroyki || {}) };
    const already = n.tarif_status === 'oplachen'
        && (n.tarif_id === 'network' || n.tarif_id === 'pro')
        && n.bez_limita_tarifa === true
        && !n.test;
    if (already && !opts.force) {
        return { ok: true, changed: false, nazvaniye: klub.nazvaniye, klub_id };
    }

    n.tarif_status = 'oplachen';
    n.tarif_id = opts.tarif_id || 'network';
    n.tarif_plan = n.tarif_id;
    n.bez_limita_tarifa = true;
    // 0 + oplachen = безлимит (не списываем пакет), см. proveritStartPlatnoyIgry
    if (opts.igry_balans != null) n.igry_balans = opts.igry_balans;
    else if (!Number.isFinite(parseInt(n.igry_balans, 10))) n.igry_balans = 0;
    delete n.test;

    await sohranitNastroykiKlubaBilling(klub_id, n);
    return { ok: true, changed: true, nazvaniye: klub.nazvaniye, klub_id, tarif_id: n.tarif_id };
}

/** При старте бота — открыть Pascal / Prime Mafia. */
async function otkrytPolnyyDostupDevKlubov() {
    const { data: kluby, error } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki');
    if (error) {
        console.error('[billing grant]', error.message);
        return { ok: false, error: error.message, updated: [] };
    }
    const updated = [];
    for (const k of kluby || []) {
        if (!etoDevKlubPoNazvaniyu(k.nazvaniye)) continue;
        const rez = await otkrytPolnyyDostupKluba(k.id);
        if (rez.ok && rez.changed) {
            updated.push(rez.nazvaniye || rez.klub_id);
            console.log('[billing] полный доступ:', rez.nazvaniye);
        } else if (rez.ok) {
            console.log('[billing] уже открыт:', rez.nazvaniye);
        }
    }
    return { ok: true, updated };
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
    tekstPaketProdazhKluba,
    knopkiPaketProdazhKluba,
    proveritStartPlatnoyIgry,
    effectiveTarifId,
    poluchitTarifKluba,
    mozhnoFunktsiyuKluba,
    etoDevKlubPoNazvaniyu,
    otkrytPolnyyDostupKluba,
    otkrytPolnyyDostupDevKlubov
};
