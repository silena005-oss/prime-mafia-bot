const supabase = require('./supabase');
const { md } = require('./helpers');

const SHAGI = [
    {
        key: 'igry_v_nedelyu',
        vopros: '📊 *Сколько игр в среднем в неделю?*',
        tip: 'knopki',
        varianty: ['1 игра', '2–3 игры', '4–6 игр', '7+ игр', 'Пока нерегулярно']
    },
    {
        key: 'igry_v_mes',
        vopros: '📅 *Сколько игр в месяц (ориентир для тарифа)?*',
        tip: 'knopki',
        varianty: ['до 4', '5–10', '11–20', '21–40', '40+']
    },
    {
        key: 'byudzhet',
        vopros: '💰 *Какой бюджет на автоматизацию комфортен?*',
        tip: 'knopki',
        varianty: ['до 4 000 ₽/мес', '4 000–8 000 ₽/мес', '8 000–15 000 ₽/мес', '15 000+ ₽/мес', 'Разово / пакет', 'Нужна консультация']
    },
    {
        key: 'komanda',
        vopros: '👥 *Сколько собственников и ведущих?*\n\n_Например: 1 собственник, 2 ведущих_',
        tip: 'text'
    },
    {
        key: 'igrokov_na_vecher',
        vopros: '🪑 *Сколько игроков обычно на вечер?*',
        tip: 'knopki',
        varianty: ['8–10', '11–13', '14–16', '17–20', '20+']
    },
    {
        key: 'drugie_nastolki',
        vopros: '🎲 *Другие настолки параллельно?*',
        tip: 'knopki',
        varianty: ['Только мафия', 'Мафия + другие на вечерах', 'Отдельные вечера под другие игры', 'Несколько клубов / брендов', 'Нет / не планируем']
    },
    {
        key: 'pravila_bally',
        vopros: '📜 *Правила или система баллов клуба*\n\n_Свободный текст или ссылка. Можно «пропустить»._',
        tip: 'text_skip'
    },
    {
        key: 'stilizatsiya',
        vopros: '🎨 *Нужна стилизация под клуб?*',
        tip: 'knopki',
        varianty: ['Да, хочу бренд', 'Позже', 'Пока нет']
    },
    {
        key: 'kommentariy',
        vopros: '💬 *Комментарий* (необязательно)\n\n_Что ещё важно знать о клубе? Или «пропустить»._',
        tip: 'text_skip'
    }
];

function tekstShaga(shag, nazvanieKluba) {
    let t = '📋 *Анкета клуба*\n';
    if (nazvanieKluba) t += '🎴 *' + md(nazvanieKluba) + '*\n\n';
    t += 'Шаг *' + (shag + 1) + '/' + SHAGI.length + '*\n\n';
    t += SHAGI[shag].vopros;
    return t;
}

function knopkiShaga(shag) {
    const s = SHAGI[shag];
    if (s.tip === 'knopki') {
        const rows = s.varianty.map((v, i) => [{
            text: v,
            callback_data: 'ank_btn_' + shag + '_' + i
        }]);
        rows.push([{ text: '⏭ Пропустить анкету', callback_data: 'ank_skip' }]);
        return rows;
    }
    return [[{ text: '⏭ Пропустить анкету', callback_data: 'ank_skip' }]];
}

function sformirovatSvodku(otvety, klub, igrok) {
    const lines = [
        '📋 *Анкета клуба*',
        '',
        '🎴 *' + md(klub?.nazvaniye || '—') + '*',
        '🆔 klub_id: `' + (klub?.id || '—') + '`',
        '👤 Владелец TG: `' + (klub?.owner_tg_id || igrok?.tg_id || '—') + '`',
        '📛 Контакт: ' + md(igrok?.igrovoy_nik || igrok?.imya || '—'),
        '📱 Тел: ' + (igrok?.telefon || '—'),
        ''
    ];
    for (const s of SHAGI) {
        const v = otvety[s.key];
        if (v) lines.push('• *' + s.key + '*: ' + md(String(v)));
    }
    lines.push('', '_Сохранено в Supabase → таблица `klub_ankety`_');
    return lines.join('\n');
}

async function sohranitAnketu(klub_id, owner_tg_id, otvety, klub, igrok, status) {
    const tekst_svodka = sformirovatSvodku(otvety, klub, igrok);
    const payload = {
        klub_id,
        owner_tg_id,
        otvety,
        tekst_svodka,
        status: status || 'completed',
        obnovlen: new Date().toISOString()
    };
    const { data, error } = await supabase
        .from('klub_ankety')
        .upsert(payload, { onConflict: 'klub_id' })
        .select()
        .single();
    return { data, error, tekst_svodka };
}

async function poluchitAnketuKluba(klub_id) {
    const { data } = await supabase.from('klub_ankety').select('*').eq('klub_id', klub_id).maybeSingle();
    return data;
}

async function spisokAnket(limit = 20) {
    const { data } = await supabase
        .from('klub_ankety')
        .select('id, klub_id, owner_tg_id, tekst_svodka, status, sozdan, kluby(nazvaniye, gorod)')
        .order('sozdan', { ascending: false })
        .limit(limit);
    return data || [];
}

module.exports = {
    SHAGI,
    tekstShaga,
    knopkiShaga,
    sformirovatSvodku,
    sohranitAnketu,
    poluchitAnketuKluba,
    spisokAnket
};
