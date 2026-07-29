const supabase = require('./supabase');
const { md } = require('./helpers');

const OtpisTekst = '\n\n_Отписаться от приглашений: /unsubscribe или «отписаться»._';

/** In-process fallback if rassylka_jobs table missing. */
const rassylkaOchered = [];
let rassylkaBusy = false;
let workerStarted = false;
let tableMissingLogged = false;

async function poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id) {
    const { data: rows } = await supabase
        .from('chleny_klubov')
        .select('igroki(id, tg_id, otpis_priglasheniy, igrovoy_nik, imya)')
        .eq('klub_id', klub_id);

    return (rows || [])
        .map(r => r.igroki)
        .filter(i => i?.tg_id && !i.otpis_priglasheniy && i.tg_id !== exclude_tg_id);
}

async function otpravitRassylku(bot, poluchateli, text, opts = {}) {
    let ok = 0;
    let fail = 0;
    let blocked = 0;
    const delayMs = opts.delayMs ?? 55;
    const startIdx = opts.startIdx || 0;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    for (let i = startIdx; i < poluchateli.length; i++) {
        const p = poluchateli[i];
        try {
            await bot.sendMessage(p.tg_id, text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {})
            });
            ok += 1;
        } catch (e) {
            const code = e.response?.body?.error_code ?? e.response?.status;
            if (code === 403) blocked += 1;
            else fail += 1;
        }
        if (onProgress) {
            try { await onProgress({ ok, fail, blocked, cursor: i + 1, total: poluchateli.length }); } catch (_) {}
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }

    return { ok, fail, blocked, total: poluchateli.length };
}

function tekstPriglasheniyaNaAnons(klub, anons, botUsername) {
    const ssylka = botUsername
        ? 'https://t.me/' + botUsername + '?start=anons_' + anons.id
        : null;
    let t = '📢 *Приглашение на игру*\n\n';
    t += '🎴 *' + md(klub?.nazvaniye || 'Клуб') + '*\n';
    t += '📅 ' + (anons.data_igry || '') + ' в ' + (anons.vremya || '') + '\n';
    t += '📍 ' + md(anons.adres || '') + '\n';
    if (anons.kommentariy) t += '💬 ' + md(anons.kommentariy) + '\n';
    t += '\nЗапишись в боте Prime Mafia';
    if (ssylka) t += ':\n' + ssylka;
    else t += ' → «📢 Анонсы игр».';
    return t + OtpisTekst;
}

function tekstPriglasheniyaVIgru(klubNazvaniye, kod, url) {
    let t = '🎴 *' + md(klubNazvaniye || 'Клуб') + '* приглашает на игру №*' + kod + '*\n\n';
    t += 'Войти по ссылке:\n' + url + '\n\n';
    t += '_Или в боте: «🎮 Войти в игру» → код ' + kod + '._';
    return t + OtpisTekst;
}

async function sozdatJobVDb({ tip, klub_id, chat_id, tekst, poluchateli }) {
    const total = poluchateli.length;
    const { data, error } = await supabase
        .from('rassylka_jobs')
        .insert({
            tip,
            klub_id: klub_id || null,
            chat_id: chat_id || null,
            tekst,
            poluchateli: poluchateli.map(p => ({ tg_id: p.tg_id })),
            status: 'pending',
            total
        })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

async function propustitOcheredRassylki() {
    if (rassylkaBusy) return;
    rassylkaBusy = true;
    while (rassylkaOchered.length) {
        const job = rassylkaOchered.shift();
        try {
            const res = await job.run();
            job.resolve(res);
        } catch (e) {
            job.reject(e);
        }
    }
    rassylkaBusy = false;
}

function postavitRassylkuVOchered(run) {
    return new Promise((resolve, reject) => {
        rassylkaOchered.push({ run, resolve, reject });
        propustitOcheredRassylki().catch(reject);
    });
}

/**
 * Enqueue broadcast: prefers durable DB job; falls back to in-memory queue.
 * Returns immediately with { queued, job_id?, empty? }.
 * When chat_id set, worker notifies Telegram on completion.
 */
async function postavitRassylku({ tip, klub_id, chat_id, tekst, poluchateli, bot }) {
    if (!poluchateli.length) {
        return { queued: false, empty: true, ok: 0, fail: 0, blocked: 0, total: 0 };
    }

    try {
        const job_id = await sozdatJobVDb({ tip, klub_id, chat_id, tekst, poluchateli });
        zapustitWorker(bot);
        return { queued: true, durable: true, job_id, total: poluchateli.length };
    } catch (e) {
        if (!tableMissingLogged) {
            tableMissingLogged = true;
            console.warn('[rassylka] DB jobs unavailable, in-memory fallback:', e.message || e);
        }
        // Fire-and-forget memory queue; notify chat when done
        postavitRassylkuVOchered(async () => {
            const res = await otpravitRassylku(bot, poluchateli, tekst);
            if (chat_id) {
                let t = '📨 *Рассылка завершена*\n\n';
                t += 'Доставлено: *' + res.ok + '* из ' + res.total;
                if (res.blocked) t += '\nЗаблокировали бота: ' + res.blocked;
                if (res.fail) t += '\nОшибок: ' + res.fail;
                await bot.sendMessage(chat_id, t, { parse_mode: 'Markdown' }).catch(() => {});
            }
            return res;
        }).catch(err => console.error('[rassylka mem]', err?.message || err));
        return { queued: true, durable: false, total: poluchateli.length };
    }
}

async function razoslatAnons(bot, klub_id, klub, anons, botUsername, exclude_tg_id, chat_id) {
    const poluchateli = await poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id);
    const tekst = tekstPriglasheniyaNaAnons(klub, anons, botUsername);
    return postavitRassylku({
        tip: 'anons',
        klub_id,
        chat_id,
        tekst,
        poluchateli,
        bot
    });
}

