import { getSupabase } from './lib/supabase.mjs';
import { exchangeToken, getUser, setupWebhook } from './lib/wahoo.mjs';
import { findOrCreateUser, createSessionToken, getSessionCookie } from './lib/auth.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=${error}&platform=wahoo` },
    });
  }

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400 });
  }

  const db = getSupabase();

  // Validate state
  if (state) {
    const { data: oauthState } = await db
      .from('oauth_state')
      .select('*')
      .eq('state', state)
      .single();

    if (!oauthState) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${process.env.SITE_URL}/callback.html?error=invalid_state&platform=wahoo` },
      });
    }
    await db.from('oauth_state').delete().eq('state', state);
  }

  try {
    const tokenData = await exchangeToken(code);
    const accessToken = tokenData.access_token;

    // Fetch Wahoo user profile
    const wahooUser = await getUser(accessToken);
    const user = wahooUser.user || wahooUser;

    const userId = await findOrCreateUser(req, {
      platform: 'wahoo',
      platformUserId: String(user.id),
      displayName: `${user.first || ''} ${user.last || ''}`.trim() || 'Wahoo User',
      profilePic: null, // Wahoo doesn't provide profile pics
      weight: user.weight?.value || null, // Wahoo returns weight as { value, unit }
      accessToken,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 7200),
      scopes: 'user_read workouts_read offline_data',
    });

    // Configure per-user webhook
    await setupWebhook(accessToken);

    // Trigger backfill
    fetch(`${process.env.SITE_URL}/.netlify/functions/backfill-activities-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, platform: 'wahoo' }),
    }).catch((err) => console.error('Wahoo backfill trigger error:', err));

    const token = createSessionToken(userId);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${process.env.SITE_URL}/callback.html?success=true&name=${encodeURIComponent(user.first || 'Wahoo User')}&user_id=${userId}&platform=wahoo`,
        'Set-Cookie': getSessionCookie(token),
      },
    });
  } catch (err) {
    console.error('Wahoo OAuth callback error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=token_exchange_failed&platform=wahoo` },
    });
  }
};
