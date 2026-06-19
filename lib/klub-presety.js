const fs = require('fs');
const path = require('path');

const CLUBS_DIR = path.join(__dirname, '..', 'clubs');
let cache = null;

function normalizovatNazvanie(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-z0-9а-я\s-]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function zagruzitPresetyKlubov() {
    if (cache) return cache;
    cache = [];
    if (!fs.existsSync(CLUBS_DIR)) return cache;

    for (const ent of fs.readdirSync(CLUBS_DIR, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
        const presetPath = path.join(CLUBS_DIR, ent.name, 'preset.json');
        if (!fs.existsSync(presetPath)) continue;
        try {
            const raw = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
            cache.push({
                slug: raw.slug || ent.name,
                folder: ent.name,
                match_names: Array.isArray(raw.match_names) ? raw.match_names : [],
                nastroyki: raw.nastroyki || {},
                opisanie: raw.opisanie || ''
            });
        } catch (e) {
            console.warn('[klub-presety] не прочитан', presetPath, e.message || e);
        }
    }
    return cache;
}

function sovpadaetImya(nazvanieKluba, pattern) {
    const a = normalizovatNazvanie(nazvanieKluba);
    const b = normalizovatNazvanie(pattern);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
}

function naytiPresetPoNazvaniyu(nazvanie) {
    const list = zagruzitPresetyKlubov();
    for (const preset of list) {
        if (preset.match_names.some(m => sovpadaetImya(nazvanie, m))) return preset;
    }
    return null;
}

function primeniPresetPoNazvaniyu(nazvanie, bazaNastroyki = {}) {
    const preset = naytiPresetPoNazvaniyu(nazvanie);
    if (!preset) return { ...bazaNastroyki };
    return {
        ...preset.nastroyki,
        ...bazaNastroyki,
        club_preset: preset.slug,
        club_preset_folder: preset.folder
    };
}

function sbrositKeshPresets() {
    cache = null;
}

module.exports = {
    normalizovatNazvanie,
    zagruzitPresetyKlubov,
    naytiPresetPoNazvaniyu,
    primeniPresetPoNazvaniyu,
    sbrositKeshPresets
};
