import { randomBytes } from 'crypto';
import { getSupabase } from './lib/supabase.mjs';
import { generatePKCE, getOAuthURL } from './lib/garmin.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  const db = getSupabase();
  const state = randomBytes(16).toString('hex');
  const userId = getUserIdFromRequest(req);
  const { verifier, challenge } = generatePKCE();

  await db.from('oauth_state').insert({
    state,
    platform: 'garmin',
    user_id: userId || null,
    code_verifier: verifier,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: getOAuthURL(state, challenge) },
  });
};
