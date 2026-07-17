const { md } = require('./helpers');

/** Короткая квалификация лида перед созданием клуба (не служба поддержки). */
const SHAGI = [
    {
        key: 'biznes',
        vopros: '🏢 *Есть ли бизнес или клуб мафии?*',
        varianty: [
            { text: 'Да, свой клуб', value: 'svoy_klub' },
            { text: 'Планирую открыть', value: 'planiruyu' },
            { text: 'Нет, пока для себя', value: 'dlya_sebya' }
        ]
    },
    {
        key: 'opyt',
        vopros: '🎭 *Какой опыт в мафии?*',
        varianty: [
            { text: 'Новичок', value: 'novichok' },
            { text: 'Играю регулярно', value: 'igrok' },
            { text: 'Веду игры', value: 'vedushchiy' },
            { text: 'Владею клубом', value: 'vladyelets' }
        ]
    },
    {
        key: 'interes',
        vopros: '✨ *Что интересно сейчас?*',
        varianty: [
            { text: 'Играть с друзьями бесплатно', value: 'druzya' },
            { text: 'Открыть клуб в городе', value: 'klub' },
            { text: 'И то и другое', value: 'oba' }
        ]
    }
];

function tekstShaga(shag) {
    return (
        '🏢 *Открыть клуб в своём городе*\n\n' +
        'Шаг *' + (shag + 1) + '/' + SHAGI.length + '*\n\n' +
        SHAGI[shag].vopros +
        '\n\n_Ответы помогут подобрать формат. Это не поддержка — можно пройти за минуту._'
    );
}

function knopkiShaga(shag) {
    const s = SHAGI[shag];
    const rows = s.varianty.map((v, i) => [{
        text: v.text,
        callback_data: 'lid_btn_' + shag + '_' + i
    }]);
    rows.push([{ text: '⬅️ В меню', callback_data: 'menu_igroka' }]);
    return rows;
}

function labelOtveta(key, value) {
    const shag = SHAGI.find(s => s.key === key);
    const v = shag?.varianty?.find(x => x.value === value);
    return v?.text || value || '—';
}

function sformirovatSvodku(otvety, igrok) {
    const lines = [
        '🎯 *Лид: открыть клуб*',
        '',
        '👤 ' + md(igrok?.igrovoy_nik || igrok?.imya || '—'),
        'TG: `' + (igrok?.tg_id || '—') + '`',
        '📍 ' + md(igrok?.gorod || 'город не указан'),
        ''
    ];
    for (const s of SHAGI) {
        lines.push('• *' + s.key + '*: ' + md(labelOtveta(s.key, otvety?.[s.key])));
    }
    return lines.join('\n');
}

function marshrutPosleLida(interes) {
    if (interes === 'druzya') return 'druzya';
    return 'klub'; // klub | oba
}

module.exports = {
    SHAGI,
    tekstShaga,
    knopkiShaga,
    labelOtveta,
    sformirovatSvodku,
    marshrutPosleLida
};
