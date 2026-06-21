// ============================================
// PrimeMafia — Telegram бот
// Раздача ролей каждому игроку в личку
// ============================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const supabase = require('./lib/supabase');
const { md, dataIgrovoegoVechera, formatDatyRu } = require('./lib/helpers');
const billing = require('./lib/billing');
const invite = require('./lib/invite');
const klubInvite = require('./lib/klub-invite');
const profile = require('./lib/profile');
const klubPresety = require('./lib/klub-presety');
const tarify = require('./lib/tarify');
const publikaciya = require('./lib/publikaciya');
const rassylka = require('./lib/rassylka');
const klubAnketa = require('./lib/klub-anketa');
const bonusy = require('./lib/bonusy');
const gorodaUi = require('./lib/goroda-ui');
const vecherReyting = require('./lib/vecher-reyting');
const itogFrazy = require('./lib/itog-frazy');

const {
    razobratDenRozhdeniya,
    formatDenRozhdeniya,
    obnovitAvatarIzTelegram,
    otsylkaAvatara,
    pozdravitSbirthday
} = profile;

const {
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
    poluchitTarifKluba,
    mozhnoFunktsiyuKluba
} = billing;

const { otpravitQrVhodaVBota, ssylkaVhodaVIgru, knopkiPriglasheniyaVIgru, tekstPriglasheniyaVIgru } = invite;

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_TOKEN не задан. Добавь переменную в Railway → Variables');
    process.exit(1);
}

// Railway (web-сервис) требует открытый PORT, иначе контейнер помечают Crashed
const http = require('http');
const PORT = process.env.PORT || 8080;
const MINI_APP_PATH = '/miniapp';
const MINI_APP_DIR = path.join(__dirname, 'miniapp');
const MINI_APP_ROOT = path.resolve(MINI_APP_DIR);
const DEFAULT_MINI_APP_URL = 'https://prime-mafia-bot-production.up.railway.app/miniapp';

function naRailway() {
    return !!(
        process.env.RAILWAY_ENVIRONMENT_NAME ||
        process.env.RAILWAY_PROJECT_ID ||
        process.env.RAILWAY_SERVICE_ID ||
        process.env.RAILWAY_STATIC_URL
    );
}

if (naRailway() && process.env.MINIAPP_DEV_TG_ID) {
    console.error('⚠️ MINIAPP_DEV_TG_ID задан на Railway — удалите переменную (dev-обход mini app запрещён)');
}
if (process.env.NODE_ENV === 'production' && process.env.MINIAPP_DEV_TG_ID) {
    console.error('⚠️ MINIAPP_DEV_TG_ID в production — dev-обход mini app запрещён');
}

function razreshenMiniAppDevBypass() {
    if (naRailway()) return false;
    if (process.env.NODE_ENV === 'production') return false;
    if (process.env.ALLOW_MINIAPP_DEV_BYPASS !== 'true') return false;
    return !!process.env.MINIAPP_DEV_TG_ID;
}

function putVnutriMiniAppDir(filePath) {
    const resolved = path.resolve(filePath);
    return resolved === MINI_APP_ROOT || resolved.startsWith(MINI_APP_ROOT + path.sep);
}

function poluchitMiniAppUrl() {
    if (process.env.MINI_APP_URL) return process.env.MINI_APP_URL.replace(/\/$/, '');
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || '';
    if (!domain) return DEFAULT_MINI_APP_URL;
    return 'https://' + domain.replace(/^https?:\/\//, '').replace(/\/$/, '') + MINI_APP_PATH;
}

function knopkiMiniApp() {
    const url = poluchitMiniAppUrl();
    if (!url) return [[{ text: '🃏 Приложение', callback_data: 'miniapp_nastroika' }]];
    return [[{ text: '🃏 Открыть приложение', web_app: { url } }]];
}

function miniAppMime(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

function otpravitJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function prochitatJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 100000) {
                req.destroy();
                reject(new Error('request_too_large'));
            }
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (_) {
                reject(new Error('invalid_json'));
            }
        });
        req.on('error', reject);
    });
}

function proveritTelegramInitData(initData) {
    if (!initData) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const checkString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const digest = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hash, 'hex'))) return null;

    const authDate = Number(params.get('auth_date') || 0);
    if (authDate && Date.now() / 1000 - authDate > 86400) return null;
    const userRaw = params.get('user');
    if (!userRaw) return null;
    try {
        return JSON.parse(userRaw);
    } catch (_) {
        return null;
    }
}

async function poluchitMiniAppUser(req) {
    const initData = req.headers['x-telegram-init-data'];
    const user = proveritTelegramInitData(initData);
    if (user?.id) return user;

    if (razreshenMiniAppDevBypass()) {
        return { id: Number(process.env.MINIAPP_DEV_TG_ID), first_name: 'Dev' };
    }
    return null;
}

function kratkoIgruDlyaMiniApp(kod, igra, requesterId = null) {
    const igroki = Array.isArray(igra.igroki) ? igra.igroki : [];
    const zhivye = igroki.filter(i => i.status === 'v_igre').length;
    const isHost = requesterId != null && igra.vedushchii_id === requesterId;
    return {
        kod,
        klub_id: igra.klub_id || null,
        klub: nazvanieKlubaIgry(igra) || '',
        kolichestvo: igra.kolichestvo || igroki.length,
        zhivye,
        faza: igra.faza || 'ozhidanie',
        den: igra.den || 1,
        status: igra.ostanovlena ? 'paused' : (igra.roli_razdany ? 'live' : 'lobby'),
        rezhim_rolei: igra.rezhim_rolei || null,
        vedushchii_id: igra.vedushchii_id || null,
        pobeditel: igra.pobeditel || null,
        is_host: isHost,
        host: isHost ? metaHostaMiniApp(igra, kod) : null,
        players: igroki.map(i => ({
            nomer: i.nomer,
            name: i.name,
            telegram_id: i.telegram_id || null,
            status: i.status || 'v_igre',
            foly: i.foly || 0,
            rol_vidna: isHost && !!i.rol,
            role: isHost ? (i.rol || null) : null,
            speaking: isHost && igra.tekushchiy_nomer === i.nomer
        })),
        composition: isHost ? poluchitSostavDlyaIgry(igra) : null
    };
}

function shagIntroNochi(igra) {
    if (!igra?._miniapp_intro) return null;
    const intro = igra._miniapp_intro;
    if (intro.phase === 'mirny') {
        const remaining = mirnyeOstalosVnesti(igra);
        return {
            phase: 'mirny',
            label: 'Мирные без роли',
            remaining,
            total: mirnyePoSostavu(igra),
            done: remaining <= 0
        };
    }
    const roles = poryadokRoleyDlyaNochi(igra);
    const idx = intro.idx || 0;
    if (idx >= roles.length) {
        return { phase: 'mirny', label: 'Мирные без роли', remaining: mirnyeOstalosVnesti(igra), total: mirnyePoSostavu(igra) };
    }
    const rol = roles[idx];
    const takihDo = roles.slice(0, idx + 1).filter(r => r === rol).length;
    const takihVsego = roles.filter(r => r === rol).length;
    return {
        phase: 'roles',
        idx,
        total: roles.length,
        rol,
        label: (rol === 'Мафия' ? 'Запись мафии: ' : '') + rol + (takihVsego > 1 ? ' ' + takihDo + '/' + takihVsego : '')
    };
}

function metaHostaMiniApp(igra, kod) {
    const gov = igra.tekushchiy_nomer;
    const shagi = igra.faza === 'noch' ? shagiNochiDeystviy(igra) : [];
    const idx = Number.isFinite(igra._noch_guided_idx) ? igra._noch_guided_idx : null;
    const intro = shagIntroNochi(igra);
    const nightDone = igra.faza === 'noch' && idx != null && idx >= shagi.length;
    return {
        can_submit_roster: igra.rezhim_rolei === 'karty' && !igra.roli_razdany && !intro &&
            (igra.igroki || []).length < igra.kolichestvo,
        roster_count: (igra.igroki || []).length,
        roster_needed: igra.kolichestvo,
        speaking_nomer: gov || null,
        timer_sec: igra.taymer_aktiven ? (igra.taymer_sekundy || 0) : 0,
        can_nominate: (igra.faza === 'den' || igra.faza === 'znakomstvo') && !!gov &&
            !uzheVystavilTekushchiyGovoryashchiy(igra) && kandidatyNaVystavlenie(igra, gov).length > 0,
        can_undo_nominate: (igra.faza === 'den' || igra.faza === 'znakomstvo') && !!gov &&
            govoryashchiyVystavilNaGolos(igra, gov) != null,
        nominees: nominirovannyePoPoryadku(igra).map(i => ({ nomer: i.nomer, name: i.name })),
        can_start_intro: !intro && igra.rezhim_rolei === 'karty' && !igra.roli_razdany &&
            (igra.igroki || []).length >= igra.kolichestvo,
        intro,
        can_pick_first: !!igra._pick_first_faza && igra.roli_razdany,
        pick_first_faza: igra._pick_first_faza || null,
        can_start_day: false,
        can_night: igra.roli_razdany && (igra.faza === 'den' || igra.faza === 'golosovanie') && !gov && !intro,
        can_finish_night: nightDone,
        night_summary: igra._miniapp_noch_itog || null,
        need_pick_first_day: !!igra._pick_first_faza,
        night: igra.faza === 'noch' ? {
            guided: idx != null,
            step: idx,
            total: shagi.length,
            step_label: idx != null && shagi[idx] ? shagi[idx].label : null,
            done: nightDone
        } : null
    };
}

async function sozdatNovuyuIgry(telegram_id, klub_id, kolichestvo, anons_id = null) {
    const { data: klub_n } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
    const nastroyki_igry = klubPresety.primeniPresetPoNazvaniyu(klub_n?.nazvaniye || '', klub_n?.nastroyki || {});
    const kod = sgenerirovat_kod();
    igry[kod] = {
        kod,
        klub_id,
        klub_nazvaniye: klub_n?.nazvaniye || '',
        anons_id: anons_id || null,
        kolichestvo,
        vedushchii_id: telegram_id,
        igroki: [],
        roli_razdany: false,
        tip_kluba: nastroyki_igry.tip_kluba || 'paskal',
        rezhim_rolei: 'karty',
        _nastroyki: nastroyki_igry
    };
    await sohranit_igru(kod);
    return kod;
}

async function otvetMiniAppPosleDeystviya(tg_id, user, message, extra = {}) {
    const data = await sostoyanieMiniApp(user || { id: tg_id });
    return { stay: true, message, data, ...extra };
}

const MINIAPP_TEMY = {
    default: { id: 'default', label: 'Prime Mafia', accent: '#d9b46a' },
    red: { id: 'red', label: 'Красная', accent: '#ff5c5c' },
    black_gold: { id: 'black_gold', label: 'Чёрно-золотая', accent: '#e8c872' },
    blue: { id: 'blue', label: 'Синяя', accent: '#6eb5ff' },
    sochi: { id: 'sochi', label: 'Sochi Warm', accent: '#f0b429' },
    ellada: { id: 'ellada', label: 'Ellada', accent: '#e8a045' }
};

const MINIAPP_TEMY_OBSCHIE = ['default', 'red', 'black_gold', 'blue'];

function dostupnyeTemyMiniApp(clubs = []) {
    const ids = new Set(MINIAPP_TEMY_OBSCHIE);
    for (const c of clubs) {
        if (c.club_theme && MINIAPP_TEMY[c.club_theme]) ids.add(c.club_theme);
    }
    return [...ids].map(id => MINIAPP_TEMY[id]).filter(Boolean);
}

function temaKlubaIzNastroek(nastroyki = {}) {
    const raw = nastroyki.miniapp_tema || nastroyki.tema || null;
    if (raw && MINIAPP_TEMY[raw]) return raw;
    if (nastroyki.deck === 'ellada') return 'ellada';
    if (nastroyki.stilizatsiya_kluba) return 'sochi';
    return null;
}

async function mozhnoSmotretAvatar(requesterTgId, targetTgId) {
    if (requesterTgId === targetTgId) return true;
    for (const [kod, igra] of Object.entries(igry)) {
        if (String(kod).startsWith('archive_')) continue;
        if (igra.vedushchii_id !== requesterTgId) continue;
        if ((igra.igroki || []).some(i => i.telegram_id === targetTgId)) return true;
    }
    return false;
}

async function obogatitIgryAvatarami(games, requesterTgId) {
    const tgIds = new Set([requesterTgId]);
    games.forEach(g => {
        const isHost = g.vedushchii_id === requesterTgId;
        (g.players || []).forEach(p => {
            if (p.telegram_id && (isHost || p.telegram_id === requesterTgId)) tgIds.add(p.telegram_id);
        });
    });
    const { data: rows } = await supabase
        .from('igroki')
        .select('tg_id, avatar_file_id')
        .in('tg_id', [...tgIds]);
    const avatars = Object.fromEntries((rows || []).filter(r => r.avatar_file_id).map(r => [r.tg_id, r.avatar_file_id]));

    return games.map(g => {
        const isHost = g.vedushchii_id === requesterTgId;
        return {
            ...g,
            players: (g.players || []).map(p => {
                const tid = p.telegram_id;
                const canSee = tid && avatars[tid] && (isHost || tid === requesterTgId);
                return {
                    ...p,
                    avatar_url: canSee ? '/api/miniapp/avatar?tg_id=' + tid : null
                };
            })
        };
    });
}

async function poluchitKlubyMiniApp(telegram_id) {
    const kluby = await poluchitKlubyDlyaIgr(telegram_id).catch(() => []);
    if (!kluby.length) return [];
    const ids = kluby.map(k => k.id);
    const { data: rows } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki')
        .in('id', ids);
    const map = Object.fromEntries((rows || []).map(r => [r.id, r]));
    return kluby.map(k => {
        const full = map[k.id] || k;
        const clubTheme = temaKlubaIzNastroek(full.nastroyki || {});
        const hasLogo = !!full.nastroyki?.logo_file_id;
        return {
            id: full.id,
            nazvaniye: full.nazvaniye || k.nazvaniye,
            branded: !!(full.nastroyki?.stilizatsiya_kluba || hasLogo),
            club_theme: clubTheme,
            logo_url: hasLogo ? '/api/miniapp/club-logo?klub_id=' + encodeURIComponent(full.id) : null
        };
    });
}

function topReytingaIzStrok(rows) {
    const totals = {};
    (rows || []).forEach(row => {
        const id = row.igrok_id;
        if (!id) return;
        if (!totals[id]) {
            totals[id] = {
                name: row.igroki?.igrovoy_nik || row.igroki?.imya || '?',
                pts: 0,
                games: 0
            };
        }
        totals[id].pts += row.bally_vsego || 0;
        totals[id].games++;
    });
    return Object.values(totals)
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 10)
        .map((p, i) => ({ place: i + 1, ...p }));
}

async function poluchitTopReytingaKluba(klub_id, sportivniy = false) {
    if (!klub_id) return [];
    const { data: rows } = await supabase
        .from('bally')
        .select('igrok_id, bally_vsego, igroki(imya, igrovoy_nik)')
        .eq('klub_id', klub_id)
        .eq('sportivniy', sportivniy || false);
    return topReytingaIzStrok(rows);
}

function statistikaRoleyIzStrok(rows) {
    if (!rows?.length) return [];
    const map = {};
    for (const r of rows) {
        const rol = r.rol || '?';
        if (!map[rol]) map[rol] = { role: rol, games: 0, wins: 0, points: 0 };
        map[rol].games += 1;
        if (r.pobedila_komanda) map[rol].wins += 1;
        map[rol].points += r.bally_vsego || 0;
    }
    return Object.values(map).sort((a, b) => b.games - a.games);
}

function luchshayaIgraIzStrok(rows) {
    if (!rows?.length) return null;
    const best = [...rows].sort((a, b) => (b.bally_vsego || 0) - (a.bally_vsego || 0))[0];
    if (!best) return null;
    const bonus = best.bonus_info && typeof best.bonus_info === 'object' ? best.bonus_info : {};
    return {
        points: best.bally_vsego || 0,
        role: best.rol || '?',
        won: !!best.pobedila_komanda,
        date: best.data_igry || null,
        club: best.kluby?.nazvaniye || '',
        best_move: !!bonus.luchshiy_hod,
        best_move_detail: bonus.luchshiy_hod?.prichina || null
    };
}

async function poluchitReytingMiniApp(telegram_id, klub_id) {
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    const igrok_id = roles.igrok?.id;
    const result = {
        klub_id: klub_id || null,
        my: null,
        top: [],
        best_game: null,
        role_stats: []
    };

    if (klub_id) {
        result.top = await poluchitTopReytingaKluba(klub_id, false);
    }

    if (!igrok_id) return result;

    let query = supabase
        .from('bally')
        .select('bally_vsego, rol, pobedila_komanda, data_igry, klub_id, bonus_info, kluby(nazvaniye)')
        .eq('igrok_id', igrok_id)
        .order('data_igry', { ascending: false })
        .limit(50);
    if (klub_id) query = query.eq('klub_id', klub_id);

    const { data: rows } = await query;
    const list = rows || [];
    if (!list.length) return result;

    const wins = list.filter(r => r.pobedila_komanda).length;
    result.my = {
        games: list.length,
        points: list.reduce((s, r) => s + (r.bally_vsego || 0), 0),
        wins,
        recent: list.slice(0, 5).map(r => ({
            role: r.rol || '?',
            points: r.bally_vsego || 0,
            won: !!r.pobedila_komanda,
            club: r.kluby?.nazvaniye || ''
        }))
    };
    result.best_game = luchshayaIgraIzStrok(list);
    result.role_stats = statistikaRoleyIzStrok(list);
    return result;
}

async function sostoyanieMiniApp(user) {
    const telegram_id = Number(user.id);
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    const igrok = roles.igrok;

    const clubs = await poluchitKlubyMiniApp(telegram_id);
    const selectedKlubId = clubs[0]?.id || null;
    let games = aktivnyeIgryVedushchego(telegram_id).map(({ kod, igra }) => kratkoIgruDlyaMiniApp(kod, igra, telegram_id));
    const klubIds = new Set(clubs.map(k => k.id));
    Object.entries(igry)
        .filter(([kod, igra]) => !String(kod).startsWith('archive_') && klubIds.has(igra?.klub_id) && igra?.vedushchii_id !== telegram_id)
        .forEach(([kod, igra]) => games.push(kratkoIgruDlyaMiniApp(kod, igra, telegram_id)));
    games = await obogatitIgryAvatarami(games, telegram_id);

    const rating = await poluchitReytingMiniApp(telegram_id, selectedKlubId).catch(() => ({
        klub_id: selectedKlubId,
        my: null,
        top: [],
        best_game: null,
        role_stats: []
    }));

    let bonuses = { active: [] };
    if (igrok?.id) {
        bonuses.active = await bonusy.poluchitBonusyIgroka(igrok.id, selectedKlubId).catch(() => []);
    }

    const ev = miniappEvents.get(telegram_id);
    const celebration = ev && Date.now() - ev.ts < 300000 ? ev : null;

    const hasAvatar = !!igrok?.avatar_file_id;

    return {
        user: {
            telegram_id,
            name: igrok?.igrovoy_nik || igrok?.imya || user.first_name || 'Игрок',
            registered: roles.registered,
            is_owner: roles.isOwner,
            is_host: roles.isHost || roles.isOwner,
            birthday: igrok?.den_rozhdeniya ? formatDenRozhdeniya(igrok.den_rozhdeniya) : null,
            avatar_url: hasAvatar ? '/api/miniapp/avatar' : null
        },
        themes: dostupnyeTemyMiniApp(clubs),
        clubs,
        selected_klub_id: selectedKlubId,
        rating,
        bonuses,
        celebration,
        games
    };
}

async function obrabotatMiniAppAction(chatId, tg_id, action, user = {}, body = {}) {
    if (action === 'open_menu') {
        await obrabotatStart({
            chat: { id: chatId },
            from: { id: tg_id, first_name: user.first_name || '', username: user.username || '' }
        }, []);
        return 'Меню отправлено в бот';
    }
    if (action === 'my_games') {
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Список игр обновлён');
    }
    if (action === 'igrovoy_vecher') {
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Выбери клуб и создай игру здесь');
    }
    if (action === 'create_game') {
        const klub_id = body.klub_id;
        const kolichestvo = parseInt(body.kolichestvo, 10);
        if (!klub_id || !Number.isFinite(kolichestvo) || kolichestvo < 6 || kolichestvo > 20) {
            return { stay: true, message: 'Выбери клуб и число игроков (6–20).' };
        }
        const kluby = await poluchitKlubyDlyaIgr(tg_id);
        if (!kluby.some(k => k.id === klub_id)) {
            return { stay: true, message: 'Нет доступа к этому клубу.' };
        }
        const kod = await sozdatNovuyuIgry(tg_id, klub_id, kolichestvo);
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Игра №' + kod + ' создана', { selected_game: kod });
    }
    if (action === 'submit_roster') {
        const kod = String(body.kod || '');
        const igra = igry[kod];
        if (!igra || igra.vedushchii_id !== tg_id) {
            return { stay: true, message: 'Игра не найдена или нет доступа.' };
        }
        const ok = await vnestiSpisokIgrokovLobby(null, igra, kod, body.text || '', { silent: true });
        if (!ok) return { stay: true, message: 'Нужно ровно ' + igra.kolichestvo + ' ников — каждый с новой строки.' };
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Состав из ' + igra.kolichestvo + ' игроков сохранён', { selected_game: kod });
    }
    if (action === 'host_action') {
        return miniAppHostAction(tg_id, user, body);
    }
    if (action === 'roles') {
        await bot.sendMessage(chatId, '🎭 *Управление ролями*\n\nОткрой настройки ролей для нужного клуба.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }]] }
        });
        return 'Управление ролями отправлено в бот';
    }
    if (action === 'join_game') {
        await bot.sendMessage(chatId, '🎮 Чтобы войти в игру, нажми «Войти в игру» в меню или отправь код игры ведущему.');
        return 'Инструкция отправлена в бот';
    }
    if (action === 'support') {
        await bot.sendMessage(chatId, '💬 Поддержка Prime Mafia: напиши сюда, что случилось, и мы поможем.');
        return 'Поддержка открыта в боте';
    }
    if (action === 'rating') {
        await bot.sendMessage(chatId, '🏆 *Рейтинг*\n\nОткрой полный рейтинг в боте:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🏆 Мой рейтинг', callback_data: 'moy_reyting' }],
                [{ text: '🏛 Рейтинг клуба', callback_data: 'reyting_vybor_kluba' }]
            ] }
        });
        return 'Рейтинг открыт в боте';
    }
    if (action === 'ack_celebration') {
        miniappEvents.delete(tg_id);
        return 'ok';
    }
    if (action === 'sync_avatar') {
        const fileId = await obnovitAvatarIzTelegram(bot, tg_id);
        return fileId ? 'Аватар обновлён из Telegram' : 'Не удалось получить фото профиля Telegram';
    }
    if (action === 'profile_settings') {
        await bot.sendMessage(chatId, '⚙️ *Настройки профиля*\n\nИмя, ник, город и день рождения — в боте:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }]] }
        });
        return 'Настройки профиля открыты в боте';
    }

    await bot.sendMessage(chatId, '✅ Данные из приложения получены.');
    return 'Действие получено';
}

async function obrabotatMiniAppAvatar(req, res, url) {
    const user = await poluchitMiniAppUser(req);
    if (!user) {
        res.writeHead(401);
        res.end();
        return;
    }
    const requesterId = Number(user.id);
    const targetId = url.searchParams.get('tg_id') ? Number(url.searchParams.get('tg_id')) : requesterId;
    if (!targetId || !(await mozhnoSmotretAvatar(requesterId, targetId))) {
        res.writeHead(403);
        res.end();
        return;
    }
    const { data: igrok } = await supabase.from('igroki').select('avatar_file_id').eq('tg_id', targetId).single();
    await otsylkaAvatara(bot, igrok?.avatar_file_id, res);
}

async function obrabotatMiniAppClubLogo(req, res, url) {
    const user = await poluchitMiniAppUser(req);
    if (!user) {
        res.writeHead(401);
        res.end();
        return;
    }
    const klub_id = url.searchParams.get('klub_id');
    if (!klub_id || !(await klubBrend.mozhnoSmotretLogoKluba(Number(user.id), klub_id))) {
        res.writeHead(403);
        res.end();
        return;
    }
    const file_id = await klubBrend.poluchitLogoFileId(klub_id);
    await otsylkaAvatara(bot, file_id, res);
}

async function obrabotatMiniAppApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/miniapp/avatar') {
        await obrabotatMiniAppAvatar(req, res, url);
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/miniapp/club-logo') {
        await obrabotatMiniAppClubLogo(req, res, url);
        return;
    }
    const user = await poluchitMiniAppUser(req);
    if (!user) {
        otpravitJson(res, 401, { ok: false, error: 'telegram_auth_required' });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/miniapp/state') {
        const klub_id = url.searchParams.get('klub_id');
        const data = await sostoyanieMiniApp(user);
        if (klub_id && data.clubs?.some(c => c.id === klub_id)) {
            data.selected_klub_id = klub_id;
            data.rating = await poluchitReytingMiniApp(Number(user.id), klub_id).catch(() => data.rating);
            const rolesK = await poluchitRoliPolzovatelya(Number(user.id));
            if (rolesK.igrok?.id) {
                data.bonuses = { active: await bonusy.poluchitBonusyIgroka(rolesK.igrok.id, klub_id).catch(() => []) };
            }
        }
        otpravitJson(res, 200, { ok: true, data });
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/miniapp/action') {
        const body = await prochitatJsonBody(req);
        const action = body.action || body.type;
        if (!action) {
            otpravitJson(res, 400, { ok: false, error: 'action_required' });
            return;
        }
        const message = await obrabotatMiniAppAction(Number(user.id), Number(user.id), action, user, body);
        if (message && typeof message === 'object' && message.stay) {
            otpravitJson(res, 200, { ok: true, ...message });
        } else {
            otpravitJson(res, 200, { ok: true, message: message || 'ok' });
        }
        return;
    }
    otpravitJson(res, 404, { ok: false, error: 'not_found' });
}

function otpravitMiniAppFile(res, url) {
    const relPath = url.pathname === MINI_APP_PATH || url.pathname === MINI_APP_PATH + '/'
        ? 'index.html'
        : decodeURIComponent(url.pathname.replace(MINI_APP_PATH + '/', ''));
    if (relPath.includes('..') || path.isAbsolute(relPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    const filePath = path.resolve(MINI_APP_DIR, relPath);
    if (!putVnutriMiniAppDir(filePath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(filePath, (err, body) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Mini app file not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': miniAppMime(filePath),
            'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=300'
        });
        res.end(body);
    });
}

http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/miniapp/')) {
        obrabotatMiniAppApi(req, res, url).catch(e => {
            console.error('[miniapp api]', e.message || e);
            otpravitJson(res, 500, { ok: false, error: 'server_error' });
        });
        return;
    }
    if (url.pathname === MINI_APP_PATH || url.pathname.startsWith(MINI_APP_PATH + '/')) {
        otpravitMiniAppFile(res, url);
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('PrimeMafia bot OK\nMini app: ' + MINI_APP_PATH + '\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Health check слушает порт', PORT);
});

const bot = new TelegramBot(token, { polling: false });

function etoOshibkaMarkdown(err) {
    const msg = String(err?.message || err?.response?.body?.description || '');
    return /parse entities|can't parse|entity/i.test(msg);
}

function optsBezMarkdown(opts) {
    if (!opts || typeof opts !== 'object') return opts;
    const copy = { ...opts };
    delete copy.parse_mode;
    return copy;
}

function vklyuchitMarkdownFallback() {
    const sendMessage = bot.sendMessage.bind(bot);
    const editMessageText = bot.editMessageText.bind(bot);
    const sendPhoto = bot.sendPhoto.bind(bot);

    bot.sendMessage = async (chatId, text, opts) => {
        try {
            return await sendMessage(chatId, text, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] sendMessage:', e.message || e);
                return sendMessage(chatId, text, optsBezMarkdown(opts));
            }
            throw e;
        }
    };

    bot.editMessageText = async (text, opts) => {
        try {
            return await editMessageText(text, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] editMessageText:', e.message || e);
                return editMessageText(text, optsBezMarkdown(opts));
            }
            throw e;
        }
    };

    bot.sendPhoto = async (chatId, photo, opts) => {
        try {
            return await sendPhoto(chatId, photo, opts);
        } catch (e) {
            if (opts?.parse_mode === 'Markdown' && etoOshibkaMarkdown(e)) {
                console.warn('[markdown fallback] sendPhoto:', e.message || e);
                return sendPhoto(chatId, photo, optsBezMarkdown(opts));
            }
            throw e;
        }
    };
}

vklyuchitMarkdownFallback();

let pollingZapuschen = false;
let konflikt409Popytki = 0;
const MAX_409_POVTOROV = 8;

function etoOshibka409(err) {
    return err?.response?.statusCode === 409
        || (err?.message && String(err.message).includes('409'));
}

async function zapustitPolling() {
    if (pollingZapuschen) return;
    await bot.deleteWebHook({ drop_pending_updates: true });
    await bot.startPolling();
    pollingZapuschen = true;
    konflikt409Popytki = 0;
}

async function perezapuskPosle409() {
    konflikt409Popytki += 1;
    if (konflikt409Popytki > MAX_409_POVTOROV) {
        console.error(
            '409: второй процесс с тем же TELEGRAM_TOKEN. Останови локальный node bot.js, на Railway — 1 реплика.\n' +
            'Бот продолжит попытки каждые 30с (контейнер не падает).'
        );
        konflikt409Popytki = MAX_409_POVTOROV;
    }
    const sek = konflikt409Popytki > MAX_409_POVTOROV ? 30 : Math.min(konflikt409Popytki * 3, 15);
    console.warn('409 конфликт — другой getUpdates. Пауза ' + sek + 'с, попытка ' + konflikt409Popytki + '/' + MAX_409_POVTOROV);
    try { await bot.stopPolling(); } catch (_) {}
    pollingZapuschen = false;
    await new Promise(r => setTimeout(r, sek * 1000));
    try {
        await zapustitPolling();
        console.log('✅ Polling снова активен');
    } catch (e) {
        if (etoOshibka409(e)) await perezapuskPosle409();
        else console.error('[polling restart]', e.message || e);
    }
}

bot.on('polling_error', (err) => {
    if (etoOshibka409(err)) {
        perezapuskPosle409().catch(e => console.error('[409 handler]', e.message || e));
        return;
    }
    console.error('[polling_error]', err.message || err);
});

// ID администратора для загрузки картинок
const ADMIN_TG_ID = parseInt(process.env.ADMIN_TG_ID || '0');
const BACKUP_ADMIN_TG_IDS = (process.env.BACKUP_ADMIN_TG_IDS || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n > 0);
if (ADMIN_TG_ID) {
    console.log('🔐 Режим админа: tg_id', ADMIN_TG_ID, BACKUP_ADMIN_TG_IDS.length ? ('+ резерв: ' + BACKUP_ADMIN_TG_IDS.join(',')) : '');
} else {
    console.warn('⚠️ ADMIN_TG_ID не задан — загрузка фото ролей отключена');
}

const ROL_VEDUSHCHIY = 'vedushchiy';
function isVedushchiy(rol) {
    return rol === ROL_VEDUSHCHIY || rol === 'vedushchii';
}

async function poluchitRoliPolzovatelya(telegram_id) {
    const { data: igrok } = await supabase
        .from('igroki')
        .select('id, imya, igrovoy_nik, den_rozhdeniya, avatar_file_id')
        .eq('tg_id', telegram_id)
        .maybeSingle();

    if (!igrok?.id) {
        return {
            registered: false,
            igrok: null,
            isOwner: false,
            isHost: false,
            menuCallback: 'menu_igroka'
        };
    }

    const { data: memberships } = await supabase
        .from('chleny_klubov')
        .select('rol')
        .eq('igrok_id', igrok.id);

    let isOwner = (memberships || []).some(m => m.rol === 'vladyelets');
    const isHost = (memberships || []).some(m => isVedushchiy(m.rol));

    if (!isOwner) {
        const { data: ownedKluby } = await supabase
            .from('kluby')
            .select('id')
            .eq('owner_tg_id', telegram_id)
            .limit(1);
        if (ownedKluby?.length) isOwner = true;
    }

    const menuCallback = isOwner ? 'menu_vladeltsa' : isHost ? 'menu_vedushchego' : 'menu_igroka';

    return {
        registered: true,
        igrok,
        isOwner,
        isHost,
        menuCallback
    };
}

function knopkaGlavnogoMenu(roles, text = '⬅️ В меню') {
    return { text, callback_data: roles?.menuCallback || 'menu_igroka' };
}

function formatIgrokDlyaPoiska(igrok) {
    const nick = igrok?.igrovoy_nik || igrok?.imya || 'Игрок';
    const extra = [];
    if (igrok?.igrovoy_nik && igrok?.imya && igrok.imya !== igrok.igrovoy_nik) extra.push(igrok.imya);
    if (igrok?.tg_username) extra.push('@' + igrok.tg_username);
    return nick + (extra.length ? ' · ' + extra.join(' · ') : '');
}

function klubIdIzSostoyaniyaNaznacha(tg_id) {
    const st = sostoyanie[tg_id];
    if (!st) return null;
    if (typeof st === 'string' && st.startsWith('naznach_poisk_')) {
        return st.replace('naznach_poisk_', '');
    }
    if (st?.naznach_klub_id) return st.naznach_klub_id;
    if (st?.naznach_podtv?.klub_id) return st.naznach_podtv.klub_id;
    return null;
}

async function naznachitVedushchegoVKlube(klub_id, igrok_id) {
    const { data: sushch, error: errQ } = await supabase
        .from('chleny_klubov')
        .select('id, rol')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .maybeSingle();

    if (errQ) return { ok: false, error: errQ.message };
    if (sushch?.rol === 'vladyelets') return { ok: false, error: 'owner' };
    if (sushch && isVedushchiy(sushch.rol)) return { ok: true, already: true };

    if (sushch) {
        let { error } = await supabase
            .from('chleny_klubov')
            .update({ rol: ROL_VEDUSHCHIY })
            .eq('id', sushch.id);
        if (error && String(error.message || '').includes('rol')) {
            ({ error } = await supabase.from('chleny_klubov').update({ rol: 'vedushchii' }).eq('id', sushch.id));
        }
        if (error) return { ok: false, error: error.message };
    } else {
        let { error } = await supabase
            .from('chleny_klubov')
            .insert({ klub_id, igrok_id, rol: ROL_VEDUSHCHIY });
        if (error && String(error.message || '').includes('rol')) {
            ({ error } = await supabase.from('chleny_klubov').insert({ klub_id, igrok_id, rol: 'vedushchii' }));
        }
        if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
}

async function uvedomitONaznacheniiVedushchego(igrok_id, klub_id) {
    const { data: igrok } = await supabase.from('igroki').select('imya, igrovoy_nik, tg_id').eq('id', igrok_id).single();
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
    if (igrok?.tg_id) {
        bot.sendMessage(igrok.tg_id,
            '🎤 *Вас назначили ведущим!*\n\n🎴 Клуб: *' + md(klub?.nazvaniye || '') + '*\n\nНапиши /start чтобы открыть меню ведущего.',
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }
    return { igrok, klub };
}

async function klubyVladeltsa(owner_tg_id) {
    const { data: owner } = await supabase.from('igroki').select('id').eq('tg_id', owner_tg_id).single();
    const ids = new Set();

    if (owner?.id) {
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id')
            .eq('igrok_id', owner.id)
            .eq('rol', 'vladyelets');
        (chleny || []).forEach(c => ids.add(c.klub_id));
    }

    const { data: kluby } = await supabase
        .from('kluby')
        .select('id, nazvaniye')
        .eq('owner_tg_id', owner_tg_id);
    (kluby || []).forEach(k => ids.add(k.id));

    const klubySpisok = kluby || [];
    const { data: vse } = ids.size
        ? await supabase.from('kluby').select('id, nazvaniye').in('id', [...ids])
        : { data: [] };
    return (vse || klubySpisok).filter(k => ids.has(k.id));
}

async function klubIdDlyaNaznacheniyaVedushchego(owner_tg_id, igrok_id) {
    const kluby = await klubyVladeltsa(owner_tg_id);
    if (!kluby.length) return { error: 'no_clubs' };
    if (kluby.length === 1) return { klub_id: kluby[0].id, klub: kluby[0] };

    const izSost = klubIdIzSostoyaniyaNaznacha(owner_tg_id);
    if (izSost && kluby.some(k => k.id === izSost)) return { klub_id: izSost, klub: kluby.find(k => k.id === izSost) };

    const ids = kluby.map(k => k.id);
    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('klub_id')
        .eq('igrok_id', igrok_id)
        .in('klub_id', ids);
    const vKlube = (chlen || []).map(c => c.klub_id);
    if (vKlube.length === 1) return { klub_id: vKlube[0], klub: kluby.find(k => k.id === vKlube[0]) };

    return { error: 'pick_club', kluby };
}

function igrokIdIzNcfm(data) {
    const rest = String(data.replace('ncfm_', ''));
    const packed = cbUnpack(rest);
    if (packed?.igrok_id) return { igrok_id: packed.igrok_id, klub_id: packed.klub_id || null };
    if (/^[0-9a-f-]{36}$/i.test(rest)) return { igrok_id: rest, klub_id: null };
    return null;
}

function callbackNaznacheniyaVedushchego(igrok_id) {
    return 'nda_' + igrok_id;
}

async function zavershitNaznachenieVedushchego(chatId, messageId, owner_tg_id, klub_id, igrok_id) {
    const rez = await naznachitVedushchegoVKlube(klub_id, igrok_id);
    console.log('[naznach]', { owner_tg_id, klub_id, igrok_id, rez });

    if (!rez.ok) {
        const msg = rez.error === 'owner'
            ? '🎤 *Ты уже собственник этого клуба*\n\nОтдельно назначать себя ведущим не нужно — можешь вести игры сам через «Игровой вечер» или «Создать игру».\n\nЧтобы добавить другого ведущего, найди его по имени или @username.'
            : '❌ Ошибка: ' + (rez.error || 'не удалось сохранить');
        await bot.editMessageText(msg, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🌙 Игровой вечер', callback_data: 'igrovoy_vecher' }],
                [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                [{ text: '🎤 Назначить другого', callback_data: 'naznachit_vedushchego' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
            ] }
        });
        return;
    }

    sostoyanie[owner_tg_id] = 'naznach_poisk_' + klub_id;
    const { igrok } = await uvedomitONaznacheniiVedushchego(igrok_id, klub_id);
    const imyaPokaz = igrok?.igrovoy_nik || igrok?.imya || 'Игрок';
    const tekst = rez.already
        ? 'ℹ️ *' + md(imyaPokaz) + '* уже ведущий этого клуба.'
        : '✅ *' + md(imyaPokaz) + '* назначен ведущим!';

    await bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🎤 Назначить ещё', callback_data: 'naznachit_vedushchego' }],
            [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
        ]}
    });
}

function razobrat_datu_anonsa(vvod) {
    if (!vvod) return null;
    const s = String(vvod).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (m1) {
        let god = parseInt(m1[3], 10);
        if (god < 100) god += 2000;
        return god + '-' + String(m1[2]).padStart(2, '0') + '-' + String(m1[1]).padStart(2, '0');
    }

    const mesyacy = {
        'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
        'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
        'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
        'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12
    };
    const m2 = s.match(/^(\d{1,2})\s+([а-яё]+)/i);
    if (m2) {
        const mes = mesyacy[m2[2].toLowerCase()];
        if (mes) {
            const den = parseInt(m2[1], 10);
            const seychas = new Date();
            let god = seychas.getFullYear();
            const kandidat = new Date(god, mes - 1, den);
            if (kandidat < new Date(seychas.getFullYear(), seychas.getMonth(), seychas.getDate())) {
                god += 1;
            }
            return god + '-' + String(mes).padStart(2, '0') + '-' + String(den).padStart(2, '0');
        }
    }
    return null;
}

function formatDataAnonsa(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return d.replace(/^0/, '') + '.' + m.replace(/^0/, '') + '.' + y;
}

function isAdmin(tg_id) {
    return (ADMIN_TG_ID > 0 && tg_id === ADMIN_TG_ID) || BACKUP_ADMIN_TG_IDS.includes(tg_id);
}

async function ustanovitOtpisPriglasheniy(tg_id, otpis) {
    await supabase.from('igroki').update({ otpis_priglasheniy: !!otpis }).eq('tg_id', tg_id);
}

async function podgruzitNastroykiIgry(igra) {
    if (!igra) return {};
    let baza = { ...(igra._nastroyki || {}) };
    let nazvanie = igra.klub_nazvaniye || '';
    if (igra.klub_id) {
        const { data: klub } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', igra.klub_id).single();
        if (klub?.nazvaniye) nazvanie = klub.nazvaniye;
        baza = { ...(klub?.nastroyki || {}), ...baza };
    }
    const nastroyki = klubPresety.primeniPresetPoNazvaniyu(nazvanie, baza);
    igra._nastroyki = nastroyki;
    igra.klub_nazvaniye = nazvanie || igra.klub_nazvaniye;
    if (nastroyki.tip_kluba) igra.tip_kluba = nastroyki.tip_kluba;
    if (nastroyki.max_foly) igra.max_foly = nastroyki.max_foly;
    return nastroyki;
}

function posleZnakomstvaGolosovanie(igra) {
    return !!igra?._nastroyki?.posle_znakomstva_golosovanie;
}

function knopkiKoncaZnakomstva(igra, kod) {
    if (posleZnakomstvaGolosovanie(igra)) {
        return [
            [{ text: '\uD83D\uDCA5 Выставить на голосование', callback_data: 'vybrat_na_golos_' + kod }],
            [{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]
        ];
    }
    return [[{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }]];
}

async function nachatZnakomstvoKluba(chatId, messageId, kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    await podgruzitNastroykiIgry(igra);
    const n = igra._nastroyki || {};
    if (n.perviy_hod_avto && n.perviy_hod_nomer) {
        await ustanovitPervogoHoda(chatId, messageId, kod, n.perviy_hod_nomer, 'znakomstvo', telegram_id);
        return;
    }
    await zaprositPervogoHoda(chatId, messageId, kod, 'znakomstvo', telegram_id);
}

// Скрипты продаж и отзывов — см. docs/SALES_SCRIPTS.md
const PRODAZH_SKRIPTY = [
    {
        id: 'tarify',
        title: '📋 Тарифы',
        items: [{
            id: 'main',
            title: 'Шпаргалка',
            text: '🎁 Тест — 0 ₽: 2 игры / ' + TEST_LIMIT_DNEY + ' дней\n\n' + tarify.tekstTarifovKratko() + '\n\n🎨 Стилизация клуба — ' + tarify.formatRub(tarify.STILIZATSIYA_PRICE) + ' ₽ один раз'
        }]
    },
    {
        id: 'bigfamily',
        title: '👨‍👩‍👧 Big Family',
        items: [{
            id: 'anton',
            title: 'Антон — после игры',
            text: tarify.tekstSkriptaBigFamily()
        }]
    },
    {
        id: 'first',
        title: '👋 Первое сообщение',
        items: [
            {
                id: 'a',
                title: 'A — через боль',
                text: 'Привет! Я [имя], автор Prime Mafia — бота для мафия-клубов.\n\nВидела, что у вас [город/клуб] проводит игры. Скажите, ведущим после вечера ещё вручную считают баллы и рейтинг?\n\nМы автоматизируем это в Telegram: роли, таймеры, фазы, рейтинг сразу после игры. Можно протестировать бесплатно — 2 игры за неделю.\n\nИнтересно показать за 5 минут?'
            },
            {
                id: 'b',
                title: 'B — через знакомство',
                text: 'Привет, [имя]! Мы знакомы по [мафии/клубу].\n\nЗапускаю Prime Mafia — помощник для ведущих и собственников клубов. Всё в Telegram: игровой вечер, раздача, таймеры, рейтинг.\n\nИщу 3–5 клубов на тест. Дам бесплатную неделю (2 игры) + помогу настроить под ваши правила.\n\nМожно созвониться на 15 минут или скину демо?'
            },
            {
                id: 'c',
                title: 'C — после игры',
                text: 'Спасибо за вечер! Кстати, мы как раз тестируем бота для клубов — если интересно, могу подключить ваш клуб на неделю бесплатно и провести одну игру вместе.\n\nБез обязательств — просто посмотрите, удобнее ли ведущему.'
            }
        ]
    },
    {
        id: 'what',
        title: '❓ Что это?',
        items: [{
            id: 'main',
            title: 'Описание продукта',
            text: 'Prime Mafia — Telegram-бот + приложение для мафия-клуба.\n\nДля ведущего:\n— игровой вечер и создание игры за минуту;\n— таймеры, фазы, голосование, ночь;\n— меньше ошибок в правилах.\n\nДля клуба:\n— рейтинг и история автоматически;\n— свои правила из папки clubs/ по названию клуба;\n— база игроков и анонсы.\n\nТест: 2 игры бесплатно, ' + TEST_LIMIT_DNEY + ' дней. Потом Mini от ' + tarify.formatRub(tarify.planPoId('mini').price) + ' ₽ или Start 7 900 ₽/мес.'
        }]
    },
    {
        id: 'demo',
        title: '🎬 Демо',
        items: [{
            id: 'main',
            title: 'Приглашение на демо',
            text: 'Отлично! Предлагаю так:\n\n1. Вы создаёте клуб в боте (2 минуты) — пришлю ссылку.\n2. Я помогаю настроить правила под ваш формат [открытая мафия / паскаль / свои роли].\n3. Проводим 1 тестовую игру на вашем вечере или созвоне с демо.\n\nНа созвоне 15 минут покажу: игровой вечер, стол, рейтинг, стилизацию под клуб.\n\nКогда удобно — [день/время]?'
        }]
    },
    {
        id: 'after',
        title: '💳 После теста',
        items: [{
            id: 'main',
            title: 'Предложение тарифа',
            text: 'Привет! Как прошли тестовые игры?\n\n' + tarify.tekstTarifovKratko() + '\n\n🎨 Стилизация (карты + интерфейс клуба): +' + tarify.formatRub(tarify.STILIZATSIYA_PRICE) + ' ₽ один раз.\n\nКакой формат ближе? Оформим заявку в Telegram.'
        }]
    },
    {
        id: 'style',
        title: '🎨 Стилизация',
        items: [{
            id: 'main',
            title: 'Upsell стилизации',
            text: 'После тарифа многие клубы берут стилизацию за 5 000 ₽ — один раз, навсегда.\n\nЧто даёт:\n— ваши карты ролей в боте (как бумажная колода);\n— цвета и тема интерфейса под клуб (красная / чёрно-золотая / синяя или своя);\n— игроки видят «ваше» приложение, не общий бот.\n\nВ mini app уже есть рейтинг, лучшая игра и темы — на тесте это хорошо смотрится на iPad.\n\nПодключить вместе с тарифом?'
        }]
    },
    {
        id: 'vozr',
        title: '🛡 Возражения',
        items: [
            {
                id: 'dorogo',
                title: '«Дорого»',
                text: tarify.tekstVozrazhenieDorogo({ igrokov: 12, vhod: 1000 })
            },
            {
                id: 'excel',
                title: '«Excel / таблица»',
                text: 'Таблица работает, пока один человек всё помнит 🙂\n\nPrime Mafia:\n— подсказывает фазы в момент игры;\n— игроки видят рейтинг в боте;\n— меньше споров по баллам;\n— новый ведущий быстрее входит в работу.\n\nТест бесплатный — сравните один вечер с таблицей и один с ботом.'
            },
            {
                id: 'pravila',
                title: '«Особенные правила»',
                text: 'Это тариф *Club* — свои правила из папки клуба (как Big Family, Sochi, Ellada).\n\nНастраиваем:\n— тайминги (например, 1 мин представление с №1);\n— переход сразу к голосованию;\n— свои роли, баллы, штрафы.\n\nПокажу в боте на вашем клубе.'
            },
            {
                id: 'podumaem',
                title: '«Подумаем»',
                text: 'Конечно. Три вопроса — сразу скажу тариф:\n\n1. Сколько игр в месяц?\n2. Сколько ведущих?\n3. Нужны ли свои правила и карты?\n\nТест бесплатный — можно «подумать» на живой игре 🙂'
            },
            {
                id: 'igroki',
                title: '«Игроки не будут»',
                text: 'Игрокам почти ничего не нужно — войти по коду от ведущего.\n\nИм доступны: анонсы, рейтинг, mini app с лучшей игрой.\nОсновная работа на ведущем.\n\nНа тесте часто спрашивают «где мой рейтинг?» — хороший знак.'
            }
        ]
    },
    {
        id: 'close',
        title: '✅ Закрытие',
        items: [{
            id: 'main',
            title: 'Закрытие сделки',
            text: 'Итого:\n\n📦 Club — 12 900 ₽/мес\n🎨 Стилизация — 5 000 ₽ (один раз)\n📅 Срок — [1 / 3 / 6 мес]\n\nДальше:\n1. Подтверждаете пакет\n2. Счёт / ссылка [СБП / карта / рассрочка]\n3. Настройка правил и карт — 1–2 дня\n4. Первый вечер — я на связи\n\nПодтверждаем?'
        }]
    },
    {
        id: 'follow',
        title: '🔔 Follow-up',
        items: [
            {
                id: 'd2',
                title: 'Через 2 дня',
                text: 'Привет! Напомню про Prime Mafia — тест 2 игры бесплатно.\n\nАктуально для [клуб]?'
            },
            {
                id: 'd7',
                title: 'Через 7 дней',
                text: 'Последнее касание по Prime Mafia 🙂\n\nЕсли не сейчас — ок. Бот: [ссылка]\nУдачных игр!'
            },
            {
                id: 'nopay',
                title: 'После теста без оплаты',
                text: 'Тестовая неделя [клуб] закончилась.\n\nЧто помешало — цена, настройка, функции?\nЗа честный фидбек — продлим тест на 1 игру или поможем с настройкой.'
            }
        ]
    },
    {
        id: 'net',
        title: '🌐 Network',
        items: [{
            id: 'main',
            title: 'Франшиза / сеть',
            text: 'Вижу, у вас несколько площадок / городов.\n\nNetwork от 35 000 ₽/мес:\n— рейтинг по клубам;\n— общая или раздельная база;\n— единые правила + локальные настройки;\n— внедрение под сеть.\n\nМожем начать с одного клуба на Club, потом масштабировать.\n\nСколько локаций в первые 3 месяца?'
        }]
    },
    {
        id: 'otzyv',
        title: '⭐ Отзывы',
        items: [
            {
                id: 'igra1',
                title: 'После 1-й тестовой игры',
                text: 'Спасибо, что протестировали Prime Mafia! 🎴\n\nКак прошёл вечер с ботом?\n1–10 — насколько ведущему было удобнее?\nЧто понравилось / что мешало?\n\nМожно голосовое 30 сек. С разрешения — используем как кейс (без имён).'
            },
            {
                id: 'nedelya',
                title: 'После тестовой недели',
                text: 'Тестовая неделя [клуб] завершилась.\n\n3 вопроса:\n1. Стало ли проще вести игры?\n2. Что улучшить в первую очередь?\n3. Порекомендуете другим клубам? (да / скорее да / нет)\n\nЗа развёрнутый отзыв — [бонус: +1 игра / скидка на стилизацию].'
            },
            {
                id: 'keys',
                title: 'Публичный кейс',
                text: 'Можем опубликовать кейс «Как [клуб] провёл вечер на Prime Mafia»?\n\nНужно: 2–3 предложения от вас + скрин mini app / стола (без данных игроков).'
            },
            {
                id: 'stil',
                title: 'После стилизации',
                text: 'Стилизация клуба подключена 🎨\n\nКак игрокам и ведущим — ощущается «своё приложение»?\nЕсли можно — скрин с iPad/телефона для нашего канала.'
            }
        ]
    },
    {
        id: 'post',
        title: '📣 Посты канала',
        items: [
            {
                id: 'anon',
                title: 'Анонс',
                text: '🎴 Prime Mafia — бот для мафия-клубов\n\nВедущим: таймеры, фазы, рейтинг в mini app\nКлубам: свои правила, карты, история\nИгрокам: анонсы и рейтинг\n\n🎁 Тест: 2 игры / 7 дней бесплатно\n💬 Подключить: [ссылка]'
            },
            {
                id: 'sochi',
                title: 'Кейс Сочи',
                text: '📍 Prime Mafia Sochi\n\n✅ Открытая мафия\n✅ Клубные карты\n✅ Рейтинг и лучшая игра в mini app\n✅ Тема интерфейса под клуб\n\n«[цитата]» — [имя], ведущий\n\nХотите так же — пишите в личку.'
            }
        ]
    }
];

const OTZYV_SKRIPT_IDS = { igra1: 'igra1', nedelya: 'nedelya', keys: 'keys', stil: 'stil' };

function naitiSkript(catId, itemId) {
    const cat = PRODAZH_SKRIPTY.find(c => c.id === catId);
    return cat?.items.find(i => i.id === itemId) || null;
}

function knopkiMenuSkriptov() {
    const rows = PRODAZH_SKRIPTY.map(c => [{ text: c.title, callback_data: 'scr_c_' + c.id }]);
    rows.push([{ text: '📨 Отправить отзыв клубу', callback_data: 'scr_rev' }]);
    rows.push([{ text: '⬅️ Закрыть', callback_data: 'scr_x' }]);
    return { inline_keyboard: rows };
}

function knopkiKategoriiSkriptov(catId) {
    const cat = PRODAZH_SKRIPTY.find(c => c.id === catId);
    if (!cat) return knopkiMenuSkriptov();
    const rows = cat.items.map(i => [{ text: i.title, callback_data: 'scr_i_' + catId + '_' + i.id }]);
    rows.push([{ text: '⬅️ К списку', callback_data: 'scr_m' }]);
    return { inline_keyboard: rows };
}

async function pokazatMenuSkriptov(chatId, messageId) {
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: knopkiMenuSkriptov()
    };
    const text = '📝 *Скрипты продаж и отзывов*\n\nВыбери раздел — текст пришлю отдельным сообщением, удобно переслать клиенту.\n\n_Источник: docs/SALES_SCRIPTS.md_';
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() =>
            bot.sendMessage(chatId, text, opts)
        );
    } else {
        await bot.sendMessage(chatId, text, opts);
    }
}

function tekstOtzyvaDlyaKluba(tip, nazvanieKluba) {
    const item = naitiSkript('otzyv', tip);
    if (!item) return '';
    return item.text.replace(/\[клуб\]/g, nazvanieKluba);
}

async function otpravitSkriptKlubu(adminChatId, klub_id, otzyvTip) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, owner_tg_id')
        .eq('id', klub_id)
        .single();
    if (!klub?.owner_tg_id) {
        await bot.sendMessage(adminChatId, '❌ У клуба нет owner_tg_id — отправь текст вручную.');
        return;
    }
    const text = tekstOtzyvaDlyaKluba(otzyvTip, klub.nazvaniye || 'клуб');
    await bot.sendMessage(klub.owner_tg_id, text).catch(err => {
        bot.sendMessage(adminChatId, '❌ Не удалось отправить клубу: ' + (err.message || err));
    });
    await bot.sendMessage(adminChatId,
        '✅ Отзыв «' + (naitiSkript('otzyv', otzyvTip)?.title || otzyvTip) + '» отправлен клубу *' +
        md(klub.nazvaniye || klub_id) + '* (`' + klub.owner_tg_id + '`)',
        { parse_mode: 'Markdown' }
    );
}

async function maybeOtpravitAvtoOtzyvPosleIgry(igra, vedushchiyChatId) {
    if (!igra?.klub_id || igra._druzya_rezhim) return;
    const nastroyki = await poluchitNastroykiKlubaBilling(igra.klub_id);
    if (nastroyki.tarif_status === 'oplachen' || (parseInt(nastroyki.igry_balans, 10) || 0) > 0) return;
    const test = nastroyki.test || {};
    if (test.otzyv_1_otpravlen) return;
    if ((test.igry_ispolzovano || 0) !== 1) return;

    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', igra.klub_id).single();
    test.otzyv_1_otpravlen = true;
    nastroyki.test = test;
    await sohranitNastroykiKlubaBilling(igra.klub_id, nastroyki);

    const text = tekstOtzyvaDlyaKluba('igra1', klub?.nazvaniye || 'клуб');
    await bot.sendMessage(vedushchiyChatId, text).catch(() => {});
    if (ADMIN_TG_ID) {
        bot.sendMessage(ADMIN_TG_ID,
            '⭐ Авто-запрос отзыва после 1-й тестовой игры\nКлуб: ' + (klub?.nazvaniye || igra.klub_id),
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }
}

async function maybeOtpravitAvtoOtzyvOkonchaniyaTesta(klub_id, vedushchiyChatId) {
    if (!klub_id) return;
    const nastroyki = await poluchitNastroykiKlubaBilling(klub_id);
    if (nastroyki.tarif_status === 'oplachen') return;
    const test = nastroyki.test || {};
    if (test.otzyv_nedelya_otpravlen) return;

    const { data: klub } = await supabase.from('kluby').select('nazvaniye, owner_tg_id').eq('id', klub_id).single();
    test.otzyv_nedelya_otpravlen = true;
    nastroyki.test = test;
    await sohranitNastroykiKlubaBilling(klub_id, nastroyki);

    const text = tekstOtzyvaDlyaKluba('nedelya', klub?.nazvaniye || 'клуб');
    const target = klub?.owner_tg_id || vedushchiyChatId;
    await bot.sendMessage(target, text).catch(() => {});
    if (ADMIN_TG_ID) {
        bot.sendMessage(ADMIN_TG_ID,
            '⭐ Авто-запрос отзыва после тестовой недели\nКлуб: ' + (klub?.nazvaniye || klub_id),
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }
}

// Telegram: callback_data максимум 64 байта
const _cbStore = new Map();
let _cbSeq = 0;

function cbPack(data) {
    _cbSeq = (_cbSeq % 999000) + 1;
    _cbStore.set(_cbSeq, { ...data, _t: Date.now() });
    return _cbSeq;
}

function cbUnpack(id) {
    return _cbStore.get(Number(id)) || null;
}

function cbBtn(prefix, data) {
    const id = cbPack(data);
    const s = prefix + id;
    const len = Buffer.byteLength(s, 'utf8');
    if (len > 64) console.error('[cbBtn] превышен лимит', len, prefix, data);
    return s;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _cbStore) {
        if (now - v._t > 3600000) _cbStore.delete(k);
    }
}, 600000);

process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    console.error('[unhandledRejection]', msg);
    if (msg.includes('BUTTON_DATA_INVALID')) {
        console.error('→ Нажмите /start для нового меню (старая кнопка с длинным callback)');
    }
});

function sanitizeInlineKeyboard(reply_markup) {
    if (!reply_markup?.inline_keyboard) return reply_markup;
    for (const row of reply_markup.inline_keyboard) {
        for (const btn of row) {
            if (!btn.callback_data) continue;
            const len = Buffer.byteLength(String(btn.callback_data), 'utf8');
            if (len > 64) {
                console.error('[sanitize] callback >64 байт:', len, btn.callback_data);
                btn.callback_data = 'baza_noop';
            }
        }
    }
    return reply_markup;
}

const _sendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = async function(chatId, text, opts = {}) {
    if (opts.reply_markup) sanitizeInlineKeyboard(opts.reply_markup);
    try {
        return await _sendMessage(chatId, text, opts);
    } catch (e) {
        if (String(e.message || e).includes('BUTTON_DATA_INVALID')) {
            console.error('[sendMessage BUTTON_DATA_INVALID]', e.message);
            return _sendMessage(chatId, text + '\n\n_Нажми /start — обнови меню._', { parse_mode: opts.parse_mode || 'Markdown' });
        }
        throw e;
    }
};

const _editMessageText = bot.editMessageText.bind(bot);
bot.editMessageText = async function(text, opts = {}) {
    if (opts.reply_markup) sanitizeInlineKeyboard(opts.reply_markup);
    try {
        return await _editMessageText(text, opts);
    } catch (e) {
        if (String(e.message || e).includes('BUTTON_DATA_INVALID')) {
            console.error('[editMessageText BUTTON_DATA_INVALID]', e.message);
            const chatId = opts.chat_id;
            if (chatId) {
                return _sendMessage(chatId, text + '\n\n_Нажми /start — обнови меню._', { parse_mode: opts.parse_mode || 'Markdown' });
            }
        }
        throw e;
    }
};

// ============================================
// СОСТАВЫ
// ============================================

// ── ПАСКАЛЬ (городская, базовая) ──────────────────
const sostavy = {
    8:  ['Дон', 'Мафия', 'Шериф', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    10: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    11: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    12: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    13: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    14: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    15: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    16: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    17: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Любовница', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Эскортница', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Консильери', 'Шериф', 'Доктор', 'Бессмертный', 'Стрелок', 'Маньяк', 'Камикадзе', 'Шахид', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── ВИП (городская профессиональная) ─────────────
// Мафия: Дон, Путана, Подрывник мафии, Мафия
// Мирные: Комиссар, Доктор, Стрелок, Стрелочник, Камикадзе, Любовница, Мирный
// Сам за себя: Маньяк
const sostavy_vip = {
    8:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Маньяк', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    10: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Маньяк', 'Мирный', 'Мирный'],
    11: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Маньяк', 'Мирный', 'Мирный'],
    12: ['Дон', 'Путана', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Маньяк', 'Мирный', 'Мирный'],
    13: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Затычка', 'Маньяк', 'Мирный', 'Мирный'],
    14: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    15: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный'],
    16: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный'],
    17: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Путана', 'Подрывник мафии', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Комиссар', 'Доктор', 'Стрелок', 'Стрелочник', 'Камикадзе', 'Затычка', 'Бессмертный', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── НАИЛЯ (Москва) ────────────────────────────────
// Мирные: Детектив, Доктор, Ведьма, Бомба, Безликий, Адвокат, Мстительный родственник, Мирный
// Мафия: Дон, Мафия
// Сам за себя: Маньяк
const sostavy_naila = {
    8:  ['Дон', 'Мафия', 'Детектив', 'Доктор', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    9:  ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    10: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    11: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    12: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    13: ['Дон', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    14: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    15: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный'],
    16: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    17: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    18: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    19: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный'],
    20: ['Дон', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Мафия', 'Детектив', 'Доктор', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник', 'Маньяк', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── СПОРТИВНАЯ (классика 10 человек) ─────────────
const sostavy_sport = {
    10: ['Дон', 'Мафия', 'Мафия', 'Шериф', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный', 'Мирный']
};

// ── ОПИСАНИЯ РОЛЕЙ (для раздачи в личку) ─────────
const roli_opisaniya = {
    // Мафия
    'Дон': '\uD83D\uDD34 *Дон мафии*\n\nТы — глава мафии. Знаешь всю команду. Ночью выбираете жертву вместе, твоё слово решающее. Можешь искать Шерифа/Комиссара.',
    'Мафия': '\uD83D\uDD34 *Мафия*\n\nТы — часть команды мафии. Знаешь своих. Ночью голосуете за жертву.',
    'Путана': '\uD83D\uDD34 *Путана (Эскортница)*\n\nЧасть мафии. Ночью называешь роль игрока. Угадала — он не переживает утро. Промахнулась — остаётся.\n\nВыстрелов за ночь: до 11 игроков — 1, с 12 до 14 — 2, от 15 — 3.',
    'Эскортница': '\uD83D\uDD34 *Эскортница*\n\nЧасть мафии. Ночью называешь роль игрока. Угадала — он не переживает утро. Промахнулась — остаётся.\n\nВыстрелов за ночь: до 11 игроков — 1, с 12 до 14 — 2, от 15 — 3.\n\u2B50 За угаданную роль: *+0.5 балла*.',
    'Подрывник мафии': '\uD83D\uDD34 *Подрывник мафии*\n\nЧасть мафии. Если в тебя выстрелит Стрелок или Маньяк — ты забираешь стрелявшего с собой.',
    'Консильери': '\uD83D\uDD34 *Консильери*\n\nЧасть мафии. Советник Дона.',
    // Мирные
    'Шериф': '\uD83D\uDFE2 *Шериф*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия.',
    'Комиссар': '\uD83D\uDFE2 *Комиссар (Детектив)*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Детектив': '\uD83D\uDFE2 *Детектив*\n\nКаждую ночь проверяешь игрока. \uD83D\uDC4D — мирный, \uD83D\uDC4E — мафия. Маньяк всегда показывается как мирный.',
    'Доктор': '\uD83D\uDFE2 *Доктор*\n\nКаждую ночь спасаешь одного игрока от одного ночного выстрела.\n\n\u274C Если в игрока стреляли и мафия, и маньяк — доктор его не спасает.\n\nPascal: одного и того же игрока можно лечить сколько угодно, себя — до 2 ночей подряд.\nVIP: нельзя лечить одного игрока две ночи подряд, себя — через ночь.',
    'Подрывник': '\uD83D\uDFE2 *Подрывник*\n\nЕсли ночью тебя убивает мафия — ты взрываешься и забираешь с собой того мафиози, которого выбрал.',
    'Охотник': '\uD83D\uDFE2 *Охотник (Стрелок)*\n\nКаждую ночь можешь выстрелить в игрока. Убил 2 мирных — выбываешь сам.',
    'Стрелок': '\uD83D\uDFE2 *Стрелок*\n\nКаждую ночь можешь выстрелить. Убил 2 мирных — выбываешь. За правильный отстрел мафии +0.5 балла.',
    'Стрелочник': '\uD83D\uDFE2 *Стрелочник*\n\nЕсли в тебя стреляли ночью — можешь перекинуть выстрел на другого. Попал в мафию — уходит мафия. Попал в мирного — уходишь ты.',
    'Камикадзе': '\uD83D\uDFE2 *Камикадзе*\n\nКаждую ночь идёшь к игроку. Пошёл к мафии — вы оба выбываете. К мирному/маньяку — ничего.',
    'Бессмертный': '\uD83D\uDFE2 *Бессмертный — Мирный житель*\n\nПросыпаешься только в первую ночь для знакомства с ведущим.\n\n\uD83D\uDEE1\uFE0F Не умирает от выстрела мафии и стрелка.\n\u274C Умирает от: эскортницы (если угадали роль), выстрела маньяка, голосования днём.\n\n\uD83C\uDFAF Задача: притягивай выстрелы мафии на себя.',
    'Шахид': '\uD83D\uDFE2 *Шахид*\n\nПри выбывании забираешь с собой случайных игроков.',
    'Затычка': '\uD83D\uDFE2 *Затычка — Мирный житель*\n\nКаждую ночь просыпаешься и выбираешь одного игрока.\n\n\uD83D\uDD07 Заблокированный игрок:\n— лишается своей минуты речи на дне\n— не может голосовать\n— но может быть выставлен на голосование другими\n\n\uD83C\uDFAF Задача: найди мафию и лишай её голоса.\n\u2B50 За правильный ход: *+0.5 балла*',
    'Любовница': '\uD83D\uDFE2 *Любовница*\n\nМожешь заблокировать роль одного игрока на голосовании.',
    'Ведьма': '\uD83D\uDFE2 *Ведьма*\n\nОдин раз за игру можешь воскресить выбывшего игрока. Просыпаешься каждую ночь до воскрешения. Если выбываешь до — вскрой карту и остаёшься за столом.',
    'Бомба': '\uD83D\uDFE2 *Бомба*\n\nПервые 3 ночи минируешь 30% стола. Если выбываешь — взрываешься вместе с заминированными.',
    'Безликий': '\uD83D\uDFE2 *Безликий*\n\nПросыпаешься на 3-ю ночь первым. Выбираешь: 1 палец — остаться за мирных, 2 — перейти в мафию, 3 — перейти к маньяку.',
    'Адвокат': '\uD83D\uDFE2 *Адвокат*\n\nМожешь показать карту на голосовании и спасти игрока. Вместо него выбирается другой.',
    'Мстительный родственник': '\uD83D\uDFE2 *Мстительный родственник*\n\nЕсли тебя убили — вскрываешь карту и забираешь с собой любого игрока.',
    // Соло
    'Маньяк': '\uD83C\uDFAF *Маньяк — Серая команда*\n\nИграешь сам за себя. Держи баланс между мирными и мафией.\n\n\uD83D\uDC4D При проверке Комиссара показываешься как мирный — пока за столом есть мафия.\n\n\uD83C\uDFC6 Победа: остался один на один с любым игроком.\n\u2B50 За победу: *5 баллов* + 0.5 за каждое убийство мафии.',
    // Мирный
    'Мирный': '\uD83D\uDFE2 *Мирный житель*\n\nНочью не просыпаешься. Логикой и ораторством вычисляй мафию. Победа — когда не останется ни мафии ни маньяка.'
};

// ── МАППИНГ: тип клуба → составы ─────────────────
function poluchit_sostav(kolichestvo, tip_kluba) {
    if (tip_kluba === 'vip') return sostavy_vip[kolichestvo] || sostavy[kolichestvo];
    if (tip_kluba === 'naila') return sostavy_naila[kolichestvo] || sostavy[kolichestvo];
    if (tip_kluba === 'sportivniy') return sostavy_sport[kolichestvo] || sostavy[kolichestvo];
    return sostavy[kolichestvo]; // паскаль и все остальные
}

// sostav_sport теперь в sostavy_sport объекте выше

// Базовые очки по умолчанию
const BALLY_DEFAULT = {
    pobeda_komanda: 2,
    porazhenie: 0,
    vyzhil: 0.25,
    ubit_v_pervuyu_noch: 0,
    luchshiy_hod_za_mafiyu: 1,
    bonus_sheriff_nashel_maf: 0.5,
    bonus_doctor_spas: 0.5,
    bonus_bessmertnyy_prinyal_vystrel: 0.5,
    bonus_eskort_ugadala_rol: 0.5,
    bonus_don_nashel_sherifa_n1: 0.5,
    bonus_kamikadze_mafiya: 0.5,
    bonus_den1_vygolosovan: 0.25,
    shtraf_teh_trup: -2,
    mafiya_pobedila_vybyl: 3,
    mafiya_pobedila_vyzhil: 4,
    bonus_don_pobedil: 0,
    bonus_manyak_pobedil: 5,
    bonus_pravilnyy_otstrel_mafii: 0.5
};

const SOGLASIE_VERSIYA = '2026-05-29';

function tekstEkranaSoglasiya() {
    return '👋 *Добро пожаловать в Prime Mafia!*\n\n' +
        'Prime Mafia — бот и mini app для *клубов мафии* в Telegram.\n' +
        'Автоматизируем рутину ведущего и клуба:\n' +
        '• игры, фазы, таймеры и стол;\n' +
        '• рейтинг и баллы после вечера;\n' +
        '• анонсы и mini app для игроков.\n\n' +
        'Перед регистрацией ознакомься и прими:\n' +
        '• публичную оферту\n' +
        '• политику конфиденциальности\n\n' +
        '_Мы обрабатываем данные только для игр, клубов, рейтинга и сервисных функций. ' +
        'Материалы клуба используются только внутри Prime Mafia и не передаются другим клубам._';
}

function knopkiEkranaSoglasiya() {
    return [
        [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
        [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
        [{ text: '✅ Принимаю условия', callback_data: 'reg_soglasie_prinyat' }],
        [{ text: '❌ Не принимаю', callback_data: 'reg_soglasie_otkaz' }]
    ];
}

function tekstInstrukciiIgroka() {
    return '📖 *Как пользоваться — игрок*\n\n' +
        '*1. Регистрация в клуб*\n' +
        'Клубы не видны в открытом списке. Ведущий даёт *код* или *ссылку* `t.me/бот?start=club_КОД` — затем город, ник и телефон.\n\n' +
        '*2. Войти в игру*\n' +
        'Ведущий даёт код или ссылку → «🎮 Войти в игру» → введи код.\n' +
        'Либо открой ссылку `t.me/бот?start=join_КОД` — попадёшь сразу.\n\n' +
        '*3. Рейтинг*\n' +
        '«🏆 Рейтинг» — твои баллы по клубам после завершённых игр.\n' +
        'В mini app — рейтинг, лучшая игра, топ клуба.\n\n' +
        '*4. Анонсы*\n' +
        '«📢 Анонсы игр» — ближайшие игры в твоём городе, запись одной кнопкой.\n\n' +
        '*5. Приглашения*\n' +
        'Клуб может прислать приглашение на игру (тариф Start+). Отписаться: /stop или «стоп». Снова подписаться: /subscribe или «подписаться».\n\n' +
        '*6. Создать клуб*\n' +
        'Если ты собственник — «➕ Создать клуб», дальше бот подскажет шаги.\n\n' +
        '_Команды: /start — меню, /help — эта справка, /stop — отписаться от приглашений._';
}

function tekstInstrukciiVedushchego() {
    return '📖 *Как пользоваться — ведущий*\n\n' +
        '*1. Игровой вечер*\n' +
        '«🌙 Начать игровой вечер» → состав гостей на вечер → игры подтягивают этот список.\n\n' +
        '*2. Создать игру*\n' +
        '«🎲 Создать игру» → клуб → тип (Pascal / спорт) → число игроков → состав ролей → «Создать».\n' +
        'Игроки входят по коду; роли можно раздать в боте или на физических картах.\n\n' +
        '*3. Вести игру*\n' +
        '«🎮 Мои игры» → панель игры: фазы, голосование, ночь, таймеры.\n' +
        'Если в клубе два ведущих — «🎤 Сменить ведущего» в панели передаст игру напарнику.\n' +
        'Mini app — стол и быстрые действия с телефона или планшета.\n\n' +
        '*4. Завершение*\n' +
        'Выбери победителя → баллы запишутся в рейтинг автоматически.\n' +
        'При необходимости — «📋 Внести результаты» для прошедшей игры.\n\n' +
        '*5. Анонсы и приглашения* (тариф Start+)\n' +
        '«📢 Создать анонс» + «📨 Разослать приглашения» или «📨 Пригласить базу» в лобби игры.\n' +
        '«🔗 Приглашение в клуб» — код и ссылка для регистрации новых игроков (клуб не виден в открытом списке).\n' +
        'На Mini — только QR/ссылка вручную, без массовой рассылки.\n\n' +
        '*6. Публикация итогов*\n' +
        'После игры — «📢 Отправить в группу клуба» (группу привязывает собственник в настройках).\n\n' +
        '_Команды: /start — меню, /games — активные игры, /pause и /resume — пауза игры, /help — справка._';
}

function tekstInstrukciiVladeltsa() {
    return '📖 *Как пользоваться — собственник клуба*\n\n' +
        '*1. Создать клуб*\n' +
        '«➕ Создать клуб» → название и город. Доступна *тестовая неделя*: 2 игры за ' + TEST_LIMIT_DNEY + ' дней.\n\n' +
        '*2. Настроить клуб*\n' +
        '«⚙️ Настройки клуба» — правила, баллы, штрафы, стилизация.\n' +
        '«🎭 Управление ролями» — состав и карты ролей.\n\n' +
        '*3. Команда*\n' +
        '«🎤 Назначить ведущего» — добавь ведущего или выбери «Я веду сам».\n' +
        '«👥 База игроков» — участники клуба.\n\n' +
        '*4. Игры и аналитика*\n' +
        'Веди игры как ведущий (см. «📖 Как пользоваться» в меню ведущего).\n' +
        '«📊 Аналитика», «🏆 Рейтинг», «📚 История» — статистика клуба.\n\n' +
        '*5. Анонсы и приглашения* (Start+)\n' +
        '«📢 Создать анонс» — дата, время, место; «📨 Разослать приглашения» — база клуба в личку.\n' +
        '«🔗 Приглашение в клуб» — персональный код и ссылка для новых игроков.\n' +
        'На тарифе *Mini* — только ведение игр и рейтинг, без массовых приглашений.\n\n' +
        '*6. Публикация итогов в Telegram*\n' +
        '⚙️ Настройки клуба → *📢 Привязать группу*:\n' +
        '1) добавьте бота в группу или канал клуба (в канале — права админа);\n' +
        '2) перешлите боту любое сообщение из этого чата;\n' +
        '3) после игры — «📢 Отправить в группу» или автопубликация в настройках.\n\n' +
        '*7. Тариф*\n' +
        'После теста — «💳 Подключить тариф». Mini — *3 999 ₽*, до 10 игр.\n\n' +
        '_Безопасность: docs/BEZOPASNOST.md · резервный админ: BACKUP_ADMIN_TG_IDS в Railway._\n' +
        '_Команды: /start — меню, /help — справка. Поддержка — «💬 Поддержка»._';
}

function tekstPrivetNezaregistrirovannomu() {
    return '👋 *Prime Mafia*\n\n' +
        'Бот и mini app для *клубов мафии*: автоматизируем игру, рейтинг, анонсы и стол ведущего.\n\n' +
        'Регистрация: *город → код клуба от ведущего → игровой ник* (и телефон).\n' +
        '_Или открой персональную ссылку-приглашение от клуба._\n\n' +
        'Нажми *«▶️ Начать регистрацию»* — откроется экран с офертой и политикой конфиденциальности.';
}

function tekstInstrukciiPosleRegistracii() {
    return '📖 *Краткая инструкция*\n\n' +
        'Ты зарегистрирован как *игрок*. Основное:\n\n' +
        '🎮 *Войти в игру* — код от ведущего\n' +
        '📢 *Анонсы* — игры в твоём городе\n' +
        '🏆 *Рейтинг* — баллы после игр\n' +
        '➕ *Создать клуб* — если ты собственник клуба мафии\n\n' +
        'Полная справка — кнопка «📖 Как пользоваться» или команда /help';
}

async function zavershitAnketuKluba(chatId, tg_id, d, status) {
    const klub_id = d.klub_id;
    const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, owner_tg_id, gorod_id').eq('id', klub_id).single();
    const { data: igrok } = await supabase.from('igroki').select('id, imya, igrovoy_nik, telefon, tg_id').eq('tg_id', tg_id).single();
    const { tekst_svodka, error } = await klubAnketa.sohranitAnketu(klub_id, tg_id, d.otvety || {}, klub, igrok, status);
    delete ozhidanie_registracii[tg_id];

    const konetsTesta = formatDatyRu(dataOkonchaniyaTesta(dataIgrovoegoVechera(), TEST_LIMIT_DNEY));
    if (error) console.error('[anketa]', error);

    bot.sendMessage(chatId,
        '✅ *Анкета сохранена!*\n\n' +
        (tekst_svodka || '') + '\n\n' +
        '🎁 *Тестовая неделя:* 2 игры за ' + TEST_LIMIT_DNEY + ' дней (до ' + konetsTesta + ').\n\n' +
        '_Повторно посмотреть: «📋 Анкета клуба» в меню собственника._',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎁 Тестовая неделя', callback_data: 'tarif_klub_' + klub_id }],
                [{ text: '🎨 Стилизация 5000₽', callback_data: 'stil_klub_' + klub_id }],
                ...menu_vladeltsa.reply_markup.inline_keyboard
            ] }
        }
    );

    if (ADMIN_TG_ID) {
        bot.sendMessage(ADMIN_TG_ID, '📋 *Новая анкета клуба*\n\n' + (tekst_svodka || ''), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📂 Все анкеты', callback_data: 'admin_ankety' }]] }
        }).catch(() => {});
    }
}

async function pokazatAnketyAdmin(chatId, messageId) {
    const rows = await klubAnketa.spisokAnket(15);
    if (!rows.length) {
        const t = '📋 *Анкеты клубов*\n\nПока нет заполненных анкет.';
        if (messageId) {
            bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, t, { parse_mode: 'Markdown' });
        }
        return;
    }
    let t = '📋 *Анкеты клубов* (' + rows.length + ')\n\n';
    const knopki = rows.map(r => [{
        text: (r.kluby?.nazvaniye || r.klub_id.slice(0, 8)) + ' · ' + (r.sozdan || '').slice(0, 10),
        callback_data: 'admin_anketa_' + r.klub_id
    }]);
    knopki.push([{ text: '⬅️ Админ', callback_data: 'admin_back' }]);
    if (messageId) {
        bot.editMessageText(t + '_Нажми клуб для полной анкеты._', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    } else {
        bot.sendMessage(chatId, t + '_Нажми клуб для полной анкеты._', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }
}

async function pokazatInstrukciyu(chatId, telegram_id, messageId) {
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    let text;
    let menuCb = 'menu_igroka';
    if (roles.isOwner) {
        text = tekstInstrukciiVladeltsa();
        menuCb = 'menu_vladeltsa';
    } else if (roles.isHost) {
        text = tekstInstrukciiVedushchego();
        menuCb = 'menu_vedushchego';
    } else if (roles.registered) {
        text = tekstInstrukciiIgroka();
    } else {
        text = tekstPrivetNezaregistrirovannomu();
    }
    const knopki = roles.registered
        ? { inline_keyboard: [[{ text: '🏠 В меню', callback_data: menuCb }]] }
        : { inline_keyboard: [[{ text: '▶️ Начать регистрацию', callback_data: 'reg_nachat' }]] };
    if (messageId) {
        await bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: knopki
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: knopki }));
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: knopki });
    }
}

function tekstOffertaKratko() {
    return '📄 *Публичная оферта Prime Mafia*\n\n' +
        '• Сервис автоматизирует игры, рейтинг, клубы и анонсы.\n' +
        '• Платные услуги: игры, пакеты, анонсы, персонализация клуба.\n' +
        '• Материалы клуба используются только внутри Prime Mafia.\n' +
        '• Код, логика и интерфейс защищены авторским правом.\n' +
        '• Клуб и ведущий отвечают за корректность введённых данных.\n' +
        '• Персональные данные обрабатываются по политике конфиденциальности.\n\n' +
        'Полный текст: `OFFERTA.md` в проекте.\n' +
        'Контакт: silena005@gmail.com';
}

function tekstPrivacyKratko() {
    return '🔒 *Политика конфиденциальности Prime Mafia*\n\n' +
        'Мы обрабатываем:\n' +
        '• Telegram ID, username, имя\n' +
        '• игровой ник, телефон, город\n' +
        '• данные игр, ролей, рейтинга и клубов\n\n' +
        'Данные хранятся в Supabase и используются только для работы Сервиса. ' +
        'Мы не продаём персональные данные.\n\n' +
        'Запрос на выгрузку или удаление: silena005@gmail.com\n' +
        'Тема письма: *PRIME MAFIA — DATA REQUEST*';
}

async function pokazatEkranSoglasiya(chatId, messageId) {
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopkiEkranaSoglasiya() }
    };
    if (messageId) {
        await bot.editMessageText(tekstEkranaSoglasiya(), { chat_id: chatId, message_id: messageId, ...opts });
    } else {
        await bot.sendMessage(chatId, tekstEkranaSoglasiya(), opts);
    }
}

async function prodolzhitRegistraciyu(chatId, tg_id, dannye) {
    const shag = dannye?.shag;
    if (shag === 'klub_kod') {
        await pokazatShagKodaKluba(chatId, null, dannye.gorod_name, dannye);
        return;
    }
    if (shag === 'igrovoy_nik') {
        let intro = '▶️ *Продолжаем регистрацию*\n\n';
        if (dannye.gorod_name) intro += '📍 ' + md(dannye.gorod_name) + '\n';
        if (dannye.klub_name) intro += '🎴 ' + md(dannye.klub_name) + '\n\n';
        await bot.sendMessage(chatId,
            intro + 'Введи *игровой ник* — так тебя будут видеть за столом:\n' +
            '_Например: Madame X, Доктор, Рыжая, Арчи_',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    if (shag === 'telefon') {
        await bot.sendMessage(chatId,
            '▶️ *Продолжаем регистрацию*\n\n' +
            (dannye.igrovoy_nik ? 'Ник: *' + md(dannye.igrovoy_nik) + '*\n\n' : '') +
            'Поделись номером телефона — нажми кнопку ниже:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        return;
    }
    if (shag === 'gorod_poisk_reg' && dannye.strana) {
        await bot.sendMessage(chatId,
            '▶️ *Продолжаем регистрацию*\n\n' +
            '✍️ Напиши часть названия города (' + dannye.strana + ') — например: *Моск* или *Соч*',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    if ((shag === 'gorod_vybor' || shag === 'gorod_poisk_reg') && dannye.strana) {
        await pokazatGorodaAlfavit(chatId, null, dannye.strana, 'reg', 'reg_nazad_strana');
        ozhidanie_registracii[tg_id].shag = 'gorod_vybor';
        return;
    }
    if (shag === 'gorod' || shag === 'gorod_vybor' || shag === 'gorod_poisk_reg') {
        await bot.sendMessage(chatId,
            '▶️ *Продолжаем регистрацию*\n\n' +
            '📍 *Шаг 1 — город:* выбери страну, затем город.\n' +
            '_⭐ популярные · 🔤 алфавит · ✍️ поиск_',
            {
            parse_mode: 'Markdown',
            reply_markup: {
                remove_keyboard: true,
                inline_keyboard: knopkiVyboraStranyReg()
            }
        });
        ozhidanie_registracii[tg_id].shag = 'gorod';
        return;
    }
    if (shag === 'den_rozhdeniya') {
        await bot.sendMessage(chatId,
            '▶️ *Почти готово!*\n\n' +
            '🎂 Напиши день рождения *ДД.ММ* или *ДД.ММ.ГГГГ* — или нажми «Пропустить».',
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'reg_dr_skip' }]] }
            }
        );
        return;
    }
    return pokazatEkranSoglasiya(chatId);
}

async function sohranitSoglasiePolzovatelya(igrok_id, tg_id) {
    const payload = {
        soglasie_offerta: true,
        soglasie_versiya: SOGLASIE_VERSIYA,
        soglasie_data: new Date().toISOString()
    };
    const query = igrok_id
        ? supabase.from('igroki').update(payload).eq('id', igrok_id)
        : supabase.from('igroki').update(payload).eq('tg_id', tg_id);
    const { error } = await query;
    if (error) console.error('Не удалось сохранить согласие (возможно, нет колонок в igroki):', error.message);
}

// ============================================
// ПАМЯТЬ БОТА (временная, до полного перехода на БД)
// ============================================

const sostoyanie = {}; // { telegram_id: 'vvodit_kod' | 'baza_poisk_<klub_id>' }
const igry = {};
const miniappEvents = new Map();

function uvedomitMiniAppPobedu(igra, kod, pobeditel) {
    itogFrazy.uvedomitMiniApp(igra, kod, pobeditel, miniappEvents);
}       // активные игры в памяти (кэш)
const ruchnyeRezultaty = {}; // черновики ручного внесения игр без процесса

// ============================================
// ПЕРСИСТЕНТНОСТЬ ИГР
// ============================================

// Сохранить игру в Supabase
async function sohranit_igru(kod) {
    const igra = igry[kod];
    if (!igra || igra._ne_sohranyat) return;
    try {
        const nastroyki = {
            ...(igra._nastroyki || {}),
            rezhim_rolei: igra.rezhim_rolei || null,
            klub_nazvaniye: nazvanieKlubaIgry(igra) || null,
            luchshie_hody: igra.luchshie_hody || [],
            ostanovlena: !!igra.ostanovlena,
            data_igry: igra.data_igry || igra._nastroyki?.data_igry || null,
            nomer_igry: igra.nomer_igry || igra._nastroyki?.nomer_igry || null
        };
        const data = {
            kod,
            klub_id: igra.klub_id || null,
            vedushchii_tg_id: igra.vedushchii_id || null,
            kolichestvo: igra.kolichestvo,
            tip_kluba: igra.tip_kluba || 'paskal',
            sportivniy: igra.sportivniy || false,
            igroki: JSON.stringify(igra.igroki || []),
            faza: igra.faza || 'ozhidanie',
            den: igra.den || 1,
            nastroyki: JSON.stringify(nastroyki),
            noch_deystviya: JSON.stringify(igra.noch_deystviya || {}),
            naznacheny_golos: JSON.stringify(igra.naznacheny_golos || []),
            obnovlena_v: new Date().toISOString(),
            zavershena: false
        };
        await supabase.from('aktivnye_igry').upsert(data, { onConflict: 'kod' });
    } catch(e) {
        console.error('Ошибка сохранения игры:', e.message);
    }
}

// Удалить игру из Supabase при завершении
async function zavershit_igru_v_db(kod) {
    try {
        const igra = igry[kod] || igry['archive_' + kod];
        const nastroyki = {
            ...(igra?._nastroyki || {}),
            rezhim_rolei: igra?.rezhim_rolei || null,
            pobeditel: igra?.pobeditel || null,
            data_igry: igra?.data_igry || igra?._nastroyki?.data_igry || null,
            nomer_igry: igra?.nomer_igry || igra?._nastroyki?.nomer_igry || null
        };
        await supabase.from('aktivnye_igry').update({
            zavershena: true,
            igroki: JSON.stringify(igra?.igroki || []),
            nastroyki: JSON.stringify(nastroyki),
            obnovlena_v: new Date().toISOString()
        }).eq('kod', kod);
    } catch(e) {}
}

// Загрузить все активные игры при старте
async function zagruzit_aktivnye_igry() {
    try {
        const { data: rows } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('zavershena', false);
        let count = 0;
        (rows || []).forEach(row => {
            if (!igry[row.kod]) {
                const nastroyki = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki) : (row.nastroyki || {});
                igry[row.kod] = {
                    kolichestvo: row.kolichestvo,
                    vedushchii_id: row.vedushchii_tg_id,
                    klub_id: row.klub_id,
                    klub_nazvaniye: nastroyki.klub_nazvaniye || null,
                    tip_kluba: row.tip_kluba || 'paskal',
                    sportivniy: row.sportivniy || false,
                    igroki: typeof row.igroki === 'string' ? JSON.parse(row.igroki) : (row.igroki || []),
                    faza: row.faza || 'ozhidanie',
                    den: row.den || 1,
                    rezhim_rolei: nastroyki.rezhim_rolei || null,
                    luchshie_hody: nastroyki.luchshie_hody || [],
                    ostanovlena: !!nastroyki.ostanovlena,
                    _nastroyki: nastroyki,
                    noch_deystviya: typeof row.noch_deystviya === 'string' ? JSON.parse(row.noch_deystviya) : (row.noch_deystviya || {}),
                    naznacheny_golos: typeof row.naznacheny_golos === 'string' ? JSON.parse(row.naznacheny_golos) : (row.naznacheny_golos || []),
                    roli_razdany: (row.igroki && (typeof row.igroki === 'string' ? JSON.parse(row.igroki) : row.igroki).some(i => i.rol)),
                    _vosstanovlena: true
                };
                count++;
            }
        });
        if (count > 0) console.log('\u2705 Восстановлено игр из БД:', count);
    } catch(e) {
        console.error('Ошибка загрузки игр:', e.message);
    }
}

// Запускаем загрузку при старте
zagruzit_aktivnye_igry();

// Состояние регистрации: { tg_id: { shag: 'igrovoy_nik' | 'telefon' | 'gorod', igrovoy_nik: '...' } }
const ozhidanie_registracii = {};

// ============================================
// ФУНКЦИИ
// ============================================

function peremeshat(massiv) {
    const novyi = [...massiv];
    for (let i = novyi.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [novyi[i], novyi[j]] = [novyi[j], novyi[i]];
    }
    return novyi;
}

function sgenerirovat_kod() {
    let kod;
    do {
        kod = String(Math.floor(1000 + Math.random() * 9000));
    } while (igry[kod]);
    return kod;
}

// ============================================
// МЕНЮ
// ============================================

const menu_vedushchego = {
    reply_markup: {
        inline_keyboard: [
            ...knopkiMiniApp(),
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [
                { text: '🎲 Создать игру', callback_data: 'sozdat_igru' },
                { text: '🎮 Мои игры', callback_data: 'moi_igry' }
            ],
            [{ text: '✨ Ещё', callback_data: 'menu_more_vedushchego' }],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }]
        ]
    }
};

const menu_vedushchego_full = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
            [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
            [{ text: '🏛 Игры клуба', callback_data: 'igry_kluba' }],
            [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
            [{ text: '📋 Внести результаты', callback_data: 'vnesti_rezultaty' }],
            [{ text: '📢 Создать анонс игры', callback_data: 'anons_vybor_kluba' }],
            [{ text: '🔗 Приглашение в клуб', callback_data: 'klub_priglashenie' }],
            [{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }],
            [{ text: '🎨 Логотип клуба', callback_data: 'brend_klub_menu' }],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }],
            [{ text: '⬅️ Короткое меню', callback_data: 'menu_vedushchego' }]
        ]
    }
};

const menu_igroka = {
    reply_markup: {
        inline_keyboard: [
            ...knopkiMiniApp(),
            [
                { text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' },
                { text: '🏆 Рейтинг', callback_data: 'moy_reyting' }
            ],
            [{ text: '📢 Анонсы игр', callback_data: 'anonsy_goroda' }],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }],
            [{ text: '✨ Ещё', callback_data: 'menu_more_igroka' }]
        ]
    }
};

const menu_igroka_full = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' }],
            [{ text: '📢 Анонсы игр', callback_data: 'anonsy_goroda' }],
            [{ text: '🎮 Играть с друзьями', callback_data: 'druzya_menu' }],
            [{ text: '🏆 Мой рейтинг', callback_data: 'moy_reyting' }],
            [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }],
            [{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }],
            [{ text: '📄 Оферта и конфиденциальность', callback_data: 'legal_menu' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }],
            [{ text: '⬅️ Короткое меню', callback_data: 'menu_igroka' }]
        ]
    }
};

const menu_vladeltsa = {
    reply_markup: {
        inline_keyboard: [
            ...knopkiMiniApp(),
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [
                { text: '🎲 Создать игру', callback_data: 'sozdat_igru' },
                { text: '🎮 Мои игры', callback_data: 'moi_igry' }
            ],
            [
                { text: '📊 Аналитика', callback_data: 'analitika' },
                { text: '✨ Ещё', callback_data: 'menu_more_vladeltsa' }
            ],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }]
        ]
    }
};

const menu_vladeltsa_full = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌙 Начать игровой вечер', callback_data: 'igrovoy_vecher' }],
            [{ text: '📊 Аналитика', callback_data: 'analitika' }],
            [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
            [{ text: '🏛 Игры клуба', callback_data: 'igry_kluba' }],
            [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
            [{ text: '🏆 Рейтинг и баллы', callback_data: 'reyting_vybor_kluba' }],
            [{ text: '👥 База игроков', callback_data: 'baza_igrokov' }],
            [{ text: '🔗 Приглашение в клуб', callback_data: 'klub_priglashenie' }],
            [{ text: '🎤 Назначить ведущего', callback_data: 'naznachit_vedushchego' }],
            [{ text: '📢 Создать анонс игры', callback_data: 'anons_vybor_kluba' }],
            [{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_vse' }],
            [{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }],
            [{ text: '⚙️ Настройки клуба', callback_data: 'nastroyki_kluba_v' }],
            [{ text: '📋 Анкета клуба', callback_data: 'anketa_klub_prosmotr' }],
            [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
            [{ text: '📖 Как пользоваться', callback_data: 'pomoshch' }],
            [{ text: '💬 Поддержка', callback_data: 'podderzhka' }],
            [{ text: '⬅️ Короткое меню', callback_data: 'menu_vladeltsa' }]
        ]
    }
};

const menu_kolichestva = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '8', callback_data: 'create_8' },
                { text: '9', callback_data: 'create_9' },
                { text: '10', callback_data: 'create_10' },
                { text: '11', callback_data: 'create_11' }
            ],
            [
                { text: '12', callback_data: 'create_12' },
                { text: '13', callback_data: 'create_13' },
                { text: '14', callback_data: 'create_14' },
                { text: '15', callback_data: 'create_15' }
            ],
            [
                { text: '16', callback_data: 'create_16' },
                { text: '17', callback_data: 'create_17' },
                { text: '18', callback_data: 'create_18' }
            ],
            [
                { text: '19', callback_data: 'create_19' },
                { text: '20', callback_data: 'create_20' }
            ],
            [
                { text: '⬅️ Назад', callback_data: 'menu_vedushchego' }
            ]
        ]
    }
};

const bystrayaKlaviaturaVedushchego = {
    reply_markup: {
        keyboard: [
            ['🏠 Меню', '🌙 Игровой вечер'],
            ['🎮 Мои игры', '🎲 Создать игру'],
            ['⏸ Пауза/стоп', '▶️ Возобновить'],
            ['🗑 Удалить игру']
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

bot.setMyCommands([
    { command: 'start', description: 'Открыть меню' },
    { command: 'help', description: 'Как пользоваться ботом' },
    { command: 'games', description: 'Мои игры' },
    { command: 'pause', description: 'Остановить активную игру' },
    { command: 'resume', description: 'Возобновить игру' }
]).catch(e => console.error('[commands]', e?.message || e));

async function pokazatBystryeKnopkiVedushchego(chatId) {
    await bot.sendMessage(chatId, '✨ Основное меню теперь в сообщении выше.', {
        reply_markup: { remove_keyboard: true }
    }).catch(() => {});
}


async function pokazatBlokStartaIgry(chatId, messageId, query, rez) {
    const alertText = (rez.paywall || rez.preduprezhdenie || 'Нет доступных игр')
        .replace(/\*/g, '')
        .slice(0, 200);
    if (query?.id) {
        await bot.answerCallbackQuery(query.id, { text: alertText, show_alert: true }).catch(() => {});
    }
    const body = rez.paywall || ('⚠️ ' + rez.preduprezhdenie);
    const klub_id = rez.klub_id || '';
    const knopki = [
        [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + klub_id }],
        [{ text: '🎁 О тестовой неделе', callback_data: 'tarif_klub_' + klub_id }],
        [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
    ];
    if (messageId) {
        await bot.editMessageText(body, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        }).catch(() => bot.sendMessage(chatId, body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } }));
    } else {
        await bot.sendMessage(chatId, body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }
    if (rez.paywall && klub_id) {
        maybeOtpravitAvtoOtzyvOkonchaniyaTesta(klub_id, chatId).catch(() => {});
    }
}

function tekstStilizatsiiKluba(nazvanieKluba = 'клуб') {
    return '🎨 *Стилизация приложения под клуб*\n\n' +
        'Клуб: *' + md(nazvanieKluba) + '*\n\n' +
        'Можно оформить интерфейс Prime Mafia в стиле вашего клуба:\n' +
        '— цвета и визуальный стиль клуба;\n' +
        '— клубная подача экранов и кнопок;\n' +
        '— ощущение собственного приложения для игроков и ведущих.\n\n' +
        'Стоимость: *5000₽ один раз, навсегда*.\n\n' +
        '_После подключения игроки и ведущие видят интерфейс, стилизованный под ваш клуб._';
}

// ============================================
// КОМАНДА /start
// ============================================

bot.onText(/\/start(?:\s+(.+))?/, async function(msg, match) {
    try {
    await obrabotatStart(msg, match);
    } catch (e) {
        console.error('[/start error]', e.message || e);
        bot.sendMessage(msg.chat.id, '❌ Ошибка запуска. Попробуй ещё раз через минуту.\n\n_' + (e.message || '') + '_', { parse_mode: 'Markdown' }).catch(() => {});
    }
});

bot.onText(/\/help/, async (msg) => {
    try {
        await pokazatInstrukciyu(msg.chat.id, msg.from.id);
    } catch (e) {
        console.error('[/help error]', e.message || e);
        bot.sendMessage(msg.chat.id, '❌ Не удалось показать справку. Попробуй /start').catch(() => {});
    }
});

bot.onText(/\/(stop|unsubscribe)$/i, async (msg) => {
    const tg_id = msg.from.id;
    await ustanovitOtpisPriglasheniy(tg_id, true);
    bot.sendMessage(msg.chat.id,
        '✅ *Вы отписались от приглашений на игры.*\n\n' +
        'Бот больше не будет присылать приглашения от клубов.\n\n' +
        'Снова подписаться: /subscribe или напишите «подписаться».',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/subscribe$/i, async (msg) => {
    const tg_id = msg.from.id;
    await ustanovitOtpisPriglasheniy(tg_id, false);
    bot.sendMessage(msg.chat.id,
        '✅ *Подписка на приглашения включена.*\n\n' +
        'Клубы снова смогут присылать приглашения на игры.\n\n' +
        'Отписаться: /stop или «стоп».',
        { parse_mode: 'Markdown' }
    );
});

async function pokazatKartochkuAnonsaPoSsylke(chatId, tg_id, anons_id) {
    const { data: a } = await supabase
        .from('anonsy')
        .select('id, data_igry, vremya, adres, kommentariy, status, klub_id, kluby(nazvaniye)')
        .eq('id', anons_id)
        .single();
    if (!a || a.status !== 'aktiven') {
        bot.sendMessage(chatId, '❌ Анонс не найден или уже неактивен.');
        return;
    }
    let t = '📢 *' + (a.kluby?.nazvaniye || 'Игра') + '*\n\n';
    t += '📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
    t += '📍 ' + (a.adres || '') + '\n';
    if (a.kommentariy) t += '💬 ' + a.kommentariy + '\n';
    bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '✍️ Записаться', callback_data: 'anons_zapisatsya_' + a.id }],
            [{ text: '📢 Все анонсы', callback_data: 'anonsy_goroda' }]
        ] }
    });
}

async function obrabotatStart(msg, match) {
    // Deep link: /start join_КОД
    const param = match?.[1]?.trim();
    if (param && param.startsWith('club_')) {
        const kod_kluba = klubInvite.normalizovatKodRegistracii(param.replace('club_', ''));
        const klub_link = kod_kluba ? await klubInvite.poluchitKlubPoKoduRegistracii(kod_kluba) : null;
        if (!klub_link) {
            bot.sendMessage(msg.chat.id, '❌ Код клуба не найден. Проверь ссылку или запроси новый код у ведущего.');
        } else {
            const { data: igrok_cl } = await supabase.from('igroki').select('id, imya, igrovoy_nik').eq('tg_id', msg.from.id).maybeSingle();
            if (igrok_cl?.id) {
                await dobavitChlenaKlubaEsliNuzhno(klub_link.id, igrok_cl.id);
                bot.sendMessage(msg.chat.id,
                    '✅ Ты в клубе *' + md(klub_link.nazvaniye) + '*!\n\nНапиши /start — откроется меню.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            const cur_cl = ozhidanie_registracii[msg.from.id] || {};
            ozhidanie_registracii[msg.from.id] = {
                ...cur_cl,
                klub_id: klub_link.id,
                klub_name: klub_link.nazvaniye,
                klub_kod: kod_kluba,
                pending_klub_from_link: true,
                pending_anons_id: cur_cl.pending_anons_id || null
            };
            bot.sendMessage(msg.chat.id,
                '🎴 *Приглашение в клуб «' + md(klub_link.nazvaniye) + '»*\n\n' +
                'Для участия нужна регистрация — город, ник и телефон. Клуб уже выбран по ссылке.',
                { parse_mode: 'Markdown' }
            );
            ozhidanie_registracii[msg.from.id].shag = 'soglasie';
            return pokazatEkranSoglasiya(msg.chat.id);
        }
    }
    if (param && param.startsWith('join_')) {
        const kod_join = param.replace('join_', '');
        const igra_join = igry[kod_join];
        if (!igra_join) { bot.sendMessage(msg.chat.id, '\u274C Игра не найдена или уже завершена.'); return; }
        const tg_id_j = msg.from.id;
        if (igra_join.igroki.find(i => i.telegram_id === tg_id_j)) {
            bot.sendMessage(msg.chat.id, '\u2705 Ты уже в этой игре!'); return;
        }
        if (igra_join.igroki.length >= igra_join.kolichestvo) {
            bot.sendMessage(msg.chat.id, '\u274C Все места заняты'); return;
        }
        const { data: igrok_j } = await supabase.from('igroki').select('id, imya, igrovoy_nik').eq('tg_id', tg_id_j).single();
        const name_j = igrok_j?.igrovoy_nik || igrok_j?.imya || msg.from.first_name || 'Игрок';
        const nomer_j = igra_join.igroki.length + 1;
        igra_join.igroki.push({ telegram_id: tg_id_j, name: name_j, nomer: nomer_j, status: 'v_igre', foly: 0, igrok_id: igrok_j?.id || null });
        if (igra_join.klub_id && igrok_j?.id) await dobavitChlenaKlubaEsliNuzhno(igra_join.klub_id, igrok_j.id);
        await sohranit_igru(kod_join);
        bot.sendMessage(msg.chat.id, '\u2705 Ты в игре! *\u2116' + nomer_j + ' ' + name_j + '*\n\n\uD83C\uDFB4 Игра: *' + kod_join + '*\n\uD83D\uDC65 ' + igra_join.igroki.length + '/' + igra_join.kolichestvo + '\n\n_Ожидай — ведущий скоро начнёт_', { parse_mode: 'Markdown' });
        if (igra_join.vedushchii_id) bot.sendMessage(igra_join.vedushchii_id, '\uD83D\uDC4B *' + name_j + '* вошёл! ' + igra_join.igroki.length + '/' + igra_join.kolichestvo, { parse_mode: 'Markdown' }).catch(() => {});
        return;
    }
    if (param && param.startsWith('anons_')) {
        const anons_id = param.replace('anons_', '');
        const { data: a_reg } = await supabase
            .from('anonsy')
            .select('id, klub_id, kluby(nazvaniye)')
            .eq('id', anons_id)
            .maybeSingle();
        const { data: igrok_a } = await supabase.from('igroki').select('id').eq('tg_id', msg.from.id).single();
        if (!igrok_a) {
            ozhidanie_registracii[msg.from.id] = {
                shag: 'soglasie',
                pending_anons_id: anons_id,
                klub_id: a_reg?.klub_id || null,
                klub_name: a_reg?.kluby?.nazvaniye || null
            };
            return pokazatEkranSoglasiya(msg.chat.id);
        }
        await pokazatKartochkuAnonsaPoSsylke(msg.chat.id, msg.from.id, anons_id);
        return;
    }
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const tg_username = msg.from.username || '';

    // Проверяем есть ли игрок в базе
    const { data: igrok } = await supabase
        .from('igroki')
        .select('*')
        .eq('tg_id', tg_id)
        .maybeSingle();

    if (igrok) {
        obnovitAvatarIzTelegram(bot, tg_id).catch(() => {});
        const roles = await poluchitRoliPolzovatelya(tg_id);

        if (roles.isOwner) {
            const dop = roles.isHost
                ? '\n\n_Ты собственник и ведущий — доступны и управление клубом, и ведение игр._'
                : '\n\n_Как собственник, ты можешь вести игры сам или назначить отдельного ведущего._';
            bot.sendMessage(chatId,
                '🏛 *Привет, ' + md(igrok.imya) + '!*\n\n' +
                'Prime Mafia — твой клуб в Telegram: игры, рейтинг, анонсы и mini app.\n\n' +
                'Меню собственника ниже. Новичку — «📖 Как пользоваться» или /help.' + dop,
                { parse_mode: 'Markdown', ...menu_vladeltsa }
            );
            await pokazatBystryeKnopkiVedushchego(chatId);
        } else if (roles.isHost) {
            bot.sendMessage(chatId,
                '🎭 *Привет, ' + md(igrok.imya) + '!*\n\n' +
                'Prime Mafia поможет провести вечер: создай игру, веди фазы, рейтинг запишется сам.\n\n' +
                'Меню ведущего ниже. Справка — «📖 Как пользоваться» или /help.',
                { parse_mode: 'Markdown', ...menu_vedushchego }
            );
            await pokazatBystryeKnopkiVedushchego(chatId);
        } else {
            bot.sendMessage(chatId,
                '🎴 *Привет, ' + md(igrok.imya) + '!*\n\n' +
                'Войди в игру по коду от ведущего, смотри анонсы и рейтинг.\n\n' +
                'Меню игрока ниже. Справка — «📖 Как пользоваться» или /help.',
                { parse_mode: 'Markdown', ...menu_igroka }
            );
        }
    } else {
        const cur = ozhidanie_registracii[tg_id];
        if (cur && cur.shag && cur.shag !== 'soglasie') {
            return prodolzhitRegistraciyu(chatId, tg_id, cur);
        }
        ozhidanie_registracii[tg_id] = {
            shag: 'soglasie',
            pending_anons_id: cur?.pending_anons_id || null
        };
        return pokazatEkranSoglasiya(chatId);
    }
}

// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================


// ============================================
// ЗАГРУЗКА КАРТИНОК РОЛЕЙ (только для админа)
// ============================================

// Маппинг file_id ролей (заполняется через /upload_role)
const roli_foto = {};
const roli_foto_klub = {};

const ALL_ROLE_NAMES = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник мафии', 'Консильери',
                      'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                      'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
                      'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
                      'Мстительный родственник', 'Маньяк', 'Мирный',
                      'Мирный житель', 'Дон мафии', 'Якудза', 'Глава якудзы',
                      'Джокер', 'Мститель', 'Чужая', 'Журналист', 'Оборотень'];

function normalizovatNazvanieRoli(input) {
    const text = String(input || '').trim().toLowerCase();
    if (text === 'путана') return 'Эскортница';
    if (text === 'мирный') return 'Мирный';
    if (text === 'мирный житель') return 'Мирный житель';
    if (text === 'дон мафии') return 'Дон мафии';
    if (text === 'глава якудзы') return 'Глава якудзы';
    if (text === 'мстительный родственник') return 'Мстительный родственник';
    return ALL_ROLE_NAMES.find(r => r.toLowerCase() === text) || null;
}

function klyuchFotoRoliKluba(klub_id, rol) {
    return 'rol_foto_klub_' + klub_id + '_' + rol;
}

function fotoRoliDlyaIgry(igra, rol) {
    if (igra?.klub_id && roli_foto_klub[igra.klub_id]?.[rol]) {
        return roli_foto_klub[igra.klub_id][rol];
    }
    return roli_foto[rol];
}

async function sohranitFotoRoli(msg, file_id) {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        if (msg.caption) {
            bot.sendMessage(msg.chat.id, '❌ Загрузка картинок ролей доступна только администратору.\n\nНапиши /admin — там инструкция.');
        }
        return;
    }

    // Проверяем caption — должно быть название роли
    const caption = normalizovatNazvanieRoli(msg.caption);
    if (!caption) {
        bot.sendMessage(msg.chat.id, 
            '📸 Картинка получена, но я не понял роль.\n\nОтправь картинку с подписью = название роли.\nПример подписи: Дон\n\nМожно писать с маленькой буквы: ведьма, маньяк.'
        );
        return;
    }

    const klubUploadId = typeof sostoyanie[tg_id] === 'string' && sostoyanie[tg_id].startsWith('admin_cards_')
        ? sostoyanie[tg_id].replace('admin_cards_', '')
        : null;

    if (klubUploadId) {
        roli_foto_klub[klubUploadId] = roli_foto_klub[klubUploadId] || {};
        roli_foto_klub[klubUploadId][caption] = file_id;
    } else {
        roli_foto[caption] = file_id;
    }

    // Сохраняем в Supabase для постоянства
    try {
        const klyuch = klubUploadId ? klyuchFotoRoliKluba(klubUploadId, caption) : 'rol_foto_' + caption;
        const { error } = await supabase.from('nastroyki_app').upsert({
            klyuch,
            znachenie: file_id
        }, { onConflict: 'klyuch' });
        if (error) {
            console.error('❌ Ошибка сохранения картинки роли:', error.message);
            bot.sendMessage(msg.chat.id, '❌ Картинка дошла, но не сохранилась в Supabase.\n\nОшибка: ' + error.message);
            return;
        }
    } catch(e) {
        console.error('❌ Supabase save exception:', e.message);
        bot.sendMessage(msg.chat.id, '❌ Картинка дошла, но не сохранилась.\n\nОшибка: ' + e.message);
        return;
    }

    bot.sendMessage(msg.chat.id,
        '✅ ' + caption + ' — картинка сохранена' + (klubUploadId ? ' для клуба.' : '.')
    );
}

bot.on('photo', async (msg) => {
    const file_id = msg.photo[msg.photo.length - 1].file_id;
    const tg_id = msg.from.id;
    const st = sostoyanie[tg_id];
    if (typeof st === 'string' && st.startsWith('brend_klub_')) {
        const klub_id = st.replace('brend_klub_', '');
        if (!(await klubBrend.mozhnoUpravlyatBrendomKluba(tg_id, klub_id))) {
            delete sostoyanie[tg_id];
            bot.sendMessage(msg.chat.id, '❌ Нет доступа к бренду этого клуба.');
            return;
        }
        const { error } = await klubBrend.sohranitLogoKluba(klub_id, file_id);
        delete sostoyanie[tg_id];
        if (error) {
            bot.sendMessage(msg.chat.id, '❌ Не удалось сохранить логотип: ' + error.message);
            return;
        }
        bot.sendMessage(msg.chat.id,
            '✅ *Логотип клуба сохранён!*\n\nОн появится в mini app и на столе при выборе клуба.',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    await sohranitFotoRoli(msg, file_id);
});

bot.on('document', async (msg) => {
    const doc = msg.document;
    const mime = doc?.mime_type || '';
    if (!mime.startsWith('image/')) return;
    const tg_id = msg.from.id;
    const st = sostoyanie[tg_id];
    if (typeof st === 'string' && st.startsWith('brend_klub_')) {
        const klub_id = st.replace('brend_klub_', '');
        if (!(await klubBrend.mozhnoUpravlyatBrendomKluba(tg_id, klub_id))) {
            delete sostoyanie[tg_id];
            bot.sendMessage(msg.chat.id, '❌ Нет доступа к бренду этого клуба.');
            return;
        }
        const { error } = await klubBrend.sohranitLogoKluba(klub_id, doc.file_id);
        delete sostoyanie[tg_id];
        if (error) {
            bot.sendMessage(msg.chat.id, '❌ Не удалось сохранить логотип: ' + error.message);
            return;
        }
        bot.sendMessage(msg.chat.id, '✅ *Логотип клуба сохранён!*', { parse_mode: 'Markdown' });
        return;
    }
    await sohranitFotoRoli(msg, doc.file_id);
});

// Команда /roles_status — показать какие роли загружены
bot.onText(/\/admin/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        bot.sendMessage(msg.chat.id,
            '🔐 *Режим администратора*\n\n' +
            'Доступ только у владельца бота (ADMIN_TG_ID в Railway).\n\n' +
            'Твой Telegram ID: `' + tg_id + '`\n' +
            '_Добавь его в переменную ADMIN_TG_ID и перезапусти сервис._',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    if (typeof sostoyanie[tg_id] === 'string' && sostoyanie[tg_id].startsWith('admin_cards_')) {
        delete sostoyanie[tg_id];
    }
    bot.sendMessage(msg.chat.id,
        '🔐 *Режим администратора*\n\n' +
        '📸 *Глобальные картинки ролей:*\n' +
        'Отправь фото или PNG/JPG-файл с *подписью* = название роли\n' +
        '_Пример подписи: Дон или ведьма_\n\n' +
        '🏛 *Клубные картинки ролей:*\n' +
        '/club\\_cards — выбрать клуб и загрузить карты именно для него\n\n' +
        '📋 /roles\\_status — глобальные роли\n' +
        '📋 /club\\_roles\\_status — роли выбранного клуба\n\n' +
        '📝 /scripts — скрипты продаж и отзывов\n' +
        '📋 /ankety — анкеты клубов (Supabase)',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/ankety/, async (msg) => {
    if (!isAdmin(msg.from.id)) {
        bot.sendMessage(msg.chat.id, '📋 Анкеты клубов доступны администратору Prime Mafia.\n\nСобственник: «📋 Анкета клуба» в меню.');
        return;
    }
    await pokazatAnketyAdmin(msg.chat.id);
});

bot.onText(/\/scripts/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) {
        bot.sendMessage(msg.chat.id,
            '📝 *Скрипты продаж*\n\nДоступ только у администратора (ADMIN_TG_ID).\n\nПолный текст: docs/SALES_SCRIPTS.md в репозитории.',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    await pokazatMenuSkriptov(msg.chat.id);
});

bot.onText(/\/club_cards/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) return;
    const { data: kluby, error } = await supabase
        .from('kluby')
        .select('id, nazvaniye')
        .order('nazvaniye', { ascending: true })
        .limit(50);
    if (error) {
        bot.sendMessage(msg.chat.id, '❌ Не получилось загрузить клубы.\n\nОшибка: ' + error.message);
        return;
    }
    if (!kluby?.length) {
        bot.sendMessage(msg.chat.id, 'Пока нет клубов для привязки карт.');
        return;
    }
    bot.sendMessage(msg.chat.id, '🏛 *Выбери клуб для загрузки карт ролей:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: kluby.map(k => [{ text: k.nazvaniye || 'Клуб', callback_data: 'admin_cards_' + k.id }])
        }
    });
});

bot.onText(/\/roles_status/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) return;

    // Загружаем из Supabase
    const { data: rows, error } = await supabase.from('nastroyki_app')
        .select('klyuch, znachenie')
        .like('klyuch', 'rol_foto_%');
    if (error) {
        console.error('❌ Ошибка статуса картинок:', error.message);
        bot.sendMessage(msg.chat.id, '❌ Не получилось загрузить статус картинок.\n\nОшибка: ' + error.message);
        return;
    }

    const loaded = (rows || [])
        .filter(r => !r.klyuch.startsWith('rol_foto_klub_'))
        .map(r => r.klyuch.replace('rol_foto_', ''));
    let t = '📸 Статус загрузки картинок:\n\n';
    ALL_ROLE_NAMES.forEach(r => {
        t += (loaded.includes(r) ? '✅' : '❌') + ' ' + r + '\n';
    });
    t += '\nЗагружено: ' + loaded.length + '/' + ALL_ROLE_NAMES.length;

    bot.sendMessage(msg.chat.id, t);
});

bot.onText(/\/club_roles_status/, async (msg) => {
    const tg_id = msg.from.id;
    if (!isAdmin(tg_id)) return;
    const klub_id = typeof sostoyanie[tg_id] === 'string' && sostoyanie[tg_id].startsWith('admin_cards_')
        ? sostoyanie[tg_id].replace('admin_cards_', '')
        : null;
    if (!klub_id) {
        bot.sendMessage(msg.chat.id, '🏛 Сначала выбери клуб командой /club_cards.');
        return;
    }
    const prefix = 'rol_foto_klub_' + klub_id + '_';
    const { data: rows, error } = await supabase.from('nastroyki_app')
        .select('klyuch, znachenie')
        .like('klyuch', prefix + '%');
    if (error) {
        bot.sendMessage(msg.chat.id, '❌ Не получилось загрузить статус клубных карт.\n\nОшибка: ' + error.message);
        return;
    }
    const loaded = (rows || []).map(r => r.klyuch.replace(prefix, ''));
    let t = '🏛📸 Статус клубных карт ролей:\n\n';
    ALL_ROLE_NAMES.forEach(r => {
        t += (loaded.includes(r) ? '✅' : '❌') + ' ' + r + '\n';
    });
    t += '\nЗагружено: ' + loaded.length + '/' + ALL_ROLE_NAMES.length;
    bot.sendMessage(msg.chat.id, t);
});

// Загрузка file_id при старте бота из Supabase
async function zagruzit_foto_roley() {
    try {
        const { data: rows } = await supabase.from('nastroyki_app')
            .select('klyuch, znachenie')
            .like('klyuch', 'rol_foto_%');
        (rows || []).forEach(r => {
            if (r.klyuch.startsWith('rol_foto_klub_')) {
                const rest = r.klyuch.replace('rol_foto_klub_', '');
                const idx = rest.indexOf('_');
                if (idx > 0) {
                    const klub_id = rest.slice(0, idx);
                    const rol = rest.slice(idx + 1);
                    roli_foto_klub[klub_id] = roli_foto_klub[klub_id] || {};
                    roli_foto_klub[klub_id][rol] = r.znachenie;
                }
            } else {
                const rol = r.klyuch.replace('rol_foto_', '');
                roli_foto[rol] = r.znachenie;
            }
        });
        if (rows?.length > 0) console.log('✅ Загружено фото ролей:', rows.length);
    } catch(e) {
        console.log('Фото ролей не загружены:', e.message);
    }
}
zagruzit_foto_roley();


// ============================================
// АВТОАРХИВАЦИЯ АНОНСОВ
// ============================================
async function arhivirovat_starye_anonsy() {
    try {
        const segodnya = new Date().toISOString().slice(0, 10);
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry')
            .eq('status', 'aktiven');
        const ids = (anonsy || []).filter(a => {
            const iso = razobrat_datu_anonsa(a.data_igry) || a.data_igry;
            return iso && iso < segodnya;
        }).map(a => a.id);
        if (ids.length === 0) return;
        const { error } = await supabase
            .from('anonsy')
            .update({ status: 'arhiv' })
            .in('id', ids);
        if (!error) console.log('📦 Архивация анонсов:', ids.length);
    } catch(e) {
        console.error('Ошибка архивации:', e.message);
    }
}
arhivirovat_starye_anonsy();
setInterval(arhivirovat_starye_anonsy, 2 * 60 * 60 * 1000);

function naytiIgruDlyaRuchnyhRoley(tg_id, text) {
    if (!text || !text.includes('\n')) return null;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length < 6) return null;

    const matches = Object.entries(igry).filter(([kod, igra]) => {
        if (String(kod).startsWith('archive_')) return false;
        if (!igra || igra.vedushchii_id !== tg_id) return false;
        if (igra.roli_razdany) return false;
        if (igra.rezhim_rolei && igra.rezhim_rolei !== 'karty') return false;
        if (lines.length !== igra.kolichestvo) return false;
        return lines.every((line, idx) => !!razobratStrokuRoli(line, idx));
    });

    return matches.length === 1 ? matches[0][0] : null;
}

async function obrabotatMiniAppData(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    let payload;

    try {
        payload = JSON.parse(msg.web_app_data?.data || '{}');
    } catch (e) {
        console.error('[miniapp data parse]', e.message || e);
        await bot.sendMessage(chatId, '❌ Не смог прочитать данные из приложения. Попробуй открыть его ещё раз.');
        return;
    }

    const action = payload.action || payload.type;
    if (action === 'open_menu') {
        await obrabotatStart(msg, []);
        return;
    }
    if (action === 'my_games') {
        await pokazatMoiIgryBystraya(chatId, tg_id);
        return;
    }
    if (action === 'igrovoy_vecher') {
        const kluby = await poluchitKlubyDlyaIgr(tg_id);
        if (kluby.length === 0) {
            await bot.sendMessage(chatId, '🌙 У тебя пока нет клуба для игрового вечера.');
        } else if (kluby.length === 1) {
            const soobsh = await bot.sendMessage(chatId, '🌙 Открываю игровой вечер...');
            await pokazatIgrovoyVecher(chatId, soobsh.message_id, kluby[0], tg_id);
        } else {
            await bot.sendMessage(chatId, '🌙 *Игровой вечер*\n\nВыбери клуб:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: kluby.map(k => [{ text: '🌙 ' + k.nazvaniye, callback_data: 'vecher_klub_' + k.id }]) }
            });
        }
        return;
    }
    if (action === 'create_game') {
        await bot.sendMessage(chatId, '🎲 *Создание игры*\n\nНажми кнопку ниже, чтобы выбрать клуб и формат игры.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]] }
        });
        return;
    }
    if (action === 'roles') {
        await bot.sendMessage(chatId, '🎭 *Управление ролями*\n\nОткрой настройки ролей для нужного клуба.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎭 Управление ролями', callback_data: 'roli_vybor_kluba' }]] }
        });
        return;
    }
    if (action === 'join_game') {
        await bot.sendMessage(chatId, '🎮 Чтобы войти в игру, нажми «Войти в игру» в меню или отправь код игры ведущему.');
        return;
    }
    if (action === 'support') {
        await bot.sendMessage(chatId, '💬 Поддержка Prime Mafia: напиши сюда, что случилось, и мы поможем.');
        return;
    }

    await bot.sendMessage(chatId, '✅ Данные из приложения получены.');
}

bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    const tg_id = msg.from.id;
    const text = (msg.text || '').trim();

    if (msg.web_app_data?.data) {
        await obrabotatMiniAppData(msg);
        return;
    }

    const fwdChat = msg.forward_from_chat || (msg.forward_origin?.type === 'chat' ? msg.forward_origin.chat : null);
    if (fwdChat && ['group', 'supergroup', 'channel'].includes(fwdChat.type) && ozhidanie_registracii[tg_id]?.shag === 'privyazat_gruppu_kluba') {
        const klub_id = ozhidanie_registracii[tg_id].klub_id;
        await publikaciya.sohranitChatGruppyKluba(klub_id, fwdChat.id, fwdChat.title);
        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId,
            '✅ *Группа привязана:* ' + md(fwdChat.title || 'чат') + '\n\n' +
            'После игры — кнопка «Отправить в группу клуба».\n' +
            'В настройках можно включить автопубликацию.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (text === '🏠 Меню') {
        await obrabotatStart(msg, []);
        return;
    }

    const textLow = text.toLowerCase();
    if (textLow === 'стоп' || textLow === 'stop') {
        await ustanovitOtpisPriglasheniy(tg_id, true);
        bot.sendMessage(chatId,
            '✅ Вы *отписались* от приглашений на игры.\n\nСнова подписаться: /subscribe или «подписаться».',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    if (textLow === 'подписаться' || textLow === 'subscribe') {
        await ustanovitOtpisPriglasheniy(tg_id, false);
        bot.sendMessage(chatId,
            '✅ Подписка на *приглашения* снова включена.\n\nОтписаться: /stop или «стоп».',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (text === '🎮 Мои игры' || text === '/games') {
        await pokazatMoiIgryBystraya(chatId, tg_id);
        return;
    }
    if (text === '🌙 Игровой вечер') {
        const kluby = await poluchitKlubyDlyaIgr(tg_id);
        if (kluby.length === 0) {
            await bot.sendMessage(chatId, '🌙 У тебя пока нет клуба для игрового вечера.', bystrayaKlaviaturaVedushchego);
        } else if (kluby.length === 1) {
            const msgVecher = await bot.sendMessage(chatId, '🌙 Открываю игровой вечер...', bystrayaKlaviaturaVedushchego);
            await pokazatIgrovoyVecher(chatId, msgVecher.message_id, kluby[0], tg_id);
        } else {
            const knopki = kluby.map(k => [{ text: '🌙 ' + k.nazvaniye, callback_data: 'vecher_klub_' + k.id }]);
            await bot.sendMessage(chatId, '🌙 *Игровой вечер*\n\nВыбери клуб:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: knopki }
            });
        }
        return;
    }
    if (text === '🎲 Создать игру') {
        await bot.sendMessage(chatId, '🎲 *Создать игру*', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]] }
        });
        return;
    }
    if (text === '⏸ Пауза/стоп' || text === '/pause') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'pause');
        return;
    }
    if (text === '▶️ Возобновить' || text === '/resume') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'resume');
        return;
    }
    if (text === '🗑 Удалить игру') {
        await pokazatBystryyVyborIgry(chatId, tg_id, 'delete');
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_date') {
        const dataIso = razobrat_datu_anonsa(text) || (text.toLowerCase() === 'сегодня' ? dataIgrovoegoVechera() : null);
        if (!dataIso) {
            bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *01.06.2026* или напиши *сегодня*.', { parse_mode: 'Markdown' });
            return;
        }
        ozhidanie_registracii[tg_id].data_igry = dataIso;
        ozhidanie_registracii[tg_id].shag = 'manual_result_number';
        bot.sendMessage(chatId, '🎲 Введи номер игры за этот вечер.\n\nНапример: `1`, `2`, `3`.', { parse_mode: 'Markdown' });
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_number') {
        const nomer = parseInt(text, 10);
        if (!Number.isFinite(nomer) || nomer < 1) {
            bot.sendMessage(chatId, '❌ Введи номер игры числом: `1`, `2`, `3`.', { parse_mode: 'Markdown' });
            return;
        }
        ozhidanie_registracii[tg_id].nomer_igry = nomer;
        ozhidanie_registracii[tg_id].shag = 'manual_result_players';
        bot.sendMessage(chatId, tekstVvodaRuchnogoProtokola(), { parse_mode: 'Markdown' });
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_players') {
        const parsed = razobratRuchnoyProtokol(text);
        if (!parsed) {
            bot.sendMessage(chatId,
                '❌ Не смог разобрать состав.\n\n' +
                'Нужно минимум 6 строк в формате:\n' +
                '`1. Анна — Дон`\n' +
                '`2. Олег — Шериф`\n' +
                '`3. Катя — Мирный`',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        const draftInfo = ozhidanie_registracii[tg_id];
        const { data: klub } = await supabase
            .from('kluby')
            .select('id, nazvaniye, nastroyki, sportivniy_rezhim')
            .eq('id', draftInfo.klub_id)
            .single();
        const igra = {
            klub_id: draftInfo.klub_id,
            klub_nazvaniye: klub?.nazvaniye || null,
            tip_kluba: klub?.nastroyki?.tip_kluba || 'paskal',
            sportivniy: !!klub?.sportivniy_rezhim,
            _nastroyki: klub?.nastroyki || {},
            data_igry: draftInfo.data_igry,
            nomer_igry: draftInfo.nomer_igry,
            igroki: parsed,
            avto_bonusy: [],
            luchshie_hody: []
        };
        for (const igrok of igra.igroki) await privyazatIgrokaIzBazy(igra, igrok);
        ruchnyeRezultaty[tg_id] = { igra };
        ozhidanie_registracii[tg_id].shag = 'manual_result_survivors';
        bot.sendMessage(chatId,
            '✅ Состав принят: *' + parsed.length + '* игроков.\n\n' +
            'Кто *выжил* к концу игры?\n\n' +
            'Отправь номера или ники через запятую. Например: `1, 4, 7, Анна`\n' +
            'Если выжили все — напиши `все`.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_survivors') {
        const draft = ruchnyeRezultaty[tg_id];
        if (!draft?.igra) {
            delete ozhidanie_registracii[tg_id];
            bot.sendMessage(chatId, '❌ Черновик результата не найден. Начни заново.');
            return;
        }
        const vvod = text.toLowerCase();
        if (['все', 'all', '+'].includes(vvod)) {
            draft.igra.igroki.forEach(i => { i.status = 'v_igre'; });
        } else {
            const survivors = razobratSpisokNikov(text);
            const nums = new Set();
            survivors.forEach(item => {
                const found = naytiIgrokaPoVvodu(draft.igra, item);
                if (found) nums.add(found.nomer);
            });
            if (nums.size === 0) {
                bot.sendMessage(chatId, '❌ Не нашёл выживших по этому списку. Отправь номера/ники через запятую или `все`.', { parse_mode: 'Markdown' });
                return;
            }
            draft.igra.igroki.forEach(i => { i.status = nums.has(i.nomer) ? 'v_igre' : 'vybyl'; });
        }
        ozhidanie_registracii[tg_id].shag = 'manual_result_tech';
        bot.sendMessage(chatId,
            '⚙️ Кто ушёл *тех. трупом*?\n\n' +
            'По умолчанию это штраф *-2* балла, но для каждого клуба значение можно менять в настройках баллов.\n\n' +
            'Отправь номера/ники через запятую или напиши `нет`.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_tech') {
        const draft = ruchnyeRezultaty[tg_id];
        if (!draft?.igra) {
            delete ozhidanie_registracii[tg_id];
            bot.sendMessage(chatId, '❌ Черновик результата не найден. Начни заново.');
            return;
        }
        const vvod = text.toLowerCase();
        if (!['нет', '0', '-', 'no'].includes(vvod)) {
            const items = razobratSpisokNikov(text);
            let foundCount = 0;
            items.forEach(item => {
                const found = naytiIgrokaPoVvodu(draft.igra, item);
                if (found) {
                    found.teh_trup = true;
                    found.status = 'vybyl';
                    foundCount += 1;
                }
            });
            if (foundCount === 0) {
                bot.sendMessage(chatId, '❌ Не нашёл игроков. Отправь номера/ники через запятую или `нет`.', { parse_mode: 'Markdown' });
                return;
            }
        }
        ozhidanie_registracii[tg_id].shag = 'manual_result_first_vote';
        bot.sendMessage(chatId,
            '🗳 Кого *первым выголосовали*?\n\n' +
            'По умолчанию такому игроку добавляется *+0.25* — как в клубной таблице.\n' +
            'Если в этом клубе правило другое, оно берётся из настроек баллов.\n\n' +
            'Отправь номер/ник или напиши `нет`.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'manual_result_first_vote') {
        const draft = ruchnyeRezultaty[tg_id];
        if (!draft?.igra) {
            delete ozhidanie_registracii[tg_id];
            bot.sendMessage(chatId, '❌ Черновик результата не найден. Начни заново.');
            return;
        }
        const vvod = text.toLowerCase();
        if (!['нет', '0', '-', 'no'].includes(vvod)) {
            const items = razobratSpisokNikov(text);
            const nums = [];
            items.forEach(item => {
                const found = naytiIgrokaPoVvodu(draft.igra, item);
                if (found && !nums.includes(found.nomer)) nums.push(found.nomer);
            });
            if (nums.length === 0) {
                bot.sendMessage(chatId, '❌ Не нашёл игрока. Отправь номер/ник или `нет`.', { parse_mode: 'Markdown' });
                return;
            }
            draft.igra.den1_vygolosovany = nums;
        }
        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId, '🏆 Кто победил?', {
            reply_markup: { inline_keyboard: [
                [{ text: '🟢 Мирные', callback_data: 'rez_manual_win_mirnye' }],
                [{ text: '🔴 Мафия', callback_data: 'rez_manual_win_mafiya' }],
                [{ text: '🎯 Маньяк', callback_data: 'rez_manual_win_manyak' }]
            ] }
        });
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('vecher_vvod_')) {
        const klub_id = sostoyanie[tg_id].replace('vecher_vvod_', '');
        const niki = razobratSpisokNikov(text);
        if (niki.length === 0) {
            bot.sendMessage(chatId, '❌ Отправь ники через запятую или каждый с новой строки.');
            return;
        }
        const igraTemp = { klub_id, igroki: [] };
        for (let i = 0; i < niki.length; i++) {
            const igrok = {
                telegram_id: null,
                name: niki[i],
                nomer: i + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null
            };
            await privyazatIgrokaIzBazy(igraTemp, igrok);
            igraTemp.igroki.push(igrok);
        }
        await sohranitSpisokVecheraKluba(klub_id, igraTemp.igroki);
        delete sostoyanie[tg_id];
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        const soobsh = await bot.sendMessage(chatId, '✅ Состав вечера сохранён: *' + niki.length + '* игроков.', { parse_mode: 'Markdown' });
        await pokazatIgrovoyVecher(chatId, soobsh.message_id, klub || { id: klub_id, nazvaniye: '' }, tg_id);
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('vecher_add_')) {
        const klub_id = sostoyanie[tg_id].replace('vecher_add_', '');
        const rez = await dobavitIgrokovVSpisokVechera(klub_id, text);
        if (!rez.ok) {
            bot.sendMessage(chatId, '❌ Отправь ники через запятую или каждый с новой строки.');
            return;
        }
        delete sostoyanie[tg_id];
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        const soobsh = await bot.sendMessage(chatId, '✅ Игроки добавлены. В составе вечера: *' + rez.count + '*.', { parse_mode: 'Markdown' });
        await pokazatIgrovoyVecher(chatId, soobsh.message_id, klub || { id: klub_id, nazvaniye: '' }, tg_id);
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('vecher_remove_')) {
        const klub_id = sostoyanie[tg_id].replace('vecher_remove_', '');
        const rez = await ubratIgrokovIzSpiskaVechera(klub_id, text);
        if (!rez.ok) {
            const msg = rez.error === 'not_found'
                ? '❌ Не нашёл таких игроков в составе вечера. Отправь номер или ник.'
                : '❌ Отправь номера/ники через запятую или каждый с новой строки.';
            bot.sendMessage(chatId, msg);
            return;
        }
        delete sostoyanie[tg_id];
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        const soobsh = await bot.sendMessage(chatId, '✅ Убрано: *' + rez.removed + '*. В составе вечера: *' + rez.count + '*.', { parse_mode: 'Markdown' });
        await pokazatIgrovoyVecher(chatId, soobsh.message_id, klub || { id: klub_id, nazvaniye: '' }, tg_id);
        return;
    }

    // Игнорируем команды
    if (text.startsWith('/')) return;

    // ===== ГОЛОСОВАНИЕ: ведущий вводит количество голосов =====
    if (sostoyanie[tg_id]?.startsWith('golos_count_')) {
        const parts_gc = sostoyanie[tg_id].replace('golos_count_', '').split('_');
        const kod_gc = parts_gc[0];
        const nomer_gc = parseInt(parts_gc[1], 10);
        const igra_gc = igry[kod_gc];
        if (!igra_gc) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const count = parseInt(text, 10);
        if (!Number.isFinite(count) || count < 0 || count > (igra_gc.igroki || []).length) {
            bot.sendMessage(chatId, '❌ Введи число голосов от 0 до ' + (igra_gc.igroki || []).length + '.');
            return;
        }
        igra_gc.golosa_dnya = igra_gc.golosa_dnya || {};
        igra_gc.golosa_dnya[nomer_gc] = count;
        delete sostoyanie[tg_id];
        await sohranit_igru(kod_gc);
        const igrok_gc = igra_gc.igroki.find(i => i.nomer === nomer_gc);
        await bot.sendMessage(chatId, '\u2705 За \u2116' + nomer_gc + ' ' + (igrok_gc?.name || '') + ': *' + count + '* голос(ов)', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra_gc, kod_gc) }
        });
        return;
    }

    // ===== ДЕНЬ: выставить на голосование по нику во время минуты игрока =====
    if (sostoyanie[tg_id]?.startsWith('vystav_golos_')) {
        const kod_vg = sostoyanie[tg_id].replace('vystav_golos_', '');
        const igra_vg = igry[kod_vg];
        if (!igra_vg) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const igrok_vg = naytiIgrokaPoVvodu(igra_vg, text);
        if (!igrok_vg) {
            bot.sendMessage(chatId,
                '❌ Игрок не найден.\n\n' + tekstVystavleniyaNaGolos(igra_vg),
                { parse_mode: 'Markdown', reply_markup: knopkiVystavleniyaNaGolos(igra_vg, kod_vg) }
            );
            return;
        }
        await vypolnitVystavlenieNaGolos(chatId, igra_vg, kod_vg, igrok_vg, tg_id);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: состав игроков списком (лобби / игровой вечер) =====
    if (sostoyanie[tg_id]?.startsWith('perviy_hod_')) {
        const kod_ph = sostoyanie[tg_id].replace('perviy_hod_', '');
        const igra_ph = igry[kod_ph];
        if (!igra_ph) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const faza_ph = igra_ph._zhdat_fazu || 'den';
        if (['авто', 'auto', 'случайно', 'рандом', 'random'].includes(text.toLowerCase())) {
            await ustanovitPervogoHodaAvto(chatId, null, kod_ph, faza_ph, tg_id);
            return;
        }
        const igrok_ph = naytiIgrokaPoVvodu(igra_ph, text);
        if (!igrok_ph || igrok_ph.status !== 'v_igre') {
            bot.sendMessage(chatId, '❌ Не нашёл такого игрока. Отправь *номер*, *ник* или `авто`.', { parse_mode: 'Markdown' });
            return;
        }
        await ustanovitPervogoHoda(chatId, null, kod_ph, igrok_ph.nomer, faza_ph, tg_id);
        return;
    }

    if (sostoyanie[tg_id]?.startsWith('lobby_spisok_')) {
        const kod_ls = sostoyanie[tg_id].replace('lobby_spisok_', '');
        const igra_ls = igry[kod_ls];
        if (!igra_ls) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        await vnestiSpisokIgrokovLobby(chatId, igra_ls, kod_ls, text);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ночь знакомства по ролям =====
    if (sostoyanie[tg_id]?.startsWith('noch_znakomstvo_')) {
        const parts_nz = sostoyanie[tg_id].replace('noch_znakomstvo_', '').split('_');
        const kod_nz = parts_nz[0];
        const idx_nz = parseInt(parts_nz[1], 10) || 0;
        const igra_nz = igry[kod_nz];
        if (!igra_nz) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена. Создай игру заново.');
            return;
        }

        const roles_nz = poryadokRoleyDlyaNochi(igra_nz);
        const rol_nz = roles_nz[idx_nz];
        if (!rol_nz) {
            await pokazatShagNochiZnakomstva(chatId, kod_nz, idx_nz);
            return;
        }

        let igrok_nz = naytiIgrokaPoVvodu(igra_nz, text);
        if (!igrok_nz) {
            if ((igra_nz.igroki || []).length >= igra_nz.kolichestvo) {
                bot.sendMessage(chatId,
                    '❌ Не нашёл такого игрока за столом.\n\n' +
                    'Отправь *номер места* или точный ник игрока. Например: `7`',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            igrok_nz = {
                telegram_id: null,
                name: text.trim(),
                nomer: (igra_nz.igroki || []).length + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null
            };
            igra_nz.igroki.push(igrok_nz);
        }

        if (igrok_nz.rol) {
            bot.sendMessage(chatId,
                '⚠️ У игрока №' + igrok_nz.nomer + ' ' + igrok_nz.name + ' уже стоит роль *' + igrok_nz.rol + '*.\n\n' +
                'Выбери другого игрока для роли *' + rol_nz + '* или открой панель и проверь состав.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        igrok_nz.rol = rol_nz;
        igrok_nz.status = 'v_igre';
        igrok_nz.foly = igrok_nz.foly || 0;
        await sohranit_igru(kod_nz);

        await bot.sendMessage(chatId, '\u2705 \u2116' + igrok_nz.nomer + ' ' + igrok_nz.name + ' — *' + rol_nz + '*', { parse_mode: 'Markdown' });
        await pokazatShagNochiZnakomstva(chatId, kod_nz, idx_nz + 1);
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ручной ввод мирных после ночи знакомства =====
    if (sostoyanie[tg_id]?.startsWith('noch_mirnye_')) {
        const kod_m = sostoyanie[tg_id].replace('noch_mirnye_', '');
        const igra_m = igry[kod_m];
        if (!igra_m) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена.');
            return;
        }
        const niki_m = razobratSpisokNikov(text);
        if (niki_m.length > 1) {
            await vnestiSpisokMirnyh(chatId, igra_m, kod_m, text);
        } else {
            await vnestiOdnogoMirnogo(chatId, igra_m, kod_m, text);
        }
        return;
    }

    // ===== ФИЗИЧЕСКИЕ КАРТЫ: ведущая вручную вносит игроков и роли =====
    const manualRolesKod = sostoyanie[tg_id]?.startsWith('manual_roles_')
        ? sostoyanie[tg_id].replace('manual_roles_', '')
        : naytiIgruDlyaRuchnyhRoley(tg_id, text);

    if (manualRolesKod) {
        const kod = manualRolesKod;
        const igra = igry[kod];
        if (!igra) {
            delete sostoyanie[tg_id];
            bot.sendMessage(chatId, '❌ Игра не найдена. Создай игру заново.');
            return;
        }

        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length !== igra.kolichestvo) {
            bot.sendMessage(chatId,
                '❌ Нужно ' + igra.kolichestvo + ' строк, по числу мест в игре.\n\n' +
                'Сейчас строк: ' + lines.length + '.\n\n' +
                'Пример:\n`1. Аня — Дон`\n`2. Оля — Мафия`\n`3. Катя — Мирный`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const parsed = [];
        const oshibki = [];
        lines.forEach((line, idx) => {
            const row = razobratStrokuRoli(line, idx);
            if (!row) oshibki.push((idx + 1) + '. ' + line);
            else parsed.push(row);
        });

        if (oshibki.length > 0) {
            bot.sendMessage(chatId,
                '❌ Не понял роль в строках:\n' + oshibki.join('\n') +
                '\n\nПиши так: `Имя — Роль`.\nРоль должна совпадать с названием в боте: Дон, Мафия, Шериф, Мирный и т.д.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        igra.igroki = parsed.map((row, idx) => ({
            telegram_id: null,
            name: row.name,
            nomer: idx + 1,
            rol: row.rol,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        }));
        const rezStart = await proveritStartPlatnoyIgry(igra, kod);
        if (!rezStart.ok) {
            await pokazatBlokStartaIgry(chatId, null, null, rezStart);
            return;
        }

        igra.rezhim_rolei = 'karty';
        igra.roli_razdany = true;
        igra.den = 1;
        delete sostoyanie[tg_id];
        await podgruzitImmunitetIgrokam(igra);
        await sohranit_igru(kod);

        let svodka = '\u2705 *Роли внесены вручную!*\n\n';
        if (rezStart.info) svodka += '\n_' + rezStart.info.replace(/\*/g, '') + '_\n';
        svodka += '\uD83C\uDFB4 Игра \u2116' + kod + '\n';
        svodka += '\uD83D\uDC65 Игроков: ' + igra.kolichestvo + '\n\n';
        svodka += tekstSpiskaPosleRoley(igra);

        bot.sendMessage(chatId, svodka, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }]
            ]}
        });
        return;
    }

    // ===== РЕГИСТРАЦИЯ: шаг 3 — игровой ник =====
    if (ozhidanie_registracii[tg_id]?.shag === 'soglasie') {
        bot.sendMessage(chatId, '📄 Сначала прими оферту и политику конфиденциальности — нажми /start');
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'igrovoy_nik') {
        if (!ozhidanie_registracii[tg_id].soglasie_prinyato) {
            bot.sendMessage(chatId, '📄 Сначала прими условия — нажми /start');
            return;
        }
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Игровой ник должен быть минимум 2 символа.');
            return;
        }
        const nik = text.trim();
        ozhidanie_registracii[tg_id].igrovoy_nik = nik;
        ozhidanie_registracii[tg_id].imya = nik;
        ozhidanie_registracii[tg_id].shag = 'telefon';

        bot.sendMessage(chatId,
            '✅ Ник сохранён: *' + nik + '*\n\n' +
            '📱 *Шаг 4 — телефон:* поделись номером — нажми кнопку ниже:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'klub_kod') {
        if (!ozhidanie_registracii[tg_id].soglasie_prinyato) {
            bot.sendMessage(chatId, '📄 Сначала прими условия — нажми /start');
            return;
        }
        await primenitKlubPoKoduRegistracii(chatId, tg_id, text);
        return;
    }

    // ===== РЕГИСТРАЦИЯ: поиск города текстом =====
    if (ozhidanie_registracii[tg_id]?.shag === 'gorod_poisk_reg') {
        const kod = ozhidanie_registracii[tg_id].gorod_kod;
        const strana = gorodaUi.stranaPoKodu(kod);
        const goroda = await zagruzitGorodaStrany(strana);
        const { knopki, found } = gorodaUi.postroитьKlavPoiska(goroda, text, 'reg');
        if (found.length === 0) {
            bot.sendMessage(chatId, '❌ Город не найден. Попробуй другую часть названия или выбери по букве алфавита.', {
                reply_markup: { inline_keyboard: [
                    [{ text: '🔤 По алфавиту', callback_data: 'rga_' + kod }],
                    [{ text: '⬅️ К странам', callback_data: 'reg_nazad_strana' }]
                ] }
            });
            return;
        }
        knopki.push([{ text: '🔤 По алфавиту', callback_data: 'rga_' + kod }]);
        bot.sendMessage(chatId, '📍 Найденные города (' + strana + '):', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    if (sostoyanie[tg_id] && String(sostoyanie[tg_id]).startsWith('gorod_poisk_sm_')) {
        const kod = sostoyanie[tg_id].replace('gorod_poisk_sm_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        const goroda = await zagruzitGorodaStrany(strana);
        const { knopki, found } = gorodaUi.postroитьKlavPoiska(goroda, text, 'sm');
        if (found.length === 0) {
            bot.sendMessage(chatId, '❌ Город не найден. Попробуй другую часть названия.', {
                reply_markup: { inline_keyboard: [[{ text: '🔤 По алфавиту', callback_data: 'sma_' + kod }]] }
            });
            return;
        }
        knopki.push([{ text: '🔤 По алфавиту', callback_data: 'sma_' + kod }]);
        delete sostoyanie[tg_id];
        bot.sendMessage(chatId, '📍 Найденные города (' + strana + '):', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    if (sostoyanie[tg_id] && String(sostoyanie[tg_id]).startsWith('gorod_poisk_vk_')) {
        const kod = sostoyanie[tg_id].replace('gorod_poisk_vk_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        const goroda = await zagruzitGorodaStrany(strana);
        const { knopki, found } = gorodaUi.postroитьKlavPoiska(goroda, text, 'vk');
        if (found.length === 0) {
            bot.sendMessage(chatId, '❌ Город не найден. Попробуй другую часть названия.', {
                reply_markup: { inline_keyboard: [[{ text: '🔤 По алфавиту', callback_data: 'vka_' + kod }]] }
            });
            return;
        }
        knopki.push([{ text: '🔤 По алфавиту', callback_data: 'vka_' + kod }]);
        delete sostoyanie[tg_id];
        bot.sendMessage(chatId, '📍 Найденные города (' + strana + '):', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }
    if (msg.contact && ozhidanie_registracii[tg_id]?.shag === 'telefon') {
        const telefon = msg.contact.phone_number;
        ozhidanie_registracii[tg_id].telefon = telefon;
        await bot.sendMessage(chatId, '✅ Номер сохранён', { reply_markup: { remove_keyboard: true } });
        await zavershitRegistraciyuInsert(chatId, tg_id, ozhidanie_registracii[tg_id], msg.from.username || '');
        return;
    }

    // ===== СОЗДАНИЕ КЛУБА: ввод названия =====
    if (ozhidanie_registracii[tg_id]?.shag === 'sozdat_klub_nazvanie') {
        const nazvaniye = text.trim();
        if (nazvaniye.length < 2) {
            bot.sendMessage(chatId, '❌ Название должно быть минимум 2 символа.');
            return;
        }

        const gorod_id = ozhidanie_registracii[tg_id].gorod_id || null;

        // Создаём клуб с gorod_id
        const insert_data = { nazvaniye, owner_tg_id: tg_id };
        if (gorod_id) insert_data.gorod_id = gorod_id;

        const { data: novyi_klub, error: klub_err } = await supabase
            .from('kluby')
            .insert(insert_data)
            .select()
            .single();

        if (klub_err) {
            console.error('Ошибка создания клуба:', klub_err);
            bot.sendMessage(chatId, '❌ Ошибка создания клуба. Попробуй ещё раз.');
            delete ozhidanie_registracii[tg_id];
            return;
        }

        // Находим самого игрока (собственника)
        const { data: igrok } = await supabase
            .from('igroki')
            .select('id')
            .eq('tg_id', tg_id)
            .single();

        if (igrok) {
            await supabase
                .from('chleny_klubov')
                .insert({ klub_id: novyi_klub.id, igrok_id: igrok.id, rol: 'vladyelets' });
        }

        await nachatTestovuyuNedelyuKluba(novyi_klub.id);
        await klubInvite.obespechitKodRegistraciiKluba(novyi_klub.id);

        ozhidanie_registracii[tg_id] = {
            shag: 'anketa_klub',
            klub_id: novyi_klub.id,
            nazvaniye_kluba: nazvaniye,
            anketa_shag: 0,
            otvety: {}
        };

        bot.sendMessage(chatId,
            `✅ *Клуб «${md(nazvaniye)}» создан!*\n\n` +
            '📋 Ответь на *9 коротких вопросов* — мы сохраним анкету и настроим бота под ваш формат.\n' +
            '_Можно пропустить — клуб уже работает._',
            { parse_mode: 'Markdown' }
        );
        bot.sendMessage(chatId, klubAnketa.tekstShaga(0, nazvaniye), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: klubAnketa.knopkiShaga(0) }
        });
        return;
    }

    if (ozhidanie_registracii[tg_id]?.shag === 'anketa_klub') {
        const d = ozhidanie_registracii[tg_id];
        const shag = d.anketa_shag ?? 0;
        const pole = klubAnketa.SHAGI[shag];
        if (pole && (pole.tip === 'text' || pole.tip === 'text_skip')) {
            if (pole.tip === 'text' && text.length < 2 && !/^пропуст/i.test(text)) {
                bot.sendMessage(chatId, '❌ Напиши ответ или «пропустить».');
                return;
            }
            if (!/^пропуст/i.test(text)) d.otvety[pole.key] = text.trim();
            d.anketa_shag = shag + 1;
            if (d.anketa_shag >= klubAnketa.SHAGI.length) {
                await zavershitAnketuKluba(chatId, tg_id, d);
                return;
            }
            bot.sendMessage(chatId, klubAnketa.tekstShaga(d.anketa_shag, d.nazvaniye_kluba), {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: klubAnketa.knopkiShaga(d.anketa_shag) }
            });
        }
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ АНОНСА: обновление полей =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('anons_upd_')) {
        const parts = sostoyanie[tg_id].replace('anons_upd_', '').split('_');
        const pole = parts[0]; // data, vremya, adres, komment
        const anons_id = parts.slice(1).join('_');
        delete sostoyanie[tg_id];

        const update = {};
        if (pole === 'data') {
            const dataIso = razobrat_datu_anonsa(text.trim());
            if (!dataIso) {
                bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *15.05.2026* или *15 мая*', { parse_mode: 'Markdown' });
                sostoyanie[tg_id] = 'anons_upd_data_' + anons_id;
                return;
            }
            update.data_igry = dataIso;
        }
        if (pole === 'vremya') update.vremya = text.trim();
        if (pole === 'adres') update.adres = text.trim();
        if (pole === 'komment') update.kommentariy = text.trim();

        const { error } = await supabase.from('anonsy').update(update).eq('id', anons_id);

        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка обновления. Попробуй ещё раз.');
            return;
        }

        const soobsh = await bot.sendMessage(chatId, '✅ Обновлено!');
        setTimeout(async () => {
            await pokazat_kartochku_anонса(chatId, soobsh.message_id, anons_id);
        }, 500);
        return;
    }

    // ===== АНОНС: ввод даты =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('anons_data_')) {
        const klub_id = sostoyanie[tg_id].replace('anons_data_', '');
        const dataIso = razobrat_datu_anonsa(text.trim());
        if (!dataIso) {
            bot.sendMessage(chatId, '❌ Не понял дату. Введи, например: *15.05.2026* или *15 мая*', { parse_mode: 'Markdown' });
            return;
        }
        delete sostoyanie[tg_id];
        ozhidanie_registracii[tg_id] = { shag: 'anons_vremya', klub_id, data_igry: dataIso };
        bot.sendMessage(chatId, '📢 *Создание анонса*\n\n*Дата:* ' + formatDataAnonsa(dataIso) + '\n\n🕐 Введи время игры:\n_Пример: 19:00_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    // ===== АНОНС: ввод времени =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_vremya') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.vremya = text.trim();
        dannye.shag = 'anons_adres';
        bot.sendMessage(chatId,
            '📢 *Создание анонса*\n\n*Дата:* ' + dannye.data_igry + '\n*Время:* ' + dannye.vremya + '\n\n📍 Введи место проведения:\n_Пример: Ресторан Паскаль, ул. Воровского 19, 2 этаж_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    // ===== АНОНС: ввод адреса =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_adres') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.adres = text.trim();
        dannye.shag = 'anons_komment';
        bot.sendMessage(chatId,
            '📢 *Создание анонса*\n\n*Дата:* ' + dannye.data_igry + '\n*Время:* ' + dannye.vremya + '\n*Адрес:* ' + dannye.adres + '\n\n💬 Добавь комментарий:\n_Пример: Играем 3 игры, стоимость 1000₽, дресс-код приветствуется_\n_Или нажми "Пропустить"_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '➡️ Пропустить', callback_data: 'anons_skip_komment' }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
        return;
    }

    // ===== АНОНС: ввод комментария =====
    if (ozhidanie_registracii[tg_id]?.shag === 'anons_komment') {
        const dannye = ozhidanie_registracii[tg_id];
        dannye.kommentariy = text.trim();
        delete ozhidanie_registracii[tg_id];
        await sohranit_anons(chatId, tg_id, dannye);
        return;
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: ввод названия =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('rol_nazvanie_')) {
        const klub_id = sostoyanie[tg_id].replace('rol_nazvanie_', '');
        const nazvanie = text.trim();
        if (nazvanie.length < 2) {
            bot.sendMessage(chatId, '❌ Название должно быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        // Сохраняем временно название и переходим к выбору стороны
        ozhidanie_registracii[tg_id] = { shag: 'rol_storona', klub_id, nazvanie };
        const soobsh = await bot.sendMessage(chatId, '🎭 *Создание роли*\n\n*Название:* ' + nazvanie + '\n\nВыбери сторону:', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👨‍👩‍👧 Мирные', callback_data: 'rol_st_mirnye' }],
                    [{ text: '🔫 Мафия', callback_data: 'rol_st_mafiya' }],
                    [{ text: '🎯 Сам за себя', callback_data: 'rol_st_solo' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + klub_id }]
                ]
            }
        });
        return;
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: ввод количества раз =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('rol_kolichestvo_')) {
        const klub_id = sostoyanie[tg_id].replace('rol_kolichestvo_', '');
        delete sostoyanie[tg_id];
        const dannye = ozhidanie_registracii[tg_id];
        if (!dannye || dannye.shag !== 'rol_kolichestvo') {
            bot.sendMessage(chatId, '❌ Ошибка. Начни заново.');
            return;
        }
        const kolichestvo = text.trim();
        const chislo = parseInt(kolichestvo);
        if (isNaN(chislo) || chislo < 1 || chislo > 99) {
            bot.sendMessage(chatId, '❌ Введи число от 1 до 99.');
            sostoyanie[tg_id] = 'rol_kolichestvo_' + klub_id;
            return;
        }
        dannye.kolichestvo_raz = chislo;
        dannye.shag = 'gotovo';
        await sohranit_rol(chatId, tg_id, klub_id, dannye);
        return;
    }


    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО: контакт =====
    if (msg.contact && klubIdIzSostoyaniyaNaznacha(tg_id)) {
        const klub_id = klubIdIzSostoyaniyaNaznacha(tg_id);
        const telefon = msg.contact.phone_number.replace(/\D/g, '');

        const { data: igroki } = await supabase
            .from('igroki')
            .select('id, imya, igrovoy_nik, tg_username, telefon')
            .ilike('telefon', '%' + telefon.slice(-10) + '%')
            .limit(3);

        if (!igroki || igroki.length === 0) {
            bot.sendMessage(chatId,
                '❌ Игрок с этим номером не найден в базе.\n\nВведи имя или @username:', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            sostoyanie[tg_id] = 'naznach_poisk_' + klub_id;
            return;
        }

        const knopki = igroki.map(i => [{
            text: formatIgrokDlyaPoiska(i),
            callback_data: 'ncfm_' + i.id
        }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

        bot.sendMessage(chatId, '✅ Нашёл! Выбери кого назначить ведущим:', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО: поиск по имени/телефону =====
    if (klubIdIzSostoyaniyaNaznacha(tg_id)) {
        const klub_id = klubIdIzSostoyaniyaNaznacha(tg_id);
        const query = text.trim();

        // Нормализуем если это телефон — берём последние 10 цифр
        const tolko_cifry = query.replace(/\D/g, '');
        const poisk_telefon = tolko_cifry.length >= 10 ? tolko_cifry.slice(-10) : null;

        let igroki;
        if (poisk_telefon) {
            const { data } = await supabase
                .from('igroki')
                .select('id, imya, igrovoy_nik, tg_username, telefon')
                .ilike('telefon', '%' + poisk_telefon + '%')
                .limit(5);
            igroki = data;
        } else {
            const { data } = await supabase
                .from('igroki')
                .select('id, imya, igrovoy_nik, tg_username, telefon')
                .or(`imya.ilike.%${query}%,igrovoy_nik.ilike.%${query}%,tg_username.ilike.%${query}%`)
                .limit(5);
            igroki = data;
        }

        if (!igroki || igroki.length === 0) {
            bot.sendMessage(chatId, '❌ Игрок не найден. Попробуй ещё раз:', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            sostoyanie[tg_id] = 'naznach_poisk_' + klub_id;
            return;
        }

        const knopki = igroki.map(i => [{
            text: formatIgrokDlyaPoiska(i),
            callback_data: 'ncfm_' + i.id
        }]);
        knopki.push([{ text: '🔍 Искать снова', callback_data: 'naznachit_v_klube_' + klub_id }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

        bot.sendMessage(chatId, '🔍 Найдено ' + igroki.length + ' игрок(ов).\n\nВыбери кого назначить ведущим:', {
            reply_markup: { inline_keyboard: knopki }
        });
        return;
    }

    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('baza_poisk_')) {
        const klub_id = sostoyanie[tg_id].replace('baza_poisk_', '');
        const zapros = text.trim();
        delete sostoyanie[tg_id];

        if (zapros.length < 1) {
            bot.sendMessage(chatId, '❌ Пустой запрос.');
            return;
        }

        // Сохраняем фильтр для пагинации
        sostoyanie['baza_filtr_' + tg_id] = zapros;

        // Отправляем новое сообщение и редактируем его результатом
        const soobsh = await bot.sendMessage(chatId, '🔍 Ищу...');
        await pokazat_bazu_igrokov(chatId, soobsh.message_id, klub_id, 0, zapros);
        return;
    }

    // ===== БОНУС: ввод очков =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('bonus_vvod_')) {
        const parts_bv = sostoyanie[tg_id].replace('bonus_vvod_', '').split('_');
        const kod_bv = parts_bv[0];
        const nomer_bv = parseInt(parts_bv[1]);
        delete sostoyanie[tg_id];

        const igra_bv = igry['archive_' + kod_bv];
        if (!igra_bv) { bot.sendMessage(chatId, '\u274C Игра не найдена'); return; }
        const igrok_bv = igra_bv.igroki.find(i => i.nomer === nomer_bv);
        if (!igrok_bv) return;

        const parts_input = text.trim().split(' ');
        const pts = parseInt(parts_input[0]);
        const reason = parts_input.slice(1).join(' ') || 'бонус';

        if (isNaN(pts) || pts < 0 || pts > 20) {
            bot.sendMessage(chatId, '\u274C Введи число от 0 до 20, затем причину');
            sostoyanie[tg_id] = 'bonus_vvod_' + kod_bv + '_' + nomer_bv;
            return;
        }

        igrok_bv.bonus_pts = pts;
        igrok_bv.bonus_text = reason;

        // Обновляем в БД
        if (igrok_bv.igrok_id && igra_bv.klub_id) {
            await supabase.from('bally')
                .update({ bally_lichnie: supabase.rpc ? undefined : pts, bally_vsego: supabase.rpc ? undefined : pts, bonus_info: { ruchnoy: { pts, text: reason } } })
                .eq('kod_igry', kod_bv)
                .eq('igrok_id', igrok_bv.igrok_id);
        }

        const soobsh_bv = await bot.sendMessage(chatId, '\u2705 Бонус +' + pts + ' (' + reason + ') для ' + igrok_bv.name);
        setTimeout(async () => {
            const igra_reload = igry['archive_' + kod_bv];
            if (!igra_reload) return;
            let t_bv = '\uD83C\uDF81 *Бонусы* — Игра \u2116' + kod_bv + '\n\n';
            igra_reload.igroki.forEach(i => {
                const b = i.bonus_pts ? ' +' + i.bonus_pts + ' (' + i.bonus_text + ')' : '';
                t_bv += '\u2116' + i.nomer + ' ' + i.name + ' [' + i.rol + ']' + b + '\n';
            });
            const kk = igra_reload.igroki.map(i => [{ text: '\uD83C\uDF81 \u2116' + i.nomer + ' ' + i.name + (i.bonus_pts ? ' +' + i.bonus_pts : ''), callback_data: 'bonus_igrok_' + kod_bv + '_' + i.nomer }]);
            kk.push([{ text: '\u2705 Готово', callback_data: 'bonusy_done_' + kod_bv }]);
            await bot.editMessageText(t_bv, { chat_id: chatId, message_id: soobsh_bv.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kk } });
        }, 500);
        return;
    }

    // ===== ИЗМЕНИТЬ БАЛЛЫ КЛУБА (JSON) =====
    if (sostoyanie[tg_id] && sostoyanie[tg_id].startsWith('edit_bally_json_')) {
        const klub_id_bj = sostoyanie[tg_id].replace('edit_bally_json_', '');
        delete sostoyanie[tg_id];
        try {
            const new_bally = JSON.parse(text.trim());
            const { data: k_bj } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id_bj).single();
            const nastroyki_bj = k_bj?.nastroyki || {};
            nastroyki_bj.bally = { ...(nastroyki_bj.bally || BALLY_DEFAULT), ...new_bally };
            await supabase.from('kluby').update({ nastroyki: nastroyki_bj }).eq('id', klub_id_bj);
            bot.sendMessage(chatId, '\u2705 Баллы обновлены!');
        } catch(e) {
            bot.sendMessage(chatId, '\u274C Неверный JSON. Попробуй ещё раз.\n\nПример: `{"pobeda_komanda":3,"vyzhil":1}`', { parse_mode: 'Markdown' });
        }
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ ИМЕНИ =====
    if (sostoyanie[tg_id] === 'edit_imya') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Имя должно быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        const { error } = await supabase
            .from('igroki').update({ imya: text.trim() }).eq('tg_id', tg_id);
        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
            return;
        }
        const soobsh = await bot.sendMessage(chatId, '✅ Имя обновлено: *' + text.trim() + '*', { parse_mode: 'Markdown' });
        setTimeout(async () => {
            await bot.editMessageText(
                '⚙️ *Настройки*\n\nВыбери что изменить:',
                { chat_id: chatId, message_id: soobsh.message_id, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                    [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                    [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                  ]}
                }
            );
        }, 800);
        return;
    }

    // ===== РЕДАКТИРОВАНИЕ ИГРОВОГО НИКА =====
    if (sostoyanie[tg_id] === 'edit_nik') {
        if (text.length < 2) {
            bot.sendMessage(chatId, '❌ Ник должен быть минимум 2 символа.');
            return;
        }
        delete sostoyanie[tg_id];
        const { error } = await supabase
            .from('igroki').update({ igrovoy_nik: text.trim() }).eq('tg_id', tg_id);
        if (error) {
            bot.sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
            return;
        }
        const soobsh = await bot.sendMessage(chatId, '✅ Игровой ник обновлён: *' + text.trim() + '*', { parse_mode: 'Markdown' });
        setTimeout(async () => {
            await bot.editMessageText(
                '⚙️ *Настройки*\n\nВыбери что изменить:',
                { chat_id: chatId, message_id: soobsh.message_id, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                    [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                    [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                  ]}
                }
            );
        }, 800);
        return;
    }

    // ===== ДЕНЬ РОЖДЕНИЯ (регистрация) =====
    if (ozhidanie_registracii[tg_id]?.shag === 'den_rozhdeniya') {
        const parsed = razobratDenRozhdeniya(text);
        if (parsed?.error) {
            bot.sendMessage(chatId, '❌ Неверный формат. Напиши *ДД.ММ* или нажми «Пропустить».', { parse_mode: 'Markdown' });
            return;
        }
        if (parsed?.iso) {
            await supabase.from('igroki').update({ den_rozhdeniya: parsed.iso }).eq('tg_id', tg_id);
        }
        const pendingAnons = ozhidanie_registracii[tg_id]?.pending_anons_id;
        delete ozhidanie_registracii[tg_id];
        bot.sendMessage(chatId, '✅ Спасибо! Добро пожаловать в Prime Mafia.');
        bot.sendMessage(chatId, tekstInstrukciiPosleRegistracii(), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📖 Полная инструкция', callback_data: 'pomoshch' }],
                [{ text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' }],
                [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
                [{ text: '🎴 Меню игрока', callback_data: 'menu_igroka' }]
            ] }
        });
        if (pendingAnons) await pokazatKartochkuAnonsaPoSsylke(chatId, tg_id, pendingAnons);
        return;
    }

    // ===== ДЕНЬ РОЖДЕНИЯ (настройки) =====
    if (sostoyanie[tg_id] === 'edit_den_rozhdeniya') {
        const parsed = razobratDenRozhdeniya(text);
        if (parsed?.error) {
            bot.sendMessage(chatId, '❌ Неверный формат. Пример: 15.03 или 15.03.1995');
            return;
        }
        delete sostoyanie[tg_id];
        const iso = parsed?.iso || null;
        await supabase.from('igroki').update({ den_rozhdeniya: iso }).eq('tg_id', tg_id);
        bot.sendMessage(chatId, iso
            ? '✅ День рождения сохранён: *' + formatDenRozhdeniya(iso) + '*'
            : '✅ День рождения удалён из профиля.', { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '⬅️ В настройки', callback_data: 'nastroyki_igroka' }]] } });
        return;
    }

    // ===== ВВОД КОДА ИГРЫ =====
    if (sostoyanie[tg_id] === 'vvodit_kod') {
        const kod = text;

        if (!/^\d{4}$/.test(kod)) {
            bot.sendMessage(chatId, '❌ Код должен быть из 4 цифр. Попробуй ещё раз.');
            return;
        }

        const igra = igry[kod];
        if (!igra) {
            bot.sendMessage(chatId, '❌ Игра с кодом *' + kod + '* не найдена.\n\nПроверь код у ведущего.', {
                parse_mode: 'Markdown'
            });
            return;
        }

        if (igra.roli_razdany) {
            bot.sendMessage(chatId, '⚠️ Эта игра уже началась. Подожди следующую.');
            delete sostoyanie[tg_id];
            return;
        }

        const uzhe_v_igre = igra.igroki.find(i => i.telegram_id === tg_id);
        if (uzhe_v_igre) {
            bot.sendMessage(chatId, '⚠️ Ты уже в этой игре. Жди раздачи ролей.');
            delete sostoyanie[tg_id];
            return;
        }

        if (igra.igroki.length >= igra.kolichestvo) {
            bot.sendMessage(chatId, '❌ В этой игре уже все места заняты.');
            delete sostoyanie[tg_id];
            return;
        }

        const { data: igrok_vhod } = await supabase
            .from('igroki')
            .select('id, imya, igrovoy_nik')
            .eq('tg_id', tg_id)
            .single();
        const nomer = igra.igroki.length + 1;
        const name = igrok_vhod?.igrovoy_nik || igrok_vhod?.imya || msg.from.first_name || 'Игрок ' + nomer;

        igra.igroki.push({ telegram_id: tg_id, name: name, nomer: nomer, status: 'v_igre', foly: 0, igrok_id: igrok_vhod?.id || null });
        if (igra.klub_id && igrok_vhod?.id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, igrok_vhod.id);
        delete sostoyanie[tg_id];
        await sohranit_igru(kod);

        bot.sendMessage(chatId,
            '✅ *Ты подключён к игре!*\n\n' +
            '🎴 Игра №' + kod + '\n' +
            '👤 Твой номер: *' + nomer + '*\n' +
            '👥 Подключено: ' + igra.igroki.length + '/' + igra.kolichestvo + '\n\n' +
            '_Жди когда ведущий раздаст роли..._',
            { parse_mode: 'Markdown' }
        );

        bot.sendMessage(igra.vedushchii_id,
            '👤 *Игрок подключился*\n\n' +
            '№' + nomer + ' — ' + name + '\n' +
            '👥 Подключено: *' + igra.igroki.length + '/' + igra.kolichestvo + '*',
            { parse_mode: 'Markdown' }
        );

        if (igra.igroki.length === igra.kolichestvo) {
            const knopkaStarta = igra.rezhim_rolei === 'karty'
                ? { text: '\u25B6\uFE0F Начать игру', callback_data: 'nachat_igru_' + kod }
                : { text: '🎴 Раздать роли', callback_data: 'razdat_' + kod };
            bot.sendMessage(igra.vedushchii_id,
                '🎉 *Все игроки в сборе!*\n\nМожно начинать.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[knopkaStarta]]
                    }
                }
            );
        }
    }
});


// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ — ТАЙМЕР И ФАЗЫ
// ============================================

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m > 0 ? m + ':' : '') + (s < 10 ? '0' : '') + s;
}

function stopTimer(kod) {
    const igra = igry[kod];
    if (!igra) return;
    igra.taymer_aktiven = false;
    if (igra._interval) { clearInterval(igra._interval); igra._interval = null; }
}

function obnovitPanelTaymera(kod) {
    const igra = igry[kod];
    if (!igra || !igra._taymer_chat_id || !igra._taymer_message_id) return;
    bot.editMessageText(buildPanelText(igra, kod), {
        chat_id: igra._taymer_chat_id,
        message_id: igra._taymer_message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
    }).catch(() => {});
}

function zapustitTaymer(chatId, messageId, kod, sekundy) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra.taymer_sekundy = sekundy;
    igra.taymer_aktiven = true;
    igra._taymer_chat_id = chatId;
    igra._taymer_message_id = messageId;

    obnovitPanelTaymera(kod);

    igra._interval = setInterval(() => {
        const ig = igry[kod];
        if (!ig || !ig.taymer_aktiven) {
            if (ig?._interval) { clearInterval(ig._interval); ig._interval = null; }
            return;
        }
        ig.taymer_sekundy--;
        obnovitPanelTaymera(kod);
        if (ig.taymer_sekundy <= 0) {
            stopTimer(kod);
            sleduyushchiy(ig._taymer_chat_id, ig._taymer_message_id, kod);
        }
    }, 1000);
}

function estDostupKIgre(igra, telegram_id) {
    return !!igra && (!igra.vedushchii_id || igra.vedushchii_id === telegram_id);
}

async function poluchitVedushchihKluba(klub_id) {
    if (!klub_id) return [];
    const { data: klub } = await supabase.from('kluby').select('owner_tg_id').eq('id', klub_id).maybeSingle();
    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('rol, igroki(id, tg_id, imya, igrovoy_nik, tg_username)')
        .eq('klub_id', klub_id)
        .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

    const hosts = [];
    const seen = new Set();
    for (const c of chleny || []) {
        const ig = c.igroki;
        if (!ig?.tg_id || seen.has(ig.tg_id)) continue;
        seen.add(ig.tg_id);
        hosts.push({
            tg_id: ig.tg_id,
            igrok_id: ig.id,
            name: ig.igrovoy_nik || ig.imya || 'Ведущий',
            rol: c.rol
        });
    }
    if (klub?.owner_tg_id && !seen.has(klub.owner_tg_id)) {
        const { data: ownerIgrok } = await supabase
            .from('igroki')
            .select('id, tg_id, imya, igrovoy_nik')
            .eq('tg_id', klub.owner_tg_id)
            .maybeSingle();
        if (ownerIgrok?.tg_id) {
            hosts.push({
                tg_id: ownerIgrok.tg_id,
                igrok_id: ownerIgrok.id,
                name: ownerIgrok.igrovoy_nik || ownerIgrok.imya || 'Собственник',
                rol: 'vladyelets'
            });
        }
    }
    return hosts;
}

async function poluchitAlternativnyhVedushchih(klub_id, tekushchiy_tg_id) {
    const vse = await poluchitVedushchihKluba(klub_id);
    return vse.filter(h => h.tg_id && h.tg_id !== tekushchiy_tg_id);
}

async function obnovitDostupnostSmenyVedushchego(igra, telegram_id) {
    if (!igra?.klub_id || igra.vedushchii_id !== telegram_id) {
        igra._smena_ved_dostupna = false;
        return false;
    }
    const alts = await poluchitAlternativnyhVedushchih(igra.klub_id, telegram_id);
    igra._smena_ved_dostupna = alts.length > 0;
    return igra._smena_ved_dostupna;
}

async function smenitVedushchegoIgry(kod, old_tg_id, new_tg_id) {
    const igra = igry[kod];
    if (!igra || igra.vedushchii_id !== old_tg_id) return { ok: false, error: 'access' };
    if (!igra.klub_id) return { ok: false, error: 'no_club' };

    const alts = await poluchitAlternativnyhVedushchih(igra.klub_id, old_tg_id);
    const novyi = alts.find(h => h.tg_id === new_tg_id);
    if (!novyi) return { ok: false, error: 'not_host' };

    stopTimer(kod);
    if (sostoyanie[old_tg_id] && String(sostoyanie[old_tg_id]).includes(kod)) delete sostoyanie[old_tg_id];

    igra.vedushchii_id = new_tg_id;
    delete igra._taymer_chat_id;
    delete igra._taymer_message_id;
    delete igra._smena_ved_dostupna;
    await sohranit_igru(kod);

    const faza_names = { ozhidanie: 'ожидание', znakomstvo: 'знакомство', den: 'день', noch: 'ночь', golosovanie: 'голосование', opravdanie: 'оправдание' };
    const fazaTxt = faza_names[igra.faza] || igra.faza || '';

    bot.sendMessage(new_tg_id,
        '🎤 *Тебе передали игру №' + kod + '*\n\n' +
        (nazvanieKlubaIgry(igra) ? '🎴 ' + md(nazvanieKlubaIgry(igra)) + '\n' : '') +
        (fazaTxt ? 'Фаза: *' + fazaTxt + '*\n\n' : '\n') +
        'Открой панель — управление теперь у тебя.',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }]] }
        }
    ).catch(() => {});

    bot.sendMessage(old_tg_id,
        '✅ *Ведущий сменён*\n\nИгра №' + kod + ' передана *' + md(novyi.name) + '*. Таймер остановлен — новый ведущий продолжит.',
        { parse_mode: 'Markdown' }
    ).catch(() => {});

    return { ok: true, novyi };
}

async function ostanovitIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };

    stopTimer(kod);
    const v = igra.vedushchii_id;
    if (v && sostoyanie[v] && String(sostoyanie[v]).includes(kod)) delete sostoyanie[v];
    igra.ostanovlena = true;
    await sohranit_igru(kod);

    for (const igrok of igra.igroki || []) {
        if (igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '⏸ *Игра №' + kod + ' остановлена ведущим.*\n\n_Ведущий сможет возобновить её позже._',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
    }
    return { ok: true };
}

async function vozobnovitIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };
    igra.ostanovlena = false;
    await sohranit_igru(kod);
    return { ok: true };
}

async function udalitAktivnuyuIgru(kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return { ok: false, error: 'not_found' };
    if (!estDostupKIgre(igra, telegram_id)) return { ok: false, error: 'access' };
    stopTimer(kod);
    const v = igra.vedushchii_id;
    if (v && sostoyanie[v] && String(sostoyanie[v]).includes(kod)) delete sostoyanie[v];
    for (const igrok of igra.igroki || []) {
        if (igrok.telegram_id) bot.sendMessage(igrok.telegram_id, '🗑 Игра №' + kod + ' удалена ведущим.').catch(() => {});
    }
    delete igry[kod];
    try {
        await supabase.from('aktivnye_igry').delete().eq('kod', kod);
    } catch (e) {
        console.error('[delete_igra] db:', e?.message);
        return { ok: false, error: 'db' };
    }
    return { ok: true };
}

function knopkiUpravleniyaIgroi(kod) {
    const igra = igry[kod];
    const knopki = [];
    if (igra?.ostanovlena) {
        knopki.push([{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }]);
    } else {
        knopki.push([{ text: '⏸ Остановить игру', callback_data: 'stop_igra_' + kod }]);
    }
    knopki.push([{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }]);
    return knopki;
}

async function udalitIgruIzIstorii(kod, telegram_id) {
    const { data: row } = await supabase
        .from('aktivnye_igry')
        .select('kod, klub_id, vedushchii_tg_id')
        .eq('kod', kod)
        .eq('zavershena', true)
        .single();
    if (!row) return { ok: false, error: 'not_found' };
    if (row.vedushchii_tg_id !== telegram_id) {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (!row.klub_id || !kluby.some(k => k.id === row.klub_id)) return { ok: false, error: 'access' };
    }
    const { error } = await supabase.from('aktivnye_igry').delete().eq('kod', kod).eq('zavershena', true);
    if (error) return { ok: false, error: 'db' };
    return { ok: true };
}

function vseRoliDostupnye() {
    return Object.keys(roli_opisaniya);
}

function razobratStrokuRoli(line, index) {
    const bezNomera = String(line || '')
        .trim()
        .replace(/^\d+[\).\-\s]*/, '')
        .trim();

    const roli = vseRoliDostupnye().sort((a, b) => b.length - a.length);
    const lower = bezNomera.toLowerCase();

    for (const rol of roli) {
        const rolLower = rol.toLowerCase();
        if (lower === rolLower) {
            return { name: 'Игрок ' + (index + 1), rol: rol === 'Путана' ? 'Эскортница' : rol };
        }
        if (lower.endsWith(rolLower)) {
            const name = bezNomera.slice(0, bezNomera.length - rol.length)
                .replace(/[—–\-:|,]+$/g, '')
                .trim();
            if (name) return { name, rol: rol === 'Путана' ? 'Эскортница' : rol };
        }
    }

    return null;
}

const PORYADOK_ROLEY_NOCHI = [
    'Дон', 'Эскортница', 'Мафия', 'Консильери', 'Подрывник мафии',
    'Шериф', 'Комиссар', 'Детектив', 'Маньяк', 'Доктор', 'Стрелок', 'Охотник',
    'Камикадзе', 'Шахид', 'Бессмертный', 'Затычка', 'Любовница', 'Ведьма',
    'Бомба', 'Безликий', 'Адвокат', 'Мстительный родственник'
];

function poluchitSostavDlyaIgry(igra) {
    return [...(igra?._sostav_custom || poluchit_sostav(igra?.kolichestvo, igra?.tip_kluba || 'paskal') || [])]
        .map(rol => rol === 'Путана' ? 'Эскортница' : rol);
}

function poryadokRoleyDlyaNochi(igra) {
    const sostav = poluchitSostavDlyaIgry(igra).filter(rol => rol !== 'Мирный');
    return sostav.sort((a, b) => {
        const ia = PORYADOK_ROLEY_NOCHI.indexOf(a);
        const ib = PORYADOK_ROLEY_NOCHI.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
}

function naytiIgrokaPoVvodu(igra, text) {
    const vvod = String(text || '').trim().toLowerCase();
    const nomer = parseInt(vvod, 10);
    if (Number.isFinite(nomer)) {
        const poNomeru = igra.igroki.find(i => i.nomer === nomer);
        if (poNomeru) return poNomeru;
    }
    return igra.igroki.find(i =>
        String(i.name || '').toLowerCase() === vvod ||
        String(i.name || '').toLowerCase().includes(vvod)
    ) || null;
}

function tekstShagaNochiZnakomstva(igra, kod, idx) {
    const roles = poryadokRoleyDlyaNochi(igra);
    const rol = roles[idx];
    const vsego = roles.length;
    const takihDo = roles.slice(0, idx + 1).filter(r => r === rol).length;
    const takihVsego = roles.filter(r => r === rol).length;
    const label = (rol === 'Мафия' ? 'Запись мафии: ' : '') + rol + (takihVsego > 1 ? ' ' + takihDo + '/' + takihVsego : '');

    let t = '\uD83C\uDF19 *Ночь знакомства* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += 'Шаг *' + (idx + 1) + '/' + vsego + '*\n';
    t += 'Роль: *' + label + '*\n\n';
    t += 'Отправь номер или ник игрока, у которого эта роль.\n';
    t += '_Например: `7` или `Аня`_\n\n';
    t += 'Мирных жителей вводить на этом шаге не нужно — их добавим отдельно после всех активных ролей.';
    return t;
}

function mirnyePoSostavu(igra) {
    return poluchitSostavDlyaIgry(igra).filter(rol => rol === 'Мирный').length;
}

function mirnyeOstalosVnesti(igra) {
    const uzhe = (igra?.igroki || []).filter(i => i.rol === 'Мирный').length;
    return Math.max(0, mirnyePoSostavu(igra) - uzhe);
}

async function privyazatIgrokaIzBazy(igra, igrok) {
    if (!igrok || igrok.igrok_id) return igrok;
    const name = String(igrok.name || '').trim().toLowerCase();
    if (!name) return igrok;

    const sravnit = (i) => {
        if (!i) return false;
        const nick = String(i.igrovoy_nik || '').toLowerCase();
        const imya = String(i.imya || '').toLowerCase();
        const username = String(i.tg_username || '').toLowerCase();
        return nick === name || imya === name || username === name || ('@' + username) === name;
    };

    if (igra?.klub_id) {
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('igroki(id, tg_id, imya, igrovoy_nik, tg_username)')
            .eq('klub_id', igra.klub_id);
        const found = (chleny || []).map(c => c.igroki).find(sravnit);
        if (found) {
            igrok.igrok_id = found.id;
            igrok.telegram_id = igrok.telegram_id || found.tg_id || null;
            igrok.name = igrok.name || found.igrovoy_nik || found.imya || igrok.name;
            await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, found.id);
            return igrok;
        }
    }

    const { data: poNicku } = await supabase
        .from('igroki')
        .select('id, tg_id, imya, igrovoy_nik, tg_username')
        .or('igrovoy_nik.ilike.' + name + ',imya.ilike.' + name + ',tg_username.ilike.' + name)
        .limit(5);
    const foundGlobal = (poNicku || []).find(sravnit);
    if (foundGlobal) {
        igrok.igrok_id = foundGlobal.id;
        igrok.telegram_id = igrok.telegram_id || foundGlobal.tg_id || null;
        igrok.name = igrok.name || foundGlobal.igrovoy_nik || foundGlobal.imya || igrok.name;
        if (igra?.klub_id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, foundGlobal.id);
    }
    return igrok;
}

async function zavershitNochZnakomstva(chatId, kod, opts = {}) {
    const silent = !!opts.silent;
    const igra = igry[kod];
    if (!igra) return;
    if (!igra._slot_oplaty) {
        const rezStart = await proveritStartPlatnoyIgry(igra, kod);
        if (!rezStart.ok) {
            if (!silent && chatId) await pokazatBlokStartaIgry(chatId, null, null, rezStart);
            return { ok: false, message: rezStart.text || 'Игра не может быть начата' };
        }
    }
    igra.rezhim_rolei = 'karty';
    igra.roli_razdany = true;
    igra.den = 1;
    igra.igroki.forEach(i => {
        i.status = 'v_igre';
        i.foly = i.foly || 0;
        if (!i.rol) i.rol = 'Мирный';
    });
    delete igra._miniapp_intro;
    igra._pick_first_faza = 'znakomstvo';
    const mirnyeVsego = igra.igroki.filter(i => i.rol === 'Мирный').length;
    const sReytingom = igra.igroki.filter(i => i.igrok_id).length;
    delete sostoyanie[igra.vedushchii_id];
    if (igra.klub_id) await sohranitSpisokVecheraKluba(igra.klub_id, igra.igroki);
    await podgruzitImmunitetIgrokam(igra);
    await sohranit_igru(kod);

    if (!silent && chatId) {
        let t = '\u2705 *Ночь знакомства завершена!*\n\n';
        t += 'Активные роли и *' + mirnyeVsego + '* мирных внесены.\n';
        t += 'В рейтинг попадут: *' + sReytingom + '/' + igra.igroki.length + '* игроков.\n';
        t += '\n\n' + tekstSpiskaPosleRoley(igra);
        t += '\n\nНажми *«Кто начинает представление?»* — выберешь первого игрока, с которого пойдёт круг.';
        await bot.sendMessage(chatId, t, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }],
                [{ text: '\uD83C\uDFAE Панель игры', callback_data: 'panel_' + kod }]
            ] }
        });
    }
    return { ok: true, message: 'Ночь знакомства завершена. Выбери, кто начинает представление.' };
}

function razobratSpisokNikov(text) {
    return String(text || '')
        .split(/\n|[,;]+/)
        .map(s => s.trim().replace(/^\d+[\).\-\s]+/, '').trim())
        .filter(Boolean);
}

function tekstVvodaRuchnogoProtokola() {
    return '📋 *Ручное внесение результата*\n\n' +
        'Отправь состав игры списком: *ник — роль*.\n\n' +
        'Пример:\n' +
        '`1. Анна — Дон`\n' +
        '`2. Олег — Шериф`\n' +
        '`3. Катя — Мирный`\n\n' +
        '_Можно использовать дефис, тире, двоеточие или пробел перед названием роли._';
}

function razobratRuchnoyProtokol(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const parsed = lines.map((line, idx) => razobratStrokuRoli(line, idx));
    if (lines.length < 6 || parsed.some(row => !row)) return null;
    return parsed.map((row, idx) => ({
        telegram_id: null,
        name: row.name,
        nomer: idx + 1,
        rol: row.rol,
        status: 'vybyl',
        foly: 0,
        igrok_id: null
    }));
}

function ruchnyeBonusVoprosy(igra) {
    const voprosy = [];
    (igra.igroki || []).forEach(i => {
        if (i.rol === 'Дон') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_don_nashel_sherifa_n1', text: 'Дон нашёл Шерифа/Комиссара/Детектива в первую ночь?', bonusText: 'Дон нашёл Шерифа/Комиссара/Детектива в первую ночь' });
        } else if (isSheriffRole(i.rol)) {
            voprosy.push({ nomer: i.nomer, key: 'bonus_sheriff_nashel_maf', text: i.rol + ' нашёл мафию проверкой?', bonusText: i.rol + ' нашёл мафию проверкой' });
        } else if (i.rol === 'Доктор') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_doctor_spas', text: 'Доктор правильно спас игрока?', bonusText: 'Доктор правильно спас игрока' });
        } else if (i.rol === 'Эскортница' || i.rol === 'Путана') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_eskort_ugadala_rol', text: 'Эскортница/Путана угадала роль игрока?', bonusText: 'Эскортница/Путана угадала роль игрока' });
        } else if (i.rol === 'Бессмертный') {
            voprosy.push({ nomer: i.nomer, key: 'bonus_bessmertnyy_prinyal_vystrel', text: 'Бессмертный принял выстрел и остался в игре?', bonusText: 'Бессмертный принял выстрел' });
        } else if (rolStrelyayushchegoZaMirnyh(i.rol)) {
            voprosy.push({ nomer: i.nomer, key: 'bonus_pravilnyy_otstrel_mafii', text: i.rol + ' правильно отстрелил мафию?', bonusText: i.rol + ' правильно отстрелил мафию' });
        }
    });
    return voprosy;
}

function tekstVoprosaRuchnogoBonusa(draft) {
    const q = draft.bonus_voprosy[draft.bonus_idx];
    const igrok = draft.igra.igroki.find(i => i.nomer === q.nomer);
    const pts = BALLY_DEFAULT[q.key] ?? 0;
    return '🎁 *Бонусы по ролям*\n\n' +
        'Игрок: №' + igrok.nomer + ' *' + igrok.name + '* — ' + igrok.rol + '\n' +
        q.text + '\n\n' +
        'Если да, добавим *+' + pts + '* к личным баллам.';
}

function knopkiRuchnogoBonusa() {
    return {
        inline_keyboard: [
            [{ text: '✅ Да', callback_data: 'rez_bonus_yes' }, { text: '❌ Нет', callback_data: 'rez_bonus_no' }]
        ]
    };
}

function tekstItogaRuchnoyIgry(igra, kod) {
    const pobediteli = {
        mirnye: 'Мирные',
        mafiya: 'Мафия',
        manyak: 'Маньяк'
    };
    let t = '🏁 *Итог игры внесён*\n\n';
    if (nazvanieKlubaIgry(igra)) t += 'Клуб: *' + md(nazvanieKlubaIgry(igra)) + '*\n';
    if (igra.data_igry) t += 'Дата: *' + formatDataAnonsa(igra.data_igry) + '*\n';
    if (igra.nomer_igry) t += 'Игра вечера: *№' + igra.nomer_igry + '*\n';
    t += 'Код записи: *' + kod + '*\n';
    t += 'Победитель: *' + (pobediteli[igra.pobeditel] || igra.pobeditel || '-') + '*\n\n';
    t += '*Состав:*\n';
    (igra.igroki || []).forEach(i => {
        const em = i.teh_trup ? '⚙️' : (i.status === 'v_igre' ? '✅' : '💀');
        const tech = i.teh_trup ? ' (тех. труп)' : '';
        t += em + ' №' + i.nomer + ' ' + i.name + ' — ' + i.rol + tech + '\n';
    });
    const techPlayers = (igra.igroki || []).filter(i => i.teh_trup);
    if (techPlayers.length) {
        t += '\n⚙️ *Тех. трупы:* ' + techPlayers.map(i => '№' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    const firstVoted = (igra.den1_vygolosovany || [])
        .map(n => igra.igroki.find(i => i.nomer === n))
        .filter(Boolean);
    if (firstVoted.length) {
        t += '🗳 *Первым выголосовали:* ' + firstVoted.map(i => '№' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    if ((igra.avto_bonusy || []).length) {
        t += '\n*Бонусы:*\n';
        igra.avto_bonusy.forEach(b => {
            const i = igra.igroki.find(p => p.nomer === b.nomer);
            t += '🎁 №' + b.nomer + ' ' + (i?.name || '') + ': +' + b.pts + ' — ' + b.text + '\n';
        });
    }
    t += '\n🏆 Баллы записаны в рейтинг.';
    return t;
}

function knopkiPosleItogaIgry(kod, klub_id) {
    const rows = [
        [{ text: '📢 Отправить победу в чат клуба', callback_data: 'publish_gruppa_' + kod }],
        [{ text: '📣 Полный текст для публикации', callback_data: 'publish_itog_' + kod }]
    ];
    if (klub_id) {
        // кнопка чата уже в первой строке
    }
    rows.push(
        [{ text: '🎁 Добавить бонусы', callback_data: 'bonusy_' + kod }],
        [{ text: '🎲 Новая игра', callback_data: 'sozdat_igru' }],
        [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
    );
    return { inline_keyboard: rows };
}

function knopkiPosleRuchnogoItoga(kod, klub_id) {
    const rows = [
        [{ text: '📢 Отправить победу в чат клуба', callback_data: 'publish_gruppa_' + kod }],
        [{ text: '📣 Полный текст для публикации', callback_data: 'publish_itog_' + kod }]
    ];
    rows.push([{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]);
    return { inline_keyboard: rows };
}

function sohranitItogiArhiva(igra, kod) {
    const klub_nazvaniye = nazvanieKlubaIgry(igra);
    const chatText = publikaciya.tekstPobedyDlyaChata({ ...igra, klub_nazvaniye }, kod);
    const pubTextFull = publikaciya.tekstItogaDlyaPublikacii({ ...igra, klub_nazvaniye }, kod);
    return { chatText, pubTextFull };
}

async function maybeAvtoPublikovatItog(igra, kod) {
    if (!igra?.klub_id) return;
    const grp = await publikaciya.poluchitChatGruppyKluba(igra.klub_id);
    if (!grp?.auto || !grp.chat_id) return;
    const text = igra._chat_text || igra._final_text || publikaciya.tekstPobedyDlyaChata({
        ...igra,
        klub_nazvaniye: nazvanieKlubaIgry(igra)
    }, kod);
    await publikaciya.otpravitItogVGruppuKluba(bot, igra.klub_id, text);
}

async function sozdatRuchnuyuIgruIzDrafta(draft, telegram_id) {
    let kod = sgenerirovat_kod();
    while (igry[kod]) kod = sgenerirovat_kod();
    const igra = draft.igra;
    igra.vedushchii_id = telegram_id;
    igra.kolichestvo = igra.igroki.length;
    igra.roli_razdany = true;
    igra.rezhim_rolei = 'ruchnoy_rezultat';
    igra.faza = 'zavershena';
    igra.den = 1;
    igra._nastroyki = {
        ...(igra._nastroyki || {}),
        ruchnoy_rezultat: true,
        data_igry: igra.data_igry || null,
        nomer_igry: igra.nomer_igry || null
    };
    for (const igrok of igra.igroki) {
        await privyazatIgrokaIzBazy(igra, igrok);
    }
    igry[kod] = igra;
    await sohranit_igru(kod);
    return { kod, igra };
}

function tekstVvodaSpiskaMirnyh(igra, kod) {
    const nuzhno = mirnyeOstalosVnesti(igra);
    let t = '\uD83D\uDFE2 *Мирные жители* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n\n';
    t += 'Активные роли уже внесены.\n\n';
    t += 'Осталось мирных: *' + nuzhno + '*\n\n';
    t += 'Добавляй *по одному* — номер или ник:\n_`7` или `Аня`_\n\n';
    t += 'Или отправь *списком* — через запятую или каждый ник с новой строки:\n';
    t += '_`Аня, Оля, Катя`_\n\n';
    t += '_Если игрок есть в боте — привяжем к рейтингу автоматически._\n';
    const sRolyami = (igra.igroki || []).filter(i => i.rol && i.rol !== 'Мирный');
    const uzheMirnye = (igra.igroki || []).filter(i => i.rol === 'Мирный');
    if (sRolyami.length > 0) {
        t += '\nУже с ролями: ' + sRolyami.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    if (uzheMirnye.length > 0) {
        t += 'Уже мирные: ' + uzheMirnye.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    return t;
}

function knopkiMirnyhVvoda(igra, kod) {
    const knopki = [];
    const bezRoli = (igra.igroki || []).filter(i => i.status === 'v_igre' && !i.rol);
    bezRoli.forEach(i => {
        knopki.push([{ text: '\uD83D\uDFE2 \u2116' + i.nomer + ' ' + i.name + ' — мирный', callback_data: 'mirny_igrok_' + kod + '_' + i.nomer }]);
    });
    if (mirnyeOstalosVnesti(igra) > 0) {
        knopki.push([{ text: '\u270D\uFE0F Ввести мирных списком', callback_data: 'mirny_vvod_' + kod }]);
    }
    if (mirnyeOstalosVnesti(igra) <= 0) {
        knopki.push([{ text: '\u2705 Завершить ночь', callback_data: 'mirny_done_' + kod }]);
    }
    return { inline_keyboard: knopki };
}

async function dobavitMirnogoVIgru(chatId, igra, kod, igrok) {
    if (!igrok) return { ok: false, error: 'not_found' };
    if (igrok.rol && igrok.rol !== 'Мирный') {
        return { ok: false, error: 'has_role', rol: igrok.rol, igrok };
    }
    if (mirnyeOstalosVnesti(igra) <= 0) {
        return { ok: false, error: 'full' };
    }
    if (igrok.rol === 'Мирный') {
        return { ok: false, error: 'already', igrok };
    }

    igrok.rol = 'Мирный';
    igrok.status = 'v_igre';
    igrok.foly = igrok.foly || 0;
    await privyazatIgrokaIzBazy(igra, igrok);
    await sohranit_igru(kod);
    return { ok: true, igrok, ostalos: mirnyeOstalosVnesti(igra) };
}

async function soobshitMirnogoDobavlen(chatId, igra, kod, igrok, ostalos) {
    const reyting = igrok.igrok_id ? ' \u2705' : '';
    let t = '\u2705 \u2116' + igrok.nomer + ' ' + igrok.name + ' — *Мирный*' + reyting;
    if (ostalos > 0) t += '\n\nОсталось мирных: *' + ostalos + '*';
    await bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: knopkiMirnyhVvoda(igra, kod)
    });
}

async function vnestiOdnogoMirnogo(chatId, igra, kod, text) {
    if (mirnyeOstalosVnesti(igra) <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return true;
    }

    const vvod = String(text || '').trim();
    if (!vvod) {
        await bot.sendMessage(chatId, '\u274C Отправь номер или ник игрока.', { parse_mode: 'Markdown' });
        return false;
    }

    let igrok = naytiIgrokaPoVvodu(igra, vvod);
    if (!igrok) {
        if ((igra.igroki || []).length >= igra.kolichestvo) {
            await bot.sendMessage(chatId, '\u274C Все места заняты (' + igra.kolichestvo + '). Выбери игрока из состава.', { parse_mode: 'Markdown' });
            return false;
        }
        igrok = {
            telegram_id: null,
            name: vvod,
            nomer: igra.igroki.length + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        };
        igra.igroki.push(igrok);
    }

    const rez = await dobavitMirnogoVIgru(chatId, igra, kod, igrok);
    if (!rez.ok) {
        if (rez.error === 'has_role') {
            await bot.sendMessage(chatId, '\u26A0\uFE0F У \u2116' + rez.igrok.nomer + ' ' + rez.igrok.name + ' уже роль *' + rez.rol + '*', { parse_mode: 'Markdown' });
        } else if (rez.error === 'already') {
            await bot.sendMessage(chatId, '\u2116' + rez.igrok.nomer + ' ' + rez.igrok.name + ' уже *Мирный*', { parse_mode: 'Markdown' });
        }
        return false;
    }

    await soobshitMirnogoDobavlen(chatId, igra, kod, rez.igrok, rez.ostalos);
    if (rez.ostalos <= 0) await zavershitNochZnakomstva(chatId, kod);
    return true;
}

async function vnestiSpisokMirnyh(chatId, igra, kod, text) {
    const nuzhno = mirnyeOstalosVnesti(igra);
    const niki = razobratSpisokNikov(text);

    if (nuzhno <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return true;
    }

    if (niki.length !== nuzhno) {
        await bot.sendMessage(chatId,
            '\u274C Нужно *' + nuzhno + '* ников (мирных по составу), получено: ' + niki.length + '.\n\n' +
            'Отправь списком — каждый ник с новой строки.',
            { parse_mode: 'Markdown' }
        );
        return false;
    }

    const oshibki = [];
    for (const nick of niki) {
        let igrok = naytiIgrokaPoVvodu(igra, nick);
        if (igrok?.rol && igrok.rol !== 'Мирный') {
            oshibki.push(nick + ' (уже роль ' + igrok.rol + ')');
            continue;
        }
        if (!igrok) {
            if ((igra.igroki || []).length >= igra.kolichestvo) {
                oshibki.push(nick + ' (нет свободных мест)');
                continue;
            }
            igrok = {
                telegram_id: null,
                name: nick,
                nomer: igra.igroki.length + 1,
                status: 'v_igre',
                foly: 0,
                igrok_id: null,
                rol: 'Мирный'
            };
            igra.igroki.push(igrok);
        } else {
            igrok.rol = 'Мирный';
            igrok.status = 'v_igre';
            igrok.foly = igrok.foly || 0;
        }
        await privyazatIgrokaIzBazy(igra, igrok);
    }

    if (oshibki.length > 0) {
        await bot.sendMessage(chatId, '\u26A0\uFE0F Не удалось внести:\n' + oshibki.join('\n'));
        return false;
    }

    await sohranit_igru(kod);
    await zavershitNochZnakomstva(chatId, kod);
    return true;
}

async function nachatVvodMirnyhRuchnoy(chatId, kod) {
    const igra = igry[kod];
    if (!igra) return;

    const ostalos = mirnyeOstalosVnesti(igra);
    if (ostalos <= 0) {
        await zavershitNochZnakomstva(chatId, kod);
        return;
    }

    sostoyanie[igra.vedushchii_id] = 'noch_mirnye_' + kod;
    await sohranit_igru(kod);
    await bot.sendMessage(chatId, tekstVvodaSpiskaMirnyh(igra, kod), {
        parse_mode: 'Markdown',
        reply_markup: knopkiMirnyhVvoda(igra, kod)
    });
}

async function pokazatShagNochiZnakomstva(chatId, kod, idx) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);
    const roles = poryadokRoleyDlyaNochi(igra);
    if (idx >= roles.length) {
        await nachatVvodMirnyhRuchnoy(chatId, kod);
        return;
    }
    sostoyanie[igra.vedushchii_id] = 'noch_znakomstvo_' + kod + '_' + idx;
    await bot.sendMessage(chatId, tekstShagaNochiZnakomstva(igra, kod, idx), { parse_mode: 'Markdown' });
}

function poluchitResidentovIzNastroek(nastroyki) {
    return Array.isArray(nastroyki?.residenty) ? nastroyki.residenty : [];
}

async function poluchitResidentovKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    return poluchitResidentovIzNastroek(klub?.nastroyki || {});
}

async function ustanovitResidentaKluba(klub_id, igrok_id, dobavit) {
    const { data: klub, error } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    if (error) throw error;

    const nastroyki = klub?.nastroyki || {};
    const residenty = new Set(poluchitResidentovIzNastroek(nastroyki));
    if (dobavit) residenty.add(igrok_id);
    else residenty.delete(igrok_id);

    await supabase
        .from('kluby')
        .update({ nastroyki: { ...nastroyki, residenty: Array.from(residenty) } })
        .eq('id', klub_id);
}

async function dobavitChlenaKlubaEsliNuzhno(klub_id, igrok_id) {
    if (!klub_id || !igrok_id) return;
    const { data: sushch } = await supabase
        .from('chleny_klubov')
        .select('id')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .single();
    if (!sushch) {
        await supabase.from('chleny_klubov').insert({ klub_id, igrok_id, rol: 'igrok' });
    }
}

function dobavitIgrokaVIgru(igra, igrok) {
    if (!igra || !igrok) return { ok: false, reason: 'not_found' };
    if ((igra.igroki || []).some(i => i.igrok_id === igrok.id || (igrok.tg_id && i.telegram_id === igrok.tg_id))) {
        return { ok: false, reason: 'exists' };
    }
    if ((igra.igroki || []).length >= igra.kolichestvo) return { ok: false, reason: 'full' };

    const name = igrok.igrovoy_nik || igrok.imya || 'Игрок';
    const nomer = igra.igroki.length + 1;
    igra.igroki.push({
        telegram_id: igrok.tg_id || null,
        name,
        nomer,
        status: 'v_igre',
        foly: 0,
        igrok_id: igrok.id
    });
    return { ok: true, nomer, name };
}

function ubratIgrokaIzIgryPoId(igra, igrok_id) {
    if (!igra || !igrok_id || igra.roli_razdany) return false;
    const idx = (igra.igroki || []).findIndex(i => i.igrok_id === igrok_id);
    if (idx < 0) return false;
    igra.igroki.splice(idx, 1);
    igra.igroki.forEach((i, index) => { i.nomer = index + 1; });
    return true;
}

async function poluchitNastroykiVecheraKluba(klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    return klub?.nastroyki || {};
}

async function obnovitNastroykiVecheraKluba(klub_id, patch) {
    const nastroyki = await poluchitNastroykiVecheraKluba(klub_id);
    await supabase
        .from('kluby')
        .update({ nastroyki: { ...nastroyki, ...patch } })
        .eq('id', klub_id);
}

async function vecherKlubaZavershen(klub_id) {
    if (!klub_id) return false;
    const nastroyki = await poluchitNastroykiVecheraKluba(klub_id);
    return nastroyki.vecher_data === dataIgrovoegoVechera() && !!nastroyki.vecher_zavershen;
}

async function poluchitDannyeVecheraKluba(klub_id) {
    if (!klub_id) return { spisok: null, zavershen: false };
    const nastroyki = await poluchitNastroykiVecheraKluba(klub_id);
    const today = dataIgrovoegoVechera();
    const zavershen = nastroyki.vecher_data === today && !!nastroyki.vecher_zavershen;
    let spisok = null;
    try {
        const { data, error } = await supabase
            .from('igrovye_vechera')
            .select('sostav')
            .eq('klub_id', klub_id)
            .eq('data_igry', today)
            .single();
        if (!error && Array.isArray(data?.sostav) && data.sostav.length > 0) spisok = data.sostav;
    } catch (_) {}
    if (!spisok && nastroyki.vecher_data === today && Array.isArray(nastroyki.vecher_spisok)) {
        spisok = nastroyki.vecher_spisok;
    }
    return { spisok, zavershen };
}

async function poluchitSpisokVecheraKluba(klub_id) {
    if (!klub_id) return null;
    if (await vecherKlubaZavershen(klub_id)) return null;
    const data_igry = dataIgrovoegoVechera();
    try {
        const { data, error } = await supabase
            .from('igrovye_vechera')
            .select('sostav')
            .eq('klub_id', klub_id)
            .eq('data_igry', data_igry)
            .single();
        if (!error && Array.isArray(data?.sostav) && data.sostav.length > 0) return data.sostav;
    } catch (_) {}

    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    const nastroyki = klub?.nastroyki || {};
    if (nastroyki.vecher_data !== dataIgrovoegoVechera()) return null;
    const spisok = Array.isArray(nastroyki.vecher_spisok) ? nastroyki.vecher_spisok : null;
    if (!spisok || spisok.length === 0) return null;
    return spisok;
}

async function sohranitSpisokVecheraKluba(klub_id, igroki) {
    if (!klub_id || !Array.isArray(igroki)) return;
    const spisok = igroki.map(i => ({
        name: i.name,
        igrok_id: i.igrok_id || null,
        telegram_id: i.telegram_id || null
    }));
    try {
        const { error } = await supabase
            .from('igrovye_vechera')
            .upsert({
                klub_id,
                data_igry: dataIgrovoegoVechera(),
                sostav: spisok,
                istochnik: 'manual',
                updated_at: new Date().toISOString()
            }, { onConflict: 'klub_id,data_igry' });
        if (!error) {
            await obnovitNastroykiVecheraKluba(klub_id, {
                vecher_data: dataIgrovoegoVechera(),
                vecher_spisok: spisok,
                vecher_zavershen: false
            });
            return;
        }
        console.error('[igrovye_vechera] fallback to kluby.nastroyki:', error.message);
    } catch (e) {
        console.error('[igrovye_vechera] fallback:', e?.message);
    }

    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();
    const nastroyki = klub?.nastroyki || {};
    await supabase
        .from('kluby')
        .update({
            nastroyki: {
                ...nastroyki,
                vecher_data: dataIgrovoegoVechera(),
                vecher_spisok: spisok,
                vecher_zavershen: false
            }
        })
        .eq('id', klub_id);
}

async function zavershitIgrovoyVecherKluba(klub_id) {
    await obnovitNastroykiVecheraKluba(klub_id, {
        vecher_data: dataIgrovoegoVechera(),
        vecher_zavershen: true,
        vecher_zavershen_v: new Date().toISOString(),
        vecher_await_poe: true
    });
}

async function zagruzitGorodaStrany(strana) {
    const { data: goroda } = await supabase
        .from('goroda')
        .select('id, nazvaniye')
        .eq('strana', strana)
        .order('nazvaniye');
    return goroda || [];
}

function knopkiVyboraStranyReg() {
    return [
        [{ text: '🇷🇺 Россия', callback_data: 'reg_strana_Россия' }],
        [{ text: '🇧🇾 Беларусь', callback_data: 'reg_strana_Беларусь' }],
        [{ text: '🇰🇿 Казахстан', callback_data: 'reg_strana_Казахстан' }],
        [{ text: '🇺🇿 Узбекистан', callback_data: 'reg_strana_Узбекистан' }],
        [{ text: '🇰🇬 Кыргызстан', callback_data: 'reg_strana_Кыргызстан' }],
        [{ text: '🇦🇲 Армения', callback_data: 'reg_strana_Армения' }],
        [{ text: '🇬🇪 Грузия', callback_data: 'reg_strana_Грузия' }],
        [{ text: '🇦🇿 Азербайджан', callback_data: 'reg_strana_Азербайджан' }]
    ];
}

async function pokazatShagKodaKluba(chatId, messageId, gorod_name, dannye) {
    let text = '🎴 *Шаг 2 — клуб* — ' + md(gorod_name || '') + '\n\n';
    if (dannye?.klub_name) {
        text += '✅ Клуб уже выбран: *' + md(dannye.klub_name) + '*\n\n';
    } else {
        text += 'Клубы *не показываются* в открытом списке — это приватность клуба.\n\n' +
            '🔑 *Код от ведущего:* напиши его сообщением (например `AB12CD`).\n' +
            '_Или открой персональную ссылку-приглашение от клуба._\n\n';
    }
    text += '_Можно продолжить без клуба — войти в игру по коду от ведущего._';

    const knopki = [];
    if (dannye?.klub_id) {
        knopki.push([{ text: '✅ Продолжить с этим клубом', callback_data: 'reg_klub_gotov' }]);
    }
    knopki.push([{ text: '🎮 Пока без клуба', callback_data: 'reg_bez_kluba' }]);
    knopki.push([{ text: '⬅️ Другой город', callback_data: 'reg_nazad_strana' }]);

    const opts = {
        chat_id: chatId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    };
    if (messageId) await bot.editMessageText(text, { message_id: messageId, ...opts });
    else await bot.sendMessage(chatId, text, opts);
}

async function posleVyboraGorodaRegistracii(chatId, messageId, telegram_id, dannye) {
    if (dannye.klub_id && dannye.klub_name) {
        dannye.shag = 'igrovoy_nik';
        await bot.editMessageText(
            '✅ Город: *' + md(dannye.gorod_name || '') + '*\n' +
            '🎴 Клуб: *' + md(dannye.klub_name) + '*\n\n' +
            '🎭 *Шаг 3 — игровой ник:*\n' +
            'Как тебя будут видеть за столом?\n' +
            '_Например: Madame X, Доктор, Рыжая, Арчи_',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
        return;
    }
    dannye.shag = 'klub_kod';
    await pokazatShagKodaKluba(chatId, messageId, dannye.gorod_name, dannye);
}

async function primenitKlubPoKoduRegistracii(chatId, telegram_id, kod_raw, replyOpts = {}) {
    const kod = klubInvite.normalizovatKodRegistracii(kod_raw);
    if (kod.length < 4) {
        await bot.sendMessage(chatId, '❌ Код слишком короткий. Попроси код у ведущего клуба.');
        return false;
    }
    const klub = await klubInvite.poluchitKlubPoKoduRegistracii(kod);
    if (!klub) {
        await bot.sendMessage(chatId, '❌ Код не найден. Проверь написание или запроси новый код у ведущего.');
        return false;
    }
    const dannye = ozhidanie_registracii[telegram_id];
    if (!dannye || dannye.shag !== 'klub_kod') return false;
    dannye.klub_id = klub.id;
    dannye.klub_name = klub.nazvaniye;
    dannye.klub_kod = kod;
    dannye.shag = 'igrovoy_nik';
    await bot.sendMessage(chatId,
        '✅ Клуб: *' + md(klub.nazvaniye) + '*\n\n' +
        '🎭 *Шаг 3 — игровой ник:*\n' +
        'Как тебя будут видеть за столом?\n' +
        '_Например: Madame X, Доктор, Рыжая, Арчи_',
        { parse_mode: 'Markdown', ...replyOpts }
    );
    return true;
}

async function mozhnoSmotretPriglashenieKluba(telegram_id, klub_id) {
    const { data: klub } = await supabase.from('kluby').select('id, owner_tg_id').eq('id', klub_id).maybeSingle();
    if (!klub) return false;
    if (klub.owner_tg_id === telegram_id) return true;
    const { data: igrok } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).maybeSingle();
    if (!igrok?.id) return false;
    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('id')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok.id)
        .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii'])
        .maybeSingle();
    return !!chlen;
}

async function knopkaNazadPriglashenieKluba(telegram_id) {
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    return roles.isOwner ? 'menu_vladeltsa' : 'menu_more_vedushchego';
}

async function pokazatPriglashenieVKlub(chatId, messageId, klub_id, telegram_id) {
    if (!(await mozhnoSmotretPriglashenieKluba(telegram_id, klub_id))) {
        const opts = { chat_id: chatId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] } };
        const text = '❌ Нет доступа к приглашению этого клуба.';
        if (messageId) await bot.editMessageText(text, { message_id: messageId, ...opts });
        else await bot.sendMessage(chatId, text, opts);
        return;
    }
    const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, owner_tg_id').eq('id', klub_id).single();
    const kod = await klubInvite.obespechitKodRegistraciiKluba(klub_id);
    if (!kod) {
        await bot.sendMessage(chatId, '❌ Не удалось создать код приглашения. Попробуй позже.');
        return;
    }
    const url = await klubInvite.ssylkaRegistraciiVKlub(bot, kod);
    const text = klubInvite.tekstPriglasheniyaVKlub(klub.nazvaniye, kod, url);
    const isOwner = klub.owner_tg_id === telegram_id;
    const knopki = [
        [{ text: '📱 QR для регистрации', callback_data: 'klub_invite_qr_' + klub_id }],
        [{ text: '🔗 Отправить ссылку отдельно', callback_data: 'klub_invite_link_' + klub_id }]
    ];
    if (isOwner) knopki.push([{ text: '🔄 Новый код (старая ссылка перестанет работать)', callback_data: 'klub_invite_new_' + klub_id }]);
    knopki.push([{ text: '⬅️ Назад', callback_data: await knopkaNazadPriglashenieKluba(telegram_id) }]);

    const opts = { chat_id: chatId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } };
    if (messageId) await bot.editMessageText(text, { message_id: messageId, ...opts });
    else await bot.sendMessage(chatId, text, opts);
}

async function zavershitRegistraciyuInsert(chatId, telegram_id, dannye, tg_username) {
    const insertPayload = {
        tg_id: telegram_id,
        tg_username: tg_username || '',
        imya: dannye.imya || dannye.igrovoy_nik,
        igrovoy_nik: dannye.igrovoy_nik,
        telefon: dannye.telefon,
        gorod: dannye.gorod_name,
        gorod_id: dannye.gorod_id,
        soglasie_offerta: !!dannye.soglasie_prinyato,
        soglasie_versiya: dannye.soglasie_versiya || SOGLASIE_VERSIYA,
        soglasie_data: dannye.soglasie_data || new Date().toISOString()
    };

    let { data: novyi_igrok, error } = await supabase
        .from('igroki')
        .insert(insertPayload)
        .select()
        .single();

    if (error && /soglasie/i.test(error.message || '')) {
        delete insertPayload.soglasie_offerta;
        delete insertPayload.soglasie_versiya;
        delete insertPayload.soglasie_data;
        ({ data: novyi_igrok, error } = await supabase.from('igroki').insert(insertPayload).select().single());
    }

    if (error) {
        const dup = /duplicate|unique|already exists|23505/i.test(error.message || '');
        if (dup) {
            const { data: est } = await supabase.from('igroki').select('id, igrovoy_nik').eq('tg_id', telegram_id).maybeSingle();
            if (est) {
                delete ozhidanie_registracii[telegram_id];
                await bot.sendMessage(chatId,
                    '✅ *Ты уже зарегистрирован!*\n\n🎭 ' + (est.igrovoy_nik || dannye.igrovoy_nik || 'Игрок') + '\n\nНапиши /start — откроется меню.',
                    { parse_mode: 'Markdown' }
                );
                return { ok: true, already: true };
            }
        }
        delete ozhidanie_registracii[telegram_id];
        console.error('Ошибка регистрации:', error);
        await bot.sendMessage(chatId, '❌ Ошибка регистрации. Напиши /start и попробуй снова.');
        return { ok: false };
    }

    if (dannye.klub_id && novyi_igrok?.id) {
        await dobavitChlenaKlubaEsliNuzhno(dannye.klub_id, novyi_igrok.id);
    }

    obnovitAvatarIzTelegram(bot, telegram_id).catch(() => {});

    ozhidanie_registracii[telegram_id] = {
        shag: 'den_rozhdeniya',
        pending_anons_id: ozhidanie_registracii[telegram_id]?.pending_anons_id || null
    };

    let clubLine = '';
    if (dannye.klub_id) {
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', dannye.klub_id).maybeSingle();
        if (klub?.nazvaniye) clubLine = '🎴 Клуб: *' + md(klub.nazvaniye) + '*\n';
    }

    await bot.sendMessage(chatId,
        '🎉 *Регистрация завершена!*\n\n' +
        '🎭 Ник: *' + md(dannye.igrovoy_nik || '') + '*\n' +
        '📍 ' + md(dannye.gorod_name || '') + '\n' +
        clubLine + '\n' +
        '🎂 *День рождения* (необязательно)\n\n' +
        'Напиши дату *ДД.ММ* или *ДД.ММ.ГГГГ* — или нажми «Пропустить».',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'reg_dr_skip' }]] }
        }
    );
    return { ok: true };
}

async function pokazatGorodaAlfavit(chatId, messageId, strana, mode, backCallback) {
    const goroda = await zagruzitGorodaStrany(strana);
    if (goroda.length === 0) {
        const opts = {
            chat_id: chatId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: backCallback }]] }
        };
        const text = '❌ Нет городов для этой страны.';
        if (messageId) await bot.editMessageText(text, { message_id: messageId, ...opts });
        else await bot.sendMessage(chatId, text, opts);
        return goroda;
    }
    const kod = gorodaUi.kodStrany(strana);
    const knopki = gorodaUi.postroитьKlavAlfavit(goroda, mode, kod, strana);
    knopki.push([{ text: '⬅️ Назад', callback_data: backCallback }]);
    const text = gorodaUi.tekstVyboraGoroda(strana);
    const opts = {
        chat_id: chatId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    };
    if (messageId) await bot.editMessageText(text, { message_id: messageId, ...opts });
    else await bot.sendMessage(chatId, text, opts);
    return goroda;
}

async function pokazatGorodaPoBukve(chatId, messageId, strana, mode, bukvaIdx, stranitsa, backCallback) {
    const goroda = await zagruzitGorodaStrany(strana);
    const kod = gorodaUi.kodStrany(strana);
    const { knopki, bukva, vsego } = gorodaUi.postroитьKlavGoroda(goroda, kod, bukvaIdx, stranitsa, mode, backCallback);
    const podzagolovok = vsego
        ? `Буква *${bukva}* — ${vsego} ${vsego === 1 ? 'город' : vsego < 5 ? 'города' : 'городов'}`
        : '_На эту букву городов нет._';
    await bot.editMessageText(gorodaUi.tekstVyboraGoroda(strana, podzagolovok), {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatVyborIgrokVechera(chatId, messageId, klub_id, reyting, sostav, telegram_id) {
    const { data: klub } = await supabase.from('kluby').select('id, nazvaniye').eq('id', klub_id).single();
    const now = new Date();
    const mesyachny = await vecherReyting.poluchitMesyachnyReyting(supabase, klub_id, now.getFullYear(), now.getMonth() + 1);

    let t = '🏁 *Игровой вечер завершён*\n\n';
    t += vecherReyting.formatReytingSpiska(reyting, '🌆 Рейтинг вечера (городской)', 12);
    t += '\n\n📅 *Месячный рейтинг* (обновляется автоматически):\n';
    t += vecherReyting.formatReytingSpiska(mesyachny, null, 5).replace(/^\*[^*]+\*\n\n/, '');
    t += '\n\n⭐ *Выбери игрока вечера* — ему придёт сообщение в личку:';

    const knopki = [];
    const uniq = new Map();
    for (const p of sostav || []) {
        const key = p.igrok_id || p.telegram_id || p.name;
        if (uniq.has(key)) continue;
        uniq.set(key, p);
    }
    const list = [...uniq.values()];
    for (let i = 0; i < list.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i + 2, list.length); j++) {
            const p = list[j];
            const cb = p.igrok_id
                ? 'poe_' + klub_id + '_' + p.igrok_id
                : 'poe_tg_' + klub_id + '_' + (p.telegram_id || 0);
            row.push({ text: '⭐ ' + p.name, callback_data: cb });
        }
        knopki.push(row);
    }
    if (knopki.length === 0) {
        knopki.push([{ text: '⏭ Пропустить', callback_data: 'poe_skip_' + klub_id }]);
    }
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    knopki.push([knopkaGlavnogoMenu(roles)]);

    await bot.editMessageText(t, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function vozobnovitIgrovoyVecherKluba(klub_id) {
    await obnovitNastroykiVecheraKluba(klub_id, {
        vecher_data: dataIgrovoegoVechera(),
        vecher_zavershen: false,
        vecher_zavershen_v: null
    });
}

async function dobavitIgrokovVSpisokVechera(klub_id, text) {
    const niki = razobratSpisokNikov(text);
    if (niki.length === 0) return { ok: false, error: 'empty' };
    const { spisok } = await poluchitDannyeVecheraKluba(klub_id);
    const current = Array.isArray(spisok) ? [...spisok] : [];
    const igraTemp = { klub_id, igroki: [] };
    for (const row of current) {
        igraTemp.igroki.push({
            telegram_id: row.telegram_id || null,
            name: row.name,
            nomer: igraTemp.igroki.length + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: row.igrok_id || null
        });
    }
    const existing = new Set(current.map(p => String(p.name || '').trim().toLowerCase()));
    for (const nick of niki) {
        if (existing.has(String(nick).trim().toLowerCase())) continue;
        const igrok = {
            telegram_id: null,
            name: nick,
            nomer: igraTemp.igroki.length + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        };
        await privyazatIgrokaIzBazy(igraTemp, igrok);
        igraTemp.igroki.push(igrok);
        existing.add(String(nick).trim().toLowerCase());
    }
    await sohranitSpisokVecheraKluba(klub_id, igraTemp.igroki);
    return { ok: true, count: igraTemp.igroki.length };
}

async function ubratIgrokovIzSpiskaVechera(klub_id, text) {
    const niki = razobratSpisokNikov(text);
    if (niki.length === 0) return { ok: false, error: 'empty' };
    const { spisok } = await poluchitDannyeVecheraKluba(klub_id);
    const current = Array.isArray(spisok) ? [...spisok] : [];
    const remove = new Set();
    for (const item of niki) {
        const idxNum = parseInt(item, 10);
        current.forEach((p, idx) => {
            const name = String(p.name || '').toLowerCase();
            if ((Number.isFinite(idxNum) && idx + 1 === idxNum) || name === String(item).toLowerCase() || name.includes(String(item).toLowerCase())) {
                remove.add(idx);
            }
        });
    }
    if (remove.size === 0) return { ok: false, error: 'not_found' };
    const ostalis = current
        .filter((_, idx) => !remove.has(idx))
        .map((p, idx) => ({ ...p, nomer: idx + 1 }));
    const igraTemp = { klub_id, igroki: ostalis.map((p, idx) => ({
        telegram_id: p.telegram_id || null,
        name: p.name,
        nomer: idx + 1,
        status: 'v_igre',
        foly: 0,
        igrok_id: p.igrok_id || null
    })) };
    if (igraTemp.igroki.length > 0) {
        await sohranitSpisokVecheraKluba(klub_id, igraTemp.igroki);
    } else {
        await obnovitNastroykiVecheraKluba(klub_id, {
            vecher_data: dataIgrovoegoVechera(),
            vecher_spisok: [],
            vecher_zavershen: false
        });
    }
    return { ok: true, count: igraTemp.igroki.length, removed: remove.size };
}

async function zapolnitIgruIzSpiskaVechera(igra, spisok) {
    igra.igroki = [];
    for (let i = 0; i < spisok.length; i++) {
        const row = spisok[i];
        const igrok = {
            telegram_id: row.telegram_id || null,
            name: row.name,
            nomer: i + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: row.igrok_id || null
        };
        await privyazatIgrokaIzBazy(igra, igrok);
        igra.igroki.push(igrok);
    }
}

function tekstVvodaSpiskaIgrokov(igra, kod) {
    let t = '\uD83C\uDFB2 *Игра \u2116' + kod + ' создана*\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83D\uDC65 Мест: *' + igra.kolichestvo + '*\n\n';
    t += '\u270D\uFE0F *Список игроков*\n\n';
    t += 'Отправь *' + igra.kolichestvo + ' ников столбиком* — каждый с новой строки:\n\n';
    t += '`Аня`\n`Оля`\n`Катя`\n\n';
    t += '_Список сохранится для следующих игр этого вечера в клубе._\n';
    t += '_Если игрок есть в боте — привяжем к рейтингу автоматически._';
    return t;
}

async function pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    sostoyanie[telegram_id] = 'lobby_spisok_' + kod;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '\uD83D\uDCF1 Раздать в боте', callback_data: 'rezhim_bot_' + kod }]
        ]}
    };
    const text = tekstVvodaSpiskaIgrokov(igra, kod);
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } else {
        await bot.sendMessage(chatId, text, opts);
    }
}

async function nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    igra.rezhim_rolei = 'karty';
    await zagruzitNazvanieKlubaVIgru(igra);
    await sohranit_igru(kod);

    if ((igra.igroki || []).length >= igra.kolichestvo) {
        await pokazatLobbyIgry(chatId, messageId, kod);
        return;
    }

    if (igra.klub_id) {
        const spisok_vecher = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (spisok_vecher && spisok_vecher.length > 0) {
            await pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok_vecher);
            return;
        }
    }

    sostoyanie[telegram_id] = 'lobby_spisok_' + kod;
    await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
}

async function vnestiSpisokIgrokovLobby(chatId, igra, kod, text, opts = {}) {
    const silent = !!opts.silent;
    const nuzhno = igra.kolichestvo;
    const niki = razobratSpisokNikov(text);

    if (niki.length !== nuzhno) {
        if (!silent && chatId) {
            await bot.sendMessage(chatId,
                '\u274C Нужно *' + nuzhno + '* ников, получено: ' + niki.length + '.\n\n' +
                'Отправь списком — каждый ник с новой строки.',
                { parse_mode: 'Markdown' }
            );
        }
        return false;
    }

    igra.igroki = [];
    for (let i = 0; i < niki.length; i++) {
        const igrok = {
            telegram_id: null,
            name: niki[i],
            nomer: i + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: null
        };
        await privyazatIgrokaIzBazy(igra, igrok);
        igra.igroki.push(igrok);
    }

    if (igra.klub_id) await sohranitSpisokVecheraKluba(igra.klub_id, igra.igroki);
    await sohranit_igru(kod);
    delete sostoyanie[igra.vedushchii_id];

    if (!silent && chatId) {
        let t = '\u2705 Состав *' + nuzhno + '* игроков внесён';
        if (igra.klub_id) t += ' и сохранён для этого вечера';
        t += '.\n\n';
        igra.igroki.forEach(i => {
            t += i.nomer + '. ' + i.name + (i.igrok_id ? ' \u2705' : '') + '\n';
        });

        await bot.sendMessage(chatId, t, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFB4 К лобби', callback_data: 'obnovit_igru_' + kod }],
                [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }]
            ]}
        });
    }
    return true;
}

async function pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);

    let t = '\uD83D\uDCCB *Состав игрового вечера*\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83C\uDFB4 Игра \u2116' + kod + ' · мест: *' + igra.kolichestvo + '*\n\n';
    t += 'На этом вечере уже играли с таким составом:\n\n';
    spisok.forEach((p, i) => {
        t += (i + 1) + '. ' + p.name + '\n';
    });

    const sovpadaet = spisok.length === igra.kolichestvo;
    if (!sovpadaet) {
        t += '\n\u26A0\uFE0F В сохранённом списке *' + spisok.length + '* игроков, в этой игре — *' + igra.kolichestvo + '*.\n';
        t += 'Отредактируй список под число мест в игре.';
    } else {
        t += '\nПодтвердить состав или отредактировать перед ночью знакомства?';
    }

    const knopki = [];
    if (sovpadaet) {
        knopki.push([{ text: '\u2705 Подтвердить список', callback_data: 'vecher_ok_' + kod }]);
    }
    knopki.push([{ text: '\u270F\uFE0F Редактировать список', callback_data: 'vecher_edit_' + kod }]);
    knopki.push([{ text: '\u2B05\uFE0F К лобби', callback_data: 'obnovit_igru_' + kod }]);

    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatVyborResidentovIgry(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra?.klub_id) return;

    const residentyIds = await poluchitResidentovKluba(igra.klub_id);
    if (residentyIds.length === 0) {
        await bot.editMessageText(
            '⭐ *Резиденты клуба*\n\nВ клубе пока нет сохранённых резидентов.\n\nДобавь их в разделе *База игроков*: открой карточку игрока и нажми «Сделать резидентом».',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В лобби', callback_data: 'obnovit_igru_' + kod }]] }
            }
        );
        return;
    }

    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('igroki(id, tg_id, imya, igrovoy_nik, tg_username)')
        .eq('klub_id', igra.klub_id);

    const residenty = (chleny || [])
        .map(c => c.igroki)
        .filter(i => i && residentyIds.includes(i.id))
        .sort((a, b) => (a.igrovoy_nik || a.imya || '').localeCompare(b.igrovoy_nik || b.imya || '', 'ru'));

    let tekst = '⭐ *Добавить резидентов в игру №' + kod + '*\n\n';
    tekst += 'Мест занято: *' + igra.igroki.length + '/' + igra.kolichestvo + '*\n';
    tekst += '_Нажимай на игроков — галочка добавляет/убирает из лобби._\n\n';

    const knopki = [];
    residenty.forEach(i => {
        const uzhe = (igra.igroki || []).some(g => g.igrok_id === i.id || (i.tg_id && g.telegram_id === i.tg_id));
        const name = i.igrovoy_nik || i.imya || 'Игрок';
        const username = i.tg_username ? ' @' + i.tg_username : '';
        knopki.push([{ text: (uzhe ? '✅ ' : '▫️ ') + name + username, callback_data: cbBtn('rezadd_', { kod, igrok_id: i.id }) }]);
    });

    knopki.push([{ text: '⬅️ В лобби', callback_data: 'obnovit_igru_' + kod }]);

    await bot.editMessageText(tekst, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatLobbyIgry(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);

    const rezhim = igra.rezhim_rolei === 'karty' ? '\uD83C\uDFB4 *Физические карты*' : '\uD83D\uDCF1 *Роли в боте*';
    const polno = igra.igroki.length >= igra.kolichestvo;
    const opisanie = igra.rezhim_rolei === 'karty'
        ? (polno
            ? 'Состав внесён — можно начинать ночь знакомства.'
            : 'Внеси *' + igra.kolichestvo + ' игроков* списком — каждый ник с новой строки.')
        : 'Игроки подключаются по коду, бот отправит каждому роль в личку.';
    let tekst = rezhim + '\n\n';
    if (nazvanieKlubaIgry(igra)) tekst += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    tekst += '\uD83C\uDFB4 Игра \u2116' + kod + '\n';
    tekst += '\uD83D\uDC65 Игроков: *' + igra.igroki.length + '/' + igra.kolichestvo + '*\n\n';
    tekst += opisanie + '\n\n';

    let spisok = '';
    igra.igroki.forEach((ig, i) => {
        spisok += (i + 1) + '. ' + (ig.name || ig.imya || 'Игрок') + '\n';
    });
    tekst += spisok || '_Список игроков ещё не внесён_';
    if (!polno) tekst += '\n\n_Осталось: ' + (igra.kolichestvo - igra.igroki.length) + ' игрок(ов)._';


    const knopki = [[{ text: '🔄 Обновить список', callback_data: 'obnovit_igru_' + kod }]];
    if (igra.klub_id) knopki.push([{ text: '⭐ Добавить резидентов', callback_data: cbBtn('rez_', { kod }) }]);
    if (igra.klub_id && await mozhnoFunktsiyuKluba(igra.klub_id, 'rassylka_priglasheniy')) {
        knopki.push([{ text: '📨 Пригласить базу клуба', callback_data: 'rassylka_igry_' + kod }]);
    }
    knopki.push(...knopkiPriglasheniyaVIgru(kod));
    if (igra.rezhim_rolei === 'bot') {
        knopki.push([{ text: polno ? '🎭 Раздать роли' : '🎭 Раздать роли (ждём игроков)', callback_data: 'razdat_' + kod }]);
    } else {
        if (!polno) {
            knopki.unshift([{ text: '\u270D\uFE0F Внести список столбиком', callback_data: 'lobby_spisok_' + kod }]);
        }
        if (igra.klub_id) {
            knopki.push([{ text: '\uD83D\uDCCB Состав вечера', callback_data: 'vecher_pokaz_' + kod }]);
        }
        if (mirnyeOstalosVnesti(igra) > 0 && (igra.igroki || []).some(i => i.rol && i.rol !== 'Мирный')) {
            knopki.push([{ text: '\uD83D\uDFE2 + Мирный (' + mirnyeOstalosVnesti(igra) + ')', callback_data: 'panel_mirny_' + kod }]);
        }
        knopki.push([{ text: polno ? '\uD83C\uDF19 Начать ночь знакомства' : '\uD83C\uDF19 Ночь (нужен полный состав)', callback_data: 'noch_znakomstvo_' + kod }]);
        knopki.push([{ text: '✍️ Внести роли вручную', callback_data: 'manual_roles_' + kod }]);
        knopki.push([{ text: polno ? '▶️ Начать игру' : '▶️ Начать игру / внести роли', callback_data: 'nachat_igru_' + kod }]);
    }
    knopki.push([{ text: '❌ Отменить', callback_data: 'otmenit_' + kod }]);

    await bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

function aktivnyeIgryVedushchego(telegram_id) {
    return Object.entries(igry)
        .filter(([kod, igra]) => !String(kod).startsWith('archive_') && igra?.vedushchii_id === telegram_id && !igra._ne_sohranyat)
        .map(([kod, igra]) => ({ kod, igra }))
        .sort((a, b) => String(a.kod).localeCompare(String(b.kod)));
}

async function pokazatMoiIgryBystraya(chatId, telegram_id) {
    const aktivnye = aktivnyeIgryVedushchego(telegram_id);
    if (aktivnye.length === 0) {
        await bot.sendMessage(chatId, '🎮 *Мои игры*\n\nАктивных игр пока нет.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                [{ text: '📚 История игр', callback_data: 'istoriya_igr' }]
            ] }
        });
        return;
    }

    let t = '🎮 *Мои активные игры*\n\n';
    const knopki = [];
    aktivnye.forEach(({ kod, igra }) => {
        const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
        const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
        t += '🎴 №' + kod + ' — ' + status + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
        knopki.push([
            { text: '🎮 №' + kod, callback_data: 'open_igra_' + kod },
            { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Стоп', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
            { text: '🗑', callback_data: 'delete_igra_' + kod }
        ]);
    });
    knopki.push([{ text: '📚 История игр', callback_data: 'istoriya_igr' }]);
    await bot.sendMessage(chatId, t, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
}

async function pokazatBystryyVyborIgry(chatId, telegram_id, tip) {
    const aktivnye = aktivnyeIgryVedushchego(telegram_id);
    const onlyStopped = tip === 'resume';
    const igryDlyaKnopok = aktivnye.filter(({ igra }) => onlyStopped ? igra.ostanovlena : true);
    if (igryDlyaKnopok.length === 0) {
        const text = onlyStopped
            ? '▶️ Нет остановленных игр для возобновления.'
            : '🎮 Активных игр пока нет.';
        await bot.sendMessage(chatId, text, bystrayaKlaviaturaVedushchego);
        return;
    }

    const zagolovok = tip === 'pause'
        ? '⏸ *Какую игру остановить?*'
        : tip === 'resume'
            ? '▶️ *Какую игру возобновить?*'
            : '🗑 *Какую игру удалить?*';
    const prefix = tip === 'pause' ? 'stop_igra_' : tip === 'resume' ? 'resume_igra_' : 'delete_igra_';
    const knopki = igryDlyaKnopok.map(({ kod, igra }) => [{
        text: '№' + kod + (igra.ostanovlena ? ' — остановлена' : ''),
        callback_data: prefix + kod
    }]);
    await bot.sendMessage(chatId, zagolovok, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

function aktivnyeIgryKluba(klub_id) {
    return Object.entries(igry)
        .filter(([kod, igra]) => !String(kod).startsWith('archive_') && igra?.klub_id === klub_id && !igra._ne_sohranyat)
        .map(([kod, igra]) => ({ kod, igra }))
        .sort((a, b) => String(a.kod).localeCompare(String(b.kod)));
}

async function poluchitKlubyDlyaIgr(telegram_id) {
    const { data: igrok } = await supabase
        .from('igroki')
        .select('id')
        .eq('tg_id', telegram_id)
        .single();

    const { data: chleny } = await supabase
        .from('chleny_klubov')
        .select('klub_id, rol, kluby(id, nazvaniye)')
        .eq('igrok_id', igrok?.id)
        .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

    return (chleny || []).filter(c => c.kluby).map(c => c.kluby);
}

async function pokazatIgrovoyVecher(chatId, messageId, klub, telegram_id) {
    const { data: klubFull } = await supabase
        .from('kluby')
        .select('id, nazvaniye, nastroyki')
        .eq('id', klub.id)
        .single();
    const klubInfo = klubFull || klub;
    const dannyeVechera = await poluchitDannyeVecheraKluba(klubInfo.id);
    const spisok = dannyeVechera.spisok;
    const zavershen = dannyeVechera.zavershen;
    const today = dataIgrovoegoVechera();
    const itogiVechera = zavershen ? await vecherReyting.poluchitIgrokaVechera(supabase, klubInfo.id, today) : null;
    const awaitPoe = zavershen && klubInfo.nastroyki?.vecher_await_poe;

    let t = '🌙 *Игровой вечер*\n\n';
    t += 'Клуб: *' + (klubInfo.nazvaniye || '') + '*\n';
    t += 'Дата: *' + today + '*\n';
    t += 'Статус: *' + (zavershen ? 'завершён' : 'идёт') + '*\n';
    if (zavershen && itogiVechera?.igroki) {
        const poeName = itogiVechera.igroki?.igrovoy_nik || itogiVechera.igroki?.imya;
        if (poeName) t += '⭐ Игрок вечера: *' + poeName + '*\n';
    }
    t += '\n';
    if (spisok?.length) {
        t += '*Состав вечера (' + spisok.length + '):*\n';
        spisok.forEach((p, i) => { t += (i + 1) + '. ' + p.name + '\n'; });
        t += zavershen
            ? '\n_Вечер завершён. Новые игры не будут подтягивать этот состав, пока не открыть вечер заново._'
            : '\n_Игроки могут добавляться и уходить: обновляй состав перед следующей игрой вечера._';
    } else {
        t += '_Состав вечера ещё не зафиксирован._\n\n';
        t += 'Можно загрузить пришедших из сегодняшнего анонса или внести ники вручную.';
    }

    const knopki = [];
    if (spisok?.length && !zavershen) {
        const tip = klubInfo.nastroyki?.tip_kluba || 'paskal';
        knopki.push([{ text: '🎲 Создать игру на ' + spisok.length, callback_data: 'igra_tip_kol_' + klubInfo.id + '_' + tip + '_' + spisok.length }]);
    }

    if (!zavershen) {
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya')
            .eq('klub_id', klubInfo.id)
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(20);
        (anonsy || [])
            .filter(a => (razobrat_datu_anonsa(a.data_igry) || a.data_igry) === today)
            .forEach(a => {
                knopki.push([{ text: '📢 Взять пришедших из анонса ' + (a.vremya || ''), callback_data: cbBtn('vech_an_', { klub_id: klubInfo.id, anons_id: a.id }) }]);
            });

        knopki.push([{ text: spisok?.length ? '✍️ Заменить состав вручную' : '✍️ Внести состав вручную', callback_data: 'vecher_vvod_' + klubInfo.id }]);
        if (spisok?.length) {
            knopki.push([
                { text: '➕ Добавить', callback_data: 'vecher_add_' + klubInfo.id },
                { text: '➖ Убрать', callback_data: 'vecher_remove_' + klubInfo.id }
            ]);
            knopki.push([{ text: '🏁 Завершить игровой вечер', callback_data: 'vecher_finish_' + klubInfo.id }]);
        }
    } else {
        if (awaitPoe && spisok?.length) {
            knopki.push([{ text: '⭐ Выбрать игрока вечера', callback_data: 'vecher_poe_' + klubInfo.id }]);
        }
        knopki.push([{ text: '↩️ Открыть вечер заново', callback_data: 'vecher_reopen_' + klubInfo.id }]);
        if (itogiVechera?.reyting_vechera?.length) {
            knopki.push([{ text: '📊 Рейтинг вечера', callback_data: 'vecher_reyting_' + klubInfo.id }]);
        }
    }
    const roles = await poluchitRoliPolzovatelya(telegram_id);
    knopki.push([knopkaGlavnogoMenu(roles)]);

    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazatIgryKluba(chatId, messageId, klub) {
    const aktivnye = aktivnyeIgryKluba(klub.id);
    let t = '🏛 *Игры клуба*\n\nКлуб: *' + klub.nazvaniye + '*\n\n';
    const knopki = [];

    if (aktivnye.length === 0) {
        t += '_Активных игр сейчас нет._\n';
    } else {
        t += '*Активные игры:*\n';
        aktivnye.forEach(({ kod, igra }) => {
            const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            const rezhim = igra.rezhim_rolei === 'karty' ? 'физ. карты' : (igra.rezhim_rolei === 'bot' ? 'бот' : 'режим не выбран');
            const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
            t += '🎴 №' + kod + ' — ' + status + ', ' + rezhim + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
            knopki.push([{ text: '🎮 Открыть игру №' + kod, callback_data: 'open_igra_' + kod }]);
            knopki.push([
                { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Остановить', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
                { text: '🗑 Удалить', callback_data: 'delete_igra_' + kod }
            ]);
        });
    }

    knopki.push([{ text: '📚 История клуба', callback_data: 'hist_klub_' + klub.id }]);
    knopki.push([{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]);
    knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

    await bot.editMessageText(t, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function otkrytIgruVedushchego(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) {
        await bot.editMessageText('❌ Игра не найдена. Возможно, она уже завершена.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]] }
        });
        return;
    }

    if (igra.ostanovlena) {
        await bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nМожно возобновить её с того же места или удалить полностью.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }],
                [{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }],
                [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
            ]}
        });
        return;
    }

    if (!igra.rezhim_rolei && !igra.roli_razdany) {
        await bot.editMessageText(
            '🎮 *Игра №' + kod + '*\n\nУ этой игры ещё не выбран режим раздачи ролей. Выбери режим, чтобы продолжить:',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🃏 Физические карты', callback_data: 'rezhim_karty_' + kod }],
                    [{ text: '📱 Раздать в боте', callback_data: 'rezhim_bot_' + kod }],
                    [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
                ]}
            }
        );
        return;
    }

    if (!igra.roli_razdany) {
        await pokazatLobbyIgry(chatId, messageId, kod);
        return;
    }

    await bot.editMessageText('🎮 *Игра №' + kod + '*\n\nОткрой игровую панель:', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
            [{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]
        ]}
    });
}

function lichnoeVremyaSek(igra) {
    const nastroeno = parseInt(igra?._nastroyki?.minuta_sek, 10);
    if (Number.isFinite(nastroeno)) return Math.min(60, Math.max(40, nastroeno));
    if ((igra?.tip_kluba || 'paskal') === 'big_family') return 40;
    if ((igra?.tip_kluba || 'paskal') === 'paskal') return igra?.kolichestvo > 15 ? 40 : 60;
    return igra?.kolichestvo > 15 ? 40 : 60;
}

const MAFIA_ROLES = ['Дон', 'Мафия', 'Путана', 'Эскортница', 'Подрывник мафии', 'Консильери'];
const SHERIFF_ROLES = ['Шериф', 'Комиссар', 'Детектив'];
const MAFIA_WIN_BLOCKERS = ['Охотник', 'Стрелок', 'Маньяк'];

function isMafiaRole(rol) {
    return MAFIA_ROLES.includes(rol);
}

function isSheriffRole(rol) {
    return SHERIFF_ROLES.includes(rol);
}

function isPeacefulRole(rol) {
    return !isMafiaRole(rol) && rol !== 'Маньяк';
}

function rolStrelyayushchegoZaMirnyh(rol) {
    return ['Стрелок', 'Охотник'].includes(rol);
}

function dobavitAvtoBonus(igra, nomer, key, pts, text, meta = {}) {
    if (!igra || !nomer || !pts) return;
    if (!Array.isArray(igra.avto_bonusy)) igra.avto_bonusy = [];
    const den = igra.den || 1;
    const tsel = meta.tsel ?? null;
    const exists = igra.avto_bonusy.some(b => b.nomer === nomer && b.key === key && b.den === den && (b.tsel ?? null) === tsel);
    if (exists) return;
    igra.avto_bonusy.push({
        nomer,
        key,
        pts,
        text,
        den,
        ...meta
    });
}

function zapisatDen1Vybyl(igra, igrok) {
    if (!igra || !igrok || (igra.den || 1) !== 1) return;
    if (!Array.isArray(igra.den1_vygolosovany)) igra.den1_vygolosovany = [];
    if (!igra.den1_vygolosovany.includes(igrok.nomer)) igra.den1_vygolosovany.push(igrok.nomer);
}

function maxFolyIgry(igra) {
    const nastroeno = parseInt(igra?.max_foly || igra?._nastroyki?.max_foly, 10);
    return Number.isFinite(nastroeno) ? nastroeno : 4;
}

function nazvanieKlubaIgry(igra) {
    return igra?.klub_nazvaniye || igra?._nastroyki?.klub_nazvaniye || '';
}

async function zagruzitNazvanieKlubaVIgru(igra) {
    if (!igra || !igra.klub_id || nazvanieKlubaIgry(igra)) return nazvanieKlubaIgry(igra);
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', igra.klub_id).single();
    if (klub?.nazvaniye) {
        igra.klub_nazvaniye = klub.nazvaniye;
        igra._nastroyki = { ...(igra._nastroyki || {}), klub_nazvaniye: klub.nazvaniye };
    }
    return nazvanieKlubaIgry(igra);
}

function limitMinShahida(igra) {
    return Math.ceil((igra?.kolichestvo || igra?.igroki?.length || 0) * 0.3);
}

function limitVystrelovEskort(igra) {
    const n = igra?.kolichestvo || igra?.igroki?.length || 0;
    if (n >= 15) return 3;
    if (n >= 12) return 2;
    return 1;
}

function eskortVyboryNochi(igra) {
    return igra?.noch_deystviya?.eskort_vybory || [];
}

function roliDlyaUgadivaniyaEskort() {
    return ALL_ROLE_NAMES.filter(r => r !== 'Путана');
}

function sravnitRoliEskort(ugadannaya, fakticheskaya) {
    const u = normalizovatNazvanieRoli(ugadannaya) || ugadannaya;
    const f = normalizovatNazvanieRoli(fakticheskaya) || fakticheskaya;
    return u === f;
}

function tekstStatusaEskort(igra) {
    const vybory = eskortVyboryNochi(igra);
    const limit = limitVystrelovEskort(igra);
    if (vybory.length === 0) return 'не стреляла (' + limit + ' доступно)';
    const chasti = vybory.map(v => '\u2116' + v.nomer + ' \u2192 ' + v.ugadannaya_rol);
    return chasti.join('; ') + ' (' + vybory.length + '/' + limit + ')';
}

const PRAVILA_PRESET = {
    paskal: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    vip: { doktor_sebya: 'cherez_raz', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: false },
    naila: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    sportivniy: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true },
    big_family: { doktor_sebya: 'dva_podryad', doktor_dvoynoy_vystrel: true, doktor_povtor_celi: true }
};

function pravilaIgry(igra) {
    const tip = igra?.tip_kluba || igra?._nastroyki?.tip_kluba || 'paskal';
    const preset = PRAVILA_PRESET[tip] || PRAVILA_PRESET.paskal;
    const custom = igra?._nastroyki?.pravila || {};
    return { ...preset, ...custom };
}

function nazvaniePravilKluba(igra) {
    const tip = igra?.tip_kluba || igra?._nastroyki?.tip_kluba || 'paskal';
    if (tip === 'vip') return 'VIP';
    if (tip === 'sportivniy') return 'Спортивный';
    return 'Pascal';
}

function tekstPravilDoktora(igra) {
    const p = pravilaIgry(igra);
    const sebya = p.doktor_sebya === 'cherez_raz' ? 'себя — через ночь' : 'себя — 2 ночи подряд';
    const drugih = p.doktor_povtor_celi ? 'других — без ограничений' : 'одного игрока — не 2 ночи подряд';
    return drugih + ', ' + sebya;
}

function dvoynoyVystrelMafiyaManyak(d) {
    const maf = (d?.mafiya_tseli || [])[0];
    const man = d?.manyak_tseli;
    return maf != null && man != null && maf === man;
}

function doktorSpasTsel(d, igra, nomer) {
    if (d?.doctor_tseli !== nomer) return false;
    if (pravilaIgry(igra).doktor_dvoynoy_vystrel !== false && dvoynoyVystrelMafiyaManyak(d)) return false;
    return true;
}

function proveritLechitDoktor(igra, nomerTsel) {
    const doctor = igra.igroki.find(i => i.status === 'v_igre' && i.rol === 'Доктор');
    if (!doctor) return { ok: true };
    const pravila = pravilaIgry(igra);
    const proshlaya = igra.doctor_proshlaya_tsel;

    if (nomerTsel !== doctor.nomer && proshlaya === nomerTsel && !pravila.doktor_povtor_celi) {
        return { ok: false, text: 'Доктор не может лечить одного игрока две ночи подряд (VIP).' };
    }
    if (nomerTsel === doctor.nomer) {
        if (pravila.doktor_sebya === 'cherez_raz' && proshlaya === doctor.nomer) {
            return { ok: false, text: 'По правилам VIP доктор лечит себя через ночь.' };
        }
        if (pravila.doktor_sebya === 'dva_podryad' && proshlaya === doctor.nomer && (igra.doctor_sebya_podryad || 0) >= 2) {
            return { ok: false, text: 'Доктор уже лечил себя 2 ночи подряд (Pascal).' };
        }
    }
    return { ok: true };
}

function zapisatIstoriyuDoktora(igra, docTsel) {
    if (!docTsel) return;
    const doctor = igra.igroki.find(i => i.rol === 'Доктор');
    const proshlaya = igra.doctor_proshlaya_tsel;
    igra.doctor_proshlaya_tsel = docTsel;
    if (doctor && docTsel === doctor.nomer) {
        igra.doctor_sebya_podryad = proshlaya === doctor.nomer ? (igra.doctor_sebya_podryad || 0) + 1 : 1;
    } else {
        igra.doctor_sebya_podryad = 0;
    }
}

function primenitNochnyeVystrely(igra, d) {
    const lines = [];
    const ubity_t = [];
    const maf = (d.mafiya_tseli || [])[0] ?? null;
    const man = d.manyak_tseli ?? null;
    const str = d.strelok_tseli ?? null;
    const doctor = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Доктор');
    const manyak = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Маньяк');
    const strelok = igra.igroki.find(x => x.status === 'v_igre' && rolStrelyayushchegoZaMirnyh(x.rol));
    const vseCeli = [...new Set([maf, man, str].filter(n => n != null))];

    for (const nomer of vseCeli) {
        const igrok = igra.igroki.find(x => x.nomer === nomer && x.status === 'v_igre');
        if (!igrok) {
            if (maf === nomer) lines.push('_Мафия стреляла в \u2116' + nomer + ', цель уже не за столом_');
            continue;
        }
        const mafiya = maf === nomer;
        const manyakStr = man === nomer;
        const strelokStr = str === nomer;
        const bessmert = igrok.rol === 'Бессмертный';
        const docSpas = doktorSpasTsel(d, igra, nomer);

        if (mafiya && manyakStr) {
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDCA5 \u2116' + nomer + ' *' + igrok.name + '* — в него стреляли и мафия, и маньяк. Доктор не спасает.');
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && manyak?.status === 'v_igre') {
                manyak.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, manyak);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Маньяка с собой\n');
            }
            continue;
        }
        if (manyakStr) {
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83C\uDFAF Маньяк убил \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ')\n');
            if (manyak && isMafiaRole(igrok.rol)) {
                dobavitAvtoBonus(igra, manyak.nomer, 'bonus_pravilnyy_otstrel_mafii', BALLY_DEFAULT.bonus_pravilnyy_otstrel_mafii, 'Маньяк правильно отстрелил мафию', { tsel: nomer });
            }
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && manyak?.status === 'v_igre') {
                manyak.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, manyak);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Маньяка с собой\n');
            }
            continue;
        }
        if (mafiya) {
            if (bessmert) {
                dobavitAvtoBonus(igra, igrok.nomer, 'bonus_bessmertnyy_prinyal_vystrel', BALLY_DEFAULT.bonus_bessmertnyy_prinyal_vystrel, 'Бессмертный принял выстрел мафии', { tsel: nomer });
                lines.push('\uD83D\uDEE1\uFE0F \u2116' + nomer + ' *' + igrok.name + '* (Бессмертный) — принял выстрел мафии и остался в игре\n');
                continue;
            }
            if (docSpas) {
                if (doctor) dobavitAvtoBonus(igra, doctor.nomer, 'bonus_doctor_spas', BALLY_DEFAULT.bonus_doctor_spas, 'Доктор правильно вылечил цель мафии', { tsel: nomer });
                lines.push('\uD83D\uDC89 \u2116' + nomer + ' *' + igrok.name + '* — спасён доктором\n');
                continue;
            }
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDC80 \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ') — убит мафией\n');
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник' && d.podryvnik_zabiraet) {
                const zabiraet = igra.igroki.find(x => x.nomer === d.podryvnik_zabiraet && x.status === 'v_igre');
                if (zabiraet) {
                    zabiraet.status = 'vybyl';
                    dobavitUnikalnoPoNomeru(ubity_t, zabiraet);
                    lines.push('\uD83D\uDCA5 Подрывник забрал с собой \u2116' + zabiraet.nomer + ' *' + zabiraet.name + '* (' + zabiraet.rol + ')\n');
                    lines.push(primenitSmertShahida(igra, zabiraet, 'noch', ubity_t));
                }
            }
            continue;
        }
        if (strelokStr) {
            if (bessmert) {
                lines.push('\uD83D\uDEE1\uFE0F Стрелок/Охотник стрелял в \u2116' + nomer + ' *' + igrok.name + '* (Бессмертный), цель осталась в игре\n');
                continue;
            }
            if (docSpas) {
                if (doctor) dobavitAvtoBonus(igra, doctor.nomer, 'bonus_doctor_spas', BALLY_DEFAULT.bonus_doctor_spas, 'Доктор правильно вылечил цель ночного выстрела', { tsel: nomer });
                lines.push('\uD83D\uDC89 Стрелок/Охотник стрелял в \u2116' + nomer + ' *' + igrok.name + '*, но Доктор спас цель\n');
                continue;
            }
            igrok.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubity_t, igrok);
            lines.push('\uD83D\uDD2B Стрелок/Охотник убил \u2116' + nomer + ' *' + igrok.name + '* (' + igrok.rol + ')\n');
            if (strelok && isMafiaRole(igrok.rol)) {
                dobavitAvtoBonus(igra, strelok.nomer, 'bonus_pravilnyy_otstrel_mafii', BALLY_DEFAULT.bonus_pravilnyy_otstrel_mafii, 'Стрелок/Охотник правильно отстрелил мафию', { tsel: nomer });
            } else if (strelok && isPeacefulRole(igrok.rol)) {
                strelok.mirnye_ubitye_strelkom = (strelok.mirnye_ubitye_strelkom || 0) + 1;
                if (strelok.mirnye_ubitye_strelkom >= 2 && strelok.status === 'v_igre') {
                    strelok.status = 'vybyl';
                    dobavitUnikalnoPoNomeru(ubity_t, strelok);
                    lines.push('\u26A0\uFE0F Стрелок/Охотник убил двух мирных и покидает игру\n');
                }
            }
            lines.push(primenitSmertShahida(igra, igrok, 'noch', ubity_t));
            if (igrok.rol === 'Подрывник мафии' && strelok?.status === 'v_igre') {
                strelok.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, strelok);
                lines.push('\uD83D\uDCA5 Подрывник мафии забрал Стрелка/Охотника с собой\n');
            }
        }
    }

    if (maf == null && !(d.mafiya_tseli || []).length) lines.push('_Мафия не выбрала цель_\n');
    return { lines, ubity_t };
}

function dobavitUnikalnoPoNomeru(spisok, igrok) {
    if (!igrok || spisok.some(i => i.nomer === igrok.nomer)) return;
    spisok.push(igrok);
}

function sosediShahida(igra, shahid) {
    const alive = (igra?.igroki || [])
        .filter(i => i.status === 'v_igre' && i.nomer !== shahid.nomer)
        .sort((a, b) => a.nomer - b.nomer);
    if (alive.length < 2) return alive;
    const left = [...alive].reverse().find(i => i.nomer < shahid.nomer) || alive[alive.length - 1];
    const right = alive.find(i => i.nomer > shahid.nomer) || alive[0];
    return [left, right].filter(Boolean);
}

function primenitSmertShahida(igra, shahid, prichina, ubitye) {
    if (!igra || !shahid || shahid.rol !== 'Шахид') return '';
    let tekst = '';

    if (prichina === 'golosovanie' && (igra.den || 1) === 1) {
        const sosedi = sosediShahida(igra, shahid);
        sosedi.forEach(sosed => {
            if (sosed.status === 'v_igre') {
                sosed.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubitye, sosed);
                tekst += '\uD83D\uDCA5 Шахида выголосовали в День 1 — сосед \u2116' + sosed.nomer + ' *' + sosed.name + '* (' + sosed.rol + ') покидает игру\n';
            }
        });
    }

    const miny = Array.isArray(igra.shahid_miny) ? igra.shahid_miny : [];
    miny.forEach(nomer => {
        const zamin = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
        if (zamin) {
            zamin.status = 'vybyl';
            dobavitUnikalnoPoNomeru(ubitye, zamin);
            tekst += '\uD83D\uDCA3 Заминированный \u2116' + zamin.nomer + ' *' + zamin.name + '* (' + zamin.rol + ') уходит вместе с Шахидом\n';
        }
    });

    igra.shahid_miny = [];
    return tekst;
}

function mozhetBytLuchshiyHod(igrok) {
    return igrok && !isMafiaRole(igrok.rol) && igrok.rol !== 'Маньяк';
}

function prichinaLuchshegoHoda(source) {
    return source === 'den1' ? 'Выголосован в День 1' : 'Убит в Ночь 1';
}

function poluchitLuchshiyHod(igra, nomer, source) {
    igra.luchshie_hody = igra.luchshie_hody || [];
    let hod = igra.luchshie_hody.find(h => h.igrok_nomer === nomer && h.source === source);
    if (!hod) {
        hod = { igrok_nomer: nomer, source, prichina: prichinaLuchshegoHoda(source), nazvannye: [] };
        igra.luchshie_hody.push(hod);
    }
    return hod;
}

function knopkiLuchshegoHoda(igra, kod, nomer, source, next) {
    const hod = poluchitLuchshiyHod(igra, nomer, source);
    const knopki = (igra.igroki || [])
        .filter(i => i.nomer !== nomer)
        .map(i => [{
            text: (hod.nazvannye.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'lh_toggle_' + kod + '_' + nomer + '_' + i.nomer + '_' + source + '_' + next
        }]);
    knopki.push([{ text: '\u2705 Сохранить лучший ход', callback_data: 'lh_done_' + kod + '_' + nomer + '_' + source + '_' + next }]);
    knopki.push([{ text: '\u23ED\uFE0F Пропустить', callback_data: 'lh_skip_' + kod + '_' + nomer + '_' + source + '_' + next }]);
    return knopki;
}

async function pokazatLuchshiyHod(chatId, messageId, kod, nomer, source, next) {
    const igra = igry[kod];
    if (!igra) return;
    const igrok = igra.igroki.find(i => i.nomer === nomer);
    if (!igrok) return;
    const hod = poluchitLuchshiyHod(igra, nomer, source);
    let t = '\uD83C\uDFC6 *Лучший ход*\n\n';
    t += '\u2116' + igrok.nomer + ' *' + igrok.name + '* — ' + hod.prichina + '\n\n';
    t += 'Отметь игроков, которых он назвал мафией на последнем слове.\n';
    t += 'Бот после игры сам сверит реальные роли и начислит баллы.\n\n';
    t += 'Выбрано: ' + (hod.nazvannye.length ? hod.nazvannye.map(n => '\u2116' + n).join(', ') : '_никого_');
    await bot.editMessageText(t, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopkiLuchshegoHoda(igra, kod, nomer, source, next) }
    });
}

async function prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next) {
    const igra = igry[kod];
    if (!igra) return;
    const pobeditel = opredelitPobeditelya(igra);
    if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;

    if (next === 'noch') {
        igra.faza = 'noch';
        await sohranit_igru(kod);
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
        return;
    }

    if (next === 'day') {
        igra.den = (igra.den || 1) + 1;
        await sohranit_igru(kod);
        await bot.editMessageText('\uD83C\uDF19 *Итоги ночи сохранены.*\n\nМожно начинать день ' + igra.den + '.\n_Сначала выберешь, кто начинает дневные речи._', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }],
                [{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]
            ] }
        });
    }
}

function mozhetKonsilyeriVerbovat(igra) {
    const alive = (igra?.igroki || []).filter(i => i.status === 'v_igre');
    if (alive.length === 0) return false;
    const maf = alive.filter(i => isMafiaRole(i.rol)).length;
    return maf > 0 && (maf / alive.length) < 0.3;
}

function opredelitPobeditelya(igra) {
    const alive = (igra?.igroki || []).filter(i => i.status === 'v_igre');
    const maf = alive.filter(i => isMafiaRole(i.rol)).length;
    const manyak = alive.filter(i => i.rol === 'Маньяк').length;
    const mirnye = alive.length - maf - manyak;

    if (alive.length === 0) return null;
    if (manyak > 0 && alive.length <= 2) return 'manyak';
    if (maf === 0 && manyak === 0) return 'mirnye';
    if (maf === 0 && mirnye === 0 && manyak > 0) return 'manyak';
    if (maf > 0 && maf >= mirnye + manyak) {
        const estBlokiruyushchayaRol = alive.some(i => MAFIA_WIN_BLOCKERS.includes(i.rol));
        if (estBlokiruyushchayaRol) return null;
        return 'mafiya';
    }
    return null;
}

async function zavershitIgruAvto(chatId, messageId, kod, pobeditel) {
    const igra = igry[kod];
    if (!igra || !pobeditel) return false;
    stopTimer(kod);

    const pobeditel_text = pobeditel === 'mirnye' ? '🟢 Мирные'
                         : pobeditel === 'mafiya' ? '🔴 Мафия'
                         : '🎯 Маньяк';

    let svodka = '⚠️ *Возможное завершение игры*\n\n';
    svodka += 'Бот видит возможного победителя: ' + pobeditel_text + '\n\n';
    svodka += 'Игра *не завершена автоматически*, рейтинг не записан.\n';
    svodka += 'Подтверди итог вручную, если игра действительно закончилась.\n\n';
    svodka += '*Сейчас за столом:*\n';
    igra.igroki.forEach(i => {
        const em = i.status === 'v_igre' ? '✅' : '💀';
        svodka += em + ' №' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
    });

    await bot.editMessageText(svodka, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '🏁 Подтвердить итог игры', callback_data: 'konec_' + kod }],
            [{ text: '🎮 Продолжить игру', callback_data: 'panel_' + kod }],
            [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
        ]}
    });
    return true;
}

function buildPanelText(igra, kod) {
    const alive = igra.igroki.filter(i => i.status === 'v_igre');
    const faza_names = { ozhidanie: 'Ожидание', znakomstvo: 'Знакомство', den: 'День', noch: 'Ночь', golosovanie: 'Голосование', opravdanie: 'Оправдание' };
    let t = '\uD83C\uDFAE *Игра \u2116' + kod + '* | ' + (faza_names[igra.faza] || '') + ' ' + (igra.den || 1) + '\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += '\uD83D\uDC65 За столом: *' + alive.length + '*/' + igra.kolichestvo + '\n';
    if (igra.taymer_aktiven && igra.taymer_sekundy > 0) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u23F1 *' + formatTime(igra.taymer_sekundy) + '* — \u2116' + (cur ? cur.nomer : '?') + ' ' + (cur ? cur.name : '') + '\n';
    } else if (igra.tekushchiy_nomer) {
        const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
        t += '\u25B6\uFE0F Ход: \u2116' + (cur ? cur.nomer : '?') + ' *' + (cur ? cur.name : '') + '*\n';
    }
    const vystavleny = nominirovannyePoPoryadku(igra);
    if (vystavleny.length && (igra.faza === 'opravdanie' || igra.faza === 'golosovanie')) {
        t += '\n\uD83D\uDCA5 *На голосовании:* ' + vystavleny.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
    }
    t += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
    if (igra.faza === 'opravdanie' || igra.faza === 'golosovanie') {
        if (vystavleny.length) {
            t += '\uD83D\uDCA5 *На голосовании (по порядку):*\n';
            vystavleny.forEach((i, idx) => {
                let em = '\uD83D\uDCA5';
                if (igra.tekushchiy_nomer === i.nomer) em = '\u25B6\uFE0F';
                t += (idx + 1) + '. ' + em + ' \u2116' + i.nomer + ' *' + i.name + '*';
                if (i.foly > 0) t += ' [' + i.foly + '\uD83D\uDD34]';
                t += '\n';
            });
        } else {
            t += '_Список на голосование пуст._\n';
        }
    } else {
        igra.igroki.forEach(i => {
            let em = i.status === 'v_igre' ? (i.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            if (igra.tekushchiy_nomer === i.nomer && i.status === 'v_igre') em = '\u25B6\uFE0F';
            if ((igra.naznacheny_golos || []).includes(i.nomer) && i.status === 'v_igre' &&
                (igra.faza === 'opravdanie' || igra.faza === 'golosovanie')) em = '\uD83D\uDCA5';
            t += em + ' \u2116' + i.nomer + ' *' + i.name + '*';
            if (i.foly > 0) t += ' [' + i.foly + '\uD83D\uDD34]';
            if (igra.zablokirovan_nomer === i.nomer && i.status === 'v_igre') t += ' \uD83D\uDD07';
            t += '\n';
        });
    }
    return t;
}

function poryadokHodaOtStarta(igra, startNomer, poChasovoy) {
    const alive = igra.igroki
        .filter(i => i.status === 'v_igre')
        .map(i => i.nomer)
        .sort((a, b) => a - b);
    let ordered = poChasovoy ? alive : [...alive].reverse();
    if (!startNomer || !ordered.includes(startNomer)) {
        return ordered.filter(n => n !== igra.zablokirovan_nomer);
    }
    const idx = ordered.indexOf(startNomer);
    const rotated = [...ordered.slice(idx), ...ordered.slice(0, idx)];
    return rotated.filter(n => n !== igra.zablokirovan_nomer);
}

function tekstVyboraPervogoHoda(igra, kod, faza) {
    let t = faza === 'znakomstvo'
        ? '\uD83D\uDC4B *Кто начинает представление?*'
        : '\u2600\uFE0F *Кто начинает день ' + (igra.den || 1) + '?*';
    t += ' — Игра \u2116' + kod + '\n\n';
    t += 'Выбери игрока кнопкой или отправь *номер / ник*.\n';
    t += faza === 'znakomstvo'
        ? 'Круг представления пойдёт *по часовой* с этого места.\n\n'
        : 'Дневные речи пойдут *против часовой* с этого места.\n\n';
    t += 'Можно выбрать вручную или нажать *«Назначить автоматически»*.\n\n';
    igra.igroki.filter(i => i.status === 'v_igre').forEach(i => {
        t += i.nomer + '. ' + i.name + '\n';
    });
    return t;
}

function knopkaKtoNachinaet(faza, den) {
    if (faza === 'znakomstvo') return '\uD83D\uDC4B Кто начинает представление?';
    return '\u2600\uFE0F Кто начинает день ' + (den || 1) + '?';
}

function knopkiVyboraPervogoHoda(igra, kod, faza) {
    const knopki = [[{ text: '🎲 Назначить автоматически', callback_data: 'perviy_hod_auto_' + kod + '_' + faza }]];
    knopki.push(...igra.igroki
        .filter(i => i.status === 'v_igre')
        .map(i => [{
            text: '\u25B6\uFE0F \u2116' + i.nomer + ' ' + i.name,
            callback_data: 'perviy_hod_' + kod + '_' + i.nomer + '_' + faza
        }]));
    knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]);
    return { inline_keyboard: knopki };
}

async function zaprositPervogoHoda(chatId, messageId, kod, faza, telegram_id) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);
    igra._zhdat_fazu = faza;
    sostoyanie[telegram_id] = 'perviy_hod_' + kod;
    const text = tekstVyboraPervogoHoda(igra, kod, faza);
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: knopkiVyboraPervogoHoda(igra, kod, faza)
    };
    try {
        if (messageId) {
            await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        } else {
            await bot.sendMessage(chatId, text, opts);
        }
    } catch (_) {
        await bot.sendMessage(chatId, text, opts);
    }
}

async function nachatFazuZnakomstva(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    await podgruzitNastroykiIgry(igra);
    await obnovitDostupnostSmenyVedushchego(igra, igra.vedushchii_id);
    const nastroyki = igra._nastroyki || {};
    igra.max_foly = nastroyki.max_foly || 4;
    igra.faza = 'znakomstvo';
    igra.poryadok_hoda = poryadokHodaOtStarta(igra, igra.perviy_hod_nomer, true);
    igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
    delete igra._pick_first_faza;
    const sek_z = nastroyki.znakomstvo_sek || 15;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'znakomstvo') }
    };
    const text = buildPanelText(igra, kod);
    if (!chatId) {
        await sohranit_igru(kod);
        return;
    }
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        zapustitTaymer(chatId, messageId, kod, sek_z);
    } else {
        const msg = await bot.sendMessage(chatId, text, opts);
        zapustitTaymer(chatId, msg.message_id, kod, sek_z);
    }
}

async function nachatFazuDen(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    await obnovitDostupnostSmenyVedushchego(igra, igra.vedushchii_id);
    stopTimer(kod);
    igra.faza = 'den';
    igra.poryadok_hoda = poryadokHodaOtStarta(igra, igra.perviy_hod_nomer, false);
    igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
    igra.naznacheny_golos = [];
    igra.vystavlenie_v_rechi = {};
    igra.golosa_dnya = {};
    delete igra._pick_first_faza;
    const sek_d = lichnoeVremyaSek(igra);
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'den') }
    };
    const text = buildPanelText(igra, kod);
    if (!chatId) {
        await sohranit_igru(kod);
        return;
    }
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
        zapustitTaymer(chatId, messageId, kod, sek_d);
    } else {
        const msg = await bot.sendMessage(chatId, text, opts);
        zapustitTaymer(chatId, msg.message_id, kod, sek_d);
    }
}

async function ustanovitPervogoHoda(chatId, messageId, kod, nomer, faza, telegram_id) {
    const igra = igry[kod];
    if (!igra) return false;
    const igrok = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
    if (!igrok) return false;
    igra.perviy_hod_nomer = nomer;
    delete igra._zhdat_fazu;
    if (telegram_id) delete sostoyanie[telegram_id];
    else delete sostoyanie[igra.vedushchii_id];
    await sohranit_igru(kod);
    if (faza === 'znakomstvo') await nachatFazuZnakomstva(chatId, messageId, kod);
    else await nachatFazuDen(chatId, messageId, kod);
    return true;
}

async function ustanovitPervogoHodaAvto(chatId, messageId, kod, faza, telegram_id) {
    const igra = igry[kod];
    if (!igra) return false;
    const kandidaty = (igra.igroki || []).filter(i => i.status === 'v_igre');
    if (kandidaty.length === 0) return false;
    const vybrannyy = kandidaty[Math.floor(Math.random() * kandidaty.length)];
    return ustanovitPervogoHoda(chatId, messageId, kod, vybrannyy.nomer, faza, telegram_id);
}

async function sleduyushchiy(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    stopTimer(kod);

    const alive = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.nomer);
    const poryadok = igra.poryadok_hoda || alive;
    const idx = poryadok.indexOf(igra.tekushchiy_nomer);
    const next_idx = idx + 1;

    if (next_idx >= poryadok.length) {
        // Все высказались — показываем кнопки конца фазы
        igra.tekushchiy_nomer = null;
        const faza = igra.faza;
        let t = buildPanelText(igra, kod);
        t += '\n\u2705 *Все высказались*\n';
        const knopki = [];
        if (faza === 'znakomstvo') knopki.push(...knopkiKoncaZnakomstva(igra, kod));
        if (faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 Выставить на голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        }
        if (faza === 'opravdanie') {
            knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
            knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
        }
        knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
        return;
    }

    igra.tekushchiy_nomer = poryadok[next_idx];
    const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
    const nastroyki = igra._nastroyki || {};
    let sekundy = igra.faza === 'znakomstvo' ? (nastroyki.znakomstvo_sek || 15)
        : igra.faza === 'opravdanie' ? (nastroyki.opravdanie_sek || 30)
        : lichnoeVremyaSek(igra);

    const t = buildPanelText(igra, kod);
    const knopki = buildTimerKnopki(kod, igra.faza);
    await bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    zapustitTaymer(chatId, messageId, kod, sekundy);
}

function vystavitIgrokaNaGolos(igra, igrok) {
    if (!igra || !igrok) return { ok: false, error: 'not_found' };
    if (igrok.status !== 'v_igre') return { ok: false, error: 'vybyl' };
    if (estImmunitetOtGolosovaniya(igrok)) return { ok: false, error: 'immunitet' };
    igra.naznacheny_golos = igra.naznacheny_golos || [];
    if (igra.naznacheny_golos.includes(igrok.nomer)) return { ok: true, already: true, igrok };
    igra.naznacheny_golos.push(igrok.nomer);
    return { ok: true, igrok };
}

function buildTimerKnopki(kod, faza) {
    const knopki = [
        [{ text: '\u23ED\uFE0F Пас', callback_data: 'pas_' + kod }, { text: '\u23F9 Стоп', callback_data: 'stop_taymer_' + kod }],
    ];
    if (faza === 'den') {
        const igra_t = igry[kod];
        if (igra_t?.tekushchiy_nomer) {
            if (uzheVystavilTekushchiyGovoryashchiy(igra_t)) {
                knopki.push([{ text: '\u274C Отменить выставление', callback_data: 'vystav_otmena_' + kod }]);
            } else if (kandidatyNaVystavlenie(igra_t, igra_t.tekushchiy_nomer).length > 0) {
                knopki.push([{ text: '\uD83D\uDCA5 Выставить (ник)', callback_data: 'vystav_nick_' + kod }]);
            }
            knopki.push([
                { text: '⏱ 40с', callback_data: 'set_minuta_' + kod + '_40' },
                { text: '⏱ 50с', callback_data: 'set_minuta_' + kod + '_50' },
                { text: '⏱ 60с', callback_data: 'set_minuta_' + kod + '_60' }
            ]);
        } else {
            knopki.push([{ text: '\uD83D\uDCCB Список на голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Ночь', callback_data: 'faza_noch_' + kod }]);
        }
    }
    if (faza === 'znakomstvo') {
        const igra_z = igry[kod];
        knopki.push(...knopkiKoncaZnakomstva(igra_z || {}, kod));
    }
    if (faza === 'opravdanie') {
        knopki.push([{ text: '\u270F\uFE0F Корректировать список', callback_data: 'vybrat_na_golos_' + kod }]);
        knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki.push([{ text: '\uD83D\uDDF3 Голосование', callback_data: 'faza_golosovanie_' + kod }]);
    }
    if (faza === 'golosovanie') {
        knopki.push([{ text: '\u270F\uFE0F Корректировать список', callback_data: 'vybrat_na_golos_' + kod }]);
    }
    const igra_sv = igry[kod];
    if (igra_sv?.klub_id && igra_sv._smena_ved_dostupna) {
        knopki.push([{ text: '🎤 Сменить ведущего', callback_data: 'smenit_vedushchego_' + kod }]);
    }
    knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);
    return knopki;
}

function estImmunitetOtGolosovaniya(igrok) {
    return !!(igrok?.immunitet || igrok?.immunitet_golos || igrok?.immunitet_do || igrok?.bonus_immunitet);
}

async function podgruzitImmunitetIgrokam(igra) {
    const ids = [...new Set((igra?.igroki || []).map(i => i.igrok_id).filter(Boolean))];
    if (!ids.length) return;
    try {
        const { data, error } = await supabase
            .from('igroki')
            .select('id, immunitet, immunitet_golos, immunitet_do, bonus_immunitet')
            .in('id', ids);
        if (error || !data) return;
        const map = Object.fromEntries(data.map(r => [r.id, r]));
        (igra.igroki || []).forEach(i => {
            const row = i.igrok_id && map[i.igrok_id];
            if (!row) return;
            if (row.immunitet) i.immunitet = row.immunitet;
            if (row.immunitet_golos) i.immunitet_golos = row.immunitet_golos;
            if (row.immunitet_do) i.immunitet_do = row.immunitet_do;
            if (row.bonus_immunitet) i.bonus_immunitet = row.bonus_immunitet;
        });
    } catch (_) {}
}

function tekstImmuniteta(igra) {
    const sImm = (igra.igroki || []).filter(i => i.status === 'v_igre' && estImmunitetOtGolosovaniya(i));
    if (sImm.length === 0) {
        return '\uD83D\uDEE1 *Иммунитет:* _нет_\n';
    }
    return '\uD83D\uDEE1 *Иммунитет:* ' + sImm.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n';
}

function tekstSpiskaPosleRoley(igra) {
    let t = '*Состав стола:*\n';
    [...(igra.igroki || [])].sort((a, b) => a.nomer - b.nomer).forEach(i => {
        const sh = estImmunitetOtGolosovaniya(i) ? ' \uD83D\uDEE1' : '';
        t += '\u2116' + i.nomer + ' ' + i.name + ' — *' + (i.rol || '?') + '*' + sh + '\n';
    });
    t += '\n' + tekstImmuniteta(igra);
    t += '_Игроков с иммунитетом нельзя выставить на голосование._';
    return t;
}

function govoryashchiyVystavilNaGolos(igra, govNomer) {
    if (!igra?.vystavlenie_v_rechi || govNomer == null) return null;
    const target = igra.vystavlenie_v_rechi[govNomer];
    return Number.isFinite(target) ? target : null;
}

function uzheVystavilTekushchiyGovoryashchiy(igra) {
    return govoryashchiyVystavilNaGolos(igra, igra?.tekushchiy_nomer) != null;
}

function otmenitVystavlenieGovoryashchego(igra, govNomer) {
    if (!igra || govNomer == null) return null;
    igra.vystavlenie_v_rechi = igra.vystavlenie_v_rechi || {};
    const target = igra.vystavlenie_v_rechi[govNomer];
    if (!Number.isFinite(target)) return null;
    delete igra.vystavlenie_v_rechi[govNomer];
    igra.naznacheny_golos = (igra.naznacheny_golos || []).filter(n => n !== target);
    sinhronizirovatSpisokGolosovaniya(igra);
    return target;
}

function kandidatyNaVystavlenie(igra, govoryashchiyNomer) {
    if (!igra) return [];
    if (govoryashchiyNomer != null && govoryashchiyVystavilNaGolos(igra, govoryashchiyNomer) != null) return [];
    const uzhe = new Set(igra.naznacheny_golos || []);
    return (igra.igroki || []).filter(i =>
        i.status === 'v_igre' &&
        !estImmunitetOtGolosovaniya(i) &&
        i.nomer !== govoryashchiyNomer &&
        !uzhe.has(i.nomer)
    );
}

function nominirovannyePoPoryadku(igra) {
    if (!igra) return [];
    return (igra.naznacheny_golos || [])
        .map(n => igra.igroki.find(i => i.nomer === n))
        .filter(i => i && i.status === 'v_igre');
}

function sinhronizirovatSpisokGolosovaniya(igra) {
    if (!igra) return;
    const seen = new Set();
    igra.naznacheny_golos = (igra.naznacheny_golos || []).filter(nomer => {
        if (seen.has(nomer)) return false;
        const igrok = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
        if (!igrok) return false;
        seen.add(nomer);
        return true;
    });
    if (igra.faza === 'opravdanie') {
        igra.poryadok_hoda = [...igra.naznacheny_golos];
        if (!igra.poryadok_hoda.includes(igra.tekushchiy_nomer)) {
            igra.tekushchiy_nomer = igra.poryadok_hoda[0] || null;
        }
    }
    if (igra.golosa_dnya) {
        const allowed = new Set(igra.naznacheny_golos);
        Object.keys(igra.golosa_dnya).forEach(n => {
            if (!allowed.has(parseInt(n, 10))) delete igra.golosa_dnya[n];
        });
    }
}

function kandidatyDobavitNaGolos(igra) {
    return kandidatyNaVystavlenie(igra, null);
}

function tekstSpiskaNominacii(igra) {
    const nom = nominirovannyePoPoryadku(igra);
    let t = '\uD83D\uDCA5 *Зафиксированный список на голосование*\n\n';
    t += '_Можно корректировать: добавить пропущенного, убрать лишнего и поменять порядок оправданий._\n\n';
    if (nom.length === 0) {
        t += '_Пока никто не выставлен._\n';
        t += '_Номинируй во время речи или нажми «Добавить игрока»._';
    } else {
        t += '*Порядок оправданий:*\n';
        nom.forEach((i, idx) => {
            t += (idx + 1) + '. \u2116' + i.nomer + ' *' + i.name + '*\n';
        });
    }
    return t;
}

function knopkiSpiskaNominacii(igra, kod) {
    const nom = nominirovannyePoPoryadku(igra);
    const knopki = [];
    nom.forEach((i, idx) => {
        const row = [];
        row.push({
            text: '\u274C ' + (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name,
            callback_data: 'golos_toggle_' + kod + '_' + i.nomer
        });
        if (idx > 0) row.push({ text: '\u2B06\uFE0F', callback_data: 'golos_up_' + kod + '_' + i.nomer });
        if (idx < nom.length - 1) row.push({ text: '\u2B07\uFE0F', callback_data: 'golos_down_' + kod + '_' + i.nomer });
        knopki.push(row);
    });
    if (kandidatyDobavitNaGolos(igra).length > 0) {
        knopki.push([{ text: '\u2795 Добавить пропущенного игрока', callback_data: 'golos_dobavit_' + kod }]);
    }
    if (nom.length > 0) {
        const text = igra.faza === 'opravdanie' ? '\u2705 Применить порядок оправданий' : '\u2705 Начать оправдание (' + nom.length + ')';
        knopki.push([{ text, callback_data: 'faza_opravdanie_' + kod }]);
    }
    const back = (igra.faza === 'opravdanie' || igra.faza === 'golosovanie') ? 'timer_back_' + kod : 'panel_' + kod;
    knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: back }]);
    return knopki;
}

function tekstDobavitNaGolos(igra) {
    let t = '\u2795 *Добавить на голосование*\n\n';
    t += '_Выбери игрока — он добавится в конец списка._\n';
    t += '_Игроки с иммунитетом и уже выставленные здесь не показываются._';
    return t;
}

function knopkiDobavitNaGolos(igra, kod) {
    const kandidaty = kandidatyDobavitNaGolos(igra);
    const knopki = kandidaty.map(i => [{
        text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name,
        callback_data: 'golos_add_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2B05\uFE0F К списку', callback_data: 'vybrat_na_golos_' + kod }]);
    return knopki;
}

function tekstVystavleniyaNaGolos(igra) {
    const cur = igra.igroki.find(i => i.nomer === igra.tekushchiy_nomer);
    const kandidaty = kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer);
    let t = '\uD83D\uDCA5 *Выставить на голосование*\n\n';
    if (cur) {
        t += 'Говорит: *№' + cur.nomer + ' ' + cur.name + '*';
        if (igra.taymer_aktiven && igra.taymer_sekundy > 0) {
            t += ' — ⏱ *' + formatTime(igra.taymer_sekundy) + '*';
        }
        t += '\n\n';
    }
    const uzheV = (igra.naznacheny_golos || [])
        .map(n => igra.igroki.find(i => i.nomer === n))
        .filter(i => i && i.status === 'v_igre');
    if (uzheV.length) {
        t += '*Уже на голосовании:* ' + uzheV.map(i => '\u2116' + i.nomer + ' ' + i.name).join(', ') + '\n\n';
    }
    if (kandidaty.length === 0) {
        t += '_Некого выставить — все доступные игроки уже номинированы._';
    } else {
        t += 'Кого выставляет *№' + cur.nomer + ' ' + cur.name + '*?\n';
        t += 'Выбери из списка или отправь *номер / ник*:\n\n';
        kandidaty.forEach(i => { t += i.nomer + '. ' + i.name + '\n'; });
        t += '\n_Таймер идёт — время не останавливается._';
    }
    return t;
}

function knopkiVystavleniyaNaGolos(igra, kod) {
    const kandidaty = kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer);
    const knopki = kandidaty.map(i => [{
        text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name,
        callback_data: 'vystav_pick_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2B05\uFE0F Отмена', callback_data: 'timer_back_' + kod }]);
    return { inline_keyboard: knopki };
}

async function vypolnitVystavlenieNaGolos(chatId, igra, kod, igrok_vg, telegram_id, opts = {}) {
    const silent = !!opts.silent;
    if (!igrok_vg || igrok_vg.status !== 'v_igre') {
        if (!silent && chatId) await bot.sendMessage(chatId, '\u274C Игрок не найден или уже выбыл.');
        return false;
    }
    const govoryashchiy = igra.igroki.find(i => i.nomer === (igra._vystav_ot_nomer ?? igra.tekushchiy_nomer));
    if (govoryashchiy && govoryashchiyVystavilNaGolos(igra, govoryashchiy.nomer) != null) {
        if (!silent && chatId) await bot.sendMessage(chatId, '\u26A0\uFE0F На этой речи уже выставлен один игрок. Отмени выставление, чтобы изменить.');
        return false;
    }
    if ((igra.naznacheny_golos || []).includes(igrok_vg.nomer)) {
        if (!silent && chatId) {
            sostoyanie[telegram_id] = 'vystav_golos_' + kod;
            await bot.sendMessage(chatId,
                '\u2139\uFE0F \u2116' + igrok_vg.nomer + ' *' + igrok_vg.name + '* уже на голосовании.\n\n' + tekstVystavleniyaNaGolos(igra),
                { parse_mode: 'Markdown', reply_markup: knopkiVystavleniyaNaGolos(igra, kod) }
            );
        }
        return false;
    }
    if (govoryashchiy && igrok_vg.nomer === govoryashchiy.nomer) {
        if (!silent && chatId) await bot.sendMessage(chatId, '\u26A0\uFE0F Нельзя выставить самого себя.');
        return false;
    }
    const rez_vg = vystavitIgrokaNaGolos(igra, igrok_vg);
    if (!rez_vg.ok) {
        if (!silent && chatId) {
            const msg_vg = rez_vg.error === 'immunitet'
                ? '\u26A0\uFE0F У этого игрока иммунитет — его нельзя выставить.'
                : rez_vg.error === 'vybyl'
                    ? '\u26A0\uFE0F Игрок уже выбыл.'
                    : '\u274C Не удалось выставить.';
            await bot.sendMessage(chatId, msg_vg);
        }
        return false;
    }
    if (govoryashchiy) {
        igra.vystavlenie_v_rechi = igra.vystavlenie_v_rechi || {};
        igra.vystavlenie_v_rechi[govoryashchiy.nomer] = igrok_vg.nomer;
    }
    delete sostoyanie[telegram_id];
    await sohranit_igru(kod);
    if (!silent && chatId) {
        const otKogo = govoryashchiy ? ('\u2116' + govoryashchiy.nomer + ' *' + govoryashchiy.name + '* выставил: ') : '';
        await bot.sendMessage(chatId, '\u2705 ' + otKogo + '\u2116' + igrok_vg.nomer + ' *' + igrok_vg.name + '* на голосовании.', {
            parse_mode: 'Markdown'
        });
    }
    obnovitPanelTaymera(kod);
    return true;
}

function tekstGolosovaniyaSPodschetom(igra, kod) {
    const golosa = igra.golosa_dnya || {};
    const naznacheny = nominirovannyePoPoryadku(igra);
    let t = '\uD83D\uDDF3 *Голосование* — Игра \u2116' + kod + '\n\n';
    t += 'Внеси количество голосов за каждого выставленного игрока.\n\n';
    if (naznacheny.length === 0) {
        t += '_Список на голосование пуст._';
    } else {
        t += '*Выставлены (по порядку):*\n';
        naznacheny.forEach((i, idx) => {
            const val = golosa[i.nomer];
            t += (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name + ' — *' + (Number.isFinite(val) ? val : 'не внесено') + '* голос(ов)\n';
        });
    }
    return t;
}

function knopkiGolosovaniyaSPodschetom(igra, kod) {
    const golosa = igra.golosa_dnya || {};
    const naznacheny = nominirovannyePoPoryadku(igra);
    const knopki = naznacheny.map((i, idx) => [{
        text: '\uD83D\uDD22 ' + (idx + 1) + '. \u2116' + i.nomer + ' ' + i.name + ' — ' + (Number.isFinite(golosa[i.nomer]) ? golosa[i.nomer] : '?'),
        callback_data: 'golos_count_' + kod + '_' + i.nomer
    }]);
    knopki.push([{ text: '\u2705 Подвести итог голосования', callback_data: 'golos_itog_auto_' + kod }]);
    knopki.push([{ text: '\u2705 Никто не выбывает', callback_data: 'golos_nikto_' + kod }]);
    knopki.push([{ text: '\u2B05\uFE0F К оправданию', callback_data: 'faza_opravdanie_' + kod }]);
    return knopki;
}

async function pokazat_prehod_k_nochi(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    igra.noch_deystviya = igra.noch_deystviya || {};
    await nachatNochGuided(chatId, messageId, kod);
}

function tipNochiPoRoli(rol) {
    if (rol === 'Мафия') return 'maf';
    if (rol === 'Дон') return 'don';
    if (rol === 'Эскортница') return 'eskort';
    if (rol === 'Консильери') return 'kons';
    if (isSheriffRole(rol)) return 'sher';
    if (rol === 'Маньяк') return 'manyak';
    if (rol === 'Доктор') return 'doc';
    if (rolStrelyayushchegoZaMirnyh(rol)) return 'strelok';
    if (rol === 'Шахид') return 'shahid';
    if (rol === 'Затычка') return 'zat';
    return null;
}

function labelShagaNochi(rol, variant, vsego) {
    const prefix = rol === 'Мафия' ? 'Мафия просыпается' : rol + ' просыпается';
    return prefix + (vsego > 1 ? ' (' + variant + '/' + vsego + ')' : '');
}

function igraEstZhivayaRol(igra, rol) {
    return (igra.igroki || []).some(i => i.status === 'v_igre' && i.rol === rol);
}

function shagiNochiDeystviy(igra) {
    const composition = poryadokRoleyDlyaNochi(igra);
    const steps = [];
    const seenTip = new Set();

    for (let i = 0; i < composition.length; i++) {
        const rol = composition[i];
        const tip = tipNochiPoRoli(rol);
        if (!tip) continue;
        if (!igraEstZhivayaRol(igra, rol)) continue;
        if (rol === 'Консильери' && !mozhetKonsilyeriVerbovat(igra)) continue;
        if (rol === 'Шахид' && !(igra.den === 1 || igra.den === 2)) continue;
        if (tip === 'eskort' || tip === 'shahid') continue;
        if ((tip === 'sher' || tip === 'strelok') && seenTip.has(tip)) continue;

        const variant = composition.slice(0, i + 1).filter(r => r === rol).length;
        const vsego = composition.filter(r => r === rol).length;
        steps.push({ rol, tip, variant, vsego, label: labelShagaNochi(rol, variant, vsego) });
        if (tip === 'sher' || tip === 'strelok') seenTip.add(tip);
    }
    return steps;
}

function kandidatyDlyaShagaNochi(igra, step) {
    const alive = (igra.igroki || []).filter(i => i.status === 'v_igre');
    if (!step) return alive;
    if (step.tip === 'maf') return alive.filter(i => !isMafiaRole(i.rol));
    if (step.tip === 'don') return alive.filter(i => i.rol !== 'Дон');
    if (step.tip === 'kons') return alive.filter(i => i.rol === 'Мирный');
    if (step.tip === 'manyak') return alive.filter(i => i.rol !== 'Маньяк');
    if (step.tip === 'strelok') {
        const strelok = alive.find(i => rolStrelyayushchegoZaMirnyh(i.rol));
        return alive.filter(i => i.nomer !== strelok?.nomer);
    }
    if (step.tip === 'zat') return alive.filter(i => i.rol !== 'Затычка');
    if (step.tip === 'eskort') {
        const eskort = alive.find(i => i.rol === 'Эскортница');
        const uzhe = new Set(eskortVyboryNochi(igra).map(v => v.nomer));
        return alive.filter(i => i.nomer !== eskort?.nomer && !uzhe.has(i.nomer));
    }
    return alive;
}

function tekstVyboraNochiGuided(igra, kod, step, idx, vsego) {
    let t = '\uD83C\uDF19 *Ночь ' + (igra.den || 1) + '* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
    t += 'Шаг *' + (idx + 1) + '/' + vsego + '*\n';
    t += '*' + step.label + '*\n\n';
    t += 'Выбери игрока кнопкой или отправь *номер / ник*.';
    const cur = tekushchiyVyborNochi(igra, step.tip);
    if (cur != null) t += '\n\n_Текущий выбор: №' + cur + '_';
    return t;
}

function tekushchiyVyborNochi(igra, tip) {
    const d = igra.noch_deystviya || {};
    if (tip === 'maf') return d.mafiya_tseli?.[0] ?? null;
    if (tip === 'don') return d.don_tseli ?? null;
    if (tip === 'kons') return d.kons_tseli ?? null;
    if (tip === 'doc') return d.doctor_tseli ?? null;
    if (tip === 'sher') return d.sherif_tseli ?? null;
    if (tip === 'manyak') return d.manyak_tseli ?? null;
    if (tip === 'strelok') return d.strelok_tseli ?? null;
    if (tip === 'zat') return d.zatychka_tseli ?? null;
    if (tip === 'shahid') {
        const miny = d.shahid_miny_tseli || igra.shahid_miny || [];
        return miny.length ? miny.join(', ') : null;
    }
    if (tip === 'eskort') {
        const v = eskortVyboryNochi(igra);
        return v.length ? v.map(x => x.nomer).join(', ') : null;
    }
    return null;
}

function sbrNochnoeDeystvie(igra, tip) {
    const d = igra.noch_deystviya || {};
    if (tip === 'maf') delete d.mafiya_tseli;
    else if (tip === 'don') delete d.don_tseli;
    else if (tip === 'kons') delete d.kons_tseli;
    else if (tip === 'doc') delete d.doctor_tseli;
    else if (tip === 'sher') delete d.sherif_tseli;
    else if (tip === 'manyak') delete d.manyak_tseli;
    else if (tip === 'strelok') delete d.strelok_tseli;
    else if (tip === 'zat') { delete d.zatychka_tseli; delete igra.zablokirovan_nomer; }
    else if (tip === 'shahid') delete d.shahid_miny_tseli;
    else if (tip === 'eskort') delete d.eskort_vybory;
    igra.noch_deystviya = d;
}

async function primeniNochnoeDeystvie(igra, tip, nomer, chatId) {
    igra.noch_deystviya = igra.noch_deystviya || {};
    const igrok = igra.igroki.find(i => i.nomer === nomer);
    if (!igrok || igrok.status !== 'v_igre') return { ok: false, text: 'Игрок не найден' };

    if (tip === 'maf') {
        igra.noch_deystviya.mafiya_tseli = [nomer];
        return { ok: true, text: 'Мафия → №' + nomer };
    }
    if (tip === 'don') {
        igra.noch_deystviya.don_tseli = nomer;
        const result = isSheriffRole(igrok.rol) ? 'ШЕРИФ/КОМИССАР' : 'Не шериф';
        return { ok: true, text: 'Дон → №' + nomer + ': ' + result, alert: result };
    }
    if (tip === 'kons') {
        if (igrok.rol !== 'Мирный') return { ok: false, text: 'Можно завербовать только обычного мирного.' };
        igra.noch_deystviya.kons_tseli = nomer;
        return { ok: true, text: 'Консильери → №' + nomer };
    }
    if (tip === 'doc') {
        const proverka = proveritLechitDoktor(igra, nomer);
        if (!proverka.ok) return { ok: false, text: proverka.text };
        igra.noch_deystviya.doctor_tseli = nomer;
        return { ok: true, text: 'Доктор → №' + nomer };
    }
    if (tip === 'sher') {
        igra.noch_deystviya.sherif_tseli = nomer;
        const result = isMafiaRole(igrok.rol) ? 'МАФИЯ' : 'Мирный';
        return { ok: true, text: 'Шериф → №' + nomer + ': ' + result, alert: result };
    }
    if (tip === 'manyak') {
        igra.noch_deystviya.manyak_tseli = nomer;
        return { ok: true, text: 'Маньяк → №' + nomer };
    }
    if (tip === 'strelok') {
        igra.noch_deystviya.strelok_tseli = nomer;
        return { ok: true, text: 'Стрелок → №' + nomer };
    }
    if (tip === 'zat') {
        igra.noch_deystviya.zatychka_tseli = nomer;
        igra.zablokirovan_nomer = nomer;
        if (igrok.telegram_id && chatId) {
            bot.sendMessage(igrok.telegram_id,
                '\uD83D\uDD07 *Затычка заблокировала тебя этой ночью.*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        return { ok: true, text: 'Затычка → №' + nomer };
    }
    return { ok: false, text: 'Неизвестное действие' };
}

function knopkiShagaNochiGuided(igra, kod, step, idx) {
    const knopki = kandidatyDlyaShagaNochi(igra, step).map(i => [{
        text: '\u2116' + i.nomer + ' ' + i.name,
        callback_data: 'noch_g_pick_' + kod + '_' + idx + '_' + i.nomer
    }]);
    if (tekushchiyVyborNochi(igra, step.tip) != null) {
        knopki.push([{ text: '\u274C Сбросить выбор', callback_data: 'noch_g_sbr_' + kod + '_' + idx }]);
    }
    knopki.push([{ text: '\u23ED Далее', callback_data: 'noch_g_next_' + kod }]);
    if (idx > 0) knopki.push([{ text: '\u2B05 Предыдущая роль', callback_data: 'noch_g_prev_' + kod }]);
    knopki.push([{ text: '\uD83D\uDCCB Классическая панель', callback_data: 'noch_panel_' + kod }]);
    return knopki;
}

async function nachatNochGuided(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    igra._noch_guided_idx = 0;
    await pokazatShagNochiGuided(chatId, messageId, kod);
}

async function pokazatShagNochiGuided(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    const shagi = shagiNochiDeystviy(igra);
    if (!shagi.length) {
        await pokazat_noch_panel(chatId, messageId, kod, null);
        return;
    }
    let idx = Number.isFinite(igra._noch_guided_idx) ? igra._noch_guided_idx : 0;
    if (idx >= shagi.length) {
        await pokazatSvodkuNochiGuided(chatId, messageId, kod);
        return;
    }
    if (idx < 0) idx = 0;
    igra._noch_guided_idx = idx;
    const step = shagi[idx];
    const t = tekstVyboraNochiGuided(igra, kod, step, idx, shagi.length);
    const knopki = knopkiShagaNochiGuided(igra, kod, step, idx);
    if (chatId && messageId) {
        await bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }
}

async function pokazatSvodkuNochiGuided(chatId, messageId, kod) {
    const igra = igry[kod];
    if (!igra) return;
    const shagi = shagiNochiDeystviy(igra);
    let t = '\uD83C\uDF19 *Ночь ' + (igra.den || 1) + ' — сводка*\n\n';
    shagi.forEach((step, idx) => {
        const cur = tekushchiyVyborNochi(igra, step.tip);
        t += (cur != null ? '\u2705' : '\u25A1') + ' ' + step.label;
        t += cur != null ? ' → №' + cur : '';
        t += '\n';
    });
    t += '\n_Эскортница и Шахид — на классической панели ночи._';
    const knopki = shagi.map((step, idx) => [{
        text: '\u270F ' + step.label,
        callback_data: 'noch_g_redo_' + kod + '_' + idx
    }]);
    knopki.push([{ text: '\uD83C\uDF1F Итоги ночи', callback_data: 'noch_itog_' + kod }]);
    knopki.push([{ text: '\uD83D\uDCCB Классическая панель', callback_data: 'noch_panel_' + kod }]);
    if (chatId && messageId) {
        await bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }
}

async function nachatIntroNoch(igra, kod) {
    if ((igra.igroki || []).length < igra.kolichestvo) {
        return { ok: false, message: 'Сначала внеси полный состав.' };
    }
    igra.rezhim_rolei = 'karty';
    igra.den = 1;
    igra.faza = 'noch_znakomstvo';
    igra.igroki.forEach(i => { delete i.rol; });
    igra._miniapp_intro = { idx: 0, phase: 'roles' };
    delete igra._pick_first_faza;
    await sohranit_igru(kod);
    const step = shagIntroNochi(igra);
    return { ok: true, message: 'Ночь знакомства: ' + (step?.label || 'начало') };
}

async function primeniIntroRol(igra, kod, nomer) {
    const step = shagIntroNochi(igra);
    if (!step || step.phase !== 'roles') return { ok: false, message: 'Сейчас не этап активных ролей.' };
    const igrok = igra.igroki.find(i => i.nomer === nomer && i.status === 'v_igre');
    if (!igrok) return { ok: false, message: 'Игрок не найден.' };
    if (igrok.rol) return { ok: false, message: 'У №' + igrok.nomer + ' уже роль ' + igrok.rol };
    igrok.rol = step.rol;
    igrok.status = 'v_igre';
    igrok.foly = igrok.foly || 0;
    igra._miniapp_intro.idx = (igra._miniapp_intro.idx || 0) + 1;
    const roles = poryadokRoleyDlyaNochi(igra);
    if (igra._miniapp_intro.idx >= roles.length) igra._miniapp_intro.phase = 'mirny';
    await sohranit_igru(kod);
    const next = shagIntroNochi(igra);
    return { ok: true, message: '№' + igrok.nomer + ' — ' + step.rol, next };
}

async function primeniIntroMirnogo(igra, kod, nomer) {
    if (mirnyeOstalosVnesti(igra) <= 0) {
        const rez = await zavershitNochZnakomstva(null, kod, { silent: true });
        return { ok: rez?.ok !== false, message: rez?.message || 'Готово', done: true };
    }
    const igrok = igra.igroki.find(i => i.nomer === nomer);
    if (!igrok) return { ok: false, message: 'Игрок не найден.' };
    if (igrok.rol && igrok.rol !== 'Мирный') return { ok: false, message: 'У игрока уже роль ' + igrok.rol };
    const rez = await dobavitMirnogoVIgru(null, igra, kod, igrok);
    if (!rez.ok) {
        if (rez.error === 'already') return { ok: false, message: 'Уже мирный' };
        return { ok: false, message: 'Не удалось назначить мирного' };
    }
    await sohranit_igru(kod);
    if (rez.ostalos <= 0) {
        const fin = await zavershitNochZnakomstva(null, kod, { silent: true });
        return { ok: true, message: '№' + igrok.nomer + ' — Мирный. Ночь знакомства завершена.', done: true, pick_first: fin?.message };
    }
    return { ok: true, message: '№' + igrok.nomer + ' — Мирный. Осталось: ' + rez.ostalos };
}

async function primeniIntroMirnyhSpiskom(igra, kod, text) {
    const nuzhno = mirnyeOstalosVnesti(igra);
    if (nuzhno <= 0) return { ok: false, message: 'Мирные уже внесены' };
    const niki = razobratSpisokNikov(text);
    if (niki.length !== nuzhno) {
        return { ok: false, message: 'Нужно ровно ' + nuzhno + ' ников мирных.' };
    }
    for (const nick of niki) {
        let igrok = naytiIgrokaPoVvodu(igra, nick);
        if (!igrok) return { ok: false, message: 'Не найден: ' + nick };
        if (igrok.rol && igrok.rol !== 'Мирный') return { ok: false, message: nick + ' уже ' + igrok.rol };
        igrok.rol = 'Мирный';
        await privyazatIgrokaIzBazy(igra, igrok);
    }
    await sohranit_igru(kod);
    const fin = await zavershitNochZnakomstva(null, kod, { silent: true });
    return { ok: fin?.ok !== false, message: fin?.message || 'Ночь знакомства завершена', done: true };
}

async function primeniItogiNochiMiniApp(igra, kod) {
    const d = igra.noch_deystviya || {};
    let itog_t = 'Итоги ночи ' + (igra.den || 1) + ':\n';
    if (d.don_tseli) {
        const proverka_don = igra.igroki.find(x => x.nomer === d.don_tseli);
        itog_t += 'Дон → №' + d.don_tseli + ': ' + (proverka_don && isSheriffRole(proverka_don.rol) ? 'Шериф' : 'не шериф') + '\n';
    }
    if (d.sherif_tseli) {
        const proverka_sher = igra.igroki.find(x => x.nomer === d.sherif_tseli);
        itog_t += 'Шериф → №' + d.sherif_tseli + ': ' + (proverka_sher && isMafiaRole(proverka_sher.rol) ? 'мафия' : 'мирный') + '\n';
    }
    if (d.kons_tseli) {
        const zaverbovan = igra.igroki.find(x => x.nomer === d.kons_tseli && x.status === 'v_igre' && x.rol === 'Мирный');
        if (zaverbovan) zaverbovan.rol = 'Мафия';
    }
    if (d.shahid_miny_tseli) igra.shahid_miny = [...d.shahid_miny_tseli];
    const vystrely = primenitNochnyeVystrely(igra, d);
    vystrely.lines.forEach(line => { itog_t += line.replace(/\*/g, ''); });
    const ubity_t = vystrely.ubity_t;
    const eskortVybory = d.eskort_vybory || [];
    eskortVybory.forEach(v => {
        const tselEsk = igra.igroki.find(x => x.nomer === v.nomer);
        if (tselEsk && tselEsk.status === 'v_igre' && sravnitRoliEskort(v.ugadannaya_rol, tselEsk.rol)) {
            tselEsk.status = 'vybyl';
            itog_t += 'Эскортница угадала №' + tselEsk.nomer + '\n';
        }
    });
    const v_igre_t = igra.igroki.filter(i => i.status === 'v_igre');
    itog_t += '\nЗа столом: ' + v_igre_t.length;
    ubity_t.forEach(i => {
        if (i.telegram_id) {
            bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Тебя убили ночью.*\n\nТвоя роль: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        }
    });
    zapisatIstoriyuDoktora(igra, d.doctor_tseli);
    igra.noch_deystviya = {};
    igra.faza = 'den';
    igra._noch_guided_idx = null;
    igra._miniapp_noch_itog = itog_t;
    const pobeditel = opredelitPobeditelya(igra);
    if (pobeditel) {
        igra.pobeditel = pobeditel;
        return { ok: true, message: 'Игра окончена', summary: itog_t, game_over: true, pobeditel };
    }
    igra.den = (igra.den || 1) + 1;
    igra._pick_first_faza = 'den';
    await sohranit_igru(kod);
    return { ok: true, message: 'Ночь завершена. Выбери, кто начинает день ' + igra.den, summary: itog_t };
}

async function miniAppHostAction(tg_id, user, body) {
    const kod = String(body.kod || '');
    const sub = body.sub;
    const igra = igry[kod];
    if (!igra || igra.vedushchii_id !== tg_id) {
        return { stay: true, message: 'Нет доступа к игре.' };
    }

    if (sub === 'pass') {
        await hostPasBezPaneli(igra, kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Следующий игрок');
    }
    if (sub === 'nominate') {
        const nomer = parseInt(body.nomer, 10);
        igra._vystav_ot_nomer = igra.tekushchiy_nomer;
        const igrok = igra.igroki.find(i => i.nomer === nomer);
        const ok = await vypolnitVystavlenieNaGolos(null, igra, kod, igrok, tg_id, { silent: true });
        return otvetMiniAppPosleDeystviya(tg_id, user, ok ? 'Игрок выставлен' : 'Не удалось выставить');
    }
    if (sub === 'undo_nominate') {
        const removed = otmenitVystavlenieGovoryashchego(igra, igra.tekushchiy_nomer);
        await sohranit_igru(kod);
        obnovitPanelTaymera(kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, removed != null ? 'Выставление отменено' : 'Нечего отменять');
    }
    if (sub === 'night') {
        stopTimer(kod);
        igra.faza = 'noch';
        igra.naznacheny_golos = [];
        igra.vystavlenie_v_rechi = {};
        igra.golosa_dnya = {};
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra._noch_guided_idx = 0;
        igra._miniapp_noch_itog = null;
        await sohranit_igru(kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Ночь ' + (igra.den || 1) + ' — шаг 1/' + shagiNochiDeystviy(igra).length);
    }
    if (sub === 'night_pick') {
        const shagi = shagiNochiDeystviy(igra);
        const idx = Number.isFinite(igra._noch_guided_idx) ? igra._noch_guided_idx : 0;
        const step = shagi[idx];
        const nomer = parseInt(body.nomer, 10);
        if (!step) return { stay: true, message: 'Ночные шаги завершены' };
        const rez = await primeniNochnoeDeystvie(igra, step.tip, nomer, null);
        if (!rez.ok) return { stay: true, message: rez.text };
        await sohranit_igru(kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, rez.text);
    }
    if (sub === 'night_next') {
        const shagi = shagiNochiDeystviy(igra);
        igra._noch_guided_idx = Math.min((igra._noch_guided_idx || 0) + 1, shagi.length);
        await sohranit_igru(kod);
        const done = igra._noch_guided_idx >= shagi.length;
        return otvetMiniAppPosleDeystviya(tg_id, user, done ? 'Все роли пройдены' : ('Шаг ' + (igra._noch_guided_idx + 1) + '/' + shagi.length));
    }
    if (sub === 'night_reset') {
        const idx = parseInt(body.step, 10);
        const shagi = shagiNochiDeystviy(igra);
        const step = shagi[idx];
        if (step) sbrNochnoeDeystvie(igra, step.tip);
        await sohranit_igru(kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Выбор сброшен');
    }
    if (sub === 'intro_start') {
        const rez = await nachatIntroNoch(igra, kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, rez.message);
    }
    if (sub === 'intro_assign') {
        const rez = await primeniIntroRol(igra, kod, parseInt(body.nomer, 10));
        return otvetMiniAppPosleDeystviya(tg_id, user, rez.message);
    }
    if (sub === 'intro_mirny') {
        if (body.text) {
            const rez = await primeniIntroMirnyhSpiskom(igra, kod, body.text);
            return otvetMiniAppPosleDeystviya(tg_id, user, rez.message);
        }
        const rez = await primeniIntroMirnogo(igra, kod, parseInt(body.nomer, 10));
        return otvetMiniAppPosleDeystviya(tg_id, user, rez.message);
    }
    if (sub === 'pick_first') {
        const nomer = parseInt(body.nomer, 10);
        const faza = body.faza || igra._pick_first_faza || 'den';
        const ok = await ustanovitPervogoHoda(null, null, kod, nomer, faza, tg_id);
        return otvetMiniAppPosleDeystviya(tg_id, user, ok ? ('Начинает №' + nomer) : 'Не удалось выбрать игрока');
    }
    if (sub === 'pick_first_auto') {
        const faza = body.faza || igra._pick_first_faza || 'den';
        const ok = await ustanovitPervogoHodaAvto(null, null, kod, faza, tg_id);
        return otvetMiniAppPosleDeystviya(tg_id, user, ok ? 'Первый игрок выбран автоматически' : 'Не удалось');
    }
    if (sub === 'night_finish') {
        const rez = await primeniItogiNochiMiniApp(igra, kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, rez.message, { night_summary: rez.summary });
    }
    if (sub === 'night_prev') {
        igra._noch_guided_idx = Math.max(0, (igra._noch_guided_idx || 0) - 1);
        await sohranit_igru(kod);
        return otvetMiniAppPosleDeystviya(tg_id, user, 'Предыдущая роль');
    }

    return { stay: true, message: 'Неизвестное действие' };
}

async function hostPasBezPaneli(igra, kod) {
    stopTimer(kod);
    const poryadok = igra.poryadok_hoda || igra.igroki.filter(i => i.status === 'v_igre').map(i => i.nomer);
    const idx = poryadok.indexOf(igra.tekushchiy_nomer);
    const next_idx = idx + 1;
    if (next_idx >= poryadok.length) igra.tekushchiy_nomer = null;
    else igra.tekushchiy_nomer = poryadok[next_idx];
    await sohranit_igru(kod);
    obnovitPanelTaymera(kod);
}


async function pokazat_noch_panel(chatId, messageId, kod, log_msg) {
    const igra = igry[kod];
    if (!igra) return;
    await zagruzitNazvanieKlubaVIgru(igra);
    const d = igra.noch_deystviya || {};
    const roli_alive = igra.igroki.filter(i => i.status === 'v_igre').map(i => i.rol);

    let t = '\uD83C\uDF19 *Ночь ' + (igra.den || 1) + '* — Игра \u2116' + kod + '\n\n';
    if (nazvanieKlubaIgry(igra)) t += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n\n';
    if (log_msg) t += log_msg + '\n\n';
    t += '_Действия:_\n';
    t += (d.mafiya_tseli?.length ? '\u2705' : '\u25A1') + ' Мафия: ' + (d.mafiya_tseli?.length ? '\u2116' + d.mafiya_tseli[0] : 'не выбрала') + '\n';
    if (roli_alive.includes('Дон')) t += (d.don_tseli ? '\u2705' : '\u25A1') + ' Дон: ' + (d.don_tseli ? '\u2116' + d.don_tseli + ' проверен' : 'не проверял') + '\n';
    if (roli_alive.includes('Эскортница')) t += (eskortVyboryNochi(igra).length ? '\u2705' : '\u25A1') + ' Эскортница: ' + tekstStatusaEskort(igra) + '\n';
    if (roli_alive.includes('Консильери')) t += (d.kons_tseli ? '\u2705' : '\u25A1') + ' Консильери: ' + (d.kons_tseli ? '\u2116' + d.kons_tseli + ' завербован' : (mozhetKonsilyeriVerbovat(igra) ? 'может вербовать' : 'ждёт условия <30%')) + '\n';
    if (roli_alive.includes('Доктор')) t += (d.doctor_tseli ? '\u2705' : '\u25A1') + ' Доктор: ' + (d.doctor_tseli ? '\u2116' + d.doctor_tseli : 'не выбрал') + '\n';
    if (roli_alive.some(isSheriffRole)) t += (d.sherif_tseli ? '\u2705' : '\u25A1') + ' Шериф/Комиссар: ' + (d.sherif_tseli ? '\u2116' + d.sherif_tseli + ' проверен' : 'не проверял') + '\n';
    if (roli_alive.includes('Маньяк')) t += (d.manyak_tseli ? '\u2705' : '\u25A1') + ' Маньяк: ' + (d.manyak_tseli ? '\u2116' + d.manyak_tseli : 'не выбрал') + '\n';
    if (roli_alive.some(rolStrelyayushchegoZaMirnyh)) t += (d.strelok_tseli ? '\u2705' : '\u25A1') + ' Стрелок/Охотник: ' + (d.strelok_tseli ? '\u2116' + d.strelok_tseli : 'не выбрал') + '\n';
    if (roli_alive.includes('Затычка')) t += (d.zatychka_tseli ? '\u2705' : '\u25A1') + ' Затычка: ' + (d.zatychka_tseli ? '\u2116' + d.zatychka_tseli + ' заблокирован' : 'не выбрала') + '\n';
    if (roli_alive.includes('Шахид') && (igra.den === 1 || igra.den === 2)) {
        const miny = d.shahid_miny_tseli || igra.shahid_miny || [];
        t += (miny.length ? '\u2705' : '\u25A1') + ' Шахид: ' + (miny.length ? miny.map(n => '\u2116' + n).join(', ') : 'не минировал') + '\n';
    }

    const knopki = [
        [{ text: '\uD83D\uDD2B Мафия убивает', callback_data: 'noch_vybor_maf_' + kod }],
    ];
    if (roli_alive.includes('Дон')) knopki.push([{ text: '\uD83D\uDD0E Дон ищет Шерифа', callback_data: 'noch_vybor_don_' + kod }]);
    if (roli_alive.includes('Эскортница') && eskortVyboryNochi(igra).length < limitVystrelovEskort(igra)) {
        knopki.push([{ text: '\uD83D\uDC8B Эскортница (' + eskortVyboryNochi(igra).length + '/' + limitVystrelovEskort(igra) + ')', callback_data: 'noch_vybor_eskort_' + kod }]);
    }
    if (roli_alive.includes('Консильери') && mozhetKonsilyeriVerbovat(igra)) knopki.push([{ text: '\uD83E\uDD1D Консильери вербует', callback_data: 'noch_vybor_kons_' + kod }]);
    if (roli_alive.includes('Доктор')) knopki.push([{ text: '\uD83D\uDC89 Доктор лечит', callback_data: 'noch_vybor_doc_' + kod }]);
    if (roli_alive.some(isSheriffRole)) knopki.push([{ text: '\uD83D\uDD0D Шериф/Комиссар проверяет', callback_data: 'noch_vybor_sher_' + kod }]);
    if (roli_alive.includes('Маньяк')) knopki.push([{ text: '\uD83C\uDFAF Маньяк стреляет', callback_data: 'noch_vybor_manyak_' + kod }]);
    if (roli_alive.some(rolStrelyayushchegoZaMirnyh)) knopki.push([{ text: '\uD83D\uDD2B Стрелок/Охотник стреляет', callback_data: 'noch_vybor_strelok_' + kod }]);
    if (roli_alive.includes('Затычка')) knopki.push([{ text: '\uD83D\uDD07 Затычка блокирует', callback_data: 'noch_vybor_zat_' + kod }]);
    if (roli_alive.includes('Шахид') && (igra.den === 1 || igra.den === 2)) {
        knopki.push([{ text: igra.den === 1 ? '\uD83D\uDCA3 Шахид минирует' : '\uD83D\uDCA3 Шахид переминирует', callback_data: 'noch_vybor_shahid_' + kod }]);
    }
    knopki.push([{ text: '\uD83C\uDF1F Итоги ночи', callback_data: 'noch_itog_' + kod }]);
    if (d.mafiya_tseli?.length) knopki.push([{ text: '\u274C Сброс: мафия', callback_data: 'noch_sbr_maf_' + kod }]);
    if (d.don_tseli) knopki.push([{ text: '\u274C Сброс: дон', callback_data: 'noch_sbr_don_' + kod }]);
    if (d.kons_tseli) knopki.push([{ text: '\u274C Сброс: консильери', callback_data: 'noch_sbr_kons_' + kod }]);
    if (d.doctor_tseli) knopki.push([{ text: '\u274C Сброс: доктор', callback_data: 'noch_sbr_doc_' + kod }]);
    if (d.sherif_tseli) knopki.push([{ text: '\u274C Сброс: шериф', callback_data: 'noch_sbr_sher_' + kod }]);
    if (d.manyak_tseli) knopki.push([{ text: '\u274C Сброс: маньяк', callback_data: 'noch_sbr_manyak_' + kod }]);
    if (d.strelok_tseli) knopki.push([{ text: '\u274C Сброс: стрелок', callback_data: 'noch_sbr_strelok_' + kod }]);
    if (d.zatychka_tseli) knopki.push([{ text: '\u274C Сброс: затычка', callback_data: 'noch_sbr_zat_' + kod }]);
    knopki.push([{ text: '\uD83C\uDF19 Пошаговая ночь', callback_data: 'noch_guided_' + kod }]);
    knopki.push([{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }]);

    bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
}


// ============================================
// ФУНКЦИЯ ЗАПИСИ БАЛЛОВ
// ============================================
async function zapisat_bally(igra, kod) {
    const pobeditel = igra.pobeditel;
    const sportivniy = igra._nastroyki?.sportivniy_rezhim || false;

    // Загружаем настройки баллов клуба
    let ballyConfig = { ...BALLY_DEFAULT };
    if (igra.klub_id) {
        const { data: klub } = await supabase.from('kluby').select('nastroyki').eq('id', igra.klub_id).single();
        if (klub?.nastroyki?.bally) ballyConfig = { ...BALLY_DEFAULT, ...klub.nastroyki.bally };
    }

    const maf_roli = MAFIA_ROLES;
    const noch_ubity = igra.noch_ubity_pervaya || [];

    const records = [];
    for (const igrok of igra.igroki) {
        if (!igrok.igrok_id) continue; // пропускаем если нет id в БД

        const is_maf = maf_roli.includes(igrok.rol);
        const is_manyak = igrok.rol === 'Маньяк';
        const is_sherif = igrok.rol === 'Шериф';
        const is_doctor = igrok.rol === 'Доктор';
        const is_kamikadze = igrok.rol === 'Камикадзе';
        const vyzhil = igrok.status === 'v_igre';

        // Определяем победу
        let pobeda = false;
        if (pobeditel === 'mirnye' && !is_maf && !is_manyak) pobeda = true;
        if (pobeditel === 'mafiya' && is_maf) pobeda = true;
        if (pobeditel === 'manyak' && is_manyak) pobeda = true;

        let bk = pobeda ? ballyConfig.pobeda_komanda : ballyConfig.porazhenie;
        let bl = 0;
        if (pobeditel === 'mafiya' && is_maf) {
            bk = 0;
            bl += vyzhil ? (ballyConfig.mafiya_pobedila_vyzhil ?? 4) : (ballyConfig.mafiya_pobedila_vybyl ?? 3);
        } else if (pobeditel === 'manyak' && is_manyak) {
            bk = 0;
            bl += ballyConfig.bonus_manyak_pobedil ?? 5;
        } else if (vyzhil && pobeda) {
            bl += ballyConfig.vyzhil ?? 0.25;
        }
        if (is_maf && pobeda && igrok.rol === 'Дон') bl += ballyConfig.bonus_don_pobedil ?? 0;
        if (igrok.bonus_pts) bl += igrok.bonus_pts;

        const bonus_info = {};
        if (igrok.bonus_pts) bonus_info.ruchnoy = { pts: igrok.bonus_pts, text: igrok.bonus_text };
        if (igrok.teh_trup) {
            const ptsTeh = ballyConfig.shtraf_teh_trup ?? -2;
            bl += ptsTeh;
            bonus_info.teh_trup = { pts: ptsTeh, text: 'Тех. труп' };
        }
        const avtoBonusy = (igra.avto_bonusy || []).filter(b => b.nomer === igrok.nomer);
        if (avtoBonusy.length > 0) {
            let avtoPts = 0;
            bonus_info.avto = avtoBonusy.map(b => {
                const pts = ballyConfig[b.key] ?? b.pts ?? 0;
                avtoPts += pts;
                return { ...b, pts };
            });
            bl += avtoPts;
        }
        if ((igra.den1_vygolosovany || []).includes(igrok.nomer)) {
            const ptsDen1 = ballyConfig.bonus_den1_vygolosovan ?? 0.25;
            bl += ptsDen1;
            bonus_info.den1_vygolosovan = { pts: ptsDen1, text: 'Выголосован в первый день' };
        }
        const luchshiyHod = (igra.luchshie_hody || []).find(h => h.igrok_nomer === igrok.nomer);
        if (luchshiyHod) {
            const ugadany = (luchshiyHod.nazvannye || []).filter(nomer => {
                const named = igra.igroki.find(x => x.nomer === nomer);
                return named && isMafiaRole(named.rol);
            });
            const ptsLuchshiyHod = ugadany.length * (ballyConfig.luchshiy_hod_za_mafiyu ?? 1);
            if (ptsLuchshiyHod > 0) bl += ptsLuchshiyHod;
            bonus_info.luchshiy_hod = {
                pts: ptsLuchshiyHod,
                prichina: luchshiyHod.prichina,
                nazvannye: luchshiyHod.nazvannye || [],
                ugadany
            };
        }

        const record = {
            kod_igry: kod,
            klub_id: igra.klub_id || null,
            igrok_id: igrok.igrok_id,
            rol: igrok.rol,
            pobedila_komanda: pobeda,
            vyzhil,
            bally_komanda: bk,
            bally_lichnie: bl,
            bally_vsego: bk + bl,
            sportivniy,
            bonus_info
        };
        if (igra.data_igry) record.data_igry = igra.data_igry;
        records.push(record);
    }

    if (records.length > 0) {
        await supabase.from('bally').insert(records);
    }
}

// ============================================
// РЕЙТИНГ КЛУБА
// ============================================
async function pokazat_reyting_kluba(chatId, messageId, klub_id, sportivniy) {
    const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();

    const { data: top } = await supabase
        .from('bally')
        .select('igrok_id, bally_vsego, igroki(imya, igrovoy_nik)')
        .eq('klub_id', klub_id)
        .eq('sportivniy', sportivniy || false);

    // Суммируем по игроку
    const totals = {};
    (top || []).forEach(row => {
        const id = row.igrok_id;
        if (!totals[id]) totals[id] = { name: row.igroki?.igrovoy_nik || row.igroki?.imya || '?', pts: 0, igr: 0 };
        totals[id].pts += row.bally_vsego;
        totals[id].igr++;
    });

    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts).slice(0, 20);
    const tip = sportivniy ? '\uD83C\uDFC6 Спортивный' : '\uD83C\uDF06 Городской';

    let t = tip + ' рейтинг — *' + (klub?.nazvaniye || '') + '*\n\n';
    if (sorted.length === 0) {
        t += '_Пока нет результатов_';
    } else {
        const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
        sorted.forEach((p, i) => {
            const m = medals[i] || (i + 1) + '.';
            t += m + ' *' + p.name + '* — ' + p.pts + ' очк. (' + p.igr + ' игр)\n';
        });
    }

    bot.editMessageText(t, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '\uD83D\uDCE5 Скачать CSV', callback_data: 'reyting_csv_' + klub_id + '_' + (sportivniy ? '1' : '0') }],
            [{ text: sportivniy ? '\uD83C\uDF06 Городской рейтинг' : '\uD83C\uDFC6 Спортивный рейтинг', callback_data: 'reyting_klub_' + klub_id + '_' + (sportivniy ? '0' : '1') }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'reyting_vybor_kluba' }]
        ]}
    });
}


// ============================================
// ПРЕДПРОСМОТР СОСТАВА РОЛЕЙ
// ============================================
function pokazat_sostav_preview(kolichestvo, tip_kluba, nastroyki_kluba, nazvaniye_kluba = '') {
    // Берём кастомный состав если есть, иначе стандартный
    let sostav;
    const kastomnye = nastroyki_kluba?.kastomnye_sostavy?.[kolichestvo];
    if (kastomnye) {
        sostav = kastomnye;
    } else {
        sostav = poluchit_sostav(kolichestvo, tip_kluba);
    }
    if (!sostav) return null;

    // Группируем роли
    const solo_roli = ['Маньяк'];

    const mafiya = sostav.filter(r => isMafiaRole(r));
    const solo = sostav.filter(r => solo_roli.includes(r));
    const mirnye = sostav.filter(r => !isMafiaRole(r) && !solo_roli.includes(r));

    let t = '\uD83C\uDFB2 *Состав на ' + kolichestvo + ' человек*';
    if (nazvaniye_kluba) t += '\nКлуб: *' + nazvaniye_kluba + '*';
    t += '\n\n';

    t += '\uD83D\uDD34 *Мафия (' + mafiya.length + '):*\n';
    // Считаем уникальные
    const maf_count = {};
    mafiya.forEach(r => { maf_count[r] = (maf_count[r] || 0) + 1; });
    Object.entries(maf_count).forEach(([r, n]) => { t += '  ' + r + (n > 1 ? ' ×' + n : '') + '\n'; });

    t += '\n\uD83D\uDFE2 *Мирные (' + mirnye.length + '):*\n';
    const mir_count = {};
    mirnye.forEach(r => { mir_count[r] = (mir_count[r] || 0) + 1; });
    Object.entries(mir_count).forEach(([r, n]) => { t += '  ' + r + (n > 1 ? ' ×' + n : '') + '\n'; });

    if (solo.length > 0) {
        t += '\n\uD83C\uDFAF *Серые (' + solo.length + '):*\n';
        solo.forEach(r => { t += '  ' + r + '\n'; });
    }

    return { text: t, sostav };
}

// ============================================
// ОБРАБОТКА КНОПОК
// ============================================

bot.on('callback_query', async function(query) {
    try {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const telegram_id = query.from.id;
    const data = query.data;

    console.log('[callback]', telegram_id, data);

    bot.answerCallbackQuery(query.id).catch(() => {});

    // ===== ВОЗВРАТ В МЕНЮ =====
    if (data === 'menu_vedushchego') {
        const roles = await poluchitRoliPolzovatelya(telegram_id);
        if (roles.isOwner) {
            bot.editMessageText('🏛 *Меню собственника*\n\nЧто хочешь сделать?', {
                chat_id: chatId, message_id: messageId,
                parse_mode: 'Markdown', ...menu_vladeltsa
            });
            return;
        }
        bot.editMessageText('🎙 *Меню ведущего*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vedushchego
        });
    }

    else if (data === 'menu_igroka') {
        bot.editMessageText('🎴 *Меню игрока*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_igroka
        });
    }

    else if (data === 'menu_vladeltsa') {
        bot.editMessageText('🏛 *Меню собственника*\n\nЧто хочешь сделать?', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vladeltsa
        });
    }

    else if (data === 'menu_more_vedushchego') {
        bot.editMessageText('🎙 *Все функции ведущего*', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vedushchego_full
        });
    }

    else if (data === 'menu_more_igroka') {
        bot.editMessageText('🎴 *Все функции игрока*', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_igroka_full
        });
    }

    else if (data === 'menu_more_vladeltsa') {
        bot.editMessageText('🏛 *Все функции собственника*', {
            chat_id: chatId, message_id: messageId,
            parse_mode: 'Markdown', ...menu_vladeltsa_full
        });
    }

    else if (data === 'pomoshch') {
        await pokazatInstrukciyu(chatId, telegram_id, messageId);
    }

    else if (data === 'miniapp_nastroika') {
        bot.editMessageText(
            '🃏 *Mini app почти готов*\n\n' +
            'Кнопка появится как приложение, когда в Railway будет задан публичный HTTPS-адрес.\n\n' +
            'Добавь в *Railway → Variables*:\n' +
            '`MINI_APP_URL=https://твой-домен.up.railway.app/miniapp`\n\n' +
            'После перезапуска нажми /start — эта кнопка превратится в «Открыть приложение».',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            }
        );
    }

    else if (data === 'scr_m' || data === 'scr_x') {
        if (!isAdmin(telegram_id)) return;
        if (data === 'scr_x') {
            bot.deleteMessage(chatId, messageId).catch(() => {});
            return;
        }
        await pokazatMenuSkriptov(chatId, messageId);
    }

    else if (data.startsWith('scr_c_')) {
        if (!isAdmin(telegram_id)) return;
        const catId = data.replace('scr_c_', '');
        const cat = PRODAZH_SKRIPTY.find(c => c.id === catId);
        if (!cat) return;
        bot.editMessageText('📝 *' + cat.title.replace(/^[^\s]+ /, '') + '*\n\nВыбери текст:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiKategoriiSkriptov(catId)
        });
    }

    else if (data.startsWith('scr_i_')) {
        if (!isAdmin(telegram_id)) return;
        const rest = data.replace('scr_i_', '');
        const sep = rest.indexOf('_');
        if (sep < 0) return;
        const catId = rest.slice(0, sep);
        const itemId = rest.slice(sep + 1);
        const item = naitiSkript(catId, itemId);
        if (!item) return;
        bot.sendMessage(chatId, '📋 *' + item.title + '*\n\n' + item.text, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: 'Текст отправлен ↑' }).catch(() => {});
    }

    else if (data === 'scr_rev') {
        if (!isAdmin(telegram_id)) return;
        bot.editMessageText('📨 *Отправить запрос отзыва клубу*\n\nВыбери шаблон:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: 'После 1-й игры', callback_data: 'scr_rt_igra1' }],
                [{ text: 'После тестовой недели', callback_data: 'scr_rt_nedelya' }],
                [{ text: 'Публичный кейс', callback_data: 'scr_rt_keys' }],
                [{ text: 'После стилизации', callback_data: 'scr_rt_stil' }],
                [{ text: '⬅️ Назад', callback_data: 'scr_m' }]
            ] }
        });
    }

    else if (data.startsWith('scr_rt_')) {
        if (!isAdmin(telegram_id)) return;
        const otzyvTip = data.replace('scr_rt_', '');
        if (!OTZYV_SKRIPT_IDS[otzyvTip]) return;
        const { data: kluby } = await supabase.from('kluby').select('id, nazvaniye').order('nazvaniye').limit(40);
        if (!kluby?.length) {
            bot.answerCallbackQuery(query.id, { text: 'Нет клубов', show_alert: true });
            return;
        }
        const knopki = kluby.map(k => [{
            text: k.nazvaniye || k.id.slice(0, 8),
            callback_data: 'scr_rv_' + otzyvTip + '_' + k.id
        }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'scr_rev' }]);
        bot.editMessageText('📨 Клуб для «' + (naitiSkript('otzyv', otzyvTip)?.title || otzyvTip) + '»:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('scr_rv_')) {
        if (!isAdmin(telegram_id)) return;
        const rest = data.replace('scr_rv_', '');
        const sep = rest.indexOf('_');
        if (sep < 0) return;
        const otzyvTip = rest.slice(0, sep);
        const klub_id = rest.slice(sep + 1);
        await otpravitSkriptKlubu(chatId, klub_id, otzyvTip);
        bot.answerCallbackQuery(query.id, { text: 'Отправлено клубу' }).catch(() => {});
    }

    else if (data.startsWith('admin_cards_')) {
        if (!isAdmin(telegram_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Только администратор', show_alert: true });
            return;
        }
        const klub_id = data.replace('admin_cards_', '');
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'admin_cards_' + klub_id;
        bot.editMessageText(
            '🏛📸 *Карты ролей клуба*\n\n' +
            'Клуб: *' + md(klub?.nazvaniye || klub_id) + '*\n\n' +
            'Теперь отправляй фото или PNG/JPG-файл с подписью = название роли.\n\n' +
            'Пример подписи: `Дон`\n\n' +
            'Статус загрузки: /club_roles_status\n' +
            'Выйти из режима клубных карт: /admin',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Админ-меню', callback_data: 'baza_noop' }]] }
            }
        );
    }

    else if (data.startsWith('perviy_hod_auto_')) {
        const parts = data.replace('perviy_hod_auto_', '').split('_');
        const kod = parts[0];
        const faza = parts[1] || 'den';
        const ok = await ustanovitPervogoHodaAvto(chatId, messageId, kod, faza, telegram_id);
        if (!ok) bot.answerCallbackQuery(query.id, { text: 'Не получилось назначить автоматически', show_alert: true });
    }

    else if (data === 'igrovoy_vecher') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (kluby.length === 0) {
            bot.editMessageText('🌙 *Игровой вечер*\n\nУ тебя пока нет клуба, где ты собственник или ведущая.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }
        if (kluby.length === 1) {
            await pokazatIgrovoyVecher(chatId, messageId, kluby[0], telegram_id);
            return;
        }
        const knopki = kluby.map(k => [{ text: '🌙 ' + k.nazvaniye, callback_data: 'vecher_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🌙 *Игровой вечер*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('vecher_klub_')) {
        const klub_id = data.replace('vecher_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }
        await pokazatIgrovoyVecher(chatId, messageId, klub, telegram_id);
    }

    else if (data.startsWith('vecher_vvod_')) {
        const klub_id = data.replace('vecher_vvod_', '');
        sostoyanie[telegram_id] = 'vecher_vvod_' + klub_id;
        bot.editMessageText(
            '🌙 *Состав игрового вечера*\n\n' +
            'Отправь список игроков через запятую или каждый ник с новой строки.\n\n' +
            'Пример:\n`Аня, Оля, Катя, Мария`',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'igrovoy_vecher' }]] }
            }
        );
    }

    else if (data.startsWith('vecher_add_')) {
        const klub_id = data.replace('vecher_add_', '');
        sostoyanie[telegram_id] = 'vecher_add_' + klub_id;
        bot.editMessageText(
            '➕ *Добавить игроков в вечер*\n\n' +
            'Отправь ники новых игроков через запятую или каждый с новой строки.\n\n' +
            'Пример:\n`Аня, Оля, Катя`',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'vecher_klub_' + klub_id }]] }
            }
        );
    }

    else if (data.startsWith('vecher_remove_')) {
        const klub_id = data.replace('vecher_remove_', '');
        sostoyanie[telegram_id] = 'vecher_remove_' + klub_id;
        bot.editMessageText(
            '➖ *Убрать игроков из вечера*\n\n' +
            'Отправь номера или ники игроков, которые ушли, через запятую.\n\n' +
            'Пример:\n`2, Катя`',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'vecher_klub_' + klub_id }]] }
            }
        );
    }

    else if (data.startsWith('vecher_finish_')) {
        const klub_id = data.replace('vecher_finish_', '');
        const today = dataIgrovoegoVechera();
        const { spisok } = await poluchitDannyeVecheraKluba(klub_id);
        const reyting = await vecherReyting.poluchitReytingVechera(supabase, klub_id, today);
        await zavershitIgrovoyVecherKluba(klub_id);
        await vecherReyting.sohranitReytingVechera(supabase, klub_id, today, reyting);
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        await vecherReyting.obrabotatMesyachnyItog(supabase, bot, klub_id, klub?.nazvaniye);
        bot.answerCallbackQuery(query.id, { text: 'Выбери игрока вечера' });
        await pokazatVyborIgrokVechera(chatId, messageId, klub_id, reyting, spisok, telegram_id);
    }

    else if (data.startsWith('poe_tg_')) {
        const rest = data.replace('poe_tg_', '');
        const [klub_id, tgRaw] = rest.split('_');
        const tgId = parseInt(tgRaw, 10);
        const today = dataIgrovoegoVechera();
        const { data: igrokRow } = tgId
            ? await supabase.from('igroki').select('id, igrovoy_nik, imya, tg_id').eq('tg_id', tgId).maybeSingle()
            : { data: null };
        const igrok_id = igrokRow?.id || null;
        const imya = igrokRow?.igrovoy_nik || igrokRow?.imya || 'Игрок';
        await vecherReyting.ustanovitIgrokaVechera(supabase, klub_id, today, igrok_id);
        await obnovitNastroykiVecheraKluba(klub_id, { vecher_await_poe: false });
        if (tgId) {
            const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
            bot.sendMessage(tgId,
                '⭐ *Ты — игрок вечера!*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\nДата: *' + today + '*\n\nПоздравляем! 🎉',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.answerCallbackQuery(query.id, { text: 'Игрок вечера: ' + imya });
        bot.editMessageText('✅ *Игрок вечера:* ' + imya + '\n\nСообщение отправлено в личку (если игрок в боте).', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🌙 К вечеру', callback_data: 'vecher_klub_' + klub_id }]] }
        });
    }

    else if (data.startsWith('poe_skip_')) {
        const klub_id = data.replace('poe_skip_', '');
        const today = dataIgrovoegoVechera();
        await vecherReyting.ustanovitIgrokaVechera(supabase, klub_id, today, null);
        await obnovitNastroykiVecheraKluba(klub_id, { vecher_await_poe: false });
        bot.answerCallbackQuery(query.id, { text: 'Ок' });
        bot.editMessageText('✅ Вечер завершён без выбора игрока вечера.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🌙 К вечеру', callback_data: 'vecher_klub_' + klub_id }]] }
        });
    }

    else if (data.startsWith('poe_')) {
        const rest = data.replace('poe_', '');
        const sep = rest.indexOf('_');
        const klub_id = rest.slice(0, sep);
        const igrok_id = rest.slice(sep + 1);
        const today = dataIgrovoegoVechera();
        const { data: igrokRow } = await supabase
            .from('igroki')
            .select('id, igrovoy_nik, imya, tg_id')
            .eq('id', igrok_id)
            .single();
        const imya = igrokRow?.igrovoy_nik || igrokRow?.imya || 'Игрок';
        await vecherReyting.ustanovitIgrokaVechera(supabase, klub_id, today, igrok_id);
        await obnovitNastroykiVecheraKluba(klub_id, { vecher_await_poe: false });
        if (igrokRow?.tg_id) {
            const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
            bot.sendMessage(igrokRow.tg_id,
                '⭐ *Ты — игрок вечера!*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\nДата: *' + today + '*\n\nПоздравляем! 🎉',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.answerCallbackQuery(query.id, { text: 'Игрок вечера: ' + imya });
        bot.editMessageText('✅ *Игрок вечера:* ' + imya + '\n\nСообщение отправлено в личку.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🌙 К вечеру', callback_data: 'vecher_klub_' + klub_id }]] }
        });
    }

    else if (data.startsWith('vecher_reopen_')) {
        const klub_id = data.replace('vecher_reopen_', '');
        await vozobnovitIgrovoyVecherKluba(klub_id);
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', klub_id).single();
        bot.answerCallbackQuery(query.id, { text: 'Вечер снова открыт' });
        await pokazatIgrovoyVecher(chatId, messageId, klub || { id: klub_id, nazvaniye: '' }, telegram_id);
    }

    else if (data.startsWith('vech_an_')) {
        const p = cbUnpack(data.replace('vech_an_', ''));
        if (!p) return;
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('status, igroki(id, tg_id, imya, igrovoy_nik)')
            .eq('anons_id', p.anons_id)
            .in('status', ['prishel', 'aktivna'])
            .order('data_zapisi', { ascending: true });
        const rows = zapisi || [];
        const prioritet = rows.some(z => z.status === 'prishel') ? rows.filter(z => z.status === 'prishel') : rows;
        if (prioritet.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'В анонсе нет игроков', show_alert: true });
            return;
        }
        const igrokiVechera = prioritet.map((z, idx) => ({
            telegram_id: z.igroki?.tg_id || null,
            name: z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (idx + 1),
            nomer: idx + 1,
            status: 'v_igre',
            foly: 0,
            igrok_id: z.igroki?.id || null
        }));
        await sohranitSpisokVecheraKluba(p.klub_id, igrokiVechera);
        const { data: klub } = await supabase.from('kluby').select('id, nazvaniye, nastroyki').eq('id', p.klub_id).single();
        bot.answerCallbackQuery(query.id, { text: 'Состав вечера сохранён: ' + igrokiVechera.length });
        await pokazatIgrovoyVecher(chatId, messageId, klub || { id: p.klub_id, nazvaniye: '' }, telegram_id);
    }

    // ===== МОИ ИГРЫ ВЕДУЩЕЙ =====
    else if (data === 'moi_igry') {
        const aktivnye = aktivnyeIgryVedushchego(telegram_id);
        if (aktivnye.length === 0) {
            bot.editMessageText(
                '🎮 *Мои игры*\n\nАктивных игр пока нет.',
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: [
                    [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                    [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
                    [{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]
                  ]}}
            );
            return;
        }

        let t = '🎮 *Мои активные игры*\n\n';
        const knopki = aktivnye.map(({ kod, igra }) => {
            const vIgre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            const rezhim = igra.rezhim_rolei === 'karty' ? 'физ. карты' : (igra.rezhim_rolei === 'bot' ? 'бот' : 'режим не выбран');
            const status = igra.ostanovlena ? 'остановлена' : (igra.roli_razdany ? 'идёт' : 'лобби');
            t += '🎴 №' + kod + ' — ' + status + ', ' + rezhim + ', ' + vIgre + '/' + (igra.kolichestvo || 0) + '\n';
            return [
                { text: '🎮 №' + kod, callback_data: 'open_igra_' + kod },
                { text: igra.ostanovlena ? '▶️ Возобновить' : '⏸ Стоп', callback_data: (igra.ostanovlena ? 'resume_igra_' : 'stop_igra_') + kod },
                { text: '🗑', callback_data: 'delete_igra_' + kod }
            ];
        });
        knopki.push([{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }]);
        knopki.push([{ text: '📚 История игр', callback_data: 'istoriya_igr' }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('open_igra_')) {
        const kod = data.replace('open_igra_', '');
        await otkrytIgruVedushchego(chatId, messageId, kod);
    }

    // ===== ИГРЫ КЛУБА =====
    else if (data === 'igry_kluba') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (kluby.length === 0) {
            bot.editMessageText('🏛 *Игры клуба*\n\nУ тебя пока нет клуба, где ты собственник или ведущая.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            await pokazatIgryKluba(chatId, messageId, kluby[0]);
            return;
        }

        const knopki = kluby.map(k => [{ text: '🏛 ' + k.nazvaniye, callback_data: 'igry_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🏛 *Игры клуба*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('igry_klub_')) {
        const klub_id = data.replace('igry_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }
        await pokazatIgryKluba(chatId, messageId, klub);
    }

    else if (data.startsWith('hist_klub_')) {
        const klub_id = data.replace('hist_klub_', '');
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const klub = kluby.find(k => k.id === klub_id);
        if (!klub) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа к клубу', show_alert: true });
            return;
        }

        const { data: rows, error } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('klub_id', klub_id)
            .eq('zavershena', true)
            .order('obnovlena_v', { ascending: false })
            .limit(10);

        if (error) {
            bot.editMessageText('❌ Не получилось загрузить историю клуба.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Игры клуба', callback_data: 'igry_klub_' + klub_id }]] }
            });
            return;
        }

        let t = '📚 *История клуба*\n\nКлуб: *' + klub.nazvaniye + '*\n\n';
        const knopki = [];
        if (!rows || rows.length === 0) {
            t += '_Завершённых игр пока нет._';
        } else {
            rows.forEach(row => {
                const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
                const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
                const dataIgry = row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : '';
                const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? 'мирные'
                    : nastroykiRow.pobeditel === 'mafiya' ? 'мафия'
                    : nastroykiRow.pobeditel === 'manyak' ? 'маньяк'
                    : 'не указан';
                t += '🏁 №' + row.kod + ' — ' + dataIgry + ', победитель: ' + pobeditel + ', игроков: ' + igrokiRow.length + '\n';
                knopki.push([{ text: '📋 Игра №' + row.kod, callback_data: 'hist_igra_' + row.kod }]);
            });
        }
        knopki.push([{ text: '⬅️ Игры клуба', callback_data: 'igry_klub_' + klub_id }]);
        knopki.push([{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ИСТОРИЯ ИГР =====
    else if (data === 'istoriya_igr') {
        const { data: rows, error } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('vedushchii_tg_id', telegram_id)
            .eq('zavershena', true)
            .order('obnovlena_v', { ascending: false })
            .limit(10);

        if (error) {
            bot.editMessageText('❌ Не получилось загрузить историю игр.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        if (!rows || rows.length === 0) {
            bot.editMessageText('📚 *История игр*\n\nЗавершённых игр пока нет.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }

        let t = '📚 *История игр*\n\nПоследние завершённые игры:\n\n';
        const knopki = rows.map(row => {
            const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
            const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
            const dataIgry = row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : '';
            const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? 'мирные'
                : nastroykiRow.pobeditel === 'mafiya' ? 'мафия'
                : nastroykiRow.pobeditel === 'manyak' ? 'маньяк'
                : 'не указан';
            t += '🏁 №' + row.kod + ' — ' + dataIgry + ', победитель: ' + pobeditel + ', игроков: ' + igrokiRow.length + '\n';
            return [{ text: '📋 Игра №' + row.kod, callback_data: 'hist_igra_' + row.kod }];
        });
        knopki.push([{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('hist_igra_')) {
        const kod = data.replace('hist_igra_', '');
        let { data: row } = await supabase
            .from('aktivnye_igry')
            .select('*')
            .eq('kod', kod)
            .eq('vedushchii_tg_id', telegram_id)
            .single();

        if (!row) {
            const { data: rowByKod } = await supabase
                .from('aktivnye_igry')
                .select('*')
                .eq('kod', kod)
                .single();

            if (rowByKod?.klub_id) {
                const kluby = await poluchitKlubyDlyaIgr(telegram_id);
                if (kluby.some(k => k.id === rowByKod.klub_id)) row = rowByKod;
            }
        }

        if (!row) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }

        const igrokiRow = typeof row.igroki === 'string' ? JSON.parse(row.igroki || '[]') : (row.igroki || []);
        const nastroykiRow = typeof row.nastroyki === 'string' ? JSON.parse(row.nastroyki || '{}') : (row.nastroyki || {});
        const pobeditel = nastroykiRow.pobeditel === 'mirnye' ? '🟢 Мирные'
            : nastroykiRow.pobeditel === 'mafiya' ? '🔴 Мафия'
            : nastroykiRow.pobeditel === 'manyak' ? '🎯 Маньяк'
            : 'не указан';
        let t = '📋 *Игра №' + kod + '*\n\n';
        t += 'Дата: ' + (row.obnovlena_v ? row.obnovlena_v.slice(0, 10) : 'не указана') + '\n';
        t += 'Победитель: ' + pobeditel + '\n\n';
        t += '*Состав:*\n';
        igrokiRow.forEach(i => {
            const em = i.status === 'v_igre' ? '✅' : '💀';
            t += em + ' №' + i.nomer + ' ' + i.name + ' — ' + (i.rol || '?') + '\n';
        });

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Удалить из истории', callback_data: 'hist_delete_' + kod }],
                [{ text: '⬅️ История игр', callback_data: 'istoriya_igr' }],
                row.klub_id ? [{ text: '🏛 Игры клуба', callback_data: 'igry_klub_' + row.klub_id }] : [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    else if (data.startsWith('hist_delete_ok_')) {
        const kod = data.replace('hist_delete_ok_', '');
        const rez = await udalitIgruIzIstorii(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Не удалось удалить', show_alert: true });
            return;
        }
        delete igry['archive_' + kod];
        bot.editMessageText('🗑 *Игра №' + kod + ' удалена из истории.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📚 История игр', callback_data: 'istoriya_igr' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('hist_delete_')) {
        const kod = data.replace('hist_delete_', '');
        bot.editMessageText('🗑 *Удалить игру №' + kod + ' из истории?*\n\nЗапись будет удалена из базы истории игр.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Да, удалить из истории', callback_data: 'hist_delete_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'hist_igra_' + kod }]
            ] }
        });
    }

    // ===== СОГЛАСИЕ: оферта и конфиденциальность =====
    else if (data === 'legal_menu') {
        bot.editMessageText('📄 *Документы Prime Mafia*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_igroka' }]
            ] }
        });
    }

    else if (data === 'legal_offerta') {
        bot.editMessageText(tekstOffertaKratko(), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ Назад', callback_data: 'reg_soglasie_vrat' }]
            ] }
        });
    }

    else if (data === 'legal_privacy') {
        bot.editMessageText(tekstPrivacyKratko(), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '⬅️ Назад', callback_data: 'reg_soglasie_vrat' }]
            ] }
        });
    }

    else if (data === 'reg_soglasie_vrat') {
        const v_reg = ozhidanie_registracii[telegram_id];
        if (v_reg && (v_reg.shag === 'soglasie' || v_reg.shag === 'soglasie_povtor')) {
            await pokazatEkranSoglasiya(chatId, messageId);
            return;
        }
        bot.editMessageText('📄 *Документы Prime Mafia*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📄 Оферта', callback_data: 'legal_offerta' }],
                [{ text: '🔒 Политика конфиденциальности', callback_data: 'legal_privacy' }],
                [{ text: '⬅️ В меню', callback_data: 'menu_igroka' }]
            ] }
        });
    }

    else if (data === 'reg_nachat') {
        const roles = await poluchitRoliPolzovatelya(telegram_id);
        if (roles.registered) {
            bot.answerCallbackQuery(query.id, { text: 'Ты уже зарегистрирован' });
            await obrabotatStart({
                chat: { id: chatId },
                from: { id: telegram_id, first_name: query.from.first_name || '', username: query.from.username || '' }
            }, []);
            return;
        }
        ozhidanie_registracii[telegram_id] = {
            shag: 'soglasie',
            pending_anons_id: ozhidanie_registracii[telegram_id]?.pending_anons_id || null
        };
        await pokazatEkranSoglasiya(chatId, messageId);
    }

    else if (data === 'reg_soglasie_prinyat') {
        const dannye_s = ozhidanie_registracii[telegram_id];
        if (dannye_s?.shag === 'soglasie_povtor' && dannye_s.igrok_id) {
            await sohranitSoglasiePolzovatelya(dannye_s.igrok_id, telegram_id);
            delete ozhidanie_registracii[telegram_id];
            bot.answerCallbackQuery(query.id, { text: '✅ Согласие принято' });
            bot.editMessageText('✅ *Спасибо!* Условия приняты.\n\nНапиши /start чтобы открыть меню.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }
        const rolesReg = await poluchitRoliPolzovatelya(telegram_id);
        if (rolesReg.registered) {
            bot.answerCallbackQuery(query.id, { text: 'Ты уже зарегистрирован — открываю меню' });
            await obrabotatStart({
                chat: { id: chatId },
                from: { id: telegram_id, first_name: query.from.first_name || '', username: query.from.username || '' }
            }, []);
            return;
        }
        if (!dannye_s || dannye_s.shag !== 'soglasie') {
            ozhidanie_registracii[telegram_id] = {
                shag: 'soglasie',
                pending_anons_id: dannye_s?.pending_anons_id || null,
                klub_id: dannye_s?.klub_id || null,
                klub_name: dannye_s?.klub_name || null,
                klub_kod: dannye_s?.klub_kod || null,
                pending_klub_from_link: !!dannye_s?.pending_klub_from_link
            };
        }
        const prev_reg = ozhidanie_registracii[telegram_id] || {};
        ozhidanie_registracii[telegram_id] = {
            shag: 'gorod',
            soglasie_prinyato: true,
            soglasie_versiya: SOGLASIE_VERSIYA,
            soglasie_data: new Date().toISOString(),
            pending_anons_id: prev_reg.pending_anons_id || null,
            klub_id: prev_reg.klub_id || null,
            klub_name: prev_reg.klub_name || null,
            klub_kod: prev_reg.klub_kod || null,
            pending_klub_from_link: !!prev_reg.pending_klub_from_link
        };
        bot.answerCallbackQuery(query.id, { text: '✅ Принято' });
        bot.editMessageText(
            '✅ *Спасибо!* Условия приняты.\n\n' +
            '📍 *Шаг 1 — город:* выбери страну, затем город.\n' +
            '_⭐ популярные · 🔤 алфавит · ✍️ поиск_',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: knopkiVyboraStranyReg() }
            }
        );
    }

    else if (data === 'reg_soglasie_otkaz') {
        delete ozhidanie_registracii[telegram_id];
        bot.answerCallbackQuery(query.id, { text: 'Без согласия регистрация невозможна' });
        bot.editMessageText(
            '❌ *Регистрация отменена.*\n\nБез принятия оферты и политики конфиденциальности использовать Prime Mafia нельзя.\n\nЕсли передумаешь — напиши /start',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    // ===== РЕГИСТРАЦИЯ: выбор страны =====
    else if (data.startsWith('reg_strana_')) {
        const strana = data.replace('reg_strana_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || !['gorod', 'gorod_vybor', 'gorod_poisk_reg'].includes(dannye.shag)) return;
        dannye.strana = strana;
        dannye.shag = 'gorod_vybor';
        dannye.gorod_kod = gorodaUi.kodStrany(strana);
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'reg', 'reg_nazad_strana');
    }

    else if (data.startsWith('rga_')) {
        const kod = data.replace('rga_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        const dannye = ozhidanie_registracii[telegram_id];
        if (dannye) {
            dannye.strana = strana;
            dannye.gorod_kod = kod;
            dannye.shag = 'gorod_vybor';
        }
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'reg', 'reg_nazad_strana');
    }

    else if (data.startsWith('rgl_')) {
        const parts = data.replace('rgl_', '').split('_');
        const kod = parts[0];
        const bukvaIdx = parseInt(parts[1], 10) || 0;
        const stranitsa = parseInt(parts[2], 10) || 0;
        const strana = gorodaUi.stranaPoKodu(kod);
        await pokazatGorodaPoBukve(chatId, messageId, strana, 'reg', bukvaIdx, stranitsa, 'reg_nazad_strana');
    }

    else if (data.startsWith('rgp_')) {
        const kod = data.replace('rgp_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        const dannye = ozhidanie_registracii[telegram_id];
        if (dannye) {
            dannye.shag = 'gorod_poisk_reg';
            dannye.gorod_kod = kod;
            dannye.strana = strana;
        }
        bot.editMessageText(
            '✍️ *Поиск города* (' + strana + ')\n\nНапиши часть названия города — например: *Моск* или *Соч*',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔤 По алфавиту', callback_data: 'rga_' + kod }],
                    [{ text: '⬅️ Назад', callback_data: 'reg_nazad_strana' }]
                ] }
            }
        );
    }

    else if (data.startsWith('reg_goroda_')) {
        const parts = data.replace('reg_goroda_', '').split('_');
        const strana = parts.slice(0, -1).join('_');
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'reg', 'reg_nazad_strana');
    }

    else if (data.startsWith('rg_')) {
        const gorod_id = data.replace('rg_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye) return;

        const { data: gorod_data } = await supabase
            .from('goroda').select('nazvaniye').eq('id', gorod_id).single();
        const gorod_name = gorod_data?.nazvaniye || 'Неизвестно';

        dannye.gorod_id = gorod_id;
        dannye.gorod_name = gorod_name;
        await posleVyboraGorodaRegistracii(chatId, messageId, telegram_id, dannye);
    }

    else if (data === 'reg_klub_gotov') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || !dannye.klub_id) return;
        dannye.shag = 'igrovoy_nik';
        bot.editMessageText(
            '✅ Клуб: *' + md(dannye.klub_name || 'Клуб') + '*\n\n' +
            '🎭 *Шаг 3 — игровой ник:*\n' +
            'Как тебя будут видеть за столом?\n' +
            '_Например: Madame X, Доктор, Рыжая, Арчи_',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    else if (data === 'reg_bez_kluba') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'klub_kod') return;
        dannye.klub_id = null;
        dannye.klub_name = null;
        dannye.klub_kod = null;
        dannye.shag = 'igrovoy_nik';
        bot.editMessageText(
            '🎭 *Шаг 3 — игровой ник:*\n\n' +
            'Как тебя будут видеть за столом?\n' +
            '_Например: Madame X, Доктор, Рыжая, Арчи_\n\n' +
            '_Клуб можно присоединить позже — по коду или ссылке от ведущего, либо при входе в игру._',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    else if (data === 'reg_dr_skip') {
        const pendingAnons = ozhidanie_registracii[telegram_id]?.pending_anons_id;
        delete ozhidanie_registracii[telegram_id];
        bot.answerCallbackQuery(query.id, { text: 'Ок' });
        bot.editMessageText('✅ Регистрация завершена! Добро пожаловать в Prime Mafia.', {
            chat_id: chatId, message_id: messageId
        });
        bot.sendMessage(chatId, tekstInstrukciiPosleRegistracii(), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📖 Полная инструкция', callback_data: 'pomoshch' }],
                [{ text: '🎮 Войти в игру', callback_data: 'voiti_v_igru' }],
                [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
                [{ text: '🎴 Меню игрока', callback_data: 'menu_igroka' }]
            ] }
        });
        if (pendingAnons) await pokazatKartochkuAnonsaPoSsylke(chatId, telegram_id, pendingAnons);
    }

    else if (data === 'reg_nazad_strana') {
        if (ozhidanie_registracii[telegram_id]) ozhidanie_registracii[telegram_id].shag = 'gorod';
        bot.editMessageText('📍 *Шаг 1 — город:* выбери страну, затем город.\n\n_⭐ популярные · 🔤 алфавит · ✍️ поиск_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiVyboraStranyReg() }
        });
    }

    // ===== ИГРОК: анонсы по городу =====
    else if (data === 'anonsy_goroda') {
        const { data: igrok } = await supabase
            .from('igroki').select('gorod').eq('tg_id', telegram_id).single();

        if (!igrok?.gorod) {
            bot.editMessageText('📢 *Анонсы игр*\n\n❌ Город не указан. Укажи город в настройках.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '⚙️ Настройки', callback_data: 'nastroyki_igroka' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
                ]}
            });
            return;
        }

        const segodnya_d = new Date().toISOString().slice(0, 10);
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, kluby(nazvaniye, gorod)')
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(50);

        const filtr = (anonsy || []).filter(a => {
            const gorodKluba = (a.kluby?.gorod || '').trim().toLowerCase();
            const gorodIgroka = (igrok.gorod || '').trim().toLowerCase();
            if (!gorodKluba || !gorodIgroka || gorodKluba !== gorodIgroka) return false;
            const iso = razobrat_datu_anonsa(a.data_igry) || a.data_igry;
            return iso && iso >= segodnya_d;
        }).slice(0, 10);

        if (filtr.length === 0) {
            bot.editMessageText('📢 *Анонсы игр в ' + igrok.gorod + '*\n\n_Пока нет запланированных игр._', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]] }
            });
            return;
        }

        let tekst = '📢 *Анонсы игр в ' + igrok.gorod + '*\n\n';
        const knopki = [];

        filtr.forEach((a, i) => {
            tekst += (i + 1) + '. 🎴 *' + (a.kluby?.nazvaniye || 'Клуб') + '*\n';
            tekst += '   📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
            tekst += '   📍 ' + (a.adres || '') + '\n';
            if (a.kommentariy) tekst += '   💬 ' + a.kommentariy + '\n';
            tekst += '\n';
            knopki.push([{ text: '✍️ Записаться: ' + (a.kluby?.nazvaniye || 'Игра ' + (i+1)), callback_data: 'anons_zapisatsya_' + a.id }]);
        });

        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ИГРОК: настройки =====
    else if (data === 'nastroyki_igroka') {
        const { data: igrok } = await supabase
            .from('igroki').select('imya, gorod, igrovoy_nik, den_rozhdeniya, avatar_file_id').eq('tg_id', telegram_id).single();

        const drText = igrok?.den_rozhdeniya ? formatDenRozhdeniya(igrok.den_rozhdeniya) : '_не указан_';

        bot.editMessageText(
            ('⚙️ *Настройки*\n\n' +
            '👤 Имя: ' + (igrok?.imya || '') + '\n' +
            '🎭 Ник: ' + (igrok?.igrovoy_nik || '_не указан_') + '\n' +
            '📍 Город: ' + (igrok?.gorod || 'не указан') + '\n' +
            '🎂 День рождения: ' + drText + '\n' +
            '🖼 Аватар: ' + (igrok?.avatar_file_id ? 'из Telegram' : '_не загружен_')),
            {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✏️ Изменить имя', callback_data: 'edit_imya' }],
                [{ text: '🎭 Изменить игровой ник', callback_data: 'edit_nik' }],
                [{ text: '🏙 Сменить город', callback_data: 'smenit_gorod' }],
                [{ text: '🎂 День рождения', callback_data: 'edit_den_rozhdeniya' }],
                [{ text: '🖼 Обновить аватар', callback_data: 'sync_avatar' }],
                [{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]
            ] }
        });
    }

    else if (data === 'edit_den_rozhdeniya') {
        sostoyanie[telegram_id] = 'edit_den_rozhdeniya';
        bot.editMessageText(
            '🎂 *День рождения*\n\n' +
            'Напиши дату *ДД.ММ* или *ДД.ММ.ГГГГ*.\n' +
            'Чтобы убрать дату — отправь «-».',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'nastroyki_igroka' }]] }
            }
        );
    }

    else if (data === 'sync_avatar') {
        bot.answerCallbackQuery(query.id, { text: 'Обновляю...' });
        const fileId = await obnovitAvatarIzTelegram(bot, telegram_id);
        bot.editMessageText(
            fileId
                ? '✅ Аватар обновлён из Telegram. Открой mini app — фото появится в профиле.'
                : '❌ Не удалось получить фото профиля Telegram. Убедись, что в настройках Telegram фото видно всем.',
            { chat_id: chatId, message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '⬅️ В настройки', callback_data: 'nastroyki_igroka' }]] } }
        );
    }

    // ===== ИГРОК: редактировать имя =====
    else if (data === 'edit_imya') {
        sostoyanie[telegram_id] = 'edit_imya';
        bot.editMessageText(
            '✏️ *Изменить имя*\n\nВведи новое имя и фамилию:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'nastroyki_igroka' }]] }
        });
    }

    // ===== ИГРОК: редактировать ник =====
    else if (data === 'edit_nik') {
        sostoyanie[telegram_id] = 'edit_nik';
        bot.editMessageText(
            '🎭 *Изменить игровой ник*\n\nВведи свой игровой псевдоним:\n_Пример: Тёмный рыцарь, Лис, Стрелок_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'nastroyki_igroka' }]] }
        });
    }

    // ===== ИГРОК: сменить город =====
    else if (data === 'smenit_gorod') {
        bot.editMessageText('📍 *Выбери новую страну:*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🇷🇺 Россия', callback_data: 'smena_strana_Россия' }],
                    [{ text: '🇧🇾 Беларусь', callback_data: 'smena_strana_Беларусь' }],
                    [{ text: '🇰🇿 Казахстан', callback_data: 'smena_strana_Казахстан' }],
                    [{ text: '🇺🇿 Узбекистан', callback_data: 'smena_strana_Узбекистан' }],
                    [{ text: '🇰🇬 Кыргызстан', callback_data: 'smena_strana_Кыргызстан' }],
                    [{ text: '🇦🇲 Армения', callback_data: 'smena_strana_Армения' }],
                    [{ text: '🇬🇪 Грузия', callback_data: 'smena_strana_Грузия' }],
                    [{ text: '🇦🇿 Азербайджан', callback_data: 'smena_strana_Азербайджан' }],
                    [{ text: '⬅️ Назад', callback_data: 'nastroyki_igroka' }]
                ]
            }
        });
    }

    else if (data.startsWith('smena_strana_')) {
        const strana = data.replace('smena_strana_', '');
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'sm', 'smenit_gorod');
    }

    else if (data.startsWith('sma_')) {
        const kod = data.replace('sma_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'sm', 'smenit_gorod');
    }

    else if (data.startsWith('sml_')) {
        const parts = data.replace('sml_', '').split('_');
        const kod = parts[0];
        const bukvaIdx = parseInt(parts[1], 10) || 0;
        const stranitsa = parseInt(parts[2], 10) || 0;
        const strana = gorodaUi.stranaPoKodu(kod);
        await pokazatGorodaPoBukve(chatId, messageId, strana, 'sm', bukvaIdx, stranitsa, 'smenit_gorod');
    }

    else if (data.startsWith('smp_')) {
        const kod = data.replace('smp_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        sostoyanie[telegram_id] = 'gorod_poisk_sm_' + kod;
        bot.editMessageText(
            '✍️ *Поиск города* (' + strana + ')\n\nНапиши часть названия — например: *Моск*',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔤 По алфавиту', callback_data: 'sma_' + kod }],
                    [{ text: '⬅️ Назад', callback_data: 'smenit_gorod' }]
                ] }
            }
        );
    }

    else if (data.startsWith('smena_goroda_')) {
        const parts = data.replace('smena_goroda_', '').split('_');
        const strana = parts.slice(0, -1).join('_');
        await pokazatGorodaAlfavit(chatId, messageId, strana, 'sm', 'smenit_gorod');
    }

    else if (data.startsWith('sg_')) {
        const gorod_id = data.replace('sg_', '');
        const { data: gorod_data } = await supabase
            .from('goroda').select('nazvaniye').eq('id', gorod_id).single();
        const gorod = gorod_data?.nazvaniye || 'Неизвестно';

        await supabase.from('igroki').update({ gorod, gorod_id }).eq('tg_id', telegram_id);

        bot.editMessageText('✅ *Город изменён на ' + gorod + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '⬅️ В настройки', callback_data: 'nastroyki_igroka' }]
            ]}
        });
    }

    // ===== ВЕДУЩИЙ: создать игру =====
    else if (data === 'sozdat_igru') {
        const roles = await poluchitRoliPolzovatelya(telegram_id);
        const nazad = knopkaGlavnogoMenu(roles, '⬅️ Назад');
        // Сначала выбираем клуб
        const { data: igrok, error: err1 } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        console.log('[DEBUG] igrok найден:', igrok?.id, 'err:', err1?.message);
        const { data: chleny, error: err2 } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        console.log('[DEBUG] chleny найдено:', chleny?.length, 'err:', err2?.message);
        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('❌ У вас нет клубов.\n\nСоздай клуб или попроси собственника назначить тебя ведущим.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [
                    [{ text: '➕ Создать клуб', callback_data: 'sozdat_klub' }],
                    [nazad]
                ] }
            });
            return;
        }

        // Сохраняем клуб если один
        if (kluby.length === 1) {
            bot.editMessageText('🎲 *Создание игры*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\nЭта игра по анонсу?', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 По анонсу', callback_data: 'igra_anons_' + kluby[0].id }],
                    [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + kluby[0].id }],
                    [nazad]
                ]}
            });
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'igra_klub_' + k.id }]);
        knopki.push([nazad]);
        bot.editMessageText('🎲 *Создание игры*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('igra_klub_')) {
        const klub_id = data.replace('igra_klub_', '');
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        bot.editMessageText('🎲 *Создание игры*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\nЭта игра по анонсу?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📢 По анонсу', callback_data: 'igra_anons_' + klub_id }],
                [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + klub_id }],
                [{ text: '⬅️ Назад', callback_data: 'sozdat_igru' }]
            ]}
        });
    }

    else if (data.startsWith('igra_anons_')) {
        const klub_id = data.replace('igra_anons_', '');

        // Загружаем активные анонсы клуба
        const { data: anonsy } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres')
            .eq('klub_id', klub_id)
            .eq('status', 'aktiven')
            .order('data_igry', { ascending: true })
            .limit(10);

        if (!anonsy || anonsy.length === 0) {
            bot.editMessageText('🎲 *Создание игры*\n\n❌ Нет активных анонсов.\n\nСначала создай анонс или начни игру без анонса.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 Создать анонс', callback_data: 'anons_vybor_kluba' }],
                    [{ text: '🎲 Без анонса', callback_data: 'igra_bez_anons_' + klub_id }],
                    [{ text: '⬅️ Назад', callback_data: 'sozdat_igru' }]
                ]}
            });
            return;
        }

        const knopki = anonsy.map(a => [{
            text: '📅 ' + a.data_igry + ' ' + (a.vremya || '') + ' — ' + (a.adres || ''),
            callback_data: cbBtn('iva_', { klub_id, anons_id: a.id })
        }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'igra_klub_' + klub_id }]);

        bot.editMessageText('🎲 *Выбери анонс:*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('iva_')) {
        const p = cbUnpack(data.replace('iva_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Нажми снова', show_alert: true }); return; }
        const { klub_id, anons_id } = p;
        bot.editMessageText('🎲 *Создание игры*\n\nНа сколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '8', callback_data: cbBtn('in_', { klub_id, anons_id, k: 8 }) },
                     { text: '9', callback_data: cbBtn('in_', { klub_id, anons_id, k: 9 }) },
                     { text: '10', callback_data: cbBtn('in_', { klub_id, anons_id, k: 10 }) },
                     { text: '11', callback_data: cbBtn('in_', { klub_id, anons_id, k: 11 }) }],
                    [{ text: '12', callback_data: cbBtn('in_', { klub_id, anons_id, k: 12 }) },
                     { text: '13', callback_data: cbBtn('in_', { klub_id, anons_id, k: 13 }) },
                     { text: '14', callback_data: cbBtn('in_', { klub_id, anons_id, k: 14 }) },
                     { text: '15', callback_data: cbBtn('in_', { klub_id, anons_id, k: 15 }) }],
                    [{ text: '16', callback_data: cbBtn('in_', { klub_id, anons_id, k: 16 }) },
                     { text: '17', callback_data: cbBtn('in_', { klub_id, anons_id, k: 17 }) },
                     { text: '18', callback_data: cbBtn('in_', { klub_id, anons_id, k: 18 }) }],
                    [{ text: '19', callback_data: cbBtn('in_', { klub_id, anons_id, k: 19 }) },
                     { text: '20', callback_data: cbBtn('in_', { klub_id, anons_id, k: 20 }) }],
                    [{ text: '⬅️ Назад', callback_data: 'igra_anons_' + klub_id }]
                ]
            }
        });
    }

    else if (data.startsWith('igra_vybr_anons_')) {
        const parts = data.replace('igra_vybr_anons_', '').split('_');
        const klub_id = parts[0];
        const anons_id = parts[1];
        bot.editMessageText('🎲 *Создание игры*\n\nНа сколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '8', callback_data: cbBtn('in_', { klub_id, anons_id, k: 8 }) },
                     { text: '9', callback_data: cbBtn('in_', { klub_id, anons_id, k: 9 }) },
                     { text: '10', callback_data: cbBtn('in_', { klub_id, anons_id, k: 10 }) },
                     { text: '11', callback_data: cbBtn('in_', { klub_id, anons_id, k: 11 }) }],
                    [{ text: '12', callback_data: cbBtn('in_', { klub_id, anons_id, k: 12 }) },
                     { text: '13', callback_data: cbBtn('in_', { klub_id, anons_id, k: 13 }) },
                     { text: '14', callback_data: cbBtn('in_', { klub_id, anons_id, k: 14 }) },
                     { text: '15', callback_data: cbBtn('in_', { klub_id, anons_id, k: 15 }) }],
                    [{ text: '16', callback_data: cbBtn('in_', { klub_id, anons_id, k: 16 }) },
                     { text: '17', callback_data: cbBtn('in_', { klub_id, anons_id, k: 17 }) },
                     { text: '18', callback_data: cbBtn('in_', { klub_id, anons_id, k: 18 }) }],
                    [{ text: '19', callback_data: cbBtn('in_', { klub_id, anons_id, k: 19 }) },
                     { text: '20', callback_data: cbBtn('in_', { klub_id, anons_id, k: 20 }) }],
                    [{ text: '⬅️ Назад', callback_data: 'igra_anons_' + klub_id }]
                ]
            }
        });
    }

    // ===== ВЫБОР ТИПА ПРАВИЛ ДЛЯ ИГРЫ =====
    else if (data.startsWith('igra_tip_') && !data.startsWith('igra_tip_kol_')) {
        const parts_it = data.replace('igra_tip_', '').split('_');
        const klub_id_it = parts_it[0];
        const tip_it = parts_it.slice(1).join('_');
        // Сохраняем тип и переходим к выбору количества
        const { data: klub_it } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id_it).single();
        const kol_knopki = [];
        const dostupnye = tip_it === 'sportivniy' ? [10] : [8,9,10,11,12,13,14,15,16,17,18,19,20];
        for (let i = 0; i < dostupnye.length; i += 4) {
            kol_knopki.push(dostupnye.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'igra_tip_kol_' + klub_id_it + '_' + tip_it + '_' + n })));
        }
        kol_knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_bez_anons_' + klub_id_it }]);
        bot.editMessageText(
            '\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_it?.nazvaniye || '') + '*\n\nСколько игроков?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kol_knopki }
        });
    }

    else if (data.startsWith('igra_tip_kol_')) {
        const parts_itk = data.replace('igra_tip_kol_', '').split('_');
        const klub_id_itk = parts_itk[0];
        const kolichestvo_itk = parseInt(parts_itk[parts_itk.length - 1]);
        const tip_itk = parts_itk.slice(1, -1).join('_');
        const { data: klub_itk } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id_itk).single();

        // Показываем предпросмотр состава перед созданием игры
        const preview = pokazat_sostav_preview(kolichestvo_itk, tip_itk, klub_itk?.nastroyki, klub_itk?.nazvaniye || '');
        if (!preview) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Нет состава для ' + kolichestvo_itk + ' игроков', show_alert: true });
            return;
        }

        const preview_key = klub_id_itk + '_' + tip_itk + '_' + kolichestvo_itk;
        // Сохраняем кастомный состав во временное хранилище
        if (!igry['preview_' + preview_key]) {
            igry['preview_' + preview_key] = {
                sostav: [...preview.sostav],
                original: [...preview.sostav],
                klub_id: klub_id_itk,
                klub_nazvaniye: klub_itk?.nazvaniye || '',
                tip_kluba: tip_itk,
                kolichestvo: kolichestvo_itk,
                _ne_sohranyat: true
            };
        }

        bot.editMessageText(
            preview.text + '\n\n' +
            '_Дальше внеси список игроков столбиком — каждый ник с новой строки._',
            {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Создать игру', callback_data: 'sostav_ok_' + preview_key }],
                [{ text: '\u2699\uFE0F Состав ролей', callback_data: 'sostav_edit_' + preview_key }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_' + klub_id_itk + '_' + tip_itk }]
            ]}
        });
    }

    // ===== СОСТАВ: подтвердить и создать игру =====
    else if (data.startsWith('sostav_ok_')) {
        const preview_key = data.replace('sostav_ok_', '');
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Сессия истекла, начни заново', show_alert: true });
            return;
        }

        const kod = sgenerirovat_kod();
        igry[kod] = {
            kolichestvo: preview_data.kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            klub_id: preview_data.klub_id,
            klub_nazvaniye: preview_data.klub_nazvaniye || '',
            tip_kluba: preview_data.tip_kluba,
            sportivniy: preview_data.tip_kluba === 'sportivniy',
            rezhim_rolei: null,
            _sostav_custom: preview_data.sostav
        };
        delete igry['preview_' + preview_key];
        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    // ===== СОСТАВ: редактировать роли =====
    else if (data.startsWith('sostav_edit_')) {
        const preview_key = data.replace('sostav_edit_', '');
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Сессия истекла', show_alert: true });
            return;
        }

        const sostav = preview_data.sostav;
        let t = '\u270F\uFE0F *Редактировать состав*\n\n';
        t += '_Нажми на роль чтобы заменить:_\n\n';
        sostav.forEach((r, i) => {
            const solo = ['Маньяк'];
            const em = isMafiaRole(r) ? '\uD83D\uDD34' : (solo.includes(r) ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
            t += (i + 1) + '. ' + em + ' ' + r + '\n';
        });

        const knopki_edit = sostav.map((r, i) => [{
            text: (i + 1) + '. ' + r + ' ✏️',
            callback_data: 'sostav_zamenit_' + preview_key + '_' + i
        }]);
        knopki_edit.push([{ text: '\uD83D\uDD04 Сбросить', callback_data: 'sostav_reset_' + preview_key }]);
        knopki_edit.push([{ text: '\u2705 Готово', callback_data: 'sostav_ok_' + preview_key }]);
        knopki_edit.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_kol_' + preview_data.klub_id + '_' + preview_data.tip_kluba + '_' + preview_data.kolichestvo }]);

        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_edit }
        });
    }

    // ===== СОСТАВ: выбрать замену для роли =====
    else if (data.startsWith('sostav_zamenit_')) {
        const rest = data.replace('sostav_zamenit_', '');
        // preview_key может содержать _ так что берём последний элемент как индекс
        const last_under = rest.lastIndexOf('_');
        const preview_key = rest.substring(0, last_under);
        const rol_idx = parseInt(rest.substring(last_under + 1));
        const preview_data = igry['preview_' + preview_key];
        if (!preview_data) return;

        const tekushchaya = preview_data.sostav[rol_idx];

        // Все доступные роли
        const vse_roli = ['Дон', 'Мафия', 'Путана', 'Подрывник мафии', 'Консильери', 'Эскортница',
                          'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
                          'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
                          'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
                          'Мстительный родственник', 'Маньяк', 'Мирный'];

        const knopki_zam = vse_roli.map((r, ri) => [{
            text: (r === tekushchaya ? '\u2705 ' : '') + r,
            callback_data: 'sostav_set_' + preview_key + '_' + rol_idx + '_' + ri
        }]);
        knopki_zam.push([{ text: '\u2B05\uFE0F Отмена', callback_data: 'sostav_edit_' + preview_key }]);

        bot.editMessageText(
            '\u270F\uFE0F Меняем позицию ' + (rol_idx + 1) + ': *' + tekushchaya + '*\n\nВыбери новую роль:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_zam }
        });
    }

    // ===== СОСТАВ: установить новую роль =====
    else if (data.startsWith('sostav_set_')) {
        const rest_s = data.replace('sostav_set_', '');
        // Формат: preview_key_idx_rolname (rolname может содержать пробелы заменим их)
        // Ищем индекс как цифру перед названием роли
        const parts_s = rest_s.split('_');
        // preview_key = klub_id + '_' + tip + '_' + kolichestvo
        // затем idx, затем роль (может быть несколько слов через _)
        // Берём первые 3 части как preview_key, 4-ю как idx, остальное как роль
        const klub_id_s = parts_s[0];
        const tip_s = parts_s[1];
        const kol_s = parts_s[2];
        const idx_s = parseInt(parts_s[3]);
        const vse_roli_s = ['Дон', 'Мафия', 'Путана', 'Подрывник мафии', 'Консильери', 'Эскортница',
            'Шериф', 'Комиссар', 'Детектив', 'Доктор', 'Охотник', 'Стрелок',
            'Стрелочник', 'Камикадзе', 'Подрывник', 'Затычка', 'Шахид', 'Бессмертный',
            'Любовница', 'Ведьма', 'Бомба', 'Безликий', 'Адвокат',
            'Мстительный родственник', 'Маньяк', 'Мирный'];
        const rol_ri = parseInt(parts_s[4], 10);
        const new_rol = vse_roli_s[rol_ri] || parts_s.slice(4).join(' ');
        const preview_key_s = klub_id_s + '_' + tip_s + '_' + kol_s;
        const preview_data_s = igry['preview_' + preview_key_s];
        if (!preview_data_s) return;

        const old_rol = preview_data_s.sostav[idx_s];
        preview_data_s.sostav[idx_s] = new_rol;

        bot.answerCallbackQuery(query.id, { text: old_rol + ' → ' + new_rol });

        // Возвращаемся к редактору
        const sostav_s = preview_data_s.sostav;
        let t_s = '\u270F\uFE0F *Редактировать состав*\n\n_Нажми на роль чтобы заменить:_\n\n';
        sostav_s.forEach((r, i) => {
            const em_s = isMafiaRole(r) ? '\uD83D\uDD34' : (r === 'Маньяк' ? '\uD83C\uDFAF' : '\uD83D\uDFE2');
            t_s += (i + 1) + '. ' + em_s + ' ' + r + '\n';
        });
        const kk_s = sostav_s.map((r, i) => [{ text: (i + 1) + '. ' + r + ' \u270F\uFE0F', callback_data: 'sostav_zamenit_' + preview_key_s + '_' + i }]);
        kk_s.push([{ text: '\uD83D\uDD04 Сбросить', callback_data: 'sostav_reset_' + preview_key_s }]);
        kk_s.push([{ text: '\u2705 Готово', callback_data: 'sostav_ok_' + preview_key_s }]);
        kk_s.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_tip_kol_' + preview_key_s }]);
        bot.editMessageText(t_s, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kk_s } });
    }

    // ===== СОСТАВ: сбросить к стандарту =====
    else if (data.startsWith('sostav_reset_')) {
        const preview_key_r = data.replace('sostav_reset_', '');
        const preview_data_r = igry['preview_' + preview_key_r];
        if (!preview_data_r) return;
        preview_data_r.sostav = [...preview_data_r.original];
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD04 Состав сброшен к стандарту' });
        // Показываем предпросмотр снова
        const preview_r = pokazat_sostav_preview(preview_data_r.kolichestvo, preview_data_r.tip_kluba, {}, preview_data_r.klub_nazvaniye || '');
        bot.editMessageText(
            preview_r.text + '\n\n' +
            '_Дальше внеси список игроков столбиком — каждый ник с новой строки._',
            {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\u2705 Создать игру', callback_data: 'sostav_ok_' + preview_key_r }],
                [{ text: '\u2699\uFE0F Состав ролей', callback_data: 'sostav_edit_' + preview_key_r }],
            ]}
        });
    }

    else if (data.startsWith('igra_bez_anons_')) {
        const klub_id = data.replace('igra_bez_anons_', '');
        const { data: klub_bz } = await supabase.from('kluby').select('nazvaniye, sportivniy_rezhim, nastroyki').eq('id', klub_id).single();
        const tip_kluba_bz = klub_bz?.nastroyki?.tip_kluba || 'paskal';
        const kol_knopki = [];
        const dostupnye = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        for (let i = 0; i < dostupnye.length; i += 4) {
            kol_knopki.push(dostupnye.slice(i, i + 4).map(n => ({
                text: String(n),
                callback_data: 'igra_tip_kol_' + klub_id + '_' + tip_kluba_bz + '_' + n
            })));
        }
        if (klub_bz?.sportivniy_rezhim) {
            kol_knopki.push([{ text: '\uD83C\uDFC6 Спортивная — 10', callback_data: 'igra_tip_kol_' + klub_id + '_sportivniy_10' }]);
        }
        kol_knopki.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_klub_' + klub_id }]);
        bot.editMessageText(
            '\uD83C\uDFB2 *Создание игры*\n\nКлуб: *' + (klub_bz?.nazvaniye || '') + '*\n\nСколько игроков?',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kol_knopki } }
        );
    }

    else if (data.startsWith('big_family_info_')) {
        const klub_id_bf = data.replace('big_family_info_', '');
        bot.editMessageText(
            '\uD83D\uDCD5 *Big Family*\n\n' +
            'Правила загружены и отделены от Паскаля.\n\n' +
            'Уже понятно из документа:\n' +
            '— дневная речь 40 секунд\n' +
            '— роли: Дон, Мафия, Путана, Комиссар, Доктор, Любовница, Бессмертный, Подрывник, Снайпер, Маньяк\n' +
            '— Подрывник играет за мирных и забирает игрока, если его убила мафия\n' +
            '— Снайпер имеет один выстрел за игру\n' +
            '— Любовница может обезвредить Маньяка\n\n' +
            'Чтобы включить создание игр Big Family без риска, нужны точные составы по количеству игроков.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'igra_bez_anons_' + klub_id_bf }]] }
            }
        );
    }

    else if (data.startsWith('in_')) {
        const p = cbUnpack(data.replace('in_', ''));
        if (!p) { bot.answerCallbackQuery(query.id, { text: 'Нажми снова', show_alert: true }); return; }
        const klub_id = p.klub_id;
        const anons_id = p.anons_id;
        const kolichestvo = parseInt(p.k, 10);
        const { data: klub_in } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
        const kod = sgenerirovat_kod();
        igry[kod] = {
            kod,
            klub_id,
            klub_nazvaniye: klub_in?.nazvaniye || '',
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            tip_kluba: klub_in?.nastroyki?.tip_kluba || 'paskal',
            rezhim_rolei: null
        };
        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('igra_n_')) {
        const parts = data.replace('igra_n_', '').split('_');
        const klub_id = parts[0];
        const anons_id = parts[1]; // 'null' или uuid
        const kolichestvo = parseInt(parts[2]);
        const { data: klub_n } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
        const nastroyki_igry = klubPresety.primeniPresetPoNazvaniyu(klub_n?.nazvaniye || '', klub_n?.nastroyki || {});
        const kod = sgenerirovat_kod();

        // Сохраняем игру в памяти
        igry[kod] = {
            kod,
            klub_id,
            klub_nazvaniye: klub_n?.nazvaniye || '',
            anons_id: anons_id === 'null' ? null : anons_id,
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            tip_kluba: nastroyki_igry.tip_kluba || 'paskal',
            rezhim_rolei: null,
            _nastroyki: nastroyki_igry
        };

        await sohranit_igru(kod);
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('rezhim_karty_')) {
        const kod = data.replace('rezhim_karty_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await nachatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('rezhim_bot_')) {
        const kod = data.replace('rezhim_bot_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        delete sostoyanie[telegram_id];
        igra.rezhim_rolei = 'bot';
        await sohranit_igru(kod);
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('obnovit_igru_')) {
        const kod = data.replace('obnovit_igru_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        delete sostoyanie[telegram_id];
        if (igra.rezhim_rolei === 'karty' && (igra.igroki || []).length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id);
            await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
            return;
        }
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('vecher_ok_')) {
        const kod = data.replace('vecher_ok_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        const spisok_vo = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (!spisok_vo || spisok_vo.length !== igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, { text: 'Число игроков не совпадает — отредактируй список', show_alert: true });
            return;
        }
        await zapolnitIgruIzSpiskaVechera(igra, spisok_vo);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Состав подтверждён' });
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('vecher_edit_')) {
        const kod = data.replace('vecher_edit_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        bot.answerCallbackQuery(query.id);
        await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('vecher_pokaz_')) {
        const kod = data.replace('vecher_pokaz_', '');
        const igra = igry[kod];
        if (!igra?.klub_id) { bot.answerCallbackQuery(query.id, { text: 'Нет привязки к клубу', show_alert: true }); return; }
        const spisok_vp = await poluchitSpisokVecheraKluba(igra.klub_id);
        if (!spisok_vp || spisok_vp.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Состав вечера ещё не сохранён', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id);
        await pokazatSpisokVecheraKluba(chatId, messageId, kod, spisok_vp);
    }

    else if (data.startsWith('lobby_spisok_')) {
        const kod = data.replace('lobby_spisok_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        bot.answerCallbackQuery(query.id);
        await pokazatVvodSpiskaIgrokov(chatId, messageId, kod, telegram_id);
    }

    else if (data.startsWith('status_')) {
        const kod = data.replace('status_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        await pokazatLobbyIgry(chatId, messageId, kod);
    }

    else if (data.startsWith('rez_')) {
        const p = cbUnpack(data.replace('rez_', ''));
        if (!p) return;
        await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
    }

    else if (data.startsWith('rezadd_')) {
        const p = cbUnpack(data.replace('rezadd_', ''));
        if (!p) return;
        const igra = igry[p.kod];
        if (!igra) { bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true }); return; }

        const { data: igrok_rez } = await supabase
            .from('igroki')
            .select('id, tg_id, imya, igrovoy_nik')
            .eq('id', p.igrok_id)
            .single();

        const uzheVigre = (igra.igroki || []).some(i => i.igrok_id === igrok_rez?.id || (igrok_rez?.tg_id && i.telegram_id === igrok_rez.tg_id));
        if (uzheVigre) {
            if (ubratIgrokaIzIgryPoId(igra, igrok_rez?.id)) {
                await sohranit_igru(p.kod);
                bot.answerCallbackQuery(query.id, { text: 'Убран из лобби' });
            } else {
                bot.answerCallbackQuery(query.id, { text: 'Игрок уже в игре' });
            }
            await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
            return;
        }

        const rezultat = dobavitIgrokaVIgru(igra, igrok_rez);
        if (rezultat.reason === 'exists') {
            bot.answerCallbackQuery(query.id, { text: 'Уже добавлен' });
        } else if (rezultat.reason === 'full') {
            bot.answerCallbackQuery(query.id, { text: 'Все места заняты', show_alert: true });
        } else if (rezultat.ok) {
            if (igra.klub_id && igrok_rez?.id) await dobavitChlenaKlubaEsliNuzhno(igra.klub_id, igrok_rez.id);
            await sohranit_igru(p.kod);
            bot.answerCallbackQuery(query.id, { text: 'Добавлен: №' + rezultat.nomer + ' ' + rezultat.name });
        }
        await pokazatVyborResidentovIgry(chatId, messageId, p.kod);
    }

    else if (data.startsWith('manual_roles_')) {
        const kod = data.replace('manual_roles_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        sostoyanie[telegram_id] = 'manual_roles_' + kod;
        bot.editMessageText(
            '✍️ *Внеси роли вручную*\n\n' +
            'Пришли одним сообщением список на *' + igra.kolichestvo + '* игроков.\n\n' +
            'Формат:\n' +
            '`1. Аня — Дон`\n' +
            '`2. Оля — Мафия`\n' +
            '`3. Катя — Мирный`\n\n' +
            'После этого бот откроет игровую панель и таймеры. Игрокам ничего отправляться не будет.',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'obnovit_igru_' + kod }]] }
            }
        );
    }

    else if (data.startsWith('nachat_igru_')) {
        const kod = data.replace('nachat_igru_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if (igra.igroki.length < igra.kolichestvo) {
            if (igra.rezhim_rolei === 'karty') {
                await bot.editMessageText(
                    '🃏 *Физические карты*\n\n' +
                    'Сейчас подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '.\n' +
                    'Для физической игры можно не ждать подключений.\n\n' +
                    'Начни ночь знакомства: сначала активные роли, затем мирных без роли — для рейтинга.',
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [
                            [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }],
                            [{ text: '✍️ Внести роли списком', callback_data: 'manual_roles_' + kod }],
                            [{ text: '⬅️ Назад', callback_data: 'obnovit_igru_' + kod }]
                        ] }
                    }
                );
                return;
            }
            bot.answerCallbackQuery(query.id, {
                text: 'Подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '. Дождись всех игроков.',
                show_alert: true
            });
            return;
        }
        igra.rezhim_rolei = 'karty';
        igra.roli_razdany = true;
        igra.den = 1;
        igra.igroki.forEach(i => {
            i.status = 'v_igre';
            i.foly = i.foly || 0;
        });
        await sohranit_igru(kod);
        await bot.editMessageText('🃏 *Игра начата с физическими картами!*\n\nРоли раздаёт ведущий за столом.\nТеперь можно открыть игровую панель и запустить знакомство.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDF19 Начать ночь знакомства', callback_data: 'noch_znakomstvo_' + kod }],
                [{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }],
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }

    else if (data.startsWith('noch_znakomstvo_')) {
        const kod = data.replace('noch_znakomstvo_', '');
        const igra = igry[kod];
        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if ((igra.igroki || []).length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, {
                text: 'Сначала внеси полный состав (' + (igra.igroki || []).length + '/' + igra.kolichestvo + ')',
                show_alert: true
            });
            return;
        }
        igra.rezhim_rolei = 'karty';
        igra.den = 1;
        igra.igroki.forEach(i => { delete i.rol; });
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDF19 Ночь знакомства' });
        await bot.editMessageText('\uD83C\uDF19 *Ночь знакомства началась.*\n\nСначала по очереди внесём активные роли из состава. Затем отдельным шагом — *мирных без роли*, чтобы они попали в рейтинг.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
        await pokazatShagNochiZnakomstva(chatId, kod, 0);
    }

    // ===== ВНЕСТИ РЕЗУЛЬТАТЫ =====
    else if (data === 'vnesti_rezultaty') {
        const klubyDostupa = await poluchitKlubyDlyaIgr(telegram_id);
        const klubIdsDostupa = new Set(klubyDostupa.map(k => k.id));
        const aktivnye = Object.entries(igry)
            .filter(([kod, igra]) => !String(kod).startsWith('archive_') && !igra._ne_sohranyat && (
                igra?.vedushchii_id === telegram_id || (igra?.klub_id && klubIdsDostupa.has(igra.klub_id))
            ))
            .map(([kod, igra]) => ({ kod, igra }));

        if (aktivnye.length === 0) {
            bot.editMessageText(
                '\uD83D\uDCCB *Внести результаты игры*\n\nАктивных игр пока нет.\n\nМожно создать игру или внести результат уже сыгранной игры без прохождения процесса.',
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: '✍️ Внести прошедшую игру', callback_data: 'rez_manual_start' }],
                        [{ text: '\uD83C\uDFB2 Создать игру', callback_data: 'sozdat_igru' }],
                        [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vedushchego' }]
                    ]}
                }
            );
            return;
        }

        let t_rez = '\uD83D\uDCCB *Внести результаты игры*\n\nВыбери игру, которую нужно завершить:\n\n';
        const knopki_rez = aktivnye.map(({ kod, igra }) => {
            const v_igre = (igra.igroki || []).filter(i => i.status === 'v_igre').length;
            t_rez += '\uD83C\uDFAE №' + kod + ' — день ' + (igra.den || 1) + ', за столом ' + v_igre + '/' + (igra.kolichestvo || igra.igroki?.length || 0) + '\n';
            return [{ text: '\uD83C\uDFC1 Завершить игру №' + kod, callback_data: 'konec_' + kod }];
        });
        knopki_rez.push([{ text: '✍️ Внести прошедшую игру без процесса', callback_data: 'rez_manual_start' }]);
        knopki_rez.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(
            t_rez,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_rez } }
        );
    }

    else if (data === 'rez_manual_start') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        if (!kluby.length) {
            bot.answerCallbackQuery(query.id, { text: 'Нет клуба для внесения результата', show_alert: true });
            return;
        }
        if (kluby.length === 1) {
            ozhidanie_registracii[telegram_id] = { shag: 'manual_result_date', klub_id: kluby[0].id };
            bot.editMessageText('📅 *Дата игры*\n\nВведи дату игры или напиши `сегодня`.\n\nПример: `01.06.2026`', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'vnesti_rezultaty' }]] }
            });
            return;
        }
        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'rez_manual_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'vnesti_rezultaty' }]);
        bot.editMessageText('✍️ *Внести прошедшую игру*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('rez_manual_klub_')) {
        const klub_id = data.replace('rez_manual_klub_', '');
        ozhidanie_registracii[telegram_id] = { shag: 'manual_result_date', klub_id };
        bot.editMessageText('📅 *Дата игры*\n\nВведи дату игры или напиши `сегодня`.\n\nПример: `01.06.2026`', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'vnesti_rezultaty' }]] }
        });
    }

    else if (data.startsWith('rez_manual_win_')) {
        const pobeditel = data.replace('rez_manual_win_', '');
        const draft = ruchnyeRezultaty[telegram_id];
        if (!draft?.igra) {
            bot.answerCallbackQuery(query.id, { text: 'Черновик не найден', show_alert: true });
            return;
        }
        draft.igra.pobeditel = pobeditel;
        draft.bonus_voprosy = ruchnyeBonusVoprosy(draft.igra);
        draft.bonus_idx = 0;
        bot.answerCallbackQuery(query.id, { text: 'Победитель выбран' });
        if (!draft.bonus_voprosy.length) {
            const { kod, igra } = await sozdatRuchnuyuIgruIzDrafta(draft, telegram_id);
            await zapisat_bally(igra, kod);
            const svodka = tekstItogaRuchnoyIgry(igra, kod);
            const { chatText, pubTextFull } = sohranitItogiArhiva(igra, kod);
            igry['archive_' + kod] = { ...igra, _final_text: pubTextFull || svodka, _chat_text: chatText };
            delete igry[kod];
            delete ruchnyeRezultaty[telegram_id];
            await zavershit_igru_v_db(kod);
            maybeOtpravitAvtoOtzyvPosleIgry(igra, chatId).catch(() => {});
            maybeAvtoPublikovatItog(igry['archive_' + kod], kod).catch(() => {});
            bot.editMessageText(svodka, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: knopkiPosleRuchnogoItoga(kod, igra.klub_id)
            });
            return;
        }
        bot.editMessageText(tekstVoprosaRuchnogoBonusa(draft), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiRuchnogoBonusa()
        });
    }

    else if (data === 'rez_bonus_yes' || data === 'rez_bonus_no') {
        const draft = ruchnyeRezultaty[telegram_id];
        if (!draft?.igra || !draft.bonus_voprosy) {
            bot.answerCallbackQuery(query.id, { text: 'Черновик не найден', show_alert: true });
            return;
        }
        const q = draft.bonus_voprosy[draft.bonus_idx];
        if (data === 'rez_bonus_yes' && q) {
            dobavitAvtoBonus(draft.igra, q.nomer, q.key, BALLY_DEFAULT[q.key] ?? 0, q.bonusText || q.text);
        }
        draft.bonus_idx += 1;
        bot.answerCallbackQuery(query.id, { text: data === 'rez_bonus_yes' ? 'Бонус добавлен' : 'Пропущено' });
        if (draft.bonus_idx < draft.bonus_voprosy.length) {
            bot.editMessageText(tekstVoprosaRuchnogoBonusa(draft), {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: knopkiRuchnogoBonusa()
            });
            return;
        }
        const { kod, igra } = await sozdatRuchnuyuIgruIzDrafta(draft, telegram_id);
        await zapisat_bally(igra, kod);
        const svodka = tekstItogaRuchnoyIgry(igra, kod);
        const { chatText, pubTextFull } = sohranitItogiArhiva(igra, kod);
        igry['archive_' + kod] = { ...igra, _final_text: pubTextFull || svodka, _chat_text: chatText };
        delete igry[kod];
        delete ruchnyeRezultaty[telegram_id];
        await zavershit_igru_v_db(kod);
        maybeOtpravitAvtoOtzyvPosleIgry(igra, chatId).catch(() => {});
        maybeAvtoPublikovatItog(igry['archive_' + kod], kod).catch(() => {});
        bot.editMessageText(svodka, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiPosleRuchnogoItoga(kod, igra.klub_id)
        });
    }

    else if (data.startsWith('publish_itog_')) {
        const kod = data.replace('publish_itog_', '');
        const igra = igry['archive_' + kod];
        const textPub = igra?._final_text || 'Итог игры №' + kod + ' уже записан в рейтинг.';
        bot.answerCallbackQuery(query.id, { text: 'Текст готов' });
        bot.sendMessage(chatId, '📣 *Полный текст для публикации:*\n\n' + textPub, { parse_mode: 'Markdown' });
    }

    else if (data.startsWith('rassylka_anons_')) {
        const anons_id = data.replace('rassylka_anons_', '');
        const { data: a } = await supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, klub_id, kluby(nazvaniye)')
            .eq('id', anons_id)
            .single();
        if (!a) {
            bot.answerCallbackQuery(query.id, { text: 'Анонс не найден', show_alert: true });
            return;
        }
        if (!(await mozhnoFunktsiyuKluba(a.klub_id, 'rassylka_priglasheniy'))) {
            bot.answerCallbackQuery(query.id, { text: 'Рассылка — с тарифа Start', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Рассылка…' });
        const me = await bot.getMe();
        const res = await rassylka.razoslatAnons(bot, a.klub_id, a.kluby, a, me.username, telegram_id);
        let t = '📨 *Рассылка приглашений*\n\n';
        if (res.empty) t += 'Некому отправить: база пуста или все отписались (/stop).';
        else t += 'Доставлено: *' + res.ok + '* из ' + res.total + (res.blocked ? '\nНе доставлено (бот заблокирован): ' + res.blocked : '') + (res.fail ? '\nОшибок: ' + res.fail : '');
        bot.sendMessage(chatId, t, { parse_mode: 'Markdown' });
    }

    else if (data.startsWith('rassylka_igry_')) {
        const kod = data.replace('rassylka_igry_', '');
        const igra = igry[kod];
        if (!igra?.klub_id) {
            bot.answerCallbackQuery(query.id, { text: 'Игра без клуба', show_alert: true });
            return;
        }
        if (!(await mozhnoFunktsiyuKluba(igra.klub_id, 'rassylka_priglasheniy'))) {
            bot.answerCallbackQuery(query.id, { text: 'Рассылка — с тарифа Start', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Рассылка…' });
        await zagruzitNazvanieKlubaVIgru(igra);
        const url = await ssylkaVhodaVIgru(bot, kod);
        const res = await rassylka.razoslatVhodVIgru(bot, igra.klub_id, nazvanieKlubaIgry(igra), kod, url, telegram_id);
        let t = '📨 *Приглашения на игру №' + kod + '*\n\n';
        if (res.empty) t += 'Некому отправить: база пуста или все отписались (/stop).';
        else t += 'Доставлено: *' + res.ok + '* из ' + res.total + '\n\nСсылка: ' + url;
        bot.sendMessage(chatId, t, { parse_mode: 'Markdown' });
    }

    else if (data.startsWith('qr_igry_')) {
        const kod = data.replace('qr_igry_', '');
        const igra = igry[kod];
        if (!igra) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id);
        await otpravitQrVhodaVBota(bot, chatId, kod);
    }

    else if (data.startsWith('link_igry_')) {
        const kod = data.replace('link_igry_', '');
        if (!igry[kod]) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        const url = await ssylkaVhodaVIgru(bot, kod);
        bot.answerCallbackQuery(query.id, { text: 'Ссылка отправлена' });
        bot.sendMessage(chatId, tekstPriglasheniyaVIgru(kod, url), { parse_mode: 'Markdown' });
    }

    else if (data.startsWith('publish_gruppa_')) {
        const kod = data.replace('publish_gruppa_', '');
        const igra = igry['archive_' + kod];
        if (!igra?.klub_id) {
            bot.answerCallbackQuery(query.id, { text: 'Клуб не указан', show_alert: true });
            return;
        }
        const textPub = igra._chat_text || publikaciya.tekstPobedyDlyaChata({
            ...igra,
            klub_nazvaniye: nazvanieKlubaIgry(igra)
        }, kod);
        const res = await publikaciya.otpravitItogVGruppuKluba(bot, igra.klub_id, textPub);
        if (res.ok) {
            bot.answerCallbackQuery(query.id, { text: 'Отправлено в «' + (res.title || 'группу') + '»' });
            bot.sendMessage(chatId, '✅ *Итог отправлен в чат клуба.*', { parse_mode: 'Markdown' });
        } else if (res.reason === 'no_chat') {
            bot.answerCallbackQuery(query.id, { text: 'Сначала привяжи группу в настройках клуба', show_alert: true });
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Ошибка: ' + (res.reason || ''), show_alert: true });
        }
    }

    else if (data.startsWith('gruppa_klub_setup_')) {
        const klub_id = data.replace('gruppa_klub_setup_', '');
        ozhidanie_registracii[telegram_id] = { shag: 'privyazat_gruppu_kluba', klub_id };
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId,
            '📢 *Привязка группы клуба*\n\n' +
            '1. Добавьте бота в группу или канал клуба (как администратора, если канал).\n' +
            '2. *Перешлите сюда* любое сообщение из этой группы/канала.\n\n' +
            '_Так мы сохраним chat_id для публикации итогов игр._',
            { parse_mode: 'Markdown' }
        );
    }

    else if (data.startsWith('gruppa_klub_auto_')) {
        const klub_id = data.replace('gruppa_klub_auto_', '');
        const grp = await publikaciya.poluchitChatGruppyKluba(klub_id);
        if (!grp?.chat_id) {
            bot.answerCallbackQuery(query.id, { text: 'Сначала привяжите группу', show_alert: true });
            return;
        }
        await publikaciya.toggleAutoPublishKluba(klub_id, !grp.auto);
        bot.answerCallbackQuery(query.id, { text: !grp.auto ? 'Автопубликация включена' : 'Автопубликация выключена' });
    }

    else if (data.startsWith('gruppa_klub_otvyaz_')) {
        const klub_id = data.replace('gruppa_klub_otvyaz_', '');
        await publikaciya.sohranitChatGruppyKluba(klub_id, null, '');
        const { data: row } = await supabase.from('kluby').select('nastroyki').eq('id', klub_id).single();
        const n = { ...(row?.nastroyki || {}) };
        delete n.telegram_chat_id;
        delete n.telegram_chat_title;
        delete n.auto_publish_results;
        await supabase.from('kluby').update({ nastroyki: n }).eq('id', klub_id);
        bot.answerCallbackQuery(query.id, { text: 'Группа отвязана' });
        bot.editMessageText('✅ Группа отвязана. Можно привязать другую в настройках клуба.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⚙️ Настройки клуба', callback_data: 'nastroyki_kluba_v' }]] }
        });
    }

    // ===== ВЕДУЩИЙ: раздать роли =====
    else if (data.startsWith('razdat_')) {
        const kod = data.replace('razdat_', '');
        const igra = igry[kod];

        if (!igra) { bot.sendMessage(chatId, '❌ Игра не найдена.'); return; }
        if (igra.roli_razdany) { bot.sendMessage(chatId, '⚠️ Роли уже розданы.'); return; }
        if (igra.igroki.length < igra.kolichestvo) {
            bot.answerCallbackQuery(query.id, {
                text: 'Подключено ' + igra.igroki.length + '/' + igra.kolichestvo + '. Дождись всех игроков.',
                show_alert: true
            });
            return;
        }

        const tip_kluba = igra.tip_kluba || 'paskal';
        const sostav = igra._sostav_custom || poluchit_sostav(igra.kolichestvo, tip_kluba);
        if (!sostav) { bot.sendMessage(chatId, '\u274C Нет состава для ' + igra.kolichestvo + ' игроков'); return; }
        let peremeshannye = peremeshat(sostav);
        // Если спортивный режим — уже обработано через poluchit_sostav


        for (let i = 0; i < igra.igroki.length; i++) {
            igra.igroki[i].rol = peremeshannye[i];
            igra.igroki[i].status = 'v_igre';
            igra.igroki[i].foly = 0;
        }
        igra.roli_razdany = true;
        igra.den = 1;
        await sohranit_igru(kod);

        for (const igrok of igra.igroki) {
            const opisanie = roli_opisaniya[igrok.rol] || ('\uD83C\uDFAD *Роль: ' + igrok.rol + '*');
            const is_maf_player = isMafiaRole(igrok.rol);
            const komanda_mafii = is_maf_player
                ? igra.igroki
                    .filter(i => isMafiaRole(i.rol))
                    .map(i => '№' + i.nomer + ' ' + i.name + ' — ' + i.rol)
                    .join('\n')
                : '';
            const reply_markup_role = is_maf_player
                ? { inline_keyboard: [[{ text: '\uD83D\uDC40 Посмотреть свою команду', callback_data: 'moya_komanda_' + kod }]] }
                : undefined;
            const foto_id = fotoRoliDlyaIgry(igra, igrok.rol);
            const tekst_roli = opisanie + '\n\n' +
                '\uD83C\uDFB4 Игра \u2116' + kod + '\n' +
                (nazvanieKlubaIgry(igra) ? '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n' : '') +
                '\uD83D\uDC64 Ты — игрок \u2116' + igrok.nomer + '\n\n' +
                (komanda_mafii ? '\uD83D\uDD34 *Твоя команда:*\n' + komanda_mafii + '\n\n' : '') +
                '\uD83E\uDD2B _Никому не показывай!_';
            if (foto_id) {
                bot.sendPhoto(igrok.telegram_id, foto_id, {
                    caption: tekst_roli,
                    parse_mode: 'Markdown',
                    protect_content: true,
                    ...(reply_markup_role ? { reply_markup: reply_markup_role } : {})
                });
            } else {
                bot.sendMessage(igrok.telegram_id, tekst_roli, {
                    parse_mode: 'Markdown',
                    protect_content: true,
                    ...(reply_markup_role ? { reply_markup: reply_markup_role } : {})
                });
            }
        }

        let svodka = '🎴 *Роли разданы!*\n\n' +
                     '🎴 Игра №' + kod + '\n' +
                     (nazvanieKlubaIgry(igra) ? '🏛 Клуб: *' + nazvanieKlubaIgry(igra) + '*\n' : '') +
                     '👥 Игроков: ' + igra.kolichestvo + '\n\n' +
                     '*Раскладка (только для тебя):*\n' +
                     '─────────────────\n';

        for (const igrok of igra.igroki) {
            svodka += '№' + igrok.nomer + ' ' + igrok.name + ' → *' + igrok.rol + '*\n';
        }
        svodka += '─────────────────\n✅ Каждому отправлена роль в личку.';

        bot.sendMessage(chatId, svodka, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Панель игры', callback_data: 'panel_' + kod }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }


    // ===== ИГРОВАЯ ПАНЕЛЬ =====
    else if (data.startsWith('panel_') && !data.startsWith('panel_foly_')) {
        const kod = data.replace('panel_', '');
        const igra = igry[kod];
        if (!igra) {
            bot.editMessageText('\u274C Игра не найдена. Возможно сервер перезапустился.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]] }
            });
            return;
        }
        await zagruzitNazvanieKlubaVIgru(igra);

        if (!estDostupKIgre(igra, telegram_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Игра у другого ведущего', show_alert: true });
            return;
        }

        if (igra.ostanovlena) {
            const knopkiStop = [
                [{ text: '▶️ Возобновить игру', callback_data: 'resume_igra_' + kod }],
                [{ text: '🗑 Удалить игру', callback_data: 'delete_igra_' + kod }]
            ];
            if (await obnovitDostupnostSmenyVedushchego(igra, telegram_id)) {
                knopkiStop.splice(1, 0, [{ text: '🎤 Сменить ведущего', callback_data: 'smenit_vedushchego_' + kod }]);
            }
            knopkiStop.push([{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]);
            bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nТаймеры не идут. Можно возобновить игру или удалить её.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: knopkiStop }
            });
            return;
        }

        const v_igre = igra.igroki.filter(i => i.status === 'v_igre').length;
        let tekst = '\uD83C\uDFAE *Игра \u2116' + kod + '* | День ' + (igra.den || 1) + '\n';
        if (nazvanieKlubaIgry(igra)) tekst += '\uD83C\uDFDB Клуб: *' + nazvanieKlubaIgry(igra) + '*\n';
        tekst += '\uD83D\uDC65 В игре: *' + v_igre + '*/' + igra.kolichestvo + '\n';
        tekst += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';

        igra.igroki.forEach(igrok => {
            let emoji = igrok.status === 'v_igre' ? (igrok.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            tekst += emoji + ' \u2116' + igrok.nomer + ' *' + igrok.name + '* — ' + (igrok.rol || '?');
            if (igrok.foly > 0) tekst += ' [' + igrok.foly + ' фол]';
            tekst += '\n';
        });

        const knopki = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбыл', callback_data: 'vybyl_' + kod + '_' + i.nomer }]);

        // Кнопки фаз
        if (!igra.faza || igra.faza === 'ozhidanie') {
            knopki.push([{ text: knopkaKtoNachinaet('znakomstvo'), callback_data: 'faza_znakomstvo_' + kod }]);
            knopki.push([{ text: knopkaKtoNachinaet('den', igra.den || 1), callback_data: 'faza_den_' + kod }]);
        } else if (igra.faza === 'den') {
            knopki.push([{ text: '\uD83D\uDCA5 На голосование', callback_data: 'vybrat_na_golos_' + kod }]);
            knopki.push([{ text: '\uD83C\uDF19 Перейти к ночи', callback_data: 'faza_noch_' + kod }]);
        } else if (igra.faza === 'noch') {
            knopki.push([{ text: '\uD83C\uDF19 Панель ночи', callback_data: 'noch_panel_' + kod }]);
        }
        if (igra.rezhim_rolei === 'karty' && !igra.roli_razdany && mirnyeOstalosVnesti(igra) > 0
            && (igra.igroki || []).some(i => i.rol && i.rol !== 'Мирный')) {
            knopki.push([{ text: '\uD83D\uDFE2 + Мирный житель (' + mirnyeOstalosVnesti(igra) + ')', callback_data: 'panel_mirny_' + kod }]);
        }
        knopki.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        if (igra.vedushchii_id === telegram_id) {
            knopki.push([{ text: '🎁 Подарок игроку', callback_data: 'podarok_menu_' + kod }]);
        }
        if (await obnovitDostupnostSmenyVedushchego(igra, telegram_id)) {
            knopki.push([{ text: '🎤 Сменить ведущего', callback_data: 'smenit_vedushchego_' + kod }]);
        }
        knopki.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
        knopki.push(...knopkiUpravleniyaIgroi(kod));
        knopki.push([{ text: '\uD83D\uDD04 Обновить', callback_data: 'panel_' + kod }]);
        knopki.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== СМЕНА ВЕДУЩЕГО В ИГРЕ =====
    else if (data.startsWith('smenit_vedushchego_')) {
        const kod = data.replace('smenit_vedushchego_', '');
        const igra = igry[kod];
        if (!igra || !estDostupKIgre(igra, telegram_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа', show_alert: true });
            return;
        }
        if (!igra.klub_id) {
            bot.answerCallbackQuery(query.id, { text: 'Смена ведущего доступна только для игр клуба', show_alert: true });
            return;
        }
        const alts = await poluchitAlternativnyhVedushchih(igra.klub_id, telegram_id);
        if (!alts.length) {
            bot.answerCallbackQuery(query.id, { text: 'В клубе нет другого ведущего', show_alert: true });
            return;
        }
        const knopki = alts.map(h => [{
            text: '🎤 ' + h.name + (h.rol === 'vladyelets' ? ' (собственник)' : ''),
            callback_data: 'smenit_ved_' + kod + '_' + h.tg_id
        }]);
        knopki.push([{ text: '⬅️ Отмена', callback_data: 'panel_' + kod }]);
        bot.editMessageText(
            '🎤 *Сменить ведущего* — игра №' + kod + '\n\n' +
            'Выбери, кому передать управление игрой.\n' +
            '_Таймер остановится — новый ведущий откроет панель и продолжит._',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } }
        );
    }

    else if (data.startsWith('smenit_ved_ok_')) {
        const rest = data.replace('smenit_ved_ok_', '');
        const li = rest.lastIndexOf('_');
        const kod = rest.slice(0, li);
        const new_tg_id = parseInt(rest.slice(li + 1), 10);
        const rez = await smenitVedushchegoIgry(kod, telegram_id, new_tg_id);
        if (!rez.ok) {
            const msg = rez.error === 'not_host' ? 'Этот человек не ведущий клуба'
                : rez.error === 'no_club' ? 'Игра без клуба'
                : 'Нет доступа';
            bot.answerCallbackQuery(query.id, { text: msg, show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: '✅ Передано ' + rez.novyi.name });
        bot.editMessageText(
            '✅ *Ведущий сменён*\n\nИгра №' + kod + ' передана *' + md(rez.novyi.name) + '*.\n\n' +
            '_Ты больше не управляешь этой игрой._',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ К моим играм', callback_data: 'moi_igry' }]] }
            }
        );
    }

    else if (data.startsWith('smenit_ved_')) {
        const rest = data.replace('smenit_ved_', '');
        const li = rest.lastIndexOf('_');
        const kod = rest.slice(0, li);
        const new_tg_id = parseInt(rest.slice(li + 1), 10);
        const igra = igry[kod];
        if (!igra || !estDostupKIgre(igra, telegram_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа', show_alert: true });
            return;
        }
        const alts = await poluchitAlternativnyhVedushchih(igra.klub_id, telegram_id);
        const kandidat = alts.find(h => h.tg_id === new_tg_id);
        if (!kandidat) {
            bot.answerCallbackQuery(query.id, { text: 'Ведущий недоступен', show_alert: true });
            return;
        }
        bot.editMessageText(
            '🎤 *Передать игру №' + kod + '?*\n\n' +
            'Новый ведущий: *' + md(kandidat.name) + '*\n\n' +
            '_Таймер остановится. Состояние игры сохранится — новый ведущий продолжит с панели._',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '✅ Да, передать', callback_data: 'smenit_ved_ok_' + kod + '_' + new_tg_id }],
                    [{ text: '⬅️ Отмена', callback_data: 'smenit_vedushchego_' + kod }]
                ] }
            }
        );
    }

    // ===== ПАНЕЛЬ ФОЛОВ =====
    else if (data.startsWith('panel_mirny_')) {
        const kod = data.replace('panel_mirny_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (mirnyeOstalosVnesti(igra) <= 0) {
            bot.answerCallbackQuery(query.id, { text: 'Все мирные уже внесены', show_alert: true });
            return;
        }
        sostoyanie[telegram_id] = 'noch_mirnye_' + kod;
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiMirnyhVvoda(igra, kod)
        });
    }

    else if (data.startsWith('mirny_igrok_')) {
        const parts_mi = data.replace('mirny_igrok_', '').split('_');
        const kod = parts_mi[0];
        const nomer_mi = parseInt(parts_mi[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_mi = igra.igroki.find(i => i.nomer === nomer_mi);
        const rez_mi = await dobavitMirnogoVIgru(chatId, igra, kod, igrok_mi);
        if (!rez_mi.ok) {
            const msg_mi = rez_mi.error === 'has_role'
                ? 'У игрока уже роль ' + rez_mi.rol
                : rez_mi.error === 'already'
                    ? 'Уже мирный'
                    : 'Не удалось добавить';
            bot.answerCallbackQuery(query.id, { text: msg_mi, show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: '\u2116' + igrok_mi.nomer + ' — Мирный' });
        if (rez_mi.ostalos <= 0) {
            await bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod) + '\n\n\u2705 *Все мирные внесены.*', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2705 Завершить ночь', callback_data: 'mirny_done_' + kod }]] }
            });
            return;
        }
        bot.editMessageText(tekstVvodaSpiskaMirnyh(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiMirnyhVvoda(igra, kod)
        });
    }

    else if (data.startsWith('mirny_vvod_')) {
        const kod = data.replace('mirny_vvod_', '');
        const igra = igry[kod];
        if (!igra) return;
        sostoyanie[telegram_id] = 'noch_mirnye_' + kod;
        bot.answerCallbackQuery(query.id, { text: 'Отправь номер или ник' });
        bot.sendMessage(chatId,
            '\u270D\uFE0F Отправь *номер / ник* одного игрока без роли или список мирных через запятую.\n\n' +
            'Пример: `Аня, Оля, Катя`\n\n' +
            'Осталось мирных: *' + mirnyeOstalosVnesti(igra) + '*',
            { parse_mode: 'Markdown', reply_markup: knopkiMirnyhVvoda(igra, kod) }
        );
    }

    else if (data.startsWith('mirny_done_')) {
        const kod = data.replace('mirny_done_', '');
        const igra = igry[kod];
        if (!igra) return;
        const ostalos_md = mirnyeOstalosVnesti(igra);
        if (ostalos_md > 0) {
            bot.answerCallbackQuery(query.id, {
                text: 'Осталось мирных: ' + ostalos_md + '. Добавь всех или введи списком.',
                show_alert: true
            });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Завершаем ночь' });
        await zavershitNochZnakomstva(chatId, kod);
    }

    else if (data.startsWith('panel_foly_')) {
        const kod = data.replace('panel_foly_', '');
        const igra = igry[kod];
        if (!igra) return;

        const knopki = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/' + maxFolyIgry(igra) + ')', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki.push([{
            text: igra.faza === 'opravdanie' ? '\u2B05\uFE0F К оправданию' : '\u2B05\uFE0F К панели',
            callback_data: igra.faza === 'opravdanie' ? 'timer_back_' + kod : 'panel_' + kod
        }]);

        bot.editMessageText('\u26A0\uFE0F *Выдать фол* — Игра \u2116' + kod + '\n\nВыбери игрока:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ОТМЕТИТЬ ВЫБЫВШЕГО =====
    else if (data.startsWith('vybyl_')) {
        const parts = data.replace('vybyl_', '').split('_');
        const kod = parts[0];
        const nomer = parseInt(parts[1]);
        const igra = igry[kod];
        if (!igra) return;

        const igrok = igra.igroki.find(i => i.nomer === nomer);
        if (!igrok) return;
        igrok.status = 'vybyl';
        const ubitye_ruchn = [igrok];
        const shahid_effect_ruchn = primenitSmertShahida(igra, igrok, 'ruchnoy', ubitye_ruchn);

        if (igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '\uD83D\uDC80 *Ты выбыл из игры \u2116' + kod + '*\n\nТвоя роль была: *' + igrok.rol + '*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        ubitye_ruchn
            .filter(i => i.nomer !== igrok.nomer)
            .forEach(i => {
                if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            });

        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 \u2116' + nomer + ' ' + igrok.name + ' выбыл' });
        await sohranit_igru(kod);
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;

        const v_igre2 = igra.igroki.filter(i => i.status === 'v_igre').length;
        let tekst2 = '\uD83C\uDFAE *Игра \u2116' + kod + '* | День ' + (igra.den || 1) + '\n';
        tekst2 += '\uD83D\uDC65 В игре: *' + v_igre2 + '*/' + igra.kolichestvo + '\n';
        tekst2 += '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
        igra.igroki.forEach(i => {
            let em = i.status === 'v_igre' ? (i.foly > 0 ? '\u26A0\uFE0F' : '\u2705') : '\uD83D\uDC80';
            tekst2 += em + ' \u2116' + i.nomer + ' *' + i.name + '* — ' + (i.rol || '?');
            if (i.foly > 0) tekst2 += ' [' + i.foly + ' фол]';
            tekst2 += '\n';
        });
        if (shahid_effect_ruchn) tekst2 += '\n' + shahid_effect_ruchn;

        const knopki2 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' — выбыл', callback_data: 'vybyl_' + kod + '_' + i.nomer }]);
        knopki2.push([{ text: '\u26A0\uFE0F Выдать фол', callback_data: 'panel_foly_' + kod }]);
        knopki2.push([{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]);
        knopki2.push(...knopkiStopIgraTest(kod));
        knopki2.push([{ text: '\uD83D\uDD04 Обновить', callback_data: 'panel_' + kod }]);
        knopki2.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(tekst2, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki2 }
        });
    }

    // ===== ВЫДАТЬ ФОЛ =====
    else if (data.startsWith('fol_')) {
        const parts = data.replace('fol_', '').split('_');
        const kod = parts[0];
        const nomer = parseInt(parts[1]);
        const igra = igry[kod];
        if (!igra) return;

        const igrok = igra.igroki.find(i => i.nomer === nomer);
        if (!igrok || igrok.status !== 'v_igre') return;

        igrok.foly = (igrok.foly || 0) + 1;

        const max_foly = maxFolyIgry(igra);
        let shahid_effect_fol = '';
        if (igrok.foly >= max_foly) {
            igrok.status = 'vybyl';
            const ubitye_fol = [igrok];
            shahid_effect_fol = primenitSmertShahida(igra, igrok, 'fol', ubitye_fol);
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\uD83D\uDEAB *Ты удалён из игры \u2116' + kod + '* за ' + max_foly + ' фола.\n\nТвоя роль была: *' + igrok.rol + '*',
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            ubitye_fol
                .filter(i => i.nomer !== igrok.nomer)
                .forEach(i => {
                    if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
                });
            bot.answerCallbackQuery(query.id, { text: '\uD83D\uDEAB ' + igrok.name + ' удалён за ' + max_foly + ' фола!', show_alert: true });
            await sohranit_igru(kod);
            const pobeditel = opredelitPobeditelya(igra);
            if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        } else {
            if (igrok.telegram_id) {
                bot.sendMessage(igrok.telegram_id,
                    '\u26A0\uFE0F *Фол ' + igrok.foly + '/' + max_foly + '* в игре \u2116' + kod,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            bot.answerCallbackQuery(query.id, { text: '\u26A0\uFE0F Фол ' + igrok.foly + '/' + max_foly + ' — ' + igrok.name });
        }

        const knopki3 = igra.igroki
            .filter(i => i.status === 'v_igre')
            .map(i => [{ text: '\u26A0\uFE0F \u2116' + i.nomer + ' ' + i.name + ' (' + i.foly + '/' + maxFolyIgry(igra) + ')', callback_data: 'fol_' + kod + '_' + i.nomer }]);
        knopki3.push([{
            text: igra.faza === 'opravdanie' ? '\u2B05\uFE0F К оправданию' : '\u2B05\uFE0F К панели',
            callback_data: igra.faza === 'opravdanie' ? 'timer_back_' + kod : 'panel_' + kod
        }]);

        bot.editMessageText('\u26A0\uFE0F *Выдать фол* — Игра \u2116' + kod + '\n\n' + (shahid_effect_fol ? shahid_effect_fol + '\n' : '') + 'Выбери игрока:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki3 }
        });
    }

    // ===== ЗАВЕРШИТЬ ИГРУ =====
    else if (data.startsWith('konec_')) {
        const kod = data.replace('konec_', '');
        const igra = igry[kod];
        if (!igra) return;

        bot.editMessageText(
            '\uD83C\uDFC1 *Завершить игру \u2116' + kod + '?*\n\nКто победил?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDFE2 Победили мирные', callback_data: 'itog_' + kod + '_mirnye' }],
                [{ text: '\uD83D\uDD34 Победила мафия', callback_data: 'itog_' + kod + '_mafiya' }],
                [{ text: '\uD83C\uDFAF Победил маньяк', callback_data: 'itog_' + kod + '_manyak' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'panel_' + kod }]
            ]}
        });
    }

    // ===== ИТОГ ИГРЫ =====
    else if (data.startsWith('itog_')) {
        const parts = data.replace('itog_', '').split('_');
        const kod = parts[0];
        const pobeditel = parts[1];
        const igra = igry[kod];
        if (!igra) return;

        igra.pobeditel = pobeditel;
        const pobeditel_text = pobeditel === 'mirnye' ? '\uD83D\uDFE2 Мирные' :
                               pobeditel === 'mafiya' ? '\uD83D\uDD34 Мафия' : '\uD83C\uDFAF Маньяк';

        // Уведомляем игроков
        for (const igrok of igra.igroki) {
            const is_maf = isMafiaRole(igrok.rol);
            const is_manyak = igrok.rol === 'Маньяк';
            let pobeda = false;
            if (pobeditel === 'mirnye' && !is_maf && !is_manyak) pobeda = true;
            if (pobeditel === 'mafiya' && is_maf) pobeda = true;
            if (pobeditel === 'manyak' && is_manyak) pobeda = true;
            const zagol = pobeda ? '🎉 *Поздравляем! Твоя команда победила!*\n\n' : '\uD83C\uDFC1 *Игра \u2116' + kod + ' завершена!*\n\n';
            bot.sendMessage(igrok.telegram_id,
                zagol + 'Победитель: ' + pobeditel_text + '\nТвоя роль: *' + igrok.rol + '*',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        // Рассчитываем баллы автоматически
        await zapisat_bally(igra, kod);
        uvedomitMiniAppPobedu(igra, kod, pobeditel);

        const { chatText, pubTextFull } = sohranitItogiArhiva(igra, kod);

        let svodka = chatText + '\n\n';
        svodka += '*Состав игры:*\n';
        igra.igroki.forEach(i => {
            const em = i.status === 'v_igre' ? '\u2705' : '\uD83D\uDC80';
            svodka += em + ' \u2116' + i.nomer + ' ' + i.name + ' — ' + i.rol + '\n';
        });
        svodka += '\n\uD83C\uDFC6 Баллы записаны в рейтинг!\n\n';
        svodka += '_Нажми «📢 Отправить победу в чат клуба» — игроки увидят итог в группе._';

        igry['archive_' + kod] = { ...igra, _final_text: pubTextFull, _chat_text: chatText };
        delete igry[kod];
        await zavershit_igru_v_db(kod);
        maybeOtpravitAvtoOtzyvPosleIgry(igra, chatId).catch(() => {});
        maybeAvtoPublikovatItog(igry['archive_' + kod], kod).catch(() => {});

        bot.editMessageText(svodka, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: knopkiPosleItogaIgry(kod, igra.klub_id)
        });
    }

    // ===== ПОДАРКИ / БОНУСЫ ИГРОКУ (igrovye_bonusy) =====
    else if (data.startsWith('podarok_menu_')) {
        const kod = data.replace('podarok_menu_', '');
        const igra = igry[kod];
        if (!igra || igra.vedushchii_id !== telegram_id) {
            bot.answerCallbackQuery(query.id, { text: 'Только ведущий', show_alert: true });
            return;
        }
        const knopki = igra.igroki.map(i => [{
            text: '№' + i.nomer + ' ' + i.name,
            callback_data: 'podarok_pick_' + kod + '_' + i.nomer
        }]);
        knopki.push([{ text: '⬅️ Панель', callback_data: 'panel_' + kod }]);
        bot.editMessageText('🎁 *Подарок / бонус игроку*\n\nВыбери игрока:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('podarok_pick_')) {
        const rest = data.replace('podarok_pick_', '');
        const us = rest.lastIndexOf('_');
        const kod = rest.slice(0, us);
        const nomer = parseInt(rest.slice(us + 1), 10);
        const igra = igry[kod];
        const igrok = igra?.igroki?.find(i => i.nomer === nomer);
        if (!igra || !igrok) return;
        const tips = Object.entries(bonusy.TIPY_BONUSOV).map(([k, v]) => [{
            text: v.emoji + ' ' + v.nazvaniye,
            callback_data: 'podarok_tip_' + kod + '_' + nomer + '_' + k
        }]);
        tips.push([{ text: '⬅️ Назад', callback_data: 'podarok_menu_' + kod }]);
        bot.editMessageText('🎁 *' + igrok.name + '* — выбери тип бонуса:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: tips }
        });
    }

    else if (data.startsWith('podarok_tip_')) {
        const parts = data.replace('podarok_tip_', '').split('_');
        const tip = parts.pop();
        const nomer = parseInt(parts.pop(), 10);
        const kod = parts.join('_');
        const igra = igry[kod];
        const igrok = igra?.igroki?.find(i => i.nomer === nomer);
        if (!igra || !igrok?.igrok_id) {
            bot.answerCallbackQuery(query.id, { text: 'Игрок не в базе бота', show_alert: true });
            return;
        }
        const { error } = await bonusy.nachislitBonus({
            igrok_id: igrok.igrok_id,
            klub_id: igra.klub_id,
            tip,
            istochnik: 'klub',
            opisaniye: 'Подарок от ведущего · игра №' + kod
        });
        bot.answerCallbackQuery(query.id, { text: error ? 'Ошибка сохранения' : 'Бонус начислен', show_alert: !!error });
        if (!error && igrok.telegram_id) {
            bot.sendMessage(igrok.telegram_id,
                '🎁 *Вам начислен бонус!*\n\n' + (bonusy.TIPY_BONUSOV[tip]?.nazvaniye || tip) + '\n\nОткрой mini app → «Подарки».',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.editMessageText('✅ Бонус *' + (bonusy.TIPY_BONUSOV[tip]?.nazvaniye || tip) + '* → *' + igrok.name + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🎮 Панель', callback_data: 'panel_' + kod }]] }
        });
    }

    // ===== РУЧНЫЕ БОНУСЫ ПОСЛЕ ИГРЫ =====
    else if (data.startsWith('bonusy_')) {
        const kod = data.replace('bonusy_', '');
        const igra = igry['archive_' + kod];
        if (!igra) { bot.answerCallbackQuery(query.id, { text: 'Игра не найдена' }); return; }

        let t = '\uD83C\uDF81 *Бонусы* — Игра \u2116' + kod + '\n\n';
        t += '_Нажми на игрока чтобы добавить бонус:_\n\n';
        igra.igroki.forEach(i => {
            const bonus = i.bonus_text ? ' +' + i.bonus_pts + ' (' + i.bonus_text + ')' : '';
            t += '\u2116' + i.nomer + ' ' + i.name + ' [' + i.rol + ']' + bonus + '\n';
        });

        const knopki = igra.igroki.map(i => [{
            text: '\uD83C\uDF81 \u2116' + i.nomer + ' ' + i.name + (i.bonus_pts ? ' +' + i.bonus_pts : ''),
            callback_data: 'bonus_igrok_' + kod + '_' + i.nomer
        }]);
        knopki.push([{ text: '\u2705 Готово', callback_data: 'bonusy_done_' + kod }]);
        knopki.push([{ text: '\u2B05\uFE0F В меню', callback_data: 'menu_vedushchego' }]);

        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    // ===== ВЫБРАТЬ ИГРОКА ДЛЯ БОНУСА =====
    else if (data.startsWith('bonus_igrok_')) {
        const parts_b = data.replace('bonus_igrok_', '').split('_');
        const kod = parts_b[0];
        const nomer_b = parseInt(parts_b[1]);
        const igra = igry['archive_' + kod];
        if (!igra) return;
        const igrok_b = igra.igroki.find(i => i.nomer === nomer_b);
        if (!igrok_b) return;

        sostoyanie[telegram_id] = 'bonus_vvod_' + kod + '_' + nomer_b;
        bot.editMessageText(
            '\uD83C\uDF81 *Бонус для \u2116' + nomer_b + ' ' + igrok_b.name + '*\n\n' +
            'Введи количество очков (например: 2) и через пробел причину:\n_Пример: 2 лучший игрок вечера_',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Отмена', callback_data: 'bonusy_' + kod }]] } }
        );
    }

    // ===== БОНУСЫ ГОТОВО — СОХРАНИТЬ =====
    else if (data.startsWith('bonusy_done_')) {
        const kod = data.replace('bonusy_done_', '');
        delete igry['archive_' + kod];
        bot.editMessageText('\u2705 *Все бонусы сохранены!*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFB2 Новая игра', callback_data: 'sozdat_igru' }],
                [{ text: '\uD83C\uDFE0 В меню', callback_data: 'menu_vedushchego' }]
            ]}
        });
    }


    // ===== ФАЗА: ЗНАКОМСТВО =====
    else if (data.startsWith('faza_znakomstvo_')) {
        const kod = data.replace('faza_znakomstvo_', '');
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id);
        await nachatZnakomstvoKluba(chatId, messageId, kod, telegram_id);
    }

    // ===== ФАЗА: ДЕНЬ =====
    else if (data.startsWith('faza_den_')) {
        const kod = data.replace('faza_den_', '');
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id);
        await zaprositPervogoHoda(chatId, messageId, kod, 'den', telegram_id);
    }

    else if (data.startsWith('perviy_hod_')) {
        const rest_ph = data.replace('perviy_hod_', '');
        const parts_ph = rest_ph.split('_');
        const faza_ph = parts_ph.pop();
        const nomer_ph = parseInt(parts_ph.pop(), 10);
        const kod_ph = parts_ph.join('_');
        const igra_ph = igry[kod_ph];
        if (!igra_ph || !Number.isFinite(nomer_ph)) return;
        bot.answerCallbackQuery(query.id, { text: 'Старт с №' + nomer_ph });
        await ustanovitPervogoHoda(chatId, messageId, kod_ph, nomer_ph, faza_ph, telegram_id);
    }

    // ===== ТАЙМЕР: личное время 40-60 секунд =====
    else if (data.startsWith('set_minuta_')) {
        const parts = data.replace('set_minuta_', '').split('_');
        const kod = parts[0];
        const sek = Math.min(60, Math.max(40, parseInt(parts[1], 10) || 60));
        const igra = igry[kod];
        if (!igra) return;
        igra._nastroyki = igra._nastroyki || {};
        igra._nastroyki.minuta_sek = sek;
        if (igra.faza === 'den' && igra.taymer_aktiven) igra.taymer_sekundy = sek;
        bot.answerCallbackQuery(query.id, { text: 'Личное время: ' + sek + ' сек' });
        await bot.editMessageText(buildPanelText(igra, kod), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
        });
    }

    // ===== ТАЙМЕР: ПАС =====
    else if (data.startsWith('pas_')) {
        const kod = data.replace('pas_', '');
        bot.answerCallbackQuery(query.id, { text: '\u23ED\uFE0F Пас — следующий' });
        sleduyushchiy(chatId, messageId, kod);
    }

    // ===== ТАЙМЕР: СТОП =====
    else if (data.startsWith('stop_taymer_')) {
        const kod = data.replace('stop_taymer_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        bot.answerCallbackQuery(query.id, { text: '\u23F9 Таймер остановлен' });
        bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) } });
    }

    // ===== ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ ПО НИКУ (во время минуты) =====
    else if (data.startsWith('vystav_nick_')) {
        const kod = data.replace('vystav_nick_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (igra.faza !== 'den' && igra.faza !== 'znakomstvo') {
            bot.answerCallbackQuery(query.id, { text: 'Сейчас не идёт круг речи', show_alert: true });
            return;
        }
        if (!igra.tekushchiy_nomer) {
            bot.answerCallbackQuery(query.id, { text: 'Сейчас никто не говорит', show_alert: true });
            return;
        }
        if (uzheVystavilTekushchiyGovoryashchiy(igra)) {
            bot.answerCallbackQuery(query.id, { text: 'На этой речи уже выставлен игрок. Нажми «Отменить выставление».', show_alert: true });
            return;
        }
        if (kandidatyNaVystavlenie(igra, igra.tekushchiy_nomer).length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Все доступные игроки уже номинированы', show_alert: true });
            return;
        }
        igra._vystav_ot_nomer = igra.tekushchiy_nomer;
        sostoyanie[telegram_id] = 'vystav_golos_' + kod;
        bot.answerCallbackQuery(query.id, { text: 'Выбери игрока' });
        bot.sendMessage(chatId, tekstVystavleniyaNaGolos(igra), {
            parse_mode: 'Markdown',
            reply_markup: knopkiVystavleniyaNaGolos(igra, kod)
        });
    }

    else if (data.startsWith('vystav_pick_')) {
        const rest = data.replace('vystav_pick_', '');
        const pos = rest.lastIndexOf('_');
        const kod = rest.slice(0, pos);
        const nomer = parseInt(rest.slice(pos + 1), 10);
        const igra = igry[kod];
        if (!igra || !Number.isFinite(nomer)) return;
        const igrok = igra.igroki.find(i => i.nomer === nomer);
        bot.answerCallbackQuery(query.id, { text: 'Выставляю…' });
        await vypolnitVystavlenieNaGolos(chatId, igra, kod, igrok, telegram_id);
    }

    else if (data.startsWith('timer_back_')) {
        const kod = data.replace('timer_back_', '');
        delete sostoyanie[telegram_id];
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id, { text: 'К таймеру' });
        const msgId = igra._taymer_message_id || messageId;
        const cId = igra._taymer_chat_id || chatId;
        await bot.editMessageText(buildPanelText(igra, kod), {
            chat_id: cId, message_id: msgId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
        });
        if (!igra.taymer_aktiven && igra.tekushchiy_nomer) {
            const nastroyki = igra._nastroyki || {};
            const sek = igra.taymer_sekundy > 0
                ? igra.taymer_sekundy
                : (igra.faza === 'znakomstvo' ? (nastroyki.znakomstvo_sek || 15)
                    : igra.faza === 'opravdanie' ? (nastroyki.opravdanie_sek || 30)
                    : lichnoeVremyaSek(igra));
            zapustitTaymer(cId, msgId, kod, sek);
        }
    }

    // ===== ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ =====
    else if (data.startsWith('vybrat_na_golos_')) {
        const kod = data.replace('vybrat_na_golos_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_dobavit_')) {
        const kod = data.replace('golos_dobavit_', '');
        const igra = igry[kod];
        if (!igra) return;
        const kandidaty = kandidatyDobavitNaGolos(igra);
        if (kandidaty.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Некого добавить', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(tekstDobavitNaGolos(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiDobavitNaGolos(igra, kod) }
        });
    }

    // ===== НАЗНАЧИТЬ НА ГОЛОСОВАНИЕ (убрать из списка) =====
    else if (data.startsWith('golos_toggle_')) {
        const parts_n = data.replace('golos_toggle_', '').split('_');
        const kod = parts_n[0];
        const nomer_n = parseInt(parts_n[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const idx_n = igra.naznacheny_golos.indexOf(nomer_n);
        if (idx_n >= 0) {
            igra.naznacheny_golos.splice(idx_n, 1);
            bot.answerCallbackQuery(query.id, { text: 'Убран из списка' });
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Игрок не в списке', show_alert: true });
            return;
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_up_') || data.startsWith('golos_down_')) {
        const up = data.startsWith('golos_up_');
        const rest = data.replace(up ? 'golos_up_' : 'golos_down_', '');
        const parts_mv = rest.split('_');
        const kod = parts_mv[0];
        const nomer_mv = parseInt(parts_mv[1], 10);
        const igra = igry[kod];
        if (!igra || !Number.isFinite(nomer_mv)) return;
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        const idx_mv = igra.naznacheny_golos.indexOf(nomer_mv);
        const nextIdx = up ? idx_mv - 1 : idx_mv + 1;
        if (idx_mv < 0 || nextIdx < 0 || nextIdx >= igra.naznacheny_golos.length) {
            bot.answerCallbackQuery(query.id, { text: 'Порядок не изменён' });
            return;
        }
        [igra.naznacheny_golos[idx_mv], igra.naznacheny_golos[nextIdx]] = [igra.naznacheny_golos[nextIdx], igra.naznacheny_golos[idx_mv]];
        sinhronizirovatSpisokGolosovaniya(igra);
        bot.answerCallbackQuery(query.id, { text: 'Порядок обновлён' });
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    else if (data.startsWith('golos_add_')) {
        const parts_a = data.replace('golos_add_', '').split('_');
        const kod = parts_a[0];
        const nomer_a = parseInt(parts_a[1]);
        const igra = igry[kod];
        if (!igra) return;
        const kandidat_a = igra.igroki.find(i => i.nomer === nomer_a);
        if (!kandidat_a || kandidat_a.status !== 'v_igre') {
            bot.answerCallbackQuery(query.id, { text: 'Игрок не найден', show_alert: true });
            return;
        }
        if (estImmunitetOtGolosovaniya(kandidat_a)) {
            bot.answerCallbackQuery(query.id, { text: 'У игрока иммунитет', show_alert: true });
            return;
        }
        igra.naznacheny_golos = igra.naznacheny_golos || [];
        if (!igra.naznacheny_golos.includes(nomer_a)) {
            igra.naznacheny_golos.push(nomer_a);
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDCA5 Добавлен' });
        await sohranit_igru(kod);
        bot.editMessageText(tekstSpiskaNominacii(igra), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiSpiskaNominacii(igra, kod) }
        });
    }

    // ===== ФАЗА: ОПРАВДАНИЕ =====
    else if (data.startsWith('faza_opravdanie_')) {
        const kod = data.replace('faza_opravdanie_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        if (!igra.naznacheny_golos || igra.naznacheny_golos.length === 0) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Никто не выставлен', show_alert: true }); return;
        }
        sinhronizirovatSpisokGolosovaniya(igra);
        igra.faza = 'opravdanie';
        igra.poryadok_hoda = [...igra.naznacheny_golos];
        igra.tekushchiy_nomer = igra.poryadok_hoda[0];
        igra.naznacheny_golos.forEach(nomer => {
            const i = igra.igroki.find(x => x.nomer === nomer);
            if (i?.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDCA5 *Тебя выставили на голосование!*\n\nГотовь оправдание.', { parse_mode: 'Markdown' }).catch(() => {});
        });
        const sek_op = igra._nastroyki?.opravdanie_sek || 30;
        await bot.editMessageText(buildPanelText(igra, kod), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildTimerKnopki(kod, 'opravdanie') } });
        zapustitTaymer(chatId, messageId, kod, sek_op);
    }

    // ===== ФАЗА: ГОЛОСОВАНИЕ =====
    else if (data.startsWith('faza_golosovanie_')) {
        const kod = data.replace('faza_golosovanie_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        igra.faza = 'golosovanie';
        igra.tekushchiy_nomer = null;
        igra.golosa_dnya = {};
        const naznacheny_v = (igra.naznacheny_golos || []).map(n => igra.igroki.find(x => x.nomer === n)).filter(Boolean);
        if (naznacheny_v.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Некого выводить на голосование', show_alert: true });
            return;
        }
        bot.editMessageText(tekstGolosovaniyaSPodschetom(igra, kod), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra, kod) }
        });
    }

    // ===== ГОЛОСОВАНИЕ: внести количество голосов =====
    else if (data.startsWith('golos_count_')) {
        const parts_gc = data.replace('golos_count_', '').split('_');
        const kod = parts_gc[0];
        const nomer_gc = parseInt(parts_gc[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_gc = igra.igroki.find(i => i.nomer === nomer_gc);
        if (!igrok_gc) return;
        sostoyanie[telegram_id] = 'golos_count_' + kod + '_' + nomer_gc;
        bot.editMessageText(
            '\uD83D\uDD22 *Голоса за \u2116' + nomer_gc + ' ' + igrok_gc.name + '*\n\n' +
            'Введи число голосов одним сообщением:',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад к голосованию', callback_data: 'faza_golosovanie_' + kod }]] }
            }
        );
    }

    // ===== ГОЛОСОВАНИЕ: автоматический итог =====
    else if (data.startsWith('golos_itog_auto_')) {
        const kod = data.replace('golos_itog_auto_', '');
        const igra = igry[kod];
        if (!igra) return;
        const naznacheny = (igra.naznacheny_golos || [])
            .map(n => igra.igroki.find(i => i.nomer === n))
            .filter(Boolean);
        const golosa = igra.golosa_dnya || {};
        const neVneseny = naznacheny.filter(i => !Number.isFinite(golosa[i.nomer]));
        if (neVneseny.length > 0) {
            bot.answerCallbackQuery(query.id, { text: 'Внеси голоса за всех выставленных.', show_alert: true });
            return;
        }
        const max = Math.max(...naznacheny.map(i => golosa[i.nomer] || 0));
        const lidery = naznacheny.filter(i => (golosa[i.nomer] || 0) === max);

        if (lidery.length !== 1 || max === 0) {
            let t_eq = '\uD83D\uDDF3 *Итог голосования:* равенство\n\n';
            lidery.forEach(i => { t_eq += '\u2116' + i.nomer + ' ' + i.name + ' — ' + (golosa[i.nomer] || 0) + ' голос(ов)\n'; });

            if (!igra.peregolosovanie_aktivno) {
                igra.peregolosovanie_aktivno = true;
                igra.naznacheny_golos = lidery.map(i => i.nomer);
                igra.golosa_dnya = {};
                await sohranit_igru(kod);
                t_eq += '\n\uD83D\uDD01 Назначено *переголосование* только между игроками с равным результатом.';
                bot.editMessageText(t_eq + '\n\n' + tekstGolosovaniyaSPodschetom(igra, kod), {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: knopkiGolosovaniyaSPodschetom(igra, kod) }
                });
                return;
            }

            igra.peregolosovanie_finalisty = lidery.map(i => i.nomer);
            await sohranit_igru(kod);
            t_eq += '\n\u26A0\uFE0F Равенство повторилось. Стол должен решить: оставить всех или удалить всех спорных игроков.';
            bot.editMessageText(t_eq, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\u2705 Оставить всех', callback_data: 'golos_ostavit_spor_' + kod }],
                    [{ text: '\uD83D\uDC80 Все спорные покидают стол', callback_data: 'golos_vybyli_spor_' + kod }]
                ] }
            });
            return;
        }

        const vybyv = lidery[0];
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 Выбывает \u2116' + vybyv.nomer });
        const igrok_gv = vybyv;
        const ubitye_gv = [];
        let shahid_effect_gv = '';
        igrok_gv.status = 'vybyl';
        zapisatDen1Vybyl(igra, igrok_gv);
        dobavitUnikalnoPoNomeru(ubitye_gv, igrok_gv);
        shahid_effect_gv = primenitSmertShahida(igra, igrok_gv, 'golosovanie', ubitye_gv);
        if (igrok_gv.telegram_id) bot.sendMessage(igrok_gv.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + igrok_gv.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        ubitye_gv
            .filter(i => i.nomer !== igrok_gv.nomer)
            .forEach(i => {
                if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        if ((igra.den || 1) === 1 && mozhetBytLuchshiyHod(igrok_gv)) {
            await pokazatLuchshiyHod(chatId, messageId, kod, igrok_gv.nomer, 'den1', 'noch');
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.faza = 'noch';
        if (shahid_effect_gv) await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC80 Голосование: \u2116' + igrok_gv.nomer + ' выбыл\n' + shahid_effect_gv);
        else await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ПЕРЕГОЛОСОВАНИЕ: оставить спорных игроков =====
    else if (data.startsWith('golos_ostavit_spor_')) {
        const kod = data.replace('golos_ostavit_spor_', '');
        const igra = igry[kod];
        if (!igra) return;
        const finalisty = (igra.peregolosovanie_finalisty || [])
            .map(n => igra.igroki.find(i => i.nomer === n))
            .filter(Boolean);
        let t = '\u2705 *Решение стола:* оставить игроков\n\n';
        finalisty.forEach(i => { t += '\u2116' + i.nomer + ' ' + i.name + ' остаётся в игре\n'; });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Игроки остаются' });
        bot.editMessageText(t, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF19 К ночи', callback_data: 'faza_noch_' + kod }]] }
        });
    }

    // ===== ПЕРЕГОЛОСОВАНИЕ: все спорные покидают стол =====
    else if (data.startsWith('golos_vybyli_spor_')) {
        const kod = data.replace('golos_vybyli_spor_', '');
        const igra = igry[kod];
        if (!igra) return;
        const finalisty = (igra.peregolosovanie_finalisty || [])
            .map(n => igra.igroki.find(i => i.nomer === n && i.status === 'v_igre'))
            .filter(Boolean);
        const ubitye_spor = [];
        let effect_text = '';
        let t = '\uD83D\uDC80 *Решение стола:* спорные игроки покидают стол\n\n';
        finalisty.forEach(i => {
            i.status = 'vybyl';
            zapisatDen1Vybyl(igra, i);
            dobavitUnikalnoPoNomeru(ubitye_spor, i);
            t += '\uD83D\uDC80 \u2116' + i.nomer + ' ' + i.name + ' (' + i.rol + ')\n';
            effect_text += primenitSmertShahida(igra, i, 'golosovanie', ubitye_spor);
        });
        if (effect_text) t += '\n' + effect_text;
        ubitye_spor.forEach(i => {
            if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
        });
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Спорные игроки выбыли' });
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        bot.editMessageText(t, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF19 К ночи', callback_data: 'faza_noch_' + kod }]] }
        });
    }

    // ===== ГОЛОСОВАНИЕ: ВЫБЫЛ =====
    else if (data.startsWith('golos_vybyl_')) {
        const parts_gv = data.replace('golos_vybyl_', '').split('_');
        const kod = parts_gv[0];
        const nomer_gv = parseInt(parts_gv[1]);
        const igra = igry[kod];
        if (!igra) return;
        const igrok_gv = igra.igroki.find(i => i.nomer === nomer_gv);
        const ubitye_gv = [];
        let shahid_effect_gv = '';
        if (igrok_gv) {
            igrok_gv.status = 'vybyl';
            zapisatDen1Vybyl(igra, igrok_gv);
            dobavitUnikalnoPoNomeru(ubitye_gv, igrok_gv);
            shahid_effect_gv = primenitSmertShahida(igra, igrok_gv, 'golosovanie', ubitye_gv);
            if (igrok_gv.telegram_id) bot.sendMessage(igrok_gv.telegram_id, '\uD83D\uDC80 *Голосование: ты выбыл.*\n\nТвоя роль была: *' + igrok_gv.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
            ubitye_gv
                .filter(i => i.nomer !== igrok_gv.nomer)
                .forEach(i => {
                    if (i.telegram_id) bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Ты выбыл из-за эффекта Шахида.*\n\nТвоя роль была: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {});
                });
        }
        igra.naznacheny_golos = [];
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC80 ' + (igrok_gv?.name || '') + ' выбыл' });
        if ((igra.den || 1) === 1 && mozhetBytLuchshiyHod(igrok_gv)) {
            await pokazatLuchshiyHod(chatId, messageId, kod, nomer_gv, 'den1', 'noch');
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.faza = 'noch';
        if (shahid_effect_gv) await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC80 Голосование: \u2116' + nomer_gv + ' выбыл\n' + shahid_effect_gv);
        else await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ГОЛОСОВАНИЕ: НИКТО =====
    else if (data.startsWith('golos_nikto_')) {
        const kod = data.replace('golos_nikto_', '');
        const igra = igry[kod];
        if (!igra) return;
        igra.naznacheny_golos = [];
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        bot.answerCallbackQuery(query.id, { text: '\u2705 Никто не выбыл' });
        igra.faza = 'noch';
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    // ===== ФАЗА: НОЧЬ (переход) =====
    else if (data.startsWith('faza_noch_')) {
        const kod = data.replace('faza_noch_', '');
        const igra = igry[kod];
        if (!igra) return;
        stopTimer(kod);
        igra.faza = 'noch';
        igra.naznacheny_golos = [];
        igra.vystavlenie_v_rechi = {};
        igra.golosa_dnya = {};
        igra.peregolosovanie_aktivno = false;
        igra.peregolosovanie_finalisty = [];
        await sohranit_igru(kod);
        await pokazat_prehod_k_nochi(chatId, messageId, kod);
    }

    else if (data.startsWith('vystav_otmena_')) {
        const kod = data.replace('vystav_otmena_', '');
        const igra = igry[kod];
        if (!igra) return;
        const removed = otmenitVystavlenieGovoryashchego(igra, igra.tekushchiy_nomer);
        if (removed == null) {
            bot.answerCallbackQuery(query.id, { text: 'Нечего отменять', show_alert: true });
            return;
        }
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Выставление отменено' });
        delete sostoyanie[telegram_id];
        const msgId = igra._taymer_message_id || messageId;
        const cId = igra._taymer_chat_id || chatId;
        await bot.editMessageText(buildPanelText(igra, kod), {
            chat_id: cId, message_id: msgId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buildTimerKnopki(kod, igra.faza) }
        });
    }

    else if (data.startsWith('noch_guided_')) {
        const kod = data.replace('noch_guided_', '');
        const igra = igry[kod];
        if (!igra) return;
        bot.answerCallbackQuery(query.id);
        await nachatNochGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_g_pick_')) {
        const parts = data.replace('noch_g_pick_', '').split('_');
        const kod = parts[0];
        const idx = parseInt(parts[1], 10);
        const nomer = parseInt(parts[2], 10);
        const igra = igry[kod];
        if (!igra) return;
        const shagi = shagiNochiDeystviy(igra);
        const step = shagi[idx];
        if (!step) return;
        const rez = await primeniNochnoeDeystvie(igra, step.tip, nomer, chatId);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.text, show_alert: true });
            return;
        }
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: rez.text, show_alert: !!rez.alert });
        igra._noch_guided_idx = idx;
        await pokazatShagNochiGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_g_sbr_')) {
        const parts = data.replace('noch_g_sbr_', '').split('_');
        const kod = parts[0];
        const idx = parseInt(parts[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        const step = shagiNochiDeystviy(igra)[idx];
        if (step) sbrNochnoeDeystvie(igra, step.tip);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Выбор сброшен' });
        igra._noch_guided_idx = idx;
        await pokazatShagNochiGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_g_next_')) {
        const kod = data.replace('noch_g_next_', '');
        const igra = igry[kod];
        if (!igra) return;
        igra._noch_guided_idx = (igra._noch_guided_idx || 0) + 1;
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Далее' });
        await pokazatShagNochiGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_g_prev_')) {
        const kod = data.replace('noch_g_prev_', '');
        const igra = igry[kod];
        if (!igra) return;
        igra._noch_guided_idx = Math.max(0, (igra._noch_guided_idx || 0) - 1);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Назад' });
        await pokazatShagNochiGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_g_redo_')) {
        const parts = data.replace('noch_g_redo_', '').split('_');
        const kod = parts[0];
        const idx = parseInt(parts[1], 10);
        const igra = igry[kod];
        if (!igra) return;
        igra._noch_guided_idx = idx;
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id);
        await pokazatShagNochiGuided(chatId, messageId, kod);
    }

    else if (data.startsWith('noch_sbr_')) {
        const parts = data.replace('noch_sbr_', '').split('_');
        const tip = parts[0];
        const kod = parts[1];
        const igra = igry[kod];
        if (!igra) return;
        sbrNochnoeDeystvie(igra, tip);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Сброшено' });
        await pokazat_noch_panel(chatId, messageId, kod, null);
    }

    // ===== НОЧЬ: выбор цели мафии =====
    else if (data.startsWith('noch_vybor_maf_')) {
        const kod = data.replace('noch_vybor_maf_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_maf = igra.igroki.filter(i => i.status === 'v_igre' && !isMafiaRole(i.rol));
        const knopki_maf = alive_maf.map(i => [{ text: '\uD83D\uDD2B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_maf_' + kod + '_' + i.nomer }]);
        knopki_maf.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD2B *Мафия: выбери жертву*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_maf } });
    }

    // ===== НОЧЬ: мафия выбрала жертву =====
    else if (data.startsWith('noch_maf_')) {
        const parts_nm = data.replace('noch_maf_', '').split('_');
        const kod = parts_nm[0]; const nomer_nm = parseInt(parts_nm[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.mafiya_tseli = [nomer_nm];
        const zhertva_nm = igra.igroki.find(i => i.nomer === nomer_nm);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD2B Цель: ' + (zhertva_nm?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD2B Мафия выбрала \u2116' + nomer_nm);
    }

    // ===== НОЧЬ: выбор цели Дона =====
    else if (data.startsWith('noch_vybor_don_')) {
        const kod = data.replace('noch_vybor_don_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_don = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Дон');
        const knopki_don = alive_don.map(i => [{ text: '\uD83D\uDD0E \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_don_' + kod + '_' + i.nomer }]);
        knopki_don.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD0E *Дон: кого проверить на Шерифа?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_don } });
    }

    // ===== НОЧЬ: Дон проверил =====
    else if (data.startsWith('noch_don_')) {
        const parts_ndon = data.replace('noch_don_', '').split('_');
        const kod = parts_ndon[0];
        const nomer_ndon = parseInt(parts_ndon[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.don_tseli = nomer_ndon;
        const tsel_ndon = igra.igroki.find(i => i.nomer === nomer_ndon);
        const result_don = tsel_ndon && isSheriffRole(tsel_ndon.rol) ? '\uD83D\uDD0D ШЕРИФ/КОМИССАР' : '\u2705 Не шериф';
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD0E \u2116' + nomer_ndon + ': ' + result_don, show_alert: true });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD0E Дон проверил \u2116' + nomer_ndon + ': ' + result_don);
    }

    // ===== НОЧЬ: выбор цели Консильери =====
    else if (data.startsWith('noch_vybor_kons_')) {
        const kod = data.replace('noch_vybor_kons_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (!mozhetKonsilyeriVerbovat(igra)) {
            bot.answerCallbackQuery(query.id, { text: 'Вербовка доступна, когда мафии меньше 30% стола.', show_alert: true });
            return;
        }
        const mirnyeBezRoli = igra.igroki.filter(i => i.status === 'v_igre' && i.rol === 'Мирный');
        if (mirnyeBezRoli.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Нет обычных мирных для вербовки.', show_alert: true });
            return;
        }
        const knopki_kons = mirnyeBezRoli.map(i => [{ text: '\uD83E\uDD1D \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_kons_' + kod + '_' + i.nomer }]);
        knopki_kons.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83E\uDD1D *Консильери: кого завербовать?*\n\nМожно выбрать только обычного мирного без роли.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_kons }
        });
    }

    // ===== НОЧЬ: Консильери завербовал =====
    else if (data.startsWith('noch_kons_')) {
        const parts_nk = data.replace('noch_kons_', '').split('_');
        const kod = parts_nk[0];
        const nomer_nk = parseInt(parts_nk[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_kons = igra.igroki.find(i => i.nomer === nomer_nk);
        if (!tsel_kons || tsel_kons.status !== 'v_igre' || tsel_kons.rol !== 'Мирный') {
            bot.answerCallbackQuery(query.id, { text: 'Можно завербовать только обычного мирного.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.kons_tseli = nomer_nk;
        bot.answerCallbackQuery(query.id, { text: '\uD83E\uDD1D Цель: ' + tsel_kons.name });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83E\uDD1D Консильери выбрал \u2116' + nomer_nk);
    }

    // ===== НОЧЬ: выбор цели доктора =====
    else if (data.startsWith('noch_vybor_doc_')) {
        const kod = data.replace('noch_vybor_doc_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_doc = igra.igroki.filter(i => i.status === 'v_igre');
        const knopki_doc = alive_doc.map(i => [{ text: '\uD83D\uDC89 \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_doc_' + kod + '_' + i.nomer }]);
        knopki_doc.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDC89 *Доктор: кого лечить?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_doc } });
    }

    // ===== НОЧЬ: доктор выбрал =====
    else if (data.startsWith('noch_doc_')) {
        const parts_nd = data.replace('noch_doc_', '').split('_');
        const kod = parts_nd[0]; const nomer_nd = parseInt(parts_nd[1]);
        const igra = igry[kod];
        if (!igra) return;
        const proverkaDoc = proveritLechitDoktor(igra, nomer_nd);
        if (!proverkaDoc.ok) {
            bot.answerCallbackQuery(query.id, { text: proverkaDoc.text, show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.doctor_tseli = nomer_nd;
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDC89 Вылечит \u2116' + nomer_nd });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC89 Доктор лечит \u2116' + nomer_nd);
    }

    // ===== НОЧЬ: выбор цели шерифа =====
    else if (data.startsWith('noch_vybor_sher_')) {
        const kod = data.replace('noch_vybor_sher_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_sher = igra.igroki.filter(i => i.status === 'v_igre');
        const knopki_sher = alive_sher.map(i => [{ text: '\uD83D\uDD0D \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_sher_' + kod + '_' + i.nomer }]);
        knopki_sher.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD0D *Шериф: кого проверить?*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sher } });
    }

    // ===== НОЧЬ: шериф проверил =====
    else if (data.startsWith('noch_sher_')) {
        const parts_ns = data.replace('noch_sher_', '').split('_');
        const kod = parts_ns[0]; const nomer_ns = parseInt(parts_ns[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.sherif_tseli = nomer_ns;
        const tseli_s = igra.igroki.find(i => i.nomer === nomer_ns);
        const is_maf = tseli_s && isMafiaRole(tseli_s.rol);
        const result_s = is_maf ? '\uD83D\uDD34 МАФИЯ' : '\u2705 Мирный';
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD0D \u2116' + nomer_ns + ': ' + result_s, show_alert: true });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD0D Шериф проверил \u2116' + nomer_ns + ': ' + result_s);
    }

    // ===== НОЧЬ: выбор цели Маньяка =====
    else if (data.startsWith('noch_vybor_manyak_')) {
        const kod = data.replace('noch_vybor_manyak_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_manyak = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Маньяк');
        const knopki_manyak = alive_manyak.map(i => [{ text: '\uD83C\uDFAF \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_manyak_' + kod + '_' + i.nomer }]);
        knopki_manyak.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83C\uDFAF *Маньяк: выбери жертву*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_manyak } });
    }

    // ===== НОЧЬ: Маньяк выбрал жертву =====
    else if (data.startsWith('noch_manyak_')) {
        const parts_nm = data.replace('noch_manyak_', '').split('_');
        const kod = parts_nm[0];
        const nomer_nm = parseInt(parts_nm[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.manyak_tseli = nomer_nm;
        const zhertva_nm = igra.igroki.find(i => i.nomer === nomer_nm);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFAF Цель: ' + (zhertva_nm?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83C\uDFAF Маньяк выбрал \u2116' + nomer_nm);
    }

    // ===== НОЧЬ: выбор цели Стрелка/Охотника =====
    else if (data.startsWith('noch_vybor_strelok_')) {
        const kod = data.replace('noch_vybor_strelok_', '');
        const igra = igry[kod];
        if (!igra) return;
        const strelok = igra.igroki.find(i => i.status === 'v_igre' && rolStrelyayushchegoZaMirnyh(i.rol));
        const alive_strelok = igra.igroki.filter(i => i.status === 'v_igre' && i.nomer !== strelok?.nomer);
        const knopki_strelok = alive_strelok.map(i => [{ text: '\uD83D\uDD2B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_strelok_' + kod + '_' + i.nomer }]);
        knopki_strelok.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD2B *Стрелок/Охотник: выбери цель*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_strelok } });
    }

    // ===== НОЧЬ: Стрелок/Охотник выбрал цель =====
    else if (data.startsWith('noch_strelok_')) {
        const parts_ns = data.replace('noch_strelok_', '').split('_');
        const kod = parts_ns[0];
        const nomer_ns = parseInt(parts_ns[1]);
        const igra = igry[kod];
        if (!igra) return;
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.strelok_tseli = nomer_ns;
        const zhertva_ns = igra.igroki.find(i => i.nomer === nomer_ns);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD2B Цель: ' + (zhertva_ns?.name || '') });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD2B Стрелок/Охотник выбрал \u2116' + nomer_ns);
    }

    // ===== НОЧЬ: выбор цели Эскортницы =====
    else if (data.startsWith('noch_vybor_eskort_')) {
        const kod = data.replace('noch_vybor_eskort_', '');
        const igra = igry[kod];
        if (!igra) return;
        const limit = limitVystrelovEskort(igra);
        const vybory = eskortVyboryNochi(igra);
        if (vybory.length >= limit) {
            bot.answerCallbackQuery(query.id, { text: 'Лимит выстрелов эскортницы на эту ночь исчерпан.', show_alert: true });
            return;
        }
        const eskort = igra.igroki.find(i => i.status === 'v_igre' && i.rol === 'Эскортница');
        const uzhe = new Set(vybory.map(v => v.nomer));
        const kandidaty = igra.igroki.filter(i => i.status === 'v_igre' && i.nomer !== eskort?.nomer && !uzhe.has(i.nomer));
        if (kandidaty.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Нет игроков для выбора.', show_alert: true });
            return;
        }
        const knopki_esk = kandidaty.map(i => [{ text: '\uD83D\uDC8B \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_eskort_pick_' + kod + '_' + i.nomer }]);
        knopki_esk.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDC8B *Эскортница: выбери игрока*\n\nВыстрел ' + (vybory.length + 1) + ' из ' + limit,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_esk } }
        );
    }

    // ===== НОЧЬ: Эскортница выбрала игрока — угадываем роль =====
    else if (data.startsWith('noch_eskort_pick_')) {
        const parts_ep = data.replace('noch_eskort_pick_', '').split('_');
        const kod = parts_ep[0];
        const nomer_ep = parseInt(parts_ep[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_ep = igra.igroki.find(i => i.nomer === nomer_ep && i.status === 'v_igre');
        if (!tsel_ep) {
            bot.answerCallbackQuery(query.id, { text: 'Игрок уже не в игре.', show_alert: true });
            return;
        }
        const roli_esk = roliDlyaUgadivaniyaEskort();
        const knopki_rol = [];
        for (let idx = 0; idx < roli_esk.length; idx += 2) {
            const row = [{ text: roli_esk[idx], callback_data: 'noch_eskort_rol_' + kod + '_' + nomer_ep + '_' + idx }];
            if (roli_esk[idx + 1]) row.push({ text: roli_esk[idx + 1], callback_data: 'noch_eskort_rol_' + kod + '_' + nomer_ep + '_' + (idx + 1) });
            knopki_rol.push(row);
        }
        knopki_rol.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_vybor_eskort_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDC8B *Эскортница называет роль*\n\nИгрок: \u2116' + nomer_ep + ' *' + tsel_ep.name + '*\nКакую роль назвала?',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_rol } }
        );
    }

    // ===== НОЧЬ: Эскортница назвала роль =====
    else if (data.startsWith('noch_eskort_rol_')) {
        const parts_er = data.replace('noch_eskort_rol_', '').split('_');
        const kod = parts_er[0];
        const nomer_er = parseInt(parts_er[1]);
        const idx_er = parseInt(parts_er[2]);
        const igra = igry[kod];
        if (!igra) return;
        const roli_esk = roliDlyaUgadivaniyaEskort();
        const ugadannaya = roli_esk[idx_er];
        if (!ugadannaya) {
            bot.answerCallbackQuery(query.id, { text: 'Роль не найдена.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        if (!Array.isArray(igra.noch_deystviya.eskort_vybory)) igra.noch_deystviya.eskort_vybory = [];
        igra.noch_deystviya.eskort_vybory.push({ nomer: nomer_er, ugadannaya_rol: ugadannaya });
        bot.answerCallbackQuery(query.id, { text: '\u2116' + nomer_er + ': ' + ugadannaya });
        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDC8B Эскортница: \u2116' + nomer_er + ' \u2192 *' + ugadannaya + '*');
    }


    // ===== НОЧЬ: выбор цели Затычки =====
    else if (data.startsWith('noch_vybor_zat_')) {
        const kod = data.replace('noch_vybor_zat_', '');
        const igra = igry[kod];
        if (!igra) return;
        const alive_zat = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Затычка');
        const knopki_zat = alive_zat.map(i => [{ text: '\uD83D\uDD07 \u2116' + i.nomer + ' ' + i.name, callback_data: 'noch_zat_' + kod + '_' + i.nomer }]);
        knopki_zat.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText('\uD83D\uDD07 *Затычка: кого заблокировать?*\n\n_Игрок лишится речи и права голосовать_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki_zat }
        });
    }

    // ===== НОЧЬ: Затычка выбрала цель =====
    else if (data.startsWith('noch_zat_')) {
        const parts_nz = data.replace('noch_zat_', '').split('_');
        const kod = parts_nz[0];
        const nomer_nz = parseInt(parts_nz[1]);
        const igra = igry[kod];
        if (!igra) return;

        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.zatychka_tseli = nomer_nz;

        // Запоминаем заблокированного для следующего дня
        igra.zablokirovan_nomer = nomer_nz;

        const tseli_nz = igra.igroki.find(i => i.nomer === nomer_nz);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDD07 ' + (tseli_nz?.name || '') + ' заблокирован' });

        // Уведомляем заблокированного
        if (tseli_nz?.telegram_id) {
            bot.sendMessage(tseli_nz.telegram_id,
                '\uD83D\uDD07 *Затычка заблокировала тебя этой ночью.*\n\nЗавтра ты не сможешь говорить на своей минуте и голосовать.\nНо тебя всё ещё могут выставить на голосование.',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        await sohranit_igru(kod);
        await pokazat_noch_panel(chatId, messageId, kod, '\uD83D\uDD07 Затычка заблокировала \u2116' + nomer_nz);
    }

    // ===== НОЧЬ: Шахид минирует / переминирует =====
    else if (data.startsWith('noch_vybor_shahid_')) {
        const kod = data.replace('noch_vybor_shahid_', '');
        const igra = igry[kod];
        if (!igra) return;
        if (!(igra.den === 1 || igra.den === 2)) {
            bot.answerCallbackQuery(query.id, { text: 'Шахид минирует только в Н1 и Н2.', show_alert: true });
            return;
        }

        igra.noch_deystviya = igra.noch_deystviya || {};
        const vybrany = igra.noch_deystviya.shahid_miny_tseli || (igra.den === 2 ? [...(igra.shahid_miny || [])] : []);
        igra.noch_deystviya.shahid_miny_tseli = vybrany;
        const limit = limitMinShahida(igra);
        const alive_sh = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Шахид');
        const knopki_sh = alive_sh.map(i => [{
            text: (vybrany.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'noch_shahid_toggle_' + kod + '_' + i.nomer
        }]);
        knopki_sh.push([{ text: '\u2705 Готово (' + vybrany.length + '/' + limit + ')', callback_data: 'noch_panel_' + kod }]);
        knopki_sh.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDCA3 *Шахид: ' + (igra.den === 1 ? 'минирование' : 'переминирование') + '*\n\n' +
            'Выбери до *' + limit + '* игроков — 30% стола.\n' +
            'Сейчас выбрано: *' + vybrany.length + '/' + limit + '*',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sh } }
        );
    }

    else if (data.startsWith('noch_shahid_toggle_')) {
        const parts_sh = data.replace('noch_shahid_toggle_', '').split('_');
        const kod = parts_sh[0];
        const nomer_sh = parseInt(parts_sh[1]);
        const igra = igry[kod];
        if (!igra) return;

        igra.noch_deystviya = igra.noch_deystviya || {};
        const limit = limitMinShahida(igra);
        const vybrany = igra.noch_deystviya.shahid_miny_tseli || (igra.den === 2 ? [...(igra.shahid_miny || [])] : []);
        const idx = vybrany.indexOf(nomer_sh);
        if (idx >= 0) {
            vybrany.splice(idx, 1);
            bot.answerCallbackQuery(query.id, { text: 'Снято' });
        } else {
            if (vybrany.length >= limit) {
                bot.answerCallbackQuery(query.id, { text: 'Можно выбрать максимум ' + limit, show_alert: true });
                return;
            }
            vybrany.push(nomer_sh);
            bot.answerCallbackQuery(query.id, { text: 'Заминирован №' + nomer_sh });
        }
        igra.noch_deystviya.shahid_miny_tseli = vybrany;
        await sohranit_igru(kod);

        const alive_sh = igra.igroki.filter(i => i.status === 'v_igre' && i.rol !== 'Шахид');
        const knopki_sh = alive_sh.map(i => [{
            text: (vybrany.includes(i.nomer) ? '\u2705 ' : '\u25AB\uFE0F ') + '\u2116' + i.nomer + ' ' + i.name,
            callback_data: 'noch_shahid_toggle_' + kod + '_' + i.nomer
        }]);
        knopki_sh.push([{ text: '\u2705 Готово (' + vybrany.length + '/' + limit + ')', callback_data: 'noch_panel_' + kod }]);
        knopki_sh.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
        bot.editMessageText(
            '\uD83D\uDCA3 *Шахид: ' + (igra.den === 1 ? 'минирование' : 'переминирование') + '*\n\n' +
            'Выбери до *' + limit + '* игроков — 30% стола.\n' +
            'Сейчас выбрано: *' + vybrany.length + '/' + limit + '*',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_sh } }
        );
    }

    // ===== НОЧЬ: итоги =====
    else if (data.startsWith('noch_itog_')) {
        const kod = data.replace('noch_itog_', '');
        const igra = igry[kod];
        if (!igra) return;
        const d = igra.noch_deystviya || {};
        const maf_t = d.mafiya_tseli || [];
        const doc_t = d.doctor_tseli;
        const ubityPodryvnik = maf_t
            .map(nomer => igra.igroki.find(x => x.nomer === nomer))
            .find(i => i && i.rol === 'Подрывник' && doc_t !== i.nomer);
        if (ubityPodryvnik && !d.podryvnik_zabiraet) {
            const kandidatyPodryvnika = igra.igroki.filter(x => x.status === 'v_igre');
            if (kandidatyPodryvnika.length > 0) {
                const knopki_podryv = kandidatyPodryvnika.map(i => [{
                    text: '\uD83D\uDCA5 \u2116' + i.nomer + ' ' + i.name + ' — ' + i.rol,
                    callback_data: 'noch_podryv_' + kod + '_' + i.nomer
                }]);
                knopki_podryv.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'noch_panel_' + kod }]);
                bot.editMessageText(
                    '\uD83D\uDCA5 *Подрывника убила мафия!*\n\n' +
                    '\u2116' + ubityPodryvnik.nomer + ' *' + ubityPodryvnik.name + '* выбирает, кого забрать с собой:',
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: knopki_podryv }
                    }
                );
                return;
            }
        }
        let itog_t = '\uD83C\uDF19 *Итоги ночи ' + (igra.den || 1) + ':*\n\n';
        if (d.don_tseli) {
            const proverka_don = igra.igroki.find(x => x.nomer === d.don_tseli);
            const don = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Дон');
            if ((igra.den || 1) === 1 && don && proverka_don && isSheriffRole(proverka_don.rol)) {
                dobavitAvtoBonus(igra, don.nomer, 'bonus_don_nashel_sherifa_n1', BALLY_DEFAULT.bonus_don_nashel_sherifa_n1, 'Дон нашёл Шерифа/Комиссара в первую ночь', { tsel: d.don_tseli });
            }
            itog_t += '\uD83D\uDD0E Дон проверил \u2116' + d.don_tseli + ': ' + (proverka_don && isSheriffRole(proverka_don.rol) ? 'Шериф/Комиссар' : 'не Шериф') + '\n';
        }
        if (d.sherif_tseli) {
            const proverka_sher = igra.igroki.find(x => x.nomer === d.sherif_tseli);
            const sherif = igra.igroki.find(x => x.status === 'v_igre' && isSheriffRole(x.rol));
            if (sherif && proverka_sher && isMafiaRole(proverka_sher.rol)) {
                dobavitAvtoBonus(igra, sherif.nomer, 'bonus_sheriff_nashel_maf', BALLY_DEFAULT.bonus_sheriff_nashel_maf, 'Шериф/Комиссар нашёл мафию', { tsel: d.sherif_tseli });
            }
            itog_t += '\uD83D\uDD0D Шериф проверил \u2116' + d.sherif_tseli + ': ' + (proverka_sher && isMafiaRole(proverka_sher.rol) ? 'Мафия' : 'мирный') + '\n';
        }
        if (d.kons_tseli) {
            const zaverbovan = igra.igroki.find(x => x.nomer === d.kons_tseli && x.status === 'v_igre' && x.rol === 'Мирный');
            if (zaverbovan) {
                zaverbovan.rol = 'Мафия';
                itog_t += '\uD83E\uDD1D Консильери завербовал \u2116' + d.kons_tseli + ' *' + zaverbovan.name + '* в мафию\n';
                if (zaverbovan.telegram_id) {
                    bot.sendMessage(zaverbovan.telegram_id,
                        '\uD83D\uDD34 *Тебя завербовала мафия.*\n\nТеперь ты играешь за команду мафии.',
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }
            }
        }
        if (d.shahid_miny_tseli) {
            igra.shahid_miny = [...d.shahid_miny_tseli];
            itog_t += '\uD83D\uDCA3 Шахид ' + ((igra.den || 1) === 1 ? 'заминировал' : 'переминировал') + ': ' + igra.shahid_miny.map(n => '\u2116' + n).join(', ') + '\n';
        }
        const vystrely = primenitNochnyeVystrely(igra, d);
        vystrely.lines.forEach(line => { itog_t += line; });
        const ubity_t = vystrely.ubity_t;
        const eskortVybory = d.eskort_vybory || [];
        const eskortNoch = igra.igroki.find(x => x.status === 'v_igre' && x.rol === 'Эскортница');
        eskortVybory.forEach(v => {
            const tselEsk = igra.igroki.find(x => x.nomer === v.nomer);
            if (!tselEsk || tselEsk.status !== 'v_igre') {
                itog_t += '\uD83D\uDC8B Эскортница: \u2116' + v.nomer + ' \u2192 ' + v.ugadannaya_rol + ' (игрок уже не за столом)\n';
                return;
            }
            if (sravnitRoliEskort(v.ugadannaya_rol, tselEsk.rol)) {
                tselEsk.status = 'vybyl';
                dobavitUnikalnoPoNomeru(ubity_t, tselEsk);
                if (eskortNoch) {
                    dobavitAvtoBonus(igra, eskortNoch.nomer, 'bonus_eskort_ugadala_rol', BALLY_DEFAULT.bonus_eskort_ugadala_rol, 'Эскортница угадала роль игрока', { tsel: tselEsk.nomer, rol: tselEsk.rol });
                }
                itog_t += '\uD83D\uDC8B Эскортница угадала: \u2116' + tselEsk.nomer + ' *' + tselEsk.name + '* — ' + tselEsk.rol + '. Не пережил утро.\n';
                itog_t += primenitSmertShahida(igra, tselEsk, 'noch', ubity_t);
            } else {
                itog_t += '\uD83D\uDC8B Эскортница промахнулась: \u2116' + tselEsk.nomer + ' *' + tselEsk.name + '* не ' + v.ugadannaya_rol + '\n';
            }
        });
        const v_igre_t = igra.igroki.filter(i => i.status === 'v_igre');
        itog_t += '\n\uD83D\uDC65 *За столом: ' + v_igre_t.length + '*\n';
        v_igre_t.forEach(i => { itog_t += '\u2705 \u2116' + i.nomer + ' ' + i.name + '\n'; });
        ubity_t.forEach(i => { bot.sendMessage(i.telegram_id, '\uD83D\uDC80 *Тебя убили ночью.*\n\nТвоя роль: *' + i.rol + '*', { parse_mode: 'Markdown' }).catch(() => {}); });
        zapisatIstoriyuDoktora(igra, doc_t);
        igra.noch_deystviya = {};
        const kandidatLuchshegoHoda = (igra.den || 1) === 1 ? ubity_t.find(mozhetBytLuchshiyHod) : null;
        if (kandidatLuchshegoHoda) {
            await sohranit_igru(kod);
            await bot.editMessageText(itog_t + '\n\n\uD83D\uDDE3 Последнее слово: можно зафиксировать лучший ход.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\uD83C\uDFC6 Лучший ход \u2116' + kandidatLuchshegoHoda.nomer, callback_data: 'lh_start_' + kod + '_' + kandidatLuchshegoHoda.nomer + '_night1_day' }],
                    [{ text: '\u23ED\uFE0F Без лучшего хода', callback_data: 'lh_skip_' + kod + '_' + kandidatLuchshegoHoda.nomer + '_night1_day' }]
                ] }
            });
            return;
        }
        const pobeditel = opredelitPobeditelya(igra);
        if (pobeditel && await zavershitIgruAvto(chatId, messageId, kod, pobeditel)) return;
        igra.den = (igra.den || 1) + 1;
        await sohranit_igru(kod);
        bot.editMessageText(itog_t + '\n\n_Сначала выберешь, кто начинает дневные речи._', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: knopkaKtoNachinaet('den', igra.den), callback_data: 'faza_den_' + kod }],
            [{ text: '\uD83C\uDFC1 Завершить игру', callback_data: 'konec_' + kod }]
        ]}});
    }

    // ===== НОЧЬ: панель =====
    else if (data.startsWith('noch_panel_')) {
        const kod = data.replace('noch_panel_', '');
        const igra = igry[kod];
        if (!igra) return;
        await pokazat_noch_panel(chatId, messageId, kod, null);
    }

    // ===== ЛУЧШИЙ ХОД: фиксация на последнем слове =====
    else if (data.startsWith('lh_start_')) {
        const parts_lh = data.replace('lh_start_', '').split('_');
        const kod = parts_lh[0];
        const nomer_lh = parseInt(parts_lh[1]);
        const source_lh = parts_lh[2];
        const next_lh = parts_lh[3];
        const igra = igry[kod];
        if (!igra) return;
        const igrok_lh = igra.igroki.find(i => i.nomer === nomer_lh);
        if (!mozhetBytLuchshiyHod(igrok_lh)) {
            bot.answerCallbackQuery(query.id, { text: 'Лучший ход доступен только мирному игроку.', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFC6 Лучший ход' });
        await pokazatLuchshiyHod(chatId, messageId, kod, nomer_lh, source_lh, next_lh);
    }

    else if (data.startsWith('lh_toggle_')) {
        const parts_lht = data.replace('lh_toggle_', '').split('_');
        const kod = parts_lht[0];
        const nomer_lh = parseInt(parts_lht[1]);
        const tsel_lh = parseInt(parts_lht[2]);
        const source_lh = parts_lht[3];
        const next_lh = parts_lht[4];
        const igra = igry[kod];
        if (!igra) return;
        const hod = poluchitLuchshiyHod(igra, nomer_lh, source_lh);
        const idx = hod.nazvannye.indexOf(tsel_lh);
        if (idx >= 0) {
            hod.nazvannye.splice(idx, 1);
            bot.answerCallbackQuery(query.id, { text: 'Снято' });
        } else {
            hod.nazvannye.push(tsel_lh);
            bot.answerCallbackQuery(query.id, { text: 'Добавлено №' + tsel_lh });
        }
        await sohranit_igru(kod);
        await pokazatLuchshiyHod(chatId, messageId, kod, nomer_lh, source_lh, next_lh);
    }

    else if (data.startsWith('lh_done_')) {
        const parts_lhd = data.replace('lh_done_', '').split('_');
        const kod = parts_lhd[0];
        const nomer_lh = parseInt(parts_lhd[1]);
        const source_lh = parts_lhd[2];
        const next_lh = parts_lhd[3];
        const igra = igry[kod];
        if (!igra) return;
        poluchitLuchshiyHod(igra, nomer_lh, source_lh);
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: '\uD83C\uDFC6 Лучший ход сохранён' });
        await prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next_lh);
    }

    else if (data.startsWith('lh_skip_')) {
        const parts_lhs = data.replace('lh_skip_', '').split('_');
        const kod = parts_lhs[0];
        const nomer_lh = parseInt(parts_lhs[1]);
        const source_lh = parts_lhs[2];
        const next_lh = parts_lhs[3];
        const igra = igry[kod];
        if (!igra) return;
        igra.luchshie_hody = (igra.luchshie_hody || []).filter(h => !(h.igrok_nomer === nomer_lh && h.source === source_lh));
        await sohranit_igru(kod);
        bot.answerCallbackQuery(query.id, { text: 'Без лучшего хода' });
        await prodolzhitPosleLuchshegoHoda(chatId, messageId, kod, next_lh);
    }

    // ===== НОЧЬ: Подрывник выбрал кого забрать =====
    else if (data.startsWith('noch_podryv_')) {
        const parts_np = data.replace('noch_podryv_', '').split('_');
        const kod = parts_np[0];
        const nomer_np = parseInt(parts_np[1]);
        const igra = igry[kod];
        if (!igra) return;
        const tsel_np = igra.igroki.find(i => i.nomer === nomer_np && i.status === 'v_igre');
        if (!tsel_np) {
            bot.answerCallbackQuery(query.id, { text: 'Можно выбрать только живого игрока.', show_alert: true });
            return;
        }
        igra.noch_deystviya = igra.noch_deystviya || {};
        igra.noch_deystviya.podryvnik_zabiraet = nomer_np;
        bot.answerCallbackQuery(query.id, { text: 'Подрывник заберёт ' + tsel_np.name });
        await sohranit_igru(kod);
        bot.editMessageText(
            '\uD83D\uDCA5 Подрывник выбрал \u2116' + nomer_np + ' *' + tsel_np.name + '*.\n\nТеперь можно показать итоги ночи.',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '\uD83C\uDF1F Итоги ночи', callback_data: 'noch_itog_' + kod }]] }
            }
        );
    }


    // ===== РЕЙТИНГ: выбор клуба =====
    else if (data === 'reyting_vybor_kluba') {
        const { data: igrok_r } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_r } = await supabase.from('chleny_klubov').select('klub_id, rol, kluby(id, nazvaniye)').eq('igrok_id', igrok_r?.id).in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);
        const kluby_r = (chleny_r || []).filter(c => c.kluby).map(c => c.kluby);
        if (kluby_r.length === 0) { bot.editMessageText('\u274C Нет клубов', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]] } }); return; }
        if (kluby_r.length === 1) { await pokazat_reyting_kluba(chatId, messageId, kluby_r[0].id, false); return; }
        const knopki_r = kluby_r.map(k => [{ text: '\uD83C\uDFC6 ' + k.nazvaniye, callback_data: 'reyting_klub_' + k.id + '_0' }]);
        knopki_r.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('\uD83C\uDFC6 *Рейтинг*\n\nВыбери клуб:', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki_r } });
    }

    else if (data.startsWith('reyting_klub_')) {
        const parts_rk = data.replace('reyting_klub_', '').split('_');
        const klub_id_rk = parts_rk[0];
        const sport_rk = parts_rk[1] === '1';
        await pokazat_reyting_kluba(chatId, messageId, klub_id_rk, sport_rk);
    }

    // ===== РЕЙТИНГ: скачать CSV =====
    else if (data.startsWith('reyting_csv_')) {
        const parts_csv = data.replace('reyting_csv_', '').split('_');
        const klub_id_csv = parts_csv[0];
        const sport_csv = parts_csv[1] === '1';

        const { data: klub_csv } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id_csv).single();
        const { data: rows_csv } = await supabase.from('bally').select('igrok_id, rol, pobedila_komanda, vyzhil, bally_komanda, bally_lichnie, bally_vsego, data_igry, igroki(imya, igrovoy_nik)').eq('klub_id', klub_id_csv).eq('sportivniy', sport_csv).order('data_igry', { ascending: false });

        let csv = 'Имя,Ник,Роль,Победа,Выжил,Баллы команды,Личные баллы,Итого,Дата\n';
        (rows_csv || []).forEach(r => {
            const name = r.igroki?.imya || '';
            const nik = r.igroki?.igrovoy_nik || '';
            const date = r.data_igry ? r.data_igry.slice(0, 10) : '';
            csv += [name, nik, r.rol, r.pobedila_komanda ? 'Да' : 'Нет', r.vyzhil ? 'Да' : 'Нет', r.bally_komanda, r.bally_lichnie, r.bally_vsego, date].join(',') + '\n';
        });

        // Сохраняем временный файл и отправляем
        const fs = require('fs');
        const path = require('path');
        const fname = '/tmp/rating_' + klub_id_csv + '_' + Date.now() + '.csv';
        fs.writeFileSync(fname, '\uFEFF' + csv, 'utf8'); // BOM для Excel
        await bot.sendDocument(chatId, fname, {}, { filename: (klub_csv?.nazvaniye || 'klub') + '_rating.csv', contentType: 'text/csv' });
        fs.unlinkSync(fname);
        bot.answerCallbackQuery(query.id, { text: '\uD83D\uDCE5 CSV отправлен' });
    }

    // ===== НАСТРОЙКИ КЛУБА =====
    else if (data === 'nastroyki_kluba_v') {
        const { data: igrok_nk } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_nk } = await supabase.from('chleny_klubov').select('klub_id, kluby(id, nazvaniye, nastroyki, sportivniy_rezhim)').eq('igrok_id', igrok_nk?.id).eq('rol', 'vladyelets');
        const klub_nk = chleny_nk?.[0]?.kluby;
        if (!klub_nk) { bot.answerCallbackQuery(query.id, { text: '\u274C Нет клуба' }); return; }

        const sport = klub_nk.sportivniy_rezhim;
        const n = klub_nk.nastroyki || {};
        let t = '\u2699\uFE0F *Настройки клуба — ' + klub_nk.nazvaniye + '*\n\n';
        t += '\uD83C\uDFC6 Спортивный режим: ' + (sport ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t += '\uD83D\uDC4B Знакомство: ' + (n.znakomstvo_sek || 10) + ' сек\n';
        t += '\u26A0\uFE0F Оправдание: ' + (n.opravdanie_sek || 30) + ' сек\n';
        t += '\uD83D\uDD34 Макс. фолов: ' + (n.max_foly || 4) + '\n';
        const tipPrav = n.tip_kluba || 'paskal';
        t += '\uD83D\uDCDC Правила: *' + (tipPrav === 'vip' ? 'VIP' : tipPrav === 'sportivniy' ? 'Спортивный' : 'Pascal') + '*\n';
        t += '\uD83D\uDC89 Доктор: ' + tekstPravilDoktora({ tip_kluba: tipPrav, _nastroyki: n }) + '\n\n';
        t += '*Баллы:*\n';
        const b = n.bally || BALLY_DEFAULT;
        t += '\uD83D\uDFE2 Победа команды: +' + (b.pobeda_komanda ?? 3) + '\n';
        t += '\uD83D\uDFE1 Выжил: +' + (b.vyzhil ?? 1) + '\n';
        t += '\uD83D\uDD34 Дон победил: +' + (b.bonus_don_pobedil ?? 2) + '\n';
        t += '\uD83C\uDFAF Маньяк победил: +' + (b.bonus_manyak_pobedil ?? 5) + '\n';
        t += '⚙️ Тех. труп: ' + (b.shtraf_teh_trup ?? -2) + '\n';
        const chatIdGr = n.telegram_chat_id;
        t += '\n📢 *Публикация итогов:*\n';
        if (chatIdGr) {
            t += 'Группа: *' + md(n.telegram_chat_title || 'привязана') + '*\n';
            t += 'Авто после игры: ' + (n.auto_publish_results ? '✅' : '❌') + '\n';
        } else {
            t += '_Группа не привязана — перешлите сообщение из чата клуба._\n';
        }

        const knGr = chatIdGr
            ? [
                [{ text: n.auto_publish_results ? '❌ Выключить автопубликацию' : '✅ Автопубликация после игры', callback_data: 'gruppa_klub_auto_' + klub_nk.id }],
                [{ text: '🔗 Отвязать группу', callback_data: 'gruppa_klub_otvyaz_' + klub_nk.id }]
            ]
            : [[{ text: '📢 Привязать группу клуба', callback_data: 'gruppa_klub_setup_' + klub_nk.id }]];

        bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_nk.id }],
            [{ text: tipPrav === 'vip' ? '\uD83D\uDCCB Переключить на Pascal' : '\uD83D\uDCCB Переключить на VIP', callback_data: 'toggle_tip_kluba_' + klub_nk.id }],
            [{ text: n.logo_file_id ? '🎨 Заменить логотип' : '🎨 Загрузить логотип', callback_data: 'brend_klub_' + klub_nk.id }],
            ...(n.logo_file_id ? [[{ text: '🗑 Удалить логотип', callback_data: 'brend_klub_del_' + klub_nk.id }]] : []),
            [{ text: '\uD83C\uDFA8 Стилизация клуба — 5000₽ навсегда', callback_data: 'stil_klub_' + klub_nk.id }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_nk.id }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_nk.id }],
            ...knGr,
            [{ text: '🔗 Приглашение в клуб', callback_data: 'klub_invite_show_' + klub_nk.id }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    else if (data === 'brend_klub_menu') {
        const klubyB = await klubBrend.klubyDlyaBrenda(telegram_id);
        if (klubyB.length === 0) {
            bot.answerCallbackQuery(query.id, { text: 'Нет клубов для управления', show_alert: true });
            return;
        }
        if (klubyB.length === 1) {
            const k = klubyB[0];
            sostoyanie[telegram_id] = 'brend_klub_' + k.id;
            const hasLogo = !!k.nastroyki?.logo_file_id;
            bot.editMessageText(
                '🎨 *Бренд клуба — ' + md(k.nazvaniye || '') + '*\n\n' +
                (hasLogo ? 'Логотип уже загружен ✅\n\n' : '') +
                'Отправь *фото или PNG/JPG* логотипа клуба.\n' +
                '_Квадратное изображение смотрится лучше всего._\n\n' +
                'Логотип появится в mini app у ведущих и игроков клуба.',
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        ...(hasLogo ? [[{ text: '🗑 Удалить логотип', callback_data: 'brend_klub_del_' + k.id }]] : []),
                        [{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]
                    ] }
                }
            );
            return;
        }
        const knopki = klubyB.map(k => [{
            text: '🎨 ' + (k.nazvaniye || 'Клуб') + (k.nastroyki?.logo_file_id ? ' ✅' : ''),
            callback_data: 'brend_klub_' + k.id
        }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vedushchego' }]);
        bot.editMessageText('🎨 *Логотип клуба*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('brend_klub_del_')) {
        const klub_id = data.replace('brend_klub_del_', '');
        if (!(await klubBrend.mozhnoUpravlyatBrendomKluba(telegram_id, klub_id))) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа', show_alert: true });
            return;
        }
        await klubBrend.udalitLogoKluba(klub_id);
        delete sostoyanie[telegram_id];
        bot.answerCallbackQuery(query.id, { text: 'Логотип удалён' });
        bot.editMessageText('🗑 Логотип удалён. Можно загрузить новый через «🎨 Логотип клуба».', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]] }
        });
    }

    else if (data.startsWith('brend_klub_')) {
        const klub_id = data.replace('brend_klub_', '');
        if (!(await klubBrend.mozhnoUpravlyatBrendomKluba(telegram_id, klub_id))) {
            bot.answerCallbackQuery(query.id, { text: 'Нет доступа', show_alert: true });
            return;
        }
        const { data: klub } = await supabase.from('kluby').select('nazvaniye, nastroyki').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'brend_klub_' + klub_id;
        const hasLogo = !!klub?.nastroyki?.logo_file_id;
        bot.editMessageText(
            '🎨 *Бренд клуба — ' + md(klub?.nazvaniye || '') + '*\n\n' +
            (hasLogo ? 'Текущий логотип будет заменён.\n\n' : '') +
            'Отправь *фото или PNG/JPG* логотипа.\n' +
            '_Квадратное изображение — лучший вариант._',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    ...(hasLogo ? [[{ text: '🗑 Удалить', callback_data: 'brend_klub_del_' + klub_id }]] : []),
                    [{ text: '⬅️ Отмена', callback_data: 'brend_klub_menu' }]
                ] }
            }
        );
    }

    else if (data.startsWith('stil_klub_')) {
        const klub_id_st = data.replace('stil_klub_', '');
        const { data: klub_st } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('id', klub_id_st)
            .single();
        bot.editMessageText(tekstStilizatsiiKluba(klub_st?.nazvaniye || 'клуб'), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDCAC Хочу подключить', callback_data: 'stil_zayavka_' + klub_id_st }],
                [{ text: '\u2B05\uFE0F В настройки клуба', callback_data: 'nastroyki_kluba_v' }]
            ] }
        });
    }

    else if (data.startsWith('stil_zayavka_')) {
        const klub_id_sz = data.replace('stil_zayavka_', '');
        const { data: klub_sz } = await supabase
            .from('kluby')
            .select('nazvaniye')
            .eq('id', klub_id_sz)
            .single();
        bot.answerCallbackQuery(query.id, { text: 'Заявка отправлена', show_alert: true });
        if (ADMIN_TG_ID) {
            bot.sendMessage(ADMIN_TG_ID,
                '🎨 *Заявка на стилизацию клуба*\n\n' +
                'Клуб: *' + (klub_sz?.nazvaniye || klub_id_sz) + '*\n' +
                'TG ведущего/собственника: `' + telegram_id + '`\n' +
                'Стоимость: 5000₽ навсегда',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.editMessageText(
            '✅ *Заявка принята!*\n\n' +
            'Мы свяжемся с тобой и согласуем цвета, стиль и детали интерфейса клуба.\n\n' +
            'Стоимость стилизации: *5000₽ один раз, навсегда*.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '\uD83D\uDCAC Написать в поддержку', callback_data: 'podderzhka' }],
                    [{ text: '\u2699\uFE0F Настройки клуба', callback_data: 'nastroyki_kluba_v' }]
                ] }
            }
        );
    }

    else if (data.startsWith('tarif_klub_')) {
        const klub_id_tar = data.replace('tarif_klub_', '');
        const { data: klub_tar } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('id', klub_id_tar)
            .single();
        bot.editMessageText(tekstTestovoyNedeli(klub_tar?.nazvaniye || 'клуб'), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + klub_id_tar }],
                [{ text: '🎨 Стилизация клуба — 5000₽', callback_data: 'stil_klub_' + klub_id_tar }],
                [{ text: '⬅️ В настройки клуба', callback_data: 'nastroyki_kluba_v' }]
            ] }
        });
    }

    else if (data.startsWith('tarif_zayavka_')) {
        const klub_id_tz = data.replace('tarif_zayavka_', '');
        const { data: klub_tz } = await supabase
            .from('kluby')
            .select('nazvaniye')
            .eq('id', klub_id_tz)
            .single();
        bot.answerCallbackQuery(query.id, { text: 'Заявка отправлена', show_alert: true });
        if (ADMIN_TG_ID) {
            bot.sendMessage(ADMIN_TG_ID,
                '💳 *Заявка на тариф клуба*\n\n' +
                'Клуб: *' + md(klub_tz?.nazvaniye || klub_id_tz) + '*\n' +
                'TG ведущего/собственника: `' + telegram_id + '`\n\n' +
                'Интерес: тариф после тестовой недели.\n' +
                'Пакеты: ' + tarify.tekstZayavkiAdmin() + '.\n' +
                'Сроки: 1 / 3 / 6 / 12 месяцев.\n' +
                'Для 6/12 месяцев можно предложить внешнюю рассрочку через банк-партнёр.\n' +
                'Если клуб международный — уточнить страну, валюту, язык и способ оплаты.',
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        bot.editMessageText(
            '✅ *Заявка на подключение тарифа принята!*\n\n' +
            'Мы свяжемся с тобой и подберём пакет:\n\n' +
            tarify.tekstTarifovSpisok() + '\n\n' +
            'Оформим в Telegram — СБП или перевод.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🎁 О тестовой неделе', callback_data: 'tarif_klub_' + klub_id_tz }],
                    [{ text: '⚙️ Настройки клуба', callback_data: 'nastroyki_kluba_v' }]
                ] }
            }
        );
    }

    // ===== TOGGLE ТИП ПРАВИЛ КЛУБА (Pascal / VIP) =====
    else if (data.startsWith('toggle_tip_kluba_')) {
        const klub_id_tt = data.replace('toggle_tip_kluba_', '');
        const { data: k_tt } = await supabase.from('kluby').select('nastroyki, nazvaniye, sportivniy_rezhim').eq('id', klub_id_tt).single();
        const nastroyki_tt = k_tt?.nastroyki || {};
        const new_tip = (nastroyki_tt.tip_kluba || 'paskal') === 'vip' ? 'paskal' : 'vip';
        await supabase.from('kluby').update({ nastroyki: { ...nastroyki_tt, tip_kluba: new_tip } }).eq('id', klub_id_tt);
        bot.answerCallbackQuery(query.id, { text: new_tip === 'vip' ? 'Правила VIP' : 'Правила Pascal', show_alert: true });
        const sport_tt = k_tt?.sportivniy_rezhim;
        const b = nastroyki_tt.bally || BALLY_DEFAULT;
        let t_tt = '\u2699\uFE0F *Настройки клуба — ' + k_tt.nazvaniye + '*\n\n';
        t_tt += '\uD83C\uDFC6 Спортивный режим: ' + (sport_tt ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t_tt += '\uD83D\uDC4B Знакомство: ' + (nastroyki_tt.znakomstvo_sek || 10) + ' сек\n';
        t_tt += '\u26A0\uFE0F Оправдание: ' + (nastroyki_tt.opravdanie_sek || 30) + ' сек\n';
        t_tt += '\uD83D\uDD34 Макс. фолов: ' + (nastroyki_tt.max_foly || 4) + '\n';
        t_tt += '\uD83D\uDCDC Правила: *' + (new_tip === 'vip' ? 'VIP' : 'Pascal') + '*\n';
        t_tt += '\uD83D\uDC89 Доктор: ' + tekstPravilDoktora({ tip_kluba: new_tip, _nastroyki: nastroyki_tt }) + '\n\n';
        t_tt += '*Баллы:*\n';
        t_tt += '\uD83D\uDFE2 Победа команды: +' + (b.pobeda_komanda ?? 3) + '\n';
        t_tt += '\uD83D\uDFE1 Выжил: +' + (b.vyzhil ?? 1) + '\n';
        t_tt += '⚙️ Тех. труп: ' + (b.shtraf_teh_trup ?? -2) + '\n';
        bot.editMessageText(t_tt, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport_tt ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_id_tt }],
            [{ text: new_tip === 'vip' ? '\uD83D\uDCCB Переключить на Pascal' : '\uD83D\uDCCB Переключить на VIP', callback_data: 'toggle_tip_kluba_' + klub_id_tt }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_id_tt }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_id_tt }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    // ===== TOGGLE СПОРТИВНЫЙ РЕЖИМ =====
    else if (data.startsWith('toggle_sport_')) {
        const klub_id_ts = data.replace('toggle_sport_', '');
        const { data: k_ts } = await supabase.from('kluby').select('sportivniy_rezhim').eq('id', klub_id_ts).single();
        const new_val = !k_ts?.sportivniy_rezhim;
        await supabase.from('kluby').update({ sportivniy_rezhim: new_val }).eq('id', klub_id_ts);
        bot.answerCallbackQuery(query.id, { text: new_val ? '\uD83C\uDFC6 Спортивный режим включён!' : '\u274C Спортивный режим выключен', show_alert: true });
        // Обновляем настройки
        const fake_data = 'nastroyki_kluba_v';
        const fakeQuery = { ...query, data: fake_data };
        // Re-trigger
        const { data: igrok_ts } = await supabase.from('igroki').select('id').eq('tg_id', telegram_id).single();
        const { data: chleny_ts } = await supabase.from('chleny_klubov').select('klub_id, kluby(id, nazvaniye, nastroyki, sportivniy_rezhim)').eq('igrok_id', igrok_ts?.id).eq('rol', 'vladyelets');
        const klub_ts = chleny_ts?.[0]?.kluby;
        if (!klub_ts) return;
        const sport_ts = klub_ts.sportivniy_rezhim;
        const n_ts = klub_ts.nastroyki || {};
        let t_ts = '\u2699\uFE0F *Настройки клуба — ' + klub_ts.nazvaniye + '*\n\n';
        t_ts += '\uD83C\uDFC6 Спортивный режим: ' + (sport_ts ? '\u2705 Включён' : '\u274C Выключен') + '\n';
        t_ts += '\uD83D\uDC4B Знакомство: ' + (n_ts.znakomstvo_sek || 10) + ' сек\n';
        t_ts += '\u26A0\uFE0F Оправдание: ' + (n_ts.opravdanie_sek || 30) + ' сек\n';
        t_ts += '\uD83D\uDD34 Макс. фолов: ' + (n_ts.max_foly || 4) + '\n';
        bot.editMessageText(t_ts, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: sport_ts ? '\u274C Выключить спорт. режим' : '\u2705 Включить спорт. режим', callback_data: 'toggle_sport_' + klub_ts.id }],
            [{ text: '\u23F1 Изменить таймеры', callback_data: 'edit_taymery_' + klub_ts.id }],
            [{ text: '\uD83C\uDFC6 Изменить баллы', callback_data: 'edit_bally_' + klub_ts.id }],
            [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_vladeltsa' }]
        ]}});
    }

    // ===== ИЗМЕНИТЬ БАЛЛЫ =====
    else if (data.startsWith('edit_bally_')) {
        const klub_id_eb = data.replace('edit_bally_', '');
        sostoyanie[telegram_id] = 'edit_bally_json_' + klub_id_eb;
        bot.editMessageText(
            '\uD83C\uDFC6 *Настройка баллов*\n\nОтправь JSON с настройками, например:\n\n`{"pobeda_komanda":3,"vyzhil":1,"bonus_den1_vygolosovan":0.25,"shtraf_teh_trup":-2}`\n\n_Можно указать только те поля что хочешь изменить._',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Отмена', callback_data: 'nastroyki_kluba_v' }]] } }
        );
    }

    // ===== РЕЙТИНГ ИГРОКА =====
    else if (data === 'moy_reyting') {
        const { data: igrok_mr } = await supabase.from('igroki').select('id, imya, igrovoy_nik').eq('tg_id', telegram_id).single();
        if (!igrok_mr) { bot.answerCallbackQuery(query.id, { text: '\u274C Зарегистрируйся сначала' }); return; }

        const { data: rows_mr } = await supabase.from('bally').select('bally_vsego, rol, pobedila_komanda, klub_id, kluby(nazvaniye)').eq('igrok_id', igrok_mr.id).order('data_igry', { ascending: false }).limit(50);

        const vsego_igr = (rows_mr || []).length;
        const vsego_pts = (rows_mr || []).reduce((s, r) => s + r.bally_vsego, 0);
        const pobedy = (rows_mr || []).filter(r => r.pobedila_komanda).length;
        const klubyIgroka = [...new Set((rows_mr || []).map(r => r.klub_id).filter(Boolean))];

        let t_mr = '\uD83C\uDFC6 *Мой рейтинг*\n\n';
        t_mr += '\uD83D\uDC64 ' + (igrok_mr.igrovoy_nik || igrok_mr.imya) + '\n\n';
        t_mr += '\uD83C\uDFB2 Игр сыграно: *' + vsego_igr + '*\n';
        t_mr += '🎴 Клубов: *' + klubyIgroka.length + '*\n';
        t_mr += '\uD83C\uDFC6 Побед: *' + pobedy + '*\n';
        t_mr += '\u2B50 Очков всего: *' + vsego_pts + '*\n\n';

        // Последние 5 игр
        if (rows_mr && rows_mr.length > 0) {
            t_mr += '*Последние игры:*\n';
            rows_mr.slice(0, 5).forEach(r => {
                const em = r.pobedila_komanda ? '\u2705' : '\u274C';
                t_mr += em + ' ' + r.rol + ' — ' + r.bally_vsego + ' очк. (' + (r.kluby?.nazvaniye || '') + ')\n';
            });
        }

        bot.editMessageText(t_mr, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_igroka' }]] } });
    }


    // ===== ИГРОК: посмотреть свою команду (только мафия) =====
    else if (data.startsWith('moya_komanda_')) {
        const kod = data.replace('moya_komanda_', '');
        // Ищем игру — может быть активная или архив
        const igra = igry[kod] || igry['archive_' + kod];
        if (!igra) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Игра не найдена или уже завершена', show_alert: true });
            return;
        }

        // Проверяем что запрашивающий — мафия
        const igrok_req = igra.igroki.find(i => i.telegram_id === telegram_id);
        if (!igrok_req || !isMafiaRole(igrok_req.rol)) {
            bot.answerCallbackQuery(query.id, { text: '\u274C Только команда мафии может это видеть', show_alert: true });
            return;
        }

        // Собираем всю мафию
        const komanda = igra.igroki.filter(i => isMafiaRole(i.rol));
        let t = '\uD83D\uDD34 *Твоя команда — Игра \u2116' + kod + '*\n\n';
        komanda.forEach(i => {
            const status = i.status === 'v_igre' ? '\u2705 в игре' : '\uD83D\uDC80 выбыл';
            t += '\u2116' + i.nomer + ' *' + i.name + '* — ' + i.rol + ' ' + status + '\n';
        });
        t += '\n\uD83E\uDD2B _Только для тебя!_';

        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, t, {
            parse_mode: 'Markdown',
            protect_content: true,
            reply_markup: { inline_keyboard: [[{ text: '\uD83D\uDC40 Обновить', callback_data: 'moya_komanda_' + kod }]] }
        });
    }


    // ===== РЕЖИМ "ИГРАТЬ С ДРУЗЬЯМИ" =====
    else if (data === 'druzya_menu') {
        bot.editMessageText(
            '\uD83C\uDFAE *Играть с друзьями*\n\n' +
            'Личная игра без клуба и без рейтинга: создаёшь код, друзья подключаются, бот раздаёт роли.\n\n' +
            '\uD83C\uDFC6 *Спортивная* — классика на 10 ролей\n' +
            '\uD83C\uDF06 *Городская* — любительская игра на 8–20 ролей\n\n' +
            '\uD83D\uDCB0 *Стоимость: 99 ₽ за игру*\n' +
            '_Оплата — при создании игры_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFB2 Создать игру (99 ₽)', callback_data: 'druzya_sozdat' }],
                [{ text: '\uD83D\uDD11 Войти по коду', callback_data: 'druzya_voiti' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'menu_igroka' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: выбор правил =====
    else if (data === 'druzya_sozdat') {
        bot.editMessageText(
            '\uD83C\uDFB2 *Создать игру с друзьями*\n\nВыбери формат игры:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83C\uDFC6 Спортивная', callback_data: 'druzya_tip_sportivniy' }],
                [{ text: '\uD83C\uDF06 Городская', callback_data: 'druzya_tip_gorodskaya' }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: выбор количества =====
    else if (data.startsWith('druzya_tip_')) {
        const tip_d = data.replace('druzya_tip_', '');
        const tip_names_d = { gorodskaya: 'Городская', sportivniy: 'Спортивная' };
        const vse_kol = tip_d === 'sportivniy' ? [10] : [8,9,10,11,12,13,14,15,16,17,18,19,20];
        const rows_d = [];
        for (let i = 0; i < vse_kol.length; i += 4) {
            rows_d.push(vse_kol.slice(i, i+4).map(n => ({ text: String(n), callback_data: 'druzya_kol_' + tip_d + '_' + n })));
        }
        rows_d.push([{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_sozdat' }]);

        bot.editMessageText(
            '\uD83C\uDFB2 *' + (tip_names_d[tip_d] || tip_d) + '*\n\nВыбери количество ролей:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows_d }
        });
    }

    // ===== ДРУЗЬЯ: предпросмотр и "оплата" =====
    else if (data.startsWith('druzya_kol_')) {
        const parts_dk = data.replace('druzya_kol_', '').split('_');
        const tip_dk = parts_dk[0];
        const kol_dk = parseInt(parts_dk[1]);
        const sostav_tip_dk = tip_dk === 'sportivniy' ? 'sportivniy' : 'paskal';

        const preview_dk = pokazat_sostav_preview(kol_dk, sostav_tip_dk, {});
        if (!preview_dk) { bot.answerCallbackQuery(query.id, { text: '\u274C Нет состава', show_alert: true }); return; }

        bot.editMessageText(
            preview_dk.text + '\n\n' +
            '\uD83D\uDCB0 *Стоимость: 99 ₽*\n' +
            '_Нажми "Оплатить и создать" для запуска_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDCB3 Оплатить и создать (99 ₽)', callback_data: 'druzya_oplata_' + tip_dk + '_' + kol_dk }],
                [{ text: '\u270F\uFE0F Изменить количество ролей', callback_data: 'druzya_tip_' + tip_dk }],
                [{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_tip_' + tip_dk }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: "оплата" (заглушка) → создать игру =====
    else if (data.startsWith('druzya_oplata_')) {
        const parts_op = data.replace('druzya_oplata_', '').split('_');
        const tip_op = parts_op[0];
        const kol_op = parseInt(parts_op[1]);
        const sostav_tip_op = tip_op === 'sportivniy' ? 'sportivniy' : 'paskal';

        // ЗАГЛУШКА ОПЛАТЫ — в будущем подключить ЮKassa/Telegram Stars
        // Пока создаём игру бесплатно для тестирования
        const kod = sgenerirovat_kod();
        const preview_op = pokazat_sostav_preview(kol_op, sostav_tip_op, {});

        igry[kod] = {
            kolichestvo: kol_op,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            klub_id: null,
            tip_kluba: sostav_tip_op,
            sportivniy: tip_op === 'sportivniy',
            rezhim_rolei: 'bot',
            _sostav_custom: preview_op?.sostav,
            _druzya_rezhim: true, // режим "с друзьями" — без рейтинга
            _oplacheno: true
        };
        await sohranit_igru(kod);

        // Создаём ссылку для приглашения
        const bot_username = (await bot.getMe()).username;
        const invite_link = 'https://t.me/' + bot_username + '?start=join_' + kod;

        bot.editMessageText(
            '\uD83C\uDFAE *Игра создана!*\n\n' +
            '\uD83D\uDD11 Код игры: *' + kod + '*\n' +
            '\uD83D\uDC65 Мест: ' + kol_op + '\n\n' +
            '\uD83D\uDCE4 *Ссылка для друзей:*\n' + invite_link + '\n\n' +
            '_Отправь эту ссылку друзьям — они нажмут и сразу войдут в игру_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '\uD83D\uDC65 ' + igry[kod].igroki.length + '/' + kol_op + ' подключились', callback_data: 'status_' + kod }],
                [{ text: '\uD83C\uDFAD Раздать роли', callback_data: 'razdat_' + kod }],
                [{ text: '\uD83D\uDCCB Состав', callback_data: 'panel_' + kod }],
                [{ text: '\uD83C\uDFE0 В меню', callback_data: 'menu_igroka' }]
            ]}
        });
    }

    // ===== ДРУЗЬЯ: войти по коду =====
    else if (data === 'druzya_voiti') {
        sostoyanie[telegram_id] = 'vvodit_kod_druzya';
        bot.editMessageText(
            '\uD83D\uDD11 *Войти в игру друга*\n\nВведи код игры:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '\u2B05\uFE0F Назад', callback_data: 'druzya_menu' }]] }
        });
    }

    // ===== УПРАВЛЕНИЕ АКТИВНОЙ ИГРОЙ =====
    else if (data.startsWith('stop_igra_ok_')) {
        const kod = data.replace('stop_igra_ok_', '');
        const rez = await ostanovitIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, {
                text: rez.error === 'access' ? '❌ Нет доступа' : 'Игра не найдена',
                show_alert: true
            });
            return;
        }
        bot.editMessageText('⏸ *Игра №' + kod + ' остановлена.*\n\nМожно возобновить её позже из «Мои игры».', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '▶️ Возобновить', callback_data: 'resume_igra_' + kod }],
                [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('stop_igra_')) {
        const kod = data.replace('stop_igra_', '');
        if (!igry[kod]) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        bot.editMessageText('⏸ *Остановить игру №' + kod + '?*\n\nТаймер остановится, игра останется в «Мои игры», её можно будет возобновить.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, остановить', callback_data: 'stop_igra_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'panel_' + kod }]
            ]}
        });
    }

    else if (data.startsWith('resume_igra_')) {
        const kod = data.replace('resume_igra_', '');
        const rez = await vozobnovitIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Игра не найдена', show_alert: true });
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Игра возобновлена' });
        await otkrytIgruVedushchego(chatId, messageId, kod);
    }

    else if (data.startsWith('delete_igra_ok_')) {
        const kod = data.replace('delete_igra_ok_', '');
        const rez = await udalitAktivnuyuIgru(kod, telegram_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'access' ? '❌ Нет доступа' : 'Не удалось удалить', show_alert: true });
            return;
        }
        bot.editMessageText('🗑 *Игра №' + kod + ' удалена.*\n\nОна удалена из активных игр и базы.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🎮 Мои игры', callback_data: 'moi_igry' }],
                [{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]
            ] }
        });
    }

    else if (data.startsWith('delete_igra_')) {
        const kod = data.replace('delete_igra_', '');
        if (!igry[kod]) {
            bot.answerCallbackQuery(query.id, { text: 'Игра не найдена', show_alert: true });
            return;
        }
        bot.editMessageText('🗑 *Удалить игру №' + kod + '?*\n\nЭто удалит игру полностью. Рейтинг не будет записан.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🗑 Да, удалить игру', callback_data: 'delete_igra_ok_' + kod }],
                [{ text: '⬅️ Назад', callback_data: 'panel_' + kod }]
            ] }
        });
    }

    // ===== ВЕДУЩИЙ: отменить игру =====
    else if (data.startsWith('otmenit_')) {
        const kod = data.replace('otmenit_', '');
        const igra = igry[kod];

        if (igra) {
            for (const igrok of igra.igroki) {
                if (igrok.telegram_id) bot.sendMessage(igrok.telegram_id, '❌ Ведущий отменил игру №' + kod).catch(() => {});
            }
            delete igry[kod];
            await supabase.from('aktivnye_igry').delete().eq('kod', kod);
        }

        bot.editMessageText('❌ *Игра отменена.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🏠 В меню', callback_data: 'menu_vedushchego' }]] }
        });
    }

    // ===== ИГРОК: войти в игру =====
    else if (data === 'voiti_v_igru') {
        sostoyanie[telegram_id] = 'vvodit_kod';
        bot.editMessageText('🎮 *Введи код игры*\n\n_4 цифры от ведущего:_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_igroka' }]] }
        });
    }

    // ===== ПОДДЕРЖКА =====
    else if (data === 'podderzhka') {
        const text = '💬 *Поддержка*\n\n' +
                     'Если что-то не работает или есть идеи — пиши!\n\n' +
                     '*Контакты:*\n' +
                     '📧 Email: silena005@gmail.com\n' +
                     '💬 Telegram: @prime\\_mafia\\_sochi\n\n' +
                     '⏱ Отвечаем в течение 24 часов';

        bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_igroka' }]] }
        });
    }

    // ===== СОБСТВЕННИК: аналитика (заглушка) =====
    else if (data === 'analitika') {
        bot.editMessageText('📊 *Аналитика*\n\n_Раздел в разработке_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== СОБСТВЕННИК / ВЕДУЩИЙ: приглашение в клуб =====
    else if (data === 'klub_priglashenie') {
        const kluby = await poluchitKlubyDlyaIgr(telegram_id);
        const nazad = await knopkaNazadPriglashenieKluba(telegram_id);
        if (!kluby.length) {
            bot.editMessageText('🔗 *Приглашение в клуб*\n\n❌ Нет клубов, где ты ведущий или собственник.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: nazad }]] }
            });
            return;
        }
        if (kluby.length === 1) {
            await pokazatPriglashenieVKlub(chatId, messageId, kluby[0].id, telegram_id);
            return;
        }
        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'klub_invite_show_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: nazad }]);
        bot.editMessageText('🔗 *Приглашение в клуб*\n\nВыбери клуб — покажем код и ссылку для регистрации:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('klub_invite_show_')) {
        const klub_id = data.replace('klub_invite_show_', '');
        await pokazatPriglashenieVKlub(chatId, messageId, klub_id, telegram_id);
    }

    else if (data.startsWith('klub_invite_link_')) {
        const klub_id = data.replace('klub_invite_link_', '');
        if (!(await mozhnoSmotretPriglashenieKluba(telegram_id, klub_id))) return;
        const kod = await klubInvite.obespechitKodRegistraciiKluba(klub_id);
        const url = kod ? await klubInvite.ssylkaRegistraciiVKlub(bot, kod) : '';
        bot.answerCallbackQuery(query.id, { text: 'Ссылка отправлена' });
        if (url) bot.sendMessage(chatId, url);
    }

    else if (data.startsWith('klub_invite_qr_')) {
        const klub_id = data.replace('klub_invite_qr_', '');
        if (!(await mozhnoSmotretPriglashenieKluba(telegram_id, klub_id))) return;
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        const kod = await klubInvite.obespechitKodRegistraciiKluba(klub_id);
        bot.answerCallbackQuery(query.id, { text: 'QR…' });
        if (kod && klub) await klubInvite.otpravitQrRegistraciiVKlub(bot, chatId, klub.nazvaniye, kod);
    }

    else if (data.startsWith('klub_invite_new_')) {
        const klub_id = data.replace('klub_invite_new_', '');
        const { data: klub } = await supabase.from('kluby').select('owner_tg_id').eq('id', klub_id).maybeSingle();
        if (!klub || klub.owner_tg_id !== telegram_id) {
            bot.answerCallbackQuery(query.id, { text: 'Только собственник может сменить код' });
            return;
        }
        await klubInvite.obnovitKodRegistraciiKluba(klub_id);
        bot.answerCallbackQuery(query.id, { text: 'Новый код создан' });
        await pokazatPriglashenieVKlub(chatId, messageId, klub_id, telegram_id);
    }

    // ===== СОБСТВЕННИК: база игроков =====
    else if (data === 'baza_igrokov') {
        // Находим клубы, где пользователь — собственник
        const { data: kluby } = await supabase
            .from('kluby')
            .select('id, nazvaniye')
            .eq('owner_tg_id', telegram_id);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('👥 *База игроков*\n\n❌ У вас нет клубов в собственности.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            // Один клуб — сразу к списку игроков
            await pokazat_bazu_igrokov(chatId, messageId, kluby[0].id, 0, '');
            return;
        }

        // Несколько клубов — выбор
        const knopki = kluby.map(k => [
            { text: '🎴 ' + k.nazvaniye, callback_data: cbBtn('bk_', { klub_id: k.id, page: 0 }) }
        ]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

        bot.editMessageText('👥 *База игроков*\n\nВыберите клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('bk_')) {
        const p = cbUnpack(data.replace('bk_', ''));
        if (!p) return;
        await pokazat_bazu_igrokov(chatId, messageId, p.klub_id, p.page || 0, '');
    }

    else if (data.startsWith('baza_klub_')) {
        const rest = data.replace('baza_klub_', '');
        const li = rest.lastIndexOf('_');
        const klub_id = rest.substring(0, li);
        const stranitsa = parseInt(rest.substring(li + 1), 10) || 0;
        const filtr = sostoyanie['baza_filtr_' + telegram_id] || '';
        await pokazat_bazu_igrokov(chatId, messageId, klub_id, stranitsa, filtr);
    }

    else if (data.startsWith('baza_poisk_')) {
        const klub_id = data.replace('baza_poisk_', '');
        sostoyanie[telegram_id] = 'baza_poisk_' + klub_id;
        bot.editMessageText('🔍 *Поиск игрока*\n\nВведите часть имени или никнейма:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '⬅️ Отмена', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }
            ]] }
        });
    }

    else if (data.startsWith('baza_sbros_')) {
        const klub_id = data.replace('baza_sbros_', '');
        delete sostoyanie['baza_filtr_' + telegram_id];
        await pokazat_bazu_igrokov(chatId, messageId, klub_id, 0, '');
    }

    else if (data === 'baza_noop') {
        // Кнопка-индикатор страницы — ничего не делаем
        return;
    }

    // ===== СОБСТВЕННИК: создать клуб (начинаем с выбора страны) =====
    else if (data === 'sozdat_klub') {
        await pokazat_vybor_strany(chatId, messageId);
    }

    // ===== ВЫБОР СТРАНЫ =====
    else if (data.startsWith('vstrana_')) {
        const ostatok = data.replace('vstrana_', '');
        const podstroka = ostatok.split('_');
        const kod_strany = podstroka[0];
        const strana = gorodaUi.stranaPoKodu(kod_strany);
        if (!gorodaUi.KODY_STRAN[kod_strany]) {
            bot.editMessageText('❌ Неизвестная страна.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
            });
            return;
        }
        await pokazat_vybor_goroda(chatId, messageId, strana, kod_strany);
    }

    else if (data.startsWith('vka_')) {
        const kod = data.replace('vka_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        await pokazat_vybor_goroda(chatId, messageId, strana, kod);
    }

    else if (data.startsWith('vkl_')) {
        const parts = data.replace('vkl_', '').split('_');
        const kod = parts[0];
        const bukvaIdx = parseInt(parts[1], 10) || 0;
        const stranitsa = parseInt(parts[2], 10) || 0;
        const strana = gorodaUi.stranaPoKodu(kod);
        await pokazatGorodaPoBukve(chatId, messageId, strana, 'vk', bukvaIdx, stranitsa, 'sozdat_klub');
    }

    else if (data.startsWith('vkp_')) {
        const kod = data.replace('vkp_', '');
        const strana = gorodaUi.stranaPoKodu(kod);
        sostoyanie[telegram_id] = 'gorod_poisk_vk_' + kod;
        bot.editMessageText(
            '✍️ *Поиск города* (' + strana + ')\n\nНапиши часть названия — например: *Моск*',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔤 По алфавиту', callback_data: 'vka_' + kod }],
                    [{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]
                ] }
            }
        );
    }

    else if (data.startsWith('vecher_poe_')) {
        const klub_id = data.replace('vecher_poe_', '');
        const today = dataIgrovoegoVechera();
        const { spisok } = await poluchitDannyeVecheraKluba(klub_id);
        const reyting = await vecherReyting.poluchitReytingVechera(supabase, klub_id, today);
        await pokazatVyborIgrokVechera(chatId, messageId, klub_id, reyting, spisok, telegram_id);
    }

    else if (data.startsWith('vecher_reyting_')) {
        const klub_id = data.replace('vecher_reyting_', '');
        const today = dataIgrovoegoVechera();
        const reyting = await vecherReyting.poluchitReytingVechera(supabase, klub_id, today);
        const now = new Date();
        const mesyachny = await vecherReyting.poluchitMesyachnyReyting(supabase, klub_id, now.getFullYear(), now.getMonth() + 1);
        let t = vecherReyting.formatReytingSpiska(reyting, '🌆 Рейтинг вечера', 20);
        t += '\n\n' + vecherReyting.formatReytingSpiska(mesyachny, '📅 Месячный рейтинг', 10);
        bot.editMessageText(t, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ К вечеру', callback_data: 'vecher_klub_' + klub_id }]] }
        });
    }

    // ===== ВЫБОР ГОРОДА =====
    else if (data.startsWith('vgorod_')) {
        // Формат: vgorod_<gorod_id>
        const gorod_id = data.replace('vgorod_', '');
        ozhidanie_registracii[telegram_id] = { shag: 'sozdat_klub_nazvanie', gorod_id: gorod_id };
        bot.editMessageText('➕ *Создание клуба*\n\nГород выбран ✅\n\nТеперь введи название клуба:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_igroka' }]] }
        });
    }

    // ===== МОЕГО ГОРОДА НЕТ =====
    else if (data === 'goroda_net') {
        bot.editMessageText('ℹ️ *Моего города нет*\n\nНапиши нам в поддержку, и мы добавим твой город:\n\n📧 silena005@gmail.com\n💬 @prime\\_mafia\\_sochi', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
        });
    }

    // ===== СОБСТВЕННИК: карточка игрока =====
    else if (data.startsWith('ip_')) {
        const p = cbUnpack(data.replace('ip_', ''));
        if (!p) return;
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('igrok_')) {
        const chasti = data.replace('igrok_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    else if (data.startsWith('res_')) {
        const p = cbUnpack(data.replace('res_', ''));
        if (!p) return;
        try {
            await ustanovitResidentaKluba(p.klub_id, p.igrok_id, p.on);
            bot.answerCallbackQuery(query.id, { text: p.on ? 'Добавлен в резиденты' : 'Убран из резидентов' });
            await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
        } catch (e) {
            console.error('Ошибка резидента:', e);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка сохранения', show_alert: true });
        }
    }

    // ===== СОБСТВЕННИК: сделать ведущим =====
    else if (data.startsWith('vd_')) {
        const p = cbUnpack(data.replace('vd_', ''));
        if (!p) {
            bot.answerCallbackQuery(query.id, { text: 'Нажми /start и повтори', show_alert: true });
            return;
        }
        const rez = await naznachitVedushchegoVKlube(p.klub_id, p.igrok_id);
        if (!rez.ok) {
            const msg = rez.error === 'owner'
                ? '❌ Собственника нельзя понизить до ведущего'
                : '❌ ' + (rez.error || 'Ошибка назначения');
            bot.answerCallbackQuery(query.id, { text: msg, show_alert: true });
            return;
        }
        if (!rez.already) await uvedomitONaznacheniiVedushchego(p.igrok_id, p.klub_id);
        bot.answerCallbackQuery(query.id, { text: rez.already ? 'Уже ведущий' : '✅ Назначен ведущим' });
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('vedushii_')) {
        const chasti = data.replace('vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        const rez = await naznachitVedushchegoVKlube(klub_id, igrok_id);
        if (!rez.ok) {
            bot.answerCallbackQuery(query.id, { text: rez.error === 'owner' ? '❌ Это собственник' : '❌ Ошибка', show_alert: true });
            return;
        }
        if (!rez.already) await uvedomitONaznacheniiVedushchego(igrok_id, klub_id);
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    // ===== СОБСТВЕННИК: снять роль ведущего =====
    else if (data.startsWith('sv_')) {
        const p = cbUnpack(data.replace('sv_', ''));
        if (!p) return;
        const { error } = await supabase.from('chleny_klubov').update({ rol: 'igrok' })
            .eq('klub_id', p.klub_id).eq('igrok_id', p.igrok_id);
        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('snyat_vedushii_')) {
        const chasti = data.replace('snyat_vedushii_', '').split('_');
        const klub_id = chasti[0];
        const igrok_id = chasti.slice(1).join('_');
        const { error } = await supabase.from('chleny_klubov').update({ rol: 'igrok' })
            .eq('klub_id', klub_id).eq('igrok_id', igrok_id);
        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
        }
        await pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id);
    }

    else if (data.startsWith('ank_btn_')) {
        const m = data.match(/^ank_btn_(\d+)_(\d+)$/);
        const d = ozhidanie_registracii[telegram_id];
        if (!m || !d || d.shag !== 'anketa_klub') {
            bot.answerCallbackQuery(query.id, { text: 'Анкета не активна', show_alert: true });
            return;
        }
        const shag = parseInt(m[1], 10);
        const idx = parseInt(m[2], 10);
        const pole = klubAnketa.SHAGI[shag];
        d.otvety[pole.key] = pole.varianty[idx];
        d.anketa_shag = shag + 1;
        bot.answerCallbackQuery(query.id);
        if (d.anketa_shag >= klubAnketa.SHAGI.length) {
            await zavershitAnketuKluba(chatId, telegram_id, d);
            return;
        }
        bot.editMessageText(klubAnketa.tekstShaga(d.anketa_shag, d.nazvaniye_kluba), {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: klubAnketa.knopkiShaga(d.anketa_shag) }
        });
    }

    else if (data === 'ank_skip') {
        const d = ozhidanie_registracii[telegram_id];
        if (!d || d.shag !== 'anketa_klub') {
            bot.answerCallbackQuery(query.id);
            return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Анкета пропущена' });
        await zavershitAnketuKluba(chatId, telegram_id, d, 'skipped');
    }

    else if (data === 'anketa_klub_prosmotr') {
        const kluby = await klubyVladeltsa(telegram_id);
        if (!kluby?.length) {
            bot.answerCallbackQuery(query.id, { text: 'Нет клуба', show_alert: true });
            return;
        }
        if (kluby.length > 1) {
            bot.editMessageText('📋 *Анкета клуба*\n\nВыбери клуб:', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: kluby.map(k => [{ text: k.nazvaniye, callback_data: 'anketa_show_' + k.id }]).concat([[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]]) }
            });
            return;
        }
        const row = await klubAnketa.poluchitAnketuKluba(kluby[0].id);
        bot.editMessageText(row?.tekst_svodka || '📋 Анкета ещё не заполнена. Создай клуб заново или дополни через поддержку.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    else if (data.startsWith('anketa_show_')) {
        const klub_id = data.replace('anketa_show_', '');
        const row = await klubAnketa.poluchitAnketuKluba(klub_id);
        bot.editMessageText(row?.tekst_svodka || '📋 Анкета не найдена.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'anketa_klub_prosmotr' }]] }
        });
    }

    else if (data === 'admin_ankety') {
        if (!isAdmin(telegram_id)) return;
        bot.answerCallbackQuery(query.id);
        await pokazatAnketyAdmin(chatId, messageId);
    }

    else if (data.startsWith('admin_anketa_')) {
        if (!isAdmin(telegram_id)) return;
        const klub_id = data.replace('admin_anketa_', '');
        const row = await klubAnketa.poluchitAnketuKluba(klub_id);
        bot.editMessageText(row?.tekst_svodka || 'Анкета не найдена', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📋 Все анкеты', callback_data: 'admin_ankety' }],
                [{ text: '⬅️ Админ', callback_data: 'admin_back' }]
            ] }
        });
    }

    else if (data === 'admin_back') {
        if (!isAdmin(telegram_id)) return;
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(
            '🔐 *Режим администратора*\n\n📋 /ankety — анкеты клубов',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }

    // ===== АНОНС: выбор клуба =====
    else if (data === 'anons_vybor_kluba') {
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('📢 *Создать анонс*\n\n❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            if (!(await mozhnoFunktsiyuKluba(kluby[0].id, 'anonsy'))) {
                bot.editMessageText(tarify.tekstOgranicheniyaTarifa('anonsy'), {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + kluby[0].id }],
                        [{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]
                    ] }
                });
                return;
            }
            sostoyanie[telegram_id] = 'anons_data_' + kluby[0].id;
            bot.editMessageText('📢 *Создание анонса*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\n📅 Введи дату игры:\n_Пример: 15 мая или 15.05.2026_', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'anons_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('📢 *Создать анонс*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('anons_klub_')) {
        const klub_id = data.replace('anons_klub_', '');
        if (!(await mozhnoFunktsiyuKluba(klub_id, 'anonsy'))) {
            bot.answerCallbackQuery(query.id, { text: 'Анонсы — с тарифа Start', show_alert: true });
            bot.editMessageText(tarify.tekstOgranicheniyaTarifa('anonsy'), {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '💳 Подключить тариф', callback_data: 'tarif_zayavka_' + klub_id }],
                    [{ text: '⬅️ Назад', callback_data: 'anons_vybor_kluba' }]
                ] }
            });
            return;
        }
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'anons_data_' + klub_id;
        bot.editMessageText('📢 *Создание анонса*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\n📅 Введи дату игры:\n_Пример: 15 мая или 15.05.2026_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== АНОНС: пропустить комментарий =====
    else if (data === 'anons_skip_komment') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'anons_komment') return;
        dannye.kommentariy = '';
        delete ozhidanie_registracii[telegram_id];
        await sohranit_anons(chatId, telegram_id, dannye);
    }

    // ===== НАЗНАЧИТЬ ВЕДУЩЕГО =====
    else if (data === 'naznachit_vedushchego') {
        console.log('[DEBUG] naznachit_vedushchego вызван, tg_id:', telegram_id);
        const kluby = await klubyVladeltsa(telegram_id);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            sostoyanie[telegram_id] = 'naznach_poisk_' + kluby[0].id;
            bot.editMessageText(
                '🎤 *Назначить ведущего*\n\nКлуб: *' + kluby[0].nazvaniye + '*\n\n' +
                '• *Я веду сам* — если хочешь вести игры сам\n' +
                '• *Другой человек* — введи имя, @username или номер телефона\n' +
                '_или перешли его контакт из телефонной книги_',
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: '🎤 Я веду сам', callback_data: 'naznach_ya_vedu_' + kluby[0].id }],
                        [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
                    ] }
                }
            );
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'naznachit_v_klube_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('🎤 *Назначить ведущего*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('naznach_ya_vedu_')) {
        const klub_id = data.replace('naznach_ya_vedu_', '');
        delete sostoyanie[telegram_id];
        bot.editMessageText(
            '🎤 *Ты ведёшь игры сам*\n\n' +
            'Как собственник, ты уже можешь открывать игровой вечер и создавать игры без отдельного назначения.\n\n' +
            'Если позже понадобится другой ведущий — вернись в «Назначить ведущего» и найди его по имени или @username.',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🌙 Игровой вечер', callback_data: 'igrovoy_vecher' }],
                    [{ text: '🎲 Создать игру', callback_data: 'sozdat_igru' }],
                    [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
                ] }
            }
        );
    }

    else if (data.startsWith('naznachit_v_klube_')) {
        const klub_id = data.replace('naznachit_v_klube_', '');
        const { data: klub } = await supabase.from('kluby').select('nazvaniye').eq('id', klub_id).single();
        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;
        bot.editMessageText(
            '🎤 *Назначить ведущего*\n\nКлуб: *' + (klub?.nazvaniye || '') + '*\n\n' +
            '• *Я веду сам* — если хочешь вести игры сам\n' +
            '• *Другой человек* — введи имя, @username или номер телефона\n' +
            '_или перешли его контакт из телефонной книги_',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🎤 Я веду сам', callback_data: 'naznach_ya_vedu_' + klub_id }],
                    [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
                ] }
            }
        );
    }

    else if (data.startsWith('ncfm_')) {
        const parsed = igrokIdIzNcfm(data);
        if (!parsed?.igrok_id) {
            bot.answerCallbackQuery(query.id, { text: 'Повтори поиск ведущего', show_alert: true });
            return;
        }
        const igrok_id = parsed.igrok_id;
        let klub_id = parsed.klub_id || klubIdIzSostoyaniyaNaznacha(telegram_id);
        if (!klub_id) {
            const resolved = await klubIdDlyaNaznacheniyaVedushchego(telegram_id, igrok_id);
            if (!resolved.klub_id) {
                bot.answerCallbackQuery(query.id, { text: 'Сначала выбери клуб', show_alert: true });
                return;
            }
            klub_id = resolved.klub_id;
        }

        const { data: igrok } = await supabase
            .from('igroki').select('imya, tg_username, telefon').eq('id', igrok_id).single();

        const { data: klub } = await supabase
            .from('kluby').select('nazvaniye').eq('id', klub_id).single();

        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;

        bot.editMessageText(
            '🎤 *Назначить ведущего?*\n\n' +
            '👤 *' + (igrok?.imya || '') + '*' +
            (igrok?.tg_username ? '\n@' + igrok.tg_username : '') +
            (igrok?.telefon ? '\n📱 ' + igrok.telefon : '') +
            '\n\nКлуб: *' + (klub?.nazvaniye || '') + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, назначить', callback_data: callbackNaznacheniyaVedushchego(igrok_id) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('naznach_podtverd_')) {
        const parts = data.replace('naznach_podtverd_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');

        sostoyanie[telegram_id] = 'naznach_poisk_' + klub_id;

        const { data: igrok } = await supabase
            .from('igroki').select('imya, tg_username, telefon').eq('id', igrok_id).single();

        const { data: klub } = await supabase
            .from('kluby').select('nazvaniye').eq('id', klub_id).single();

        bot.editMessageText(
            '🎤 *Назначить ведущего?*\n\n' +
            '👤 *' + (igrok?.imya || '') + '*' +
            (igrok?.tg_username ? '\n@' + igrok.tg_username : '') +
            (igrok?.telefon ? '\n📱 ' + igrok.telefon : '') +
            '\n\nКлуб: *' + (klub?.nazvaniye || '') + '*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, назначить', callback_data: callbackNaznacheniyaVedushchego(igrok_id) }],
                [{ text: '🔍 Искать другого', callback_data: 'naznachit_v_klube_' + klub_id }],
                [{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]
            ]}
        });
    }

    else if (data.startsWith('nda_')) {
        const igrok_id = data.replace('nda_', '');
        if (!/^[0-9a-f-]{36}$/i.test(igrok_id)) {
            bot.answerCallbackQuery(query.id, { text: 'Повтори поиск', show_alert: true });
            return;
        }
        const resolved = await klubIdDlyaNaznacheniyaVedushchego(telegram_id, igrok_id);
        if (!resolved.klub_id) {
            bot.answerCallbackQuery(query.id, {
                text: resolved.error === 'pick_club' ? 'Сначала выбери клуб' : 'Нет доступа к клубу',
                show_alert: true
            });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, resolved.klub_id, igrok_id);
    }

    else if (data === 'naznach_da') {
        const pending = sostoyanie[telegram_id]?.naznach_podtv;
        if (!pending?.klub_id || !pending?.igrok_id) {
            bot.answerCallbackQuery(query.id, { text: 'Нажми «Да» в новом сообщении или повтори поиск', show_alert: true });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, pending.klub_id, pending.igrok_id);
    }

    else if (data.startsWith('nok_')) {
        const p = cbUnpack(data.replace('nok_', ''));
        if (!p) {
            bot.answerCallbackQuery(query.id, { text: 'Кнопка устарела — повтори поиск', show_alert: true });
            return;
        }
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, p.klub_id, p.igrok_id);
    }

    else if (data.startsWith('naznach_ok_')) {
        const parts = data.replace('naznach_ok_', '').split('_');
        const klub_id = parts[0];
        const igrok_id = parts.slice(1).join('_');
        await zavershitNaznachenieVedushchego(chatId, messageId, telegram_id, klub_id, igrok_id);
    }

    // ===== МОИ АНОНСЫ =====
    else if (data === 'moi_anonsy_vse' || data.startsWith('moi_anonsy_')) {
        const klub_id = data === 'moi_anonsy_vse' ? null : data.replace('moi_anonsy_', '');

        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        const { data: klubyVlad } = await supabase
            .from('chleny_klubov')
            .select('klub_id')
            .eq('igrok_id', igrok?.id)
            .eq('rol', 'vladyelets');

        const klubIds = (klubyVlad || []).map(c => c.klub_id).filter(Boolean);
        if (klubIds.length === 0) {
            bot.editMessageText('📋 *Мои анонсы*\n\n❌ Нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        let query = supabase
            .from('anonsy')
            .select('id, data_igry, vremya, adres, kommentariy, status, kluby(nazvaniye)')
            .in('klub_id', klub_id ? [klub_id] : klubIds)
            .order('data_igry', { ascending: false })
            .limit(10);

        const { data: anonsy } = await query;

        if (!anonsy || anonsy.length === 0) {
            bot.editMessageText('📋 *Мои анонсы*\n\n_Анонсов пока нет._', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 Создать анонс', callback_data: 'anons_vybor_kluba' }],
                    [{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]
                ]}
            });
            return;
        }

        let tekst = '📋 *Мои анонсы*\n\n';
        const knopki = [];

        anonsy.forEach((a, i) => {
            const status_emoji = a.status === 'aktiven' ? '🟢' : '🔴';
            tekst += (i + 1) + '. ' + status_emoji + ' *' + (a.kluby?.nazvaniye || '') + '*\n';
            tekst += '   📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
            tekst += '   📍 ' + (a.adres || '') + '\n\n';
            const dataTxt = formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry);
            knopki.push([{ text: status_emoji + ' ' + dataTxt + ' ' + (a.vremya || '') + ' — ' + (a.kluby?.nazvaniye || ''), callback_data: 'anons_card_' + a.id }]);
        });

        knopki.push([{ text: '📢 Создать новый', callback_data: 'anons_vybor_kluba' }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== КАРТОЧКА АНОНСА =====
    else if (data.startsWith('anons_card_')) {
        const anons_id = data.replace('anons_card_', '');
        await pokazat_kartochku_anонса(chatId, messageId, anons_id);
    }

    // ===== УДАЛИТЬ АНОНС: подтверждение =====
    else if (data.startsWith('anons_delete_confirm_')) {
        const anons_id = data.replace('anons_delete_confirm_', '');
        bot.editMessageText('🗑 *Удалить анонс?*\n\nЭто действие нельзя отменить. Все записи на этот анонс также будут удалены.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Да, удалить', callback_data: 'anons_delete_' + anons_id }],
                [{ text: '⬅️ Отмена', callback_data: 'anons_card_' + anons_id }]
            ]}
        });
    }

    else if (data.startsWith('anons_delete_')) {
        const anons_id = data.replace('anons_delete_', '');
        const { error } = await supabase.from('anonsy').delete().eq('id', anons_id);

        if (error) {
            bot.editMessageText('❌ Ошибка удаления.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'moi_anonsy_vse' }]] }
            });
            return;
        }

        bot.editMessageText('✅ *Анонс удалён.*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_vse' }], [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]] }
        });
    }

    // ===== РЕДАКТИРОВАТЬ АНОНС =====
    else if (data.startsWith('anons_edit_')) {
        const anons_id = data.replace('anons_edit_', '');
        bot.editMessageText('✏️ *Редактирование анонса*\n\nЧто хочешь изменить?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '📅 Дата', callback_data: 'anons_edit_data_' + anons_id }],
                [{ text: '🕐 Время', callback_data: 'anons_edit_vremya_' + anons_id }],
                [{ text: '📍 Место проведения', callback_data: 'anons_edit_adres_' + anons_id }],
                [{ text: '💬 Комментарий', callback_data: 'anons_edit_komment_' + anons_id }],
                [{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]
            ]}
        });
    }

    else if (data.startsWith('anons_edit_data_')) {
        const anons_id = data.replace('anons_edit_data_', '');
        sostoyanie[telegram_id] = 'anons_upd_data_' + anons_id;
        bot.editMessageText('📅 Введи новую дату:\n_Пример: 15 мая или 15.05.2026_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_vremya_')) {
        const anons_id = data.replace('anons_edit_vremya_', '');
        sostoyanie[telegram_id] = 'anons_upd_vremya_' + anons_id;
        bot.editMessageText('🕐 Введи новое время:\n_Пример: 19:00_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_adres_')) {
        const anons_id = data.replace('anons_edit_adres_', '');
        sostoyanie[telegram_id] = 'anons_upd_adres_' + anons_id;
        bot.editMessageText('📍 Введи новое место проведения:\n_Пример: Ресторан Паскаль, ул. Воровского 19_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    else if (data.startsWith('anons_edit_komment_')) {
        const anons_id = data.replace('anons_edit_komment_', '');
        sostoyanie[telegram_id] = 'anons_upd_komment_' + anons_id;
        bot.editMessageText('💬 Введи новый комментарий:\n_Пример: Играем 3 игры, стоимость 1000₽_', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'anons_edit_' + anons_id }]] }
        });
    }

    // ===== АНОНС: записаться на игру =====
    else if (data.startsWith('anons_zapisatsya_')) {
        const anons_id = data.replace('anons_zapisatsya_', '');
        const { data: igrok } = await supabase
            .from('igroki').select('id, imya').eq('tg_id', telegram_id).single();

        if (!igrok) {
            bot.answerCallbackQuery(query.id, { text: '❌ Сначала зарегистрируйся через /start', show_alert: true });
            return;
        }

        // Проверяем не записан ли уже
        const { data: sushchestvuyushchaya } = await supabase
            .from('zapisi_na_anons')
            .select('id, status')
            .eq('anons_id', anons_id)
            .eq('igrok_id', igrok.id)
            .single();

        if (sushchestvuyushchaya && sushchestvuyushchaya.status === 'aktivna') {
            bot.answerCallbackQuery(query.id);
            // Показываем с кнопкой отмены
            bot.editMessageReplyMarkup({
                inline_keyboard: [
                    [{ text: '❌ Отменить запись', callback_data: 'anons_otmenit_' + anons_id }],
                    [{ text: '⬅️ Назад', callback_data: 'anonsy_goroda' }]
                ]
            }, { chat_id: chatId, message_id: messageId });
            bot.answerCallbackQuery(query.id, { text: '✅ Ты уже записан!', show_alert: true });
            return;
        }

        const { error } = await supabase
            .from('zapisi_na_anons')
            .insert({ anons_id, igrok_id: igrok.id, status: 'aktivna' });

        if (error) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка записи. Попробуй ещё раз.', show_alert: true });
            return;
        }

        bot.answerCallbackQuery(query.id, { text: '🎉 Ты записан на игру!', show_alert: true });

        // Меняем кнопку на "Отменить запись"
        bot.editMessageReplyMarkup({
            inline_keyboard: [
                [{ text: '❌ Отменить запись', callback_data: 'anons_otmenit_' + anons_id }],
                [{ text: '⬅️ Назад', callback_data: 'anonsy_goroda' }]
            ]
        }, { chat_id: chatId, message_id: messageId });

        // Уведомляем ведущего
        const { data: anons } = await supabase
            .from('anonsy')
            .select('vedushchiy_id, data_igry, vremya, igroki(tg_id)')
            .eq('id', anons_id)
            .single();

        if (anons?.vedushchiy_id) {
            const { data: vedushchiy } = await supabase
                .from('igroki').select('tg_id').eq('id', anons.vedushchiy_id).single();
            if (vedushchiy?.tg_id) {
                // Считаем сколько записалось
                const { count } = await supabase
                    .from('zapisi_na_anons')
                    .select('id', { count: 'exact' })
                    .eq('anons_id', anons_id)
                    .eq('status', 'aktivna');

                bot.sendMessage(vedushchiy.tg_id,
                    '📝 *Новая запись на игру!*\n\n' +
                    '👤 ' + igrok.imya + '\n' +
                    '📅 ' + (anons.data_igry || '') + ' ' + (anons.vremya || '') + '\n' +
                    '👥 Всего записалось: ' + count,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    }

    // ===== АНОНС: список записавшихся с отметкой посещаемости =====
    else if (data.startsWith('anons_spisok_')) {
        const anons_id = data.replace('anons_spisok_', '');

        const { data: anons } = await supabase
            .from('anonsy')
            .select('data_igry, vremya, klub_id, kluby(nazvaniye)')
            .eq('id', anons_id)
            .single();

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';

        if (vse.length === 0) {
            tekst += '_Пока никто не записался._\n';
        } else {
            tekst += '_Отметь кто пришёл:_\n';
            vse.forEach((z, i) => {
                const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
                let statusEmoji = '⬜️';
                if (z.status === 'prishel') statusEmoji = '✅';
                if (z.status === 'ne_prishel') statusEmoji = '❌';
                tekst += statusEmoji + ' ' + (i + 1) + '. ' + nik + '\n';
            });
        }

        if (prishli.length > 0) {
            tekst += '\n👥 Пришли: *' + prishli.length + '*';
        }

        // Кнопки для каждого игрока
        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            if (z.status === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });

        // Кнопка начать игру если есть пришедшие
        if (prishli.length >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishli.length + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishli.length > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 игроков (' + prishli.length + '/8)', callback_data: 'baza_noop' }]);
        }

        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПОСЕЩАЕМОСТЬ: отметить пришёл =====
    else if (data.startsWith('pd_')) {
        const p = cbUnpack(data.replace('pd_', ''));
        if (!p) return;
        const zapis_id = p.zapis_id;
        const anons_id = p.anons_id;

        await supabase.from('zapisi_na_anons').update({ status: 'prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '✅ Отмечен как пришедший' });

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            let st = z.id === zapis_id ? '✅' : (z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️'));
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + (prishli.length) + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            }
            return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);
        bot.editMessageText(tekst, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    else if (data.startsWith('pris_da_')) {
        const parts = data.replace('pris_da_', '').split('_');
        const zapis_id = parts[0];
        const anons_id = parts.slice(1).join('_');

        await supabase.from('zapisi_na_anons').update({ status: 'prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '✅ Отмечен как пришедший' });

        // Обновляем список
        const fakeCb = { ...query, data: 'anons_spisok_' + anons_id };
        const fakeQuery = { message: query.message, from: query.from, id: query.id, data: 'anons_spisok_' + anons_id };
        // Перезагружаем список
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            let st = z.id === zapis_id ? '✅' : (z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️'));
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + (prishli.length) + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== ПОСЕЩАЕМОСТЬ: отметить не пришёл =====
    else if (data.startsWith('pn_')) {
        const p = cbUnpack(data.replace('pn_', ''));
        if (!p) return;
        const zapis_id = p.zapis_id;
        const anons_id = p.anons_id;

        await supabase.from('zapisi_na_anons').update({ status: 'ne_prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '❌ Отмечен как не пришедший' });

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel');
        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            const st = z.status === 'prishel' ? '✅' : (z.status === 'ne_prishel' ? '❌' : '⬜️');
            tekst += st + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        if (prishli.length > 0) tekst += '\n👥 Пришли: *' + prishli.length + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            if (z.status === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            }
            return [{ text: '⬜️ ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
        });
        const prishliCount = prishli.length;
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);
        bot.editMessageText(tekst, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: knopki } });
    }

    else if (data.startsWith('pris_net_')) {
        const parts = data.replace('pris_net_', '').split('_');
        const zapis_id = parts[0];
        const anons_id = parts.slice(1).join('_');

        await supabase.from('zapisi_na_anons').update({ status: 'ne_prishel' }).eq('id', zapis_id);
        bot.answerCallbackQuery(query.id, { text: '❌ Отмечен как не пришедший' });

        // Обновляем список (та же логика)
        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('id, status, igrok_id, igroki(id, imya, tg_username, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .in('status', ['aktivna', 'prishel', 'ne_prishel'])
            .order('data_zapisi', { ascending: true });

        const { data: anons } = await supabase
            .from('anonsy').select('data_igry, vremya, kluby(nazvaniye)').eq('id', anons_id).single();

        const vse = zapisi || [];
        const prishli = vse.filter(z => z.status === 'prishel' || (z.id !== zapis_id && z.status === 'prishel'));

        let tekst = '👥 *Список игроков*\n';
        tekst += '📅 ' + (anons?.data_igry || '') + ' ' + (anons?.vremya || '') + '\n';
        tekst += '🎴 ' + (anons?.kluby?.nazvaniye || '') + '\n\n';
        tekst += '_Отметь кто пришёл:_\n';
        vse.forEach((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || '—';
            const st = z.id === zapis_id ? 'ne_prishel' : z.status;
            let emoji = st === 'prishel' ? '✅' : (st === 'ne_prishel' ? '❌' : '⬜️');
            tekst += emoji + ' ' + (i + 1) + '. ' + nik + '\n';
        });
        const prishliCount = vse.filter(z => (z.id === zapis_id ? false : z.status === 'prishel')).length;
        if (prishliCount > 0) tekst += '\n👥 Пришли: *' + prishliCount + '*';

        const knopki = vse.map((z, i) => {
            const nik = z.igroki?.igrovoy_nik || z.igroki?.imya || 'Игрок ' + (i + 1);
            const st = z.id === zapis_id ? 'ne_prishel' : z.status;
            if (st === 'prishel') {
                return [{ text: '✅ ' + nik + ' — не пришёл?', callback_data: cbBtn('pn_', { zapis_id: z.id, anons_id }) }];
            } else {
                return [{ text: (st === 'ne_prishel' ? '❌' : '⬜️') + ' ' + nik + ' — пришёл?', callback_data: cbBtn('pd_', { zapis_id: z.id, anons_id }) }];
            }
        });
        if (prishliCount >= 8) {
            knopki.push([{ text: '🎲 Начать игру (' + prishliCount + ' чел)', callback_data: 'gia_' + anons_id }]);
        } else if (prishliCount > 0) {
            knopki.push([{ text: '⚠️ Нужно минимум 8 (' + prishliCount + '/8)', callback_data: 'baza_noop' }]);
        }
        knopki.push([{ text: '🔄 Обновить', callback_data: 'anons_spisok_' + anons_id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'anons_card_' + anons_id }]);

        bot.editMessageText(tekst, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    // ===== НАЧАТЬ ИГРУ ИЗ АНОНСА =====
    else if (data.startsWith('gia_')) {
        const anons_id = data.replace('gia_', '');

        const { data: zapisi } = await supabase
            .from('zapisi_na_anons')
            .select('igroki(id, imya, tg_id, igrovoy_nik)')
            .eq('anons_id', anons_id)
            .eq('status', 'prishel');

        const igroki_prishli = (zapisi || []).filter(z => z.igroki?.tg_id);

        if (igroki_prishli.length < 8) {
            bot.answerCallbackQuery(query.id, { text: '❌ Нужно минимум 8 игроков', show_alert: true });
            return;
        }

        // Показываем выбор количества игроков
        const n = igroki_prishli.length;
        bot.editMessageText(
            '🎲 *Начать игру*\n\n' +
            '👥 Пришли: ' + n + ' игроков\n\n' +
            'Сколько играют? (можно меньше чем пришло)',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        ...Array.from({ length: n - 7 }, (_, i) => {
                            const k = i + 8;
                            return [{ text: k + ' игроков', callback_data: 'igra_kol_' + anons_id + '_' + k }];
                        }),
                        [{ text: '⬅️ Назад', callback_data: 'anons_spisok_' + anons_id }]
                    ]
                }
            }
        );
    }

    // ===== ВЫБОР КОЛИЧЕСТВА ИЗ АНОНСА — создать игру =====
    else if (data.startsWith('igra_kol_')) {
        const parts = data.replace('igra_kol_', '').split('_');
        const kolichestvo = parseInt(parts[parts.length - 1]);
        const anons_id = parts.slice(0, -1).join('_');

        if (!sostavy[kolichestvo]) {
            bot.answerCallbackQuery(query.id, { text: '❌ Нет состава для ' + kolichestvo + ' игроков', show_alert: true });
            return;
        }

        const kod = sgenerirovat_kod();
        // Загружаем тип клуба
        let tip_kl = 'paskal';
        if (anons_id) {
            const { data: an_kl } = await supabase.from('anonsy').select('klub_id, kluby(tip, nastroyki)').eq('id', anons_id).single();
            tip_kl = an_kl?.kluby?.nastroyki?.tip_kluba || an_kl?.kluby?.tip || 'paskal';
        }
        igry[kod] = {
            kolichestvo,
            vedushchii_id: telegram_id,
            igroki: [],
            roli_razdany: false,
            anons_id,
            tip_kluba: tip_kl
        };

        bot.editMessageText(
            '🎲 *Игра создана!*\n\n' +
            '🔑 Код игры: *' + kod + '*\n' +
            '👥 Мест: ' + kolichestvo + '\n\n' +
            '_Игроки вводят этот код в боте чтобы войти_\n\n' +
            'Или нажми кнопку ниже чтобы скопировать сообщение для игроков:',
            {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👥 ' + igry[kod].igroki.length + '/' + kolichestvo + ' подключились', callback_data: 'status_' + kod }],
                        [{ text: '🎴 Раздать роли', callback_data: 'razdat_' + kod }],
                        [{ text: '⬅️ В меню', callback_data: 'menu_vedushchego' }]
                    ]
                }
            }
        );
    }

    // ===== АНОНС: отменить запись =====
    else if (data.startsWith('anons_otmenit_')) {
        const anons_id = data.replace('anons_otmenit_', '');
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        await supabase
            .from('zapisi_na_anons')
            .update({ status: 'otmenena' })
            .eq('anons_id', anons_id)
            .eq('igrok_id', igrok?.id);

        bot.answerCallbackQuery(query.id, { text: '✅ Запись отменена.', show_alert: true });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор клуба =====
    else if (data === 'roli_vybor_kluba') {
        const { data: igrok } = await supabase
            .from('igroki').select('id').eq('tg_id', telegram_id).single();

        // Ищем клубы где пользователь — собственник или ведущий
        const { data: chleny } = await supabase
            .from('chleny_klubov')
            .select('klub_id, rol, kluby(id, nazvaniye)')
            .eq('igrok_id', igrok?.id)
            .in('rol', ['vladyelets', ROL_VEDUSHCHIY, 'vedushchii']);

        const kluby = (chleny || []).filter(c => c.kluby).map(c => c.kluby);

        if (!kluby || kluby.length === 0) {
            bot.editMessageText('🎭 *Управление ролями*\n\n❌ У вас нет клубов.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
            });
            return;
        }

        if (kluby.length === 1) {
            await pokazat_roli_kluba(chatId, messageId, kluby[0].id);
            return;
        }

        const knopki = kluby.map(k => [{ text: '🎴 ' + k.nazvaniye, callback_data: 'roli_klub_' + k.id }]);
        knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);
        bot.editMessageText('🎭 *Управление ролями*\n\nВыбери клуб:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: knopki }
        });
    }

    else if (data.startsWith('roli_klub_')) {
        const klub_id = data.replace('roli_klub_', '');
        await pokazat_roli_kluba(chatId, messageId, klub_id);
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: добавить роль =====
    else if (data.startsWith('rol_dobavit_')) {
        const klub_id = data.replace('rol_dobavit_', '');
        sostoyanie[telegram_id] = 'rol_nazvanie_' + klub_id;
        bot.editMessageText('🎭 *Новая роль*\n\nВведи название роли:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + klub_id }]] }
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор стороны =====
    else if (data.startsWith('rol_st_')) {
        const storona_kod = data.replace('rol_st_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_storona') return;

        const storony = { mirnye: '👨‍👩‍👧 Мирные', mafiya: '🔫 Мафия', solo: '🎯 Сам за себя' };
        dannye.storona = storona_kod;
        dannye.storona_text = storony[storona_kod] || storona_kod;
        dannye.shag = 'rol_deystvie';

        bot.editMessageText(
            '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie + '\n*Сторона:* ' + dannye.storona_text + '\n\nВыбери действие:', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔪 Убить', callback_data: 'rol_dey_ubit' }],
                    [{ text: '💊 Спасти', callback_data: 'rol_dey_spasti' }],
                    [{ text: '🔍 Проверить', callback_data: 'rol_dey_proverit' }],
                    [{ text: '✨ Иное', callback_data: 'rol_dey_inoe' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
                ]
            }
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: выбор действия =====
    else if (data.startsWith('rol_dey_')) {
        const deystvie_kod = data.replace('rol_dey_', '');
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_deystvie') return;

        if (deystvie_kod === 'inoe') {
            // Иное — сохраняем как есть и сразу к количеству раз
            dannye.deystvie = 'inoe';
            dannye.deystvie_text = '✨ Иное';
            dannye.shag = 'rol_kolichestvo';
            sostoyanie[telegram_id] = 'rol_kolichestvo_' + dannye.klub_id;
            bot.editMessageText(
                '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie +
                '\n*Сторона:* ' + dannye.storona_text +
                '\n*Действие:* ' + dannye.deystvie_text +
                '\n\n_Напомни: опиши правила этой роли и пришли нам для добавления в систему._\n\nСколько раз за игру (введи число или напиши "каждую ночь"):', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔁 Каждую ночь', callback_data: 'rol_kol_kazhduu' }],
                    [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
                ]}
            });
            return;
        }

        const deystviya = { ubit: '🔪 Убить', spasti: '💊 Спасти', proverit: '🔍 Проверить' };
        dannye.deystvie = deystvie_kod;
        dannye.deystvie_text = deystviya[deystvie_kod] || deystvie_kod;
        dannye.shag = 'rol_kolichestvo';
        sostoyanie[telegram_id] = 'rol_kolichestvo_' + dannye.klub_id;

        bot.editMessageText(
            '🎭 *Новая роль*\n\n*Название:* ' + dannye.nazvanie +
            '\n*Сторона:* ' + dannye.storona_text +
            '\n*Действие:* ' + dannye.deystvie_text +
            '\n\nСколько раз за игру?', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🔁 Каждую ночь', callback_data: 'rol_kol_kazhduu' }],
                [{ text: '⬅️ Отмена', callback_data: 'roli_klub_' + dannye.klub_id }]
            ]}
        });
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: каждую ночь =====
    else if (data === 'rol_kol_kazhduu') {
        const dannye = ozhidanie_registracii[telegram_id];
        if (!dannye || dannye.shag !== 'rol_kolichestvo') return;
        delete sostoyanie[telegram_id];
        dannye.kolichestvo_raz = 'каждую ночь';
        dannye.shag = 'gotovo';
        await sohranit_rol(chatId, telegram_id, dannye.klub_id, dannye);
    }

    // ===== КОНСТРУКТОР РОЛЕЙ: удалить роль =====
    else if (data.startsWith('rol_udalit_')) {
        const parts = data.replace('rol_udalit_', '').split('_');
        const klub_id = parts[0];
        const rol_index = parseInt(parts[1]);

        const { data: klub } = await supabase
            .from('kluby').select('nastroyki').eq('id', klub_id).single();

        const nastroyki = klub?.nastroyki || {};
        const roli = nastroyki.kastomnye_roli || [];
        roli.splice(rol_index, 1);
        nastroyki.kastomnye_roli = roli;

        await supabase.from('kluby').update({ nastroyki }).eq('id', klub_id);
        await pokazat_roli_kluba(chatId, messageId, klub_id);
    }

    } catch (e) {
        console.error('[callback error]', query?.data, e?.message || e);
        bot.answerCallbackQuery(query.id, { text: 'Ошибка. Нажми /start', show_alert: true }).catch(() => {});
    }
});

// ============================================
// БАЗА ИГРОКОВ — функция отображения
// ============================================

async function pokazat_bazu_igrokov(chatId, messageId, klub_id, stranitsa, filtr) {
    const NA_STRANITSE = 10;

    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    if (!klub) {
        bot.editMessageText('❌ Клуб не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    const { data: chleny, error } = await supabase
        .from('chleny_klubov')
        .select('rol, igroki(id, imya, tg_username, telefon)')
        .eq('klub_id', klub_id);

    if (error) {
        console.error('Ошибка загрузки базы:', error);
        bot.editMessageText('❌ Ошибка загрузки базы игроков.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]] }
        });
        return;
    }

    let igroki_spisok = (chleny || [])
        .filter(c => c.igroki)
        .map(c => ({ ...c.igroki, rol: c.rol }));

    if (filtr) {
        const f = filtr.toLowerCase();
        const tolko_cifry = filtr.replace(/\D/g, '');
        const poisk_telefon = tolko_cifry.length >= 6 ? tolko_cifry.slice(-10) : null;

        igroki_spisok = igroki_spisok.filter(i => {
            if ((i.imya || '').toLowerCase().includes(f)) return true;
            if ((i.tg_username || '').toLowerCase().includes(f)) return true;
            if (poisk_telefon && (i.telefon || '').replace(/\D/g, '').slice(-10).includes(poisk_telefon)) return true;
            return false;
        });
    }

    igroki_spisok.sort((a, b) => (a.imya || '').localeCompare(b.imya || '', 'ru'));

    const vsego = igroki_spisok.length;
    const stranits_vsego = Math.max(1, Math.ceil(vsego / NA_STRANITSE));
    if (stranitsa >= stranits_vsego) stranitsa = stranits_vsego - 1;
    if (stranitsa < 0) stranitsa = 0;

    const ot = stranitsa * NA_STRANITSE;
    const do_ = Math.min(ot + NA_STRANITSE, vsego);
    const na_stranitse = igroki_spisok.slice(ot, do_);

    const residenty = new Set(poluchitResidentovIzNastroek(klub.nastroyki || {}));

    let tekst = '👥 *База игроков* — ' + klub.nazvaniye + '\n';
    if (filtr) tekst += '🔍 _Фильтр: ' + filtr + '_\n';
    tekst += '\n';

    if (vsego === 0) {
        tekst += filtr ? '_Никого не найдено по запросу._' : '_В клубе пока нет игроков._';
    } else {
        tekst += '_Всего: ' + vsego + ' • Страница ' + (stranitsa + 1) + '/' + stranits_vsego + '_\n';
        tekst += '_Нажми на игрока для управления._';
    }

    const knopki = [];

    na_stranitse.forEach((i) => {
        const rol_emoji = i.rol === 'vladyelets' ? '👑 '
                        : isVedushchiy(i.rol) ? '🎤 '
                        : '';
        const rez_emoji = residenty.has(i.id) ? '⭐ ' : '';
        const username = i.tg_username ? ' (@' + i.tg_username + ')' : '';
        const knopka_text = rez_emoji + rol_emoji + (i.imya || 'Без имени') + username;
        knopki.push([{
            text: knopka_text,
            callback_data: cbBtn('ip_', { klub_id, igrok_id: i.id })
        }]);
    });

    if (stranits_vsego > 1) {
        const navig = [];
        if (stranitsa > 0) navig.push({ text: '⬅️', callback_data: cbBtn('bk_', { klub_id, page: stranitsa - 1 }) });
        navig.push({ text: (stranitsa + 1) + '/' + stranits_vsego, callback_data: 'baza_noop' });
        if (stranitsa < stranits_vsego - 1) navig.push({ text: '➡️', callback_data: cbBtn('bk_', { klub_id, page: stranitsa + 1 }) });
        knopki.push(navig);
    }

    knopki.push([{ text: '🔍 Поиск', callback_data: 'baza_poisk_' + klub_id }]);
    if (filtr) knopki.push([{ text: '✖️ Сбросить фильтр', callback_data: 'baza_sbros_' + klub_id }]);
    knopki.push([{ text: '⬅️ Назад', callback_data: 'menu_vladeltsa' }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// КАРТОЧКА ИГРОКА
// ============================================

async function pokazat_kartochku_igroka(chatId, messageId, klub_id, igrok_id) {
    const { data: igrok } = await supabase
        .from('igroki')
        .select('imya, tg_username, telefon')
        .eq('id', igrok_id)
        .single();

    if (!igrok) {
        bot.editMessageText('❌ Игрок не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }]] }
        });
        return;
    }

    const { data: chlen } = await supabase
        .from('chleny_klubov')
        .select('rol')
        .eq('klub_id', klub_id)
        .eq('igrok_id', igrok_id)
        .single();

    const rol = chlen?.rol || 'igrok';
    const rol_text = rol === 'vladyelets' ? '👑 Собственник'
                    : isVedushchiy(rol) ? '🎤 Ведущий'
                    : '🎴 Игрок';

    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    const residenty = new Set(poluchitResidentovIzNastroek(klub?.nastroyki || {}));
    const rezident = residenty.has(igrok_id);

    let tekst = '👤 *Карточка игрока*\n\n';
    tekst += '*Имя:* ' + (igrok.imya || 'Без имени') + '\n';
    if (igrok.tg_username) tekst += '*Telegram:* @' + igrok.tg_username.replace(/_/g, '\\_') + '\n';
    if (igrok.telefon) tekst += '*Телефон:* ' + igrok.telefon + '\n';
    tekst += '*Роль в клубе ' + (klub?.nazvaniye || '') + ':* ' + rol_text + '\n';
    tekst += '*Резидент:* ' + (rezident ? '⭐ Да' : 'нет');

    const knopki = [];

    if (rol === 'vladyelets') {
        knopki.push([{ text: '⚠️ Это собственник клуба', callback_data: 'baza_noop' }]);
    } else if (isVedushchiy(rol)) {
        knopki.push([{ text: '↩️ Снять роль ведущего', callback_data: cbBtn('sv_', { klub_id, igrok_id }) }]);
    } else {
        knopki.push([{ text: '🎤 Сделать ведущим', callback_data: cbBtn('vd_', { klub_id, igrok_id }) }]);
    }

    knopki.push([{
        text: rezident ? '☆ Убрать из резидентов' : '⭐ Сделать резидентом',
        callback_data: cbBtn('res_', { klub_id, igrok_id, on: !rezident })
    }]);
    knopki.push([{ text: '⬅️ К списку', callback_data: cbBtn('bk_', { klub_id, page: 0 }) }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// ВЫБОР СТРАНЫ И ГОРОДА (ПРИ СОЗДАНИИ КЛУБА)
// ============================================

async function pokazat_vybor_strany(chatId, messageId) {
    const strany = [
        { kod: 'RU', flag: '🇷🇺', nazvaniye: 'Россия' },
        { kod: 'BY', flag: '🇧🇾', nazvaniye: 'Беларусь' },
        { kod: 'KZ', flag: '🇰🇿', nazvaniye: 'Казахстан' },
        { kod: 'UZ', flag: '🇺🇿', nazvaniye: 'Узбекистан' },
        { kod: 'KG', flag: '🇰🇬', nazvaniye: 'Кыргызстан' },
        { kod: 'AM', flag: '🇦🇲', nazvaniye: 'Армения' },
        { kod: 'GE', flag: '🇬🇪', nazvaniye: 'Грузия' },
        { kod: 'AZ', flag: '🇦🇿', nazvaniye: 'Азербайджан' }
    ];

    const knopki = strany.map(s => [{
        text: s.flag + ' ' + s.nazvaniye,
        callback_data: 'vstrana_' + s.kod + '_0'
    }]);
    knopki.push([{ text: '⬅️ Отмена', callback_data: 'menu_vladeltsa' }]);

    bot.editMessageText('➕ *Создание клуба*\n\nВыбери страну:', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazat_vybor_goroda(chatId, messageId, strana, kod_strany) {
    if (!kod_strany) kod_strany = gorodaUi.kodStrany(strana);

    const goroda = await zagruzitGorodaStrany(strana);
    if (goroda.length === 0) {
        bot.editMessageText('⚠️ Список городов пуст. Напиши в поддержку.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'sozdat_klub' }]] }
        });
        return;
    }

    const knopki = gorodaUi.postroитьKlavAlfavit(goroda, 'vk', kod_strany);
    knopki.push([{ text: '❔ Моего города нет', callback_data: 'goroda_net' }]);
    knopki.push([{ text: '⬅️ К выбору страны', callback_data: 'sozdat_klub' }]);

    const tekst = '➕ *Создание клуба*\n\nСтрана: *' + strana + '*\n\n' +
        gorodaUi.tekstVyboraGoroda(null, 'Нажми букву или «Написать город».');

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

// ============================================
// КОНСТРУКТОР РОЛЕЙ — функции
// ============================================

async function pokazat_roli_kluba(chatId, messageId, klub_id) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nazvaniye, nastroyki')
        .eq('id', klub_id)
        .single();

    if (!klub) {
        bot.editMessageText('❌ Клуб не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'roli_vybor_kluba' }]] }
        });
        return;
    }

    const roli = klub.nastroyki?.kastomnye_roli || [];
    const storony = { mirnye: '👨‍👩‍👧', mafiya: '🔫', solo: '🎯' };

    let tekst = '🎭 *Роли клуба — ' + klub.nazvaniye + '*\n\n';

    if (roli.length === 0) {
        tekst += '_Кастомных ролей пока нет._\n\n_Стандартные роли: Дон, Мафия, Шериф, Доктор и другие._';
    } else {
        tekst += '_Кастомные роли:_\n\n';
        roli.forEach((r, i) => {
            const emoji = storony[r.storona] || '❓';
            tekst += (i + 1) + '. ' + emoji + ' *' + r.nazvanie + '*';
            tekst += ' — ' + (r.deystvie_text || r.deystvie);
            tekst += ', ' + r.kolichestvo_raz + ' раз\n';
        });
    }

    const knopki = [];

    // Кнопки удаления для каждой роли
    roli.forEach((r, i) => {
        knopki.push([{ text: '🗑 Удалить: ' + r.nazvanie, callback_data: 'rol_udalit_' + klub_id + '_' + i }]);
    });

    knopki.push([{ text: '➕ Добавить роль', callback_data: 'rol_dobavit_' + klub_id }]);
    knopki.push([{ text: '⬅️ Назад', callback_data: 'roli_vybor_kluba' }]);

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function sohranit_rol(chatId, tg_id, klub_id, dannye) {
    const { data: klub } = await supabase
        .from('kluby')
        .select('nastroyki')
        .eq('id', klub_id)
        .single();

    const nastroyki = klub?.nastroyki || {};
    const roli = nastroyki.kastomnye_roli || [];

    roli.push({
        nazvanie: dannye.nazvanie,
        storona: dannye.storona,
        storona_text: dannye.storona_text,
        deystvie: dannye.deystvie,
        deystvie_text: dannye.deystvie_text,
        kolichestvo_raz: dannye.kolichestvo_raz
    });

    nastroyki.kastomnye_roli = roli;

    const { error } = await supabase
        .from('kluby')
        .update({ nastroyki })
        .eq('id', klub_id);

    delete ozhidanie_registracii[tg_id];

    if (error) {
        console.error('Ошибка сохранения роли:', error);
        bot.sendMessage(chatId, '❌ Ошибка сохранения роли. Попробуй ещё раз.');
        return;
    }

    const soobsh = await bot.sendMessage(chatId,
        '✅ *Роль добавлена!*\n\n' +
        '🎭 *' + dannye.nazvanie + '*\n' +
        'Сторона: ' + dannye.storona_text + '\n' +
        'Действие: ' + (dannye.deystvie_text || dannye.deystvie) + '\n' +
        'Раз за игру: ' + dannye.kolichestvo_raz,
        { parse_mode: 'Markdown' }
    );

    setTimeout(async () => {
        await pokazat_roli_kluba(chatId, soobsh.message_id, klub_id);
    }, 500);
}

// ============================================
// АНОНСЫ — функции
// ============================================

async function sohranit_anons(chatId, tg_id, dannye) {
    const { data: igrok } = await supabase
        .from('igroki').select('id').eq('tg_id', tg_id).single();

    const { data: klub } = await supabase
        .from('kluby').select('nazvaniye, gorod, strana').eq('id', dannye.klub_id).single();

    const { data: anons, error } = await supabase
        .from('anonsy')
        .insert({
            klub_id: dannye.klub_id,
            vedushchiy_id: igrok?.id,
            data_igry: dannye.data_igry,
            vremya: dannye.vremya,
            adres: dannye.adres,
            kommentariy: dannye.kommentariy || null,
            status: 'aktiven'
        })
        .select()
        .single();

    if (error) {
        console.error('Ошибка сохранения анонса:', error);
        bot.sendMessage(chatId, '❌ Ошибка создания анонса. Попробуй ещё раз.');
        return;
    }

    const tekst =
        '📢 *Анонс создан!*\n\n' +
        '🎴 *' + (klub?.nazvaniye || '') + '*\n' +
        '📅 ' + formatDataAnonsa(dannye.data_igry) + ' в ' + dannye.vremya + '\n' +
        '📍 ' + dannye.adres +
        (dannye.kommentariy ? '\n💬 ' + dannye.kommentariy : '') +
        '\n\n_Игроки из ' + (klub?.gorod || 'вашего города') + ' увидят анонс в меню «📢 Анонсы игр»._';

    const knopki = [
        [{ text: '✏️ Редактировать', callback_data: 'anons_edit_' + anons.id }],
        [{ text: '🗑 Удалить анонс', callback_data: 'anons_delete_confirm_' + anons.id }],
        [{ text: '📋 Мои анонсы', callback_data: 'moi_anonsy_' + dannye.klub_id }],
        [{ text: '⬅️ В меню', callback_data: 'menu_vladeltsa' }]
    ];
    if (await mozhnoFunktsiyuKluba(dannye.klub_id, 'rassylka_priglasheniy')) {
        knopki.unshift([{ text: '📨 Разослать приглашения базе', callback_data: 'rassylka_anons_' + anons.id }]);
    }

    bot.sendMessage(chatId, tekst, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: knopki }
    });
}

async function pokazat_kartochku_anонса(chatId, messageId, anons_id) {
    const { data: a } = await supabase
        .from('anonsy')
        .select('id, data_igry, vremya, adres, kommentariy, status, klub_id, kluby(nazvaniye)')
        .eq('id', anons_id)
        .single();

    if (!a) {
        bot.editMessageText('❌ Анонс не найден.', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'moi_anonsy_vse' }]] }
        });
        return;
    }

    const status_emoji = a.status === 'aktiven' ? '🟢 Активен' : '🔴 Неактивен';
    let tekst = '📢 *' + (a.kluby?.nazvaniye || '') + '*\n\n';
    tekst += '📅 ' + formatDataAnonsa(razobrat_datu_anonsa(a.data_igry) || a.data_igry) + ' в ' + (a.vremya || '') + '\n';
    tekst += '📍 ' + (a.adres || '') + '\n';
    if (a.kommentariy) tekst += '💬 ' + a.kommentariy + '\n';
    tekst += '\nСтатус: ' + status_emoji;

    bot.editMessageText(tekst, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '👥 Список записавшихся', callback_data: 'anons_spisok_' + a.id }],
            [{ text: '✏️ Редактировать', callback_data: 'anons_edit_' + a.id }],
            [{ text: '🗑 Удалить', callback_data: 'anons_delete_confirm_' + a.id }],
            [{ text: '⬅️ Мои анонсы', callback_data: 'moi_anonsy_' + a.klub_id }]
        ]}
    });
}

(async function initTelegram() {
    console.log('Запуск Telegram polling...');
    let lastBirthdayRun = '';
    setInterval(() => {
        const moscowNow = new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false });
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
        if (parseInt(moscowNow, 10) === 10 && lastBirthdayRun !== today) {
            lastBirthdayRun = today;
            pozdravitSbirthday(bot).catch(e => console.error('[birthday cron]', e.message || e));
        }
    }, 15 * 60 * 1000);
    try {
        const me = await bot.getMe();
        console.log('🤖 @' + (me.username || me.id));
        await zapustitPolling();
        console.log('🎴 PrimeMafia бот запущен (polling)');
    } catch (e) {
        if (etoOshibka409(e)) {
            await perezapuskPosle409();
            console.log('🎴 Polling перезапущен после 409');
        } else {
            console.error('❌ Ошибка Telegram (бот на порту ' + PORT + ' жив, polling нет):', e.message || e);
        }
    }
})();