async function razoslatVhodVIgru(bot, klub_id, klubNazvaniye, kod, url, exclude_tg_id, chat_id) {
    const poluchateli = await poluchitPoluchateleyPriglasheniy(klub_id, exclude_tg_id);
    const tekst = tekstPriglasheniyaVIgru(klubNazvaniye, kod, url);
    return postavitRassylku({
        tip: 'igra',
        klub_id,
        chat_id,
        tekst,
        poluchateli,
        bot
    });
}

async function vzyatSleduyushchiyJob() {
    const { data: rows, error } = await supabase
        .from('rassylka_jobs')
        .select('*')
        .eq('status', 'pending')
        .order('sozdan', { ascending: true })
        .limit(1);
    if (error) throw error;
    const job = rows?.[0];
    if (!job) return null;
    const { data: claimed, error: e2 } = await supabase
        .from('rassylka_jobs')
        .update({ status: 'running', nachat: new Date().toISOString() })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
    if (e2) throw e2;
    return claimed || null;
}

async function obrabotatJob(bot, job) {
    const poluchateli = (job.poluchateli || []).map(p => ({ tg_id: p.tg_id })).filter(p => p.tg_id);
    let ok = job.ok || 0;
    let fail = job.fail || 0;
    let blocked = job.blocked || 0;
    const startIdx = job.cursor_idx || 0;
    const delayMs = 55;

    for (let i = startIdx; i < poluchateli.length; i++) {
        try {
            await bot.sendMessage(poluchateli[i].tg_id, job.tekst, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            ok += 1;
        } catch (e) {
            const code = e.response?.body?.error_code ?? e.response?.status;
            if (code === 403) blocked += 1;
            else fail += 1;
        }
        if ((i + 1) % 25 === 0 || i === poluchateli.length - 1) {
            await supabase.from('rassylka_jobs').update({
                ok, fail, blocked, cursor_idx: i + 1
            }).eq('id', job.id);
        }
        await new Promise(r => setTimeout(r, delayMs));
    }

    await supabase.from('rassylka_jobs').update({
        status: 'done',
        ok,
        fail,
        blocked,
        total: poluchateli.length,
        cursor_idx: poluchateli.length,
        zavershen: new Date().toISOString()
    }).eq('id', job.id);

    if (job.chat_id) {
        let t = '📨 *Рассылка завершена*\n\n';
        if (!poluchateli.length) t += 'Некому отправить.';
        else {
            t += 'Доставлено: *' + ok + '* из ' + poluchateli.length;
            if (blocked) t += '\nЗаблокировали бота: ' + blocked;
            if (fail) t += '\nОшибок: ' + fail;
        }
        await bot.sendMessage(job.chat_id, t, { parse_mode: 'Markdown' }).catch(() => {});
    }
}

async function tickWorker(bot) {
    if (rassylkaBusy) return;
    rassylkaBusy = true;
    try {
        const job = await vzyatSleduyushchiyJob();
        if (job) await obrabotatJob(bot, job);
    } catch (e) {
        if (!tableMissingLogged) {
            // table may not exist yet
            const msg = String(e.message || e);
            if (/relation .*rassylka_jobs.* does not exist|Could not find the table/i.test(msg)) {
                tableMissingLogged = true;
            } else {
                console.error('[rassylka worker]', msg);
            }
        }
    } finally {
        rassylkaBusy = false;
    }
}

function zapustitWorker(bot) {
    if (workerStarted || !bot) return;
    workerStarted = true;
    setInterval(() => {
        tickWorker(bot).catch(() => {});
    }, 3000).unref?.();
    tickWorker(bot).catch(() => {});
}

module.exports = {
    OtpisTekst,
    poluchitPoluchateleyPriglasheniy,
    otpravitRassylku,
    tekstPriglasheniyaNaAnons,
    tekstPriglasheniyaVIgru,
    razoslatAnons,
    razoslatVhodVIgru,
    postavitRassylkuVOchered,
    postavitRassylku,
    zapustitWorker
};
