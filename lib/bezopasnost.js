/**
 * Helpers for PostgREST-safe filters and miniapp rate limits.
 */

function sanitizirovatPoisk(q, maxLen = 64) {
    return String(q || '')
        .trim()
        .slice(0, maxLen)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[%_,.()\\*"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function postgrestQuote(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Build .or() clause for player name search (ilike %q% on 3 columns). */
function orIlikeIgrokiPoisk(q) {
    const s = sanitizirovatPoisk(q);
    if (!s) return null;
    const pat = postgrestQuote('%' + s + '%');
    return `imya.ilike.${pat},igrovoy_nik.ilike.${pat},tg_username.ilike.${pat}`;
}

/** Exact-ish case-insensitive match for roster nickname linking. */
function orIlikeIgrokiTochno(name) {
    const s = sanitizirovatPoisk(name, 80);
    if (!s) return null;
    const pat = postgrestQuote(s);
    return `igrovoy_nik.ilike.${pat},imya.ilike.${pat},tg_username.ilike.${pat}`;
}

/** Только цифры — для .or(owner_tg_id.eq.…) без инъекции */
function orOwnerTgId(telegram_id) {
    const variants = new Set();
    const n = Number(telegram_id);
    if (Number.isFinite(n) && n > 0) {
        variants.add(String(n));
    }
    const asStr = String(telegram_id || '').trim();
    if (/^\d{1,20}$/.test(asStr)) variants.add(asStr);
    if (!variants.size) return null;
    return [...variants].map(id => 'owner_tg_id.eq.' + id).join(',');
}

/** Путь файла Telegram API — без path traversal / чужих хостов */
function bezopasnyyPutTelegramFile(filePath) {
    const p = String(filePath || '').trim();
    if (!p || p.includes('..') || p.includes('\\') || p.startsWith('/') || p.includes('://')) {
        return null;
    }
    if (!/^[A-Za-z0-9._\-\/]+$/.test(p)) return null;
    return p;
}

function urlTelegramFile(botToken, filePath) {
    const safe = bezopasnyyPutTelegramFile(filePath);
    if (!safe || !botToken) return null;
    return 'https://api.telegram.org/file/bot' + botToken + '/' + safe;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]);

function etoRazreshennyyImageMime(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    return ALLOWED_IMAGE_MIME.has(m);
}

/** Magic bytes: JPEG / PNG / GIF / WEBP */
function etoImageMagicBytes(buf) {
    if (!buf || buf.length < 12) return false;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    // JPEG
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
    // GIF
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
    // WEBP: RIFF....WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
    return false;
}

/**
 * Скачивает первые байты файла Telegram и проверяет, что это реальное изображение.
 * file_size из Telegram — если передан и слишком большой, отклоняем сразу.
 */
async function proveritTelegramImageUpload(bot, botToken, fileId, opts = {}) {
    const maxBytes = opts.maxBytes || MAX_UPLOAD_BYTES;
    if (opts.fileSize != null && Number(opts.fileSize) > maxBytes) {
        return { ok: false, reason: 'too_large' };
    }
    if (opts.mimeType && !etoRazreshennyyImageMime(opts.mimeType)) {
        return { ok: false, reason: 'mime' };
    }
    try {
        const file = await bot.getFile(fileId);
        if (file?.file_size && file.file_size > maxBytes) {
            return { ok: false, reason: 'too_large' };
        }
        const url = urlTelegramFile(botToken, file?.file_path);
        if (!url) return { ok: false, reason: 'bad_path' };
        const res = await fetch(url, { headers: { Range: 'bytes=0-31' } });
        if (!res.ok) return { ok: false, reason: 'fetch' };
        const ab = await res.arrayBuffer();
        if (!etoImageMagicBytes(Buffer.from(ab))) {
            return { ok: false, reason: 'magic' };
        }
        return { ok: true };
    } catch (e) {
        console.warn('[upload check]', e?.message || e);
        return { ok: false, reason: 'error' };
    }
}

const rateBuckets = new Map();

function proveritRateLimit(key, limit, windowMs) {
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { ok: true };
}

setInterval(() => {
    const now = Date.now();
    for (const [k, b] of rateBuckets) {
        if (now >= b.resetAt) rateBuckets.delete(k);
    }
}, 60 * 1000).unref?.();

function securityHeadersDlyaOtvetov() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'SAMEORIGIN',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'Cross-Origin-Resource-Policy': 'same-site'
    };
}

function securityHeadersDlyaMiniAppHtml() {
    return {
        ...securityHeadersDlyaOtvetov(),
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' https://telegram.org",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "connect-src 'self'",
            "frame-ancestors https://web.telegram.org https://telegram.org",
            "base-uri 'self'",
            "form-action 'self'"
        ].join('; ')
    };
}

const zlib = require('zlib');

/** Gzip body when client accepts it (static + JSON). */
function otpravitSSzhatie(req, res, status, headers, body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const ae = String(req?.headers?.['accept-encoding'] || '');
    const wantsGzip = /\bgzip\b/.test(ae);
    if (!wantsGzip || buf.length < 512) {
        res.writeHead(status, headers);
        res.end(buf);
        return;
    }
    zlib.gzip(buf, (err, compressed) => {
        if (err || !compressed) {
            res.writeHead(status, headers);
            res.end(buf);
            return;
        }
        res.writeHead(status, {
            ...headers,
            'Content-Encoding': 'gzip',
            Vary: 'Accept-Encoding',
            'Content-Length': compressed.length
        });
        res.end(compressed);
    });
}

/** Bounded in-memory media cache for Telegram file_id → bytes. */
const mediaCache = new Map();
const MEDIA_CACHE_MAX = 40;
const MEDIA_CACHE_TTL_MS = 30 * 60 * 1000;

function poluchitMediaIzKasha(fileId) {
    const hit = mediaCache.get(String(fileId));
    if (!hit) return null;
    if (Date.now() - hit.ts > MEDIA_CACHE_TTL_MS) {
        mediaCache.delete(String(fileId));
        return null;
    }
    return hit;
}

function sohranitMediaVKesh(fileId, contentType, buf) {
    const key = String(fileId);
    if (mediaCache.has(key)) mediaCache.delete(key);
    mediaCache.set(key, { ts: Date.now(), contentType, buf });
    while (mediaCache.size > MEDIA_CACHE_MAX) {
        const oldest = mediaCache.keys().next().value;
        mediaCache.delete(oldest);
    }
}

module.exports = {
    sanitizirovatPoisk,
    postgrestQuote,
    orIlikeIgrokiPoisk,
    orIlikeIgrokiTochno,
    orOwnerTgId,
    bezopasnyyPutTelegramFile,
    urlTelegramFile,
    etoRazreshennyyImageMime,
    etoImageMagicBytes,
    proveritTelegramImageUpload,
    MAX_UPLOAD_BYTES,
    proveritRateLimit,
    securityHeadersDlyaOtvetov,
    securityHeadersDlyaMiniAppHtml,
    otpravitSSzhatie,
    poluchitMediaIzKasha,
    sohranitMediaVKesh
};
