// UI выбора города: плитки по алфавиту + поиск по тексту

const RUSSIAN_LETTERS = [
    'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М', 'Н', 'О', 'П',
    'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Э', 'Ю', 'Я', '#'
];

const KODY_STRAN = {
    RU: 'Россия',
    BY: 'Беларусь',
    KZ: 'Казахстан',
    UZ: 'Узбекистан',
    KG: 'Кыргызстан',
    AM: 'Армения',
    GE: 'Грузия',
    AZ: 'Азербайджан'
};

const OBRATNO_KODY = Object.fromEntries(
    Object.entries(KODY_STRAN).map(([k, v]) => [v, k])
);

const NA_STRANITSE = 10;

function normalizovatBukvu(nazvaniye) {
    const s = String(nazvaniye || '').trim();
    if (!s) return '#';
    let c = s[0].toUpperCase();
    if (c === 'Ё') c = 'Е';
    if (/[A-Z]/.test(c)) return c;
    if (RUSSIAN_LETTERS.includes(c)) return c;
    return '#';
}

function bukvaPoIndeksu(idx) {
    return RUSSIAN_LETTERS[idx] || '#';
}

function indeksBukvy(bukva) {
    const i = RUSSIAN_LETTERS.indexOf(bukva);
    return i >= 0 ? i : RUSSIAN_LETTERS.length - 1;
}

function bukvyGorodov(goroda) {
    const set = new Set();
    for (const g of goroda || []) set.add(normalizovatBukvu(g.nazvaniye));
    return RUSSIAN_LETTERS.filter(b => set.has(b));
}

function gorodaPoBukve(goroda, bukva) {
    const b = bukvaPoIndeksu(typeof bukva === 'number' ? bukva : indeksBukvy(bukva));
    return (goroda || []).filter(g => normalizovatBukvu(g.nazvaniye) === b);
}

function poiskGorodov(goroda, query, limit = 15) {
    const f = String(query || '').trim().toLowerCase();
    if (f.length < 2) return [];
    return (goroda || [])
        .filter(g => String(g.nazvaniye || '').toLowerCase().includes(f))
        .slice(0, limit);
}

function kodStrany(strana) {
    return OBRATNO_KODY[strana] || 'RU';
}

function stranaPoKodu(kod) {
    return KODY_STRAN[kod] || KODY_STRAN.RU;
}

/** mode: reg | sm | vk — префиксы callback: rga/rgl/rgp, sma/sml/smp, vka/vkl/vkp */
function prefiksy(mode) {
    if (mode === 'sm') return { alf: 'sma', list: 'sml', poisk: 'smp', select: 'sg' };
    if (mode === 'vk') return { alf: 'vka', list: 'vkl', poisk: 'vkp', select: 'vgorod_' };
    return { alf: 'rga', list: 'rgl', poisk: 'rgp', select: 'rg_' };
}

function postroитьKlavAlfavit(goroda, mode, kod) {
    const p = prefiksy(mode);
    const bukvy = bukvyGorodov(goroda);
    const knopki = [];
    for (let i = 0; i < bukvy.length; i += 4) {
        knopki.push(
            bukvy.slice(i, i + 4).map(b => ({
                text: b,
                callback_data: `${p.list}_${kod}_${indeksBukvy(b)}_0`
            }))
        );
    }
    knopki.push([{ text: '✍️ Написать город', callback_data: `${p.poisk}_${kod}` }]);
    return knopki;
}

function postroитьKlavGoroda(goroda, kod, bukvaIdx, stranitsa, mode, backCallback) {
    const p = prefiksy(mode);
    const bukva = bukvaPoIndeksu(bukvaIdx);
    const filtered = gorodaPoBukve(goroda, bukva);
    const vsego = filtered.length;
    const stranits_vsego = Math.max(1, Math.ceil(vsego / NA_STRANITSE));
    if (stranitsa >= stranits_vsego) stranitsa = stranits_vsego - 1;
    if (stranitsa < 0) stranitsa = 0;

    const slice = filtered.slice(stranitsa * NA_STRANITSE, (stranitsa + 1) * NA_STRANITSE);
    const knopki = [];
    for (let i = 0; i < slice.length; i += 2) {
        const row = [{ text: slice[i].nazvaniye, callback_data: p.select + slice[i].id }];
        if (slice[i + 1]) row.push({ text: slice[i + 1].nazvaniye, callback_data: p.select + slice[i + 1].id });
        knopki.push(row);
    }
    if (stranits_vsego > 1) {
        const nav = [];
        if (stranitsa > 0) nav.push({ text: '⬅️', callback_data: `${p.list}_${kod}_${bukvaIdx}_${stranitsa - 1}` });
        nav.push({ text: `${stranitsa + 1}/${stranits_vsego}`, callback_data: 'baza_noop' });
        if (stranitsa < stranits_vsego - 1) nav.push({ text: '➡️', callback_data: `${p.list}_${kod}_${bukvaIdx}_${stranitsa + 1}` });
        knopki.push(nav);
    }
    knopki.push([{ text: '🔤 По алфавиту', callback_data: `${p.alf}_${kod}` }]);
    knopki.push([{ text: '✍️ Написать город', callback_data: `${p.poisk}_${kod}` }]);
    if (backCallback) knopki.push([{ text: '⬅️ Назад', callback_data: backCallback }]);
    return { knopki, bukva, vsego };
}

function postroитьKlavPoiska(goroda, query, mode) {
    const p = prefiksy(mode);
    const found = poiskGorodov(goroda, query);
    const knopki = [];
    for (let i = 0; i < found.length; i += 2) {
        const row = [{ text: found[i].nazvaniye, callback_data: p.select + found[i].id }];
        if (found[i + 1]) row.push({ text: found[i + 1].nazvaniye, callback_data: p.select + found[i + 1].id });
        knopki.push(row);
    }
    return { knopki, found };
}

function tekstVyboraGoroda(strana, podzagolovok) {
    let t = '📍 *Выбери город*';
    if (strana) t += ' (' + strana + ')';
    t += '\n\n';
    t += podzagolovok || 'Нажми букву алфавита или «Написать город», чтобы найти быстрее.';
    return t;
}

module.exports = {
    RUSSIAN_LETTERS,
    KODY_STRAN,
    NA_STRANITSE,
    normalizovatBukvu,
    bukvaPoIndeksu,
    indeksBukvy,
    bukvyGorodov,
    gorodaPoBukve,
    poiskGorodov,
    kodStrany,
    stranaPoKodu,
    prefiksy,
    postroитьKlavAlfavit,
    postroитьKlavGoroda,
    postroитьKlavPoiska,
    tekstVyboraGoroda
};
