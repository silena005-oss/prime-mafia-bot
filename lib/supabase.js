const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL или SUPABASE_KEY не заданы в Railway → Variables');
    process.exit(1);
}

function proveritServiceRoleKey(key) {
    try {
        const part = key.split('.')[1];
        if (!part) return null;
        const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
        return payload.role || null;
    } catch (_) {
        return null;
    }
}

const keyRole = proveritServiceRoleKey(process.env.SUPABASE_KEY);
if (keyRole && keyRole !== 'service_role') {
    console.error('❌ SUPABASE_KEY должен быть service_role (Settings → API → service_role secret).');
    console.error('   Сейчас role=' + keyRole + '. Anon-ключ не подходит для бота с RLS.');
    process.exit(1);
}
if (keyRole === 'service_role') {
    console.log('✅ Supabase: service_role key');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = supabase;
