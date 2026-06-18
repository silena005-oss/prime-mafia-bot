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

module.exports = {
    md,
    dataIgrovoegoVechera,
    formatDatyRu
};
