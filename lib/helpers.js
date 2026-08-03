function md(text) {
    return String(text ?? '').replace(/([_*`\[])/g, '\\$1');
}

function dataIgrovoegoVechera() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function formatDatyRu(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
}

/** Убирает мусор из строки ника: «В игре:», 1️⃣, «1. », № и т.п. */
function ochistitNikIzSpiska(raw) {
    let t = String(raw ?? '').trim();
    if (!t) return '';
    // целая строка — подпись UI / заголовок, не ник
    if (/^(в\s*игре|выбыл|состав(?:\s+вечера)?|игроки|участники|список)\s*:?\s*$/iu.test(t)) return '';
    // keycap-цифры (1️⃣…🔟) и склеенные 1️⃣1️⃣
    t = t.replace(/^(?:(?:[0-9]\uFE0F?\u20E3)+|🔟)+\s*/u, '');
    // № / # / обычные номера «1. » «2) »
    t = t.replace(/^(?:№|#)\s*/u, '');
    t = t.replace(/^\d+[\).\-\s:]+/u, '');
    t = t.trim();
    if (/^(в\s*игре|выбыл)\s*:?\s*$/iu.test(t)) return '';
    return t;
}

function razobratSpisokNikov(text) {
    return String(text || '')
        .split(/\n|[,;]+/)
        .map(ochistitNikIzSpiska)
        .filter(Boolean);
}

module.exports = {
    md,
    dataIgrovoegoVechera,
    formatDatyRu,
    ochistitNikIzSpiska,
    razobratSpisokNikov
};
