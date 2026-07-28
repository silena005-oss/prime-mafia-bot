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

module.exports = {
    sanitizirovatPoisk,
    postgrestQuote,
    orIlikeIgrokiPoisk,
    orIlikeIgrokiTochno,
    proveritRateLimit,
    securityHeadersDlyaOtvetov,
    securityHeadersDlyaMiniAppHtml
};
