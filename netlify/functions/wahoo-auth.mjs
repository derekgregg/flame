import { randomBytes } from 'crypto';
import { getSupabase } from './lib/supabase.mjs';
import { getOAuthURL } from './lib/wahoo.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  const db = getSupabase();
  const state = randomBytes(16).toString('hex');
  const userId = getUserIdFromRequest(req);

  await db.from('oauth_state').insert({
    state,
    platform: 'wahoo',
    user_id: userId || null,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: getOAuthURL(state) },
  });
};
