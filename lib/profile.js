const supabase = require('./supabase');

function segodnyaMMDD() {
    const parts = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }).split('-');
    return parts[1] + '-' + parts[2];
}

function godMoscow() {
    return parseInt(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }).split('-')[0], 10);
}

function razobratDenRozhdeniya(vvod) {
    const t = String(vvod || '').trim().toLowerCase();
    if (!t || t === 'пропустить' || t === '-') return null;

    const dm = t.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?$/);
    if (dm) {
        const d = parseInt(dm[1], 10);
        const m = parseInt(dm[2], 10);
        const y = dm[3] ? parseInt(dm[3], 10) : 2000;
        if (m < 1 || m > 12 || d < 1 || d > 31) return { error: 'invalid' };
        const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dt = new Date(iso + 'T12:00:00Z');
        if (Number.isNaN(dt.getTime())) return { error: 'invalid' };
        return { iso };
    }
    return { error: 'format' };
}

function formatDenRozhdeniya(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [, m, d] = iso.split('-');
    return d.replace(/^0/, '') + '.' + m.replace(/^0/, '');
}

function segodnyaDenRozhdeniya(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const mmdd = iso.slice(5);
    return mmdd === segodnyaMMDD();
}

async function obnovitAvatarIzTelegram(bot, tg_id) {
    if (!bot || !tg_id) return null;
    try {
        const photos = await bot.getUserProfilePhotos(tg_id, { limit: 1 });
        const fileId = photos?.photos?.[0]?.[0]?.file_id;
        if (!fileId) return null;
        await supabase.from('igroki').update({ avatar_file_id: fileId }).eq('tg_id', tg_id);
        return fileId;
    } catch (e) {
        console.warn('[avatar]', tg_id, e.message || e);
        return null;
    }
}

async function otsylkaAvatara(bot, file_id, res) {
    if (!file_id || !bot) {
        res.writeHead(404);
        res.end();
        return;
    }
    try {
        const file = await bot.getFile(file_id);
        if (!file?.file_path) {
            res.writeHead(404);
            res.end();
            return;
        }
        const url = 'https://api.telegram.org/file/bot' + bot.token + '/' + file.file_path;
        const upstream = await fetch(url);
        if (!upstream.ok) {
            res.writeHead(404);
            res.end();
            return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(200, {
            'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'private, max-age=3600'
        });
        res.end(buf);
    } catch (e) {
        console.warn('[avatar proxy]', e.message || e);
        res.writeHead(502);
        res.end();
    }
}

async function pozdravitSbirthday(bot) {
    if (!bot) return;
    const year = godMoscow();
    const mmdd = segodnyaMMDD();

    const { data: rows, error } = await supabase
        .from('igroki')
        .select('id, tg_id, imya, igrovoy_nik, den_rozhdeniya, pozdravlen_dr_god, gorod')
        .not('den_rozhdeniya', 'is', null);

    if (error) {
        console.error('[birthday]', error.message);
        return;
    }

    for (const igrok of rows || []) {
        if (!igrok.den_rozhdeniya || !segodnyaDenRozhdeniya(igrok.den_rozhdeniya)) continue;
        if (igrok.pozdravlen_dr_god === year) continue;
        const name = igrok.igrovoy_nik || igrok.imya || 'игрок';
        const text =
            '🎂 *С днём рождения, ' + name.replace(/([_*`\[])/g, '\\$1') + '!*\n\n' +
            'Prime Mafia и твои мафия-клубы желают ярких игр, удачных ролей и побед!\n\n' +
            '_Загляни в mini app — там твой рейтинг и бонусы._';

        try {
            await bot.sendMessage(igrok.tg_id, text, { parse_mode: 'Markdown' });
            await supabase.from('igroki').update({ pozdravlen_dr_god: year }).eq('id', igrok.id);

            const { data: klubyIgroka } = await supabase
                .from('chleny_klubov')
                .select('klub_id')
                .eq('igrok_id', igrok.id);
            const klubIds = (klubyIgroka || []).map(k => k.klub_id).filter(Boolean);
            if (klubIds.length) {
                const { data: chleny } = await supabase
                    .from('chleny_klubov')
                    .select('igroki(tg_id)')
                    .in('klub_id', klubIds)
                    .neq('igrok_id', igrok.id);
                const notified = new Set();
                for (const row of chleny || []) {
                    const tid = row.igroki?.tg_id;
                    if (!tid || tid === igrok.tg_id || notified.has(tid)) continue;
                    notified.add(tid);
                    bot.sendMessage(tid,
                        '🎉 Сегодня день рождения у *' + name.replace(/([_*`\[])/g, '\\$1') + '*!\n\n' +
                        'Поздравь на игре — будет теплее 🎴',
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }
            }
        } catch (e) {
            console.warn('[birthday send]', igrok.tg_id, e.message || e);
        }
    }
}

module.exports = {
    segodnyaMMDD,
    razobratDenRozhdeniya,
    formatDenRozhdeniya,
    segodnyaDenRozhdeniya,
    obnovitAvatarIzTelegram,
    otsylkaAvatara,
    pozdravitSbirthday
};
