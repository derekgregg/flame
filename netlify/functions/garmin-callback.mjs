import { getSupabase } from './lib/supabase.mjs';
import { exchangeToken, registerUser } from './lib/garmin.mjs';
import { findOrCreateUser, createSessionToken, getSessionCookie } from './lib/auth.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=${error}&platform=garmin` },
    });
  }

  if (!code || !state) {
    return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
  }

  const db = getSupabase();

  // Retrieve and validate state + code_verifier
  const { data: oauthState } = await db
    .from('oauth_state')
    .select('*')
    .eq('state', state)
    .single();

  if (!oauthState) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=invalid_state&platform=garmin` },
    });
  }

  await db.from('oauth_state').delete().eq('state', state);

  try {
    const tokenData = await exchangeToken(code, oauthState.code_verifier);
    const accessToken = tokenData.access_token;

    // Garmin doesn't return a rich user profile in the token response.
    // The user ID comes from the token data.
    const garminUserId = tokenData.userId || tokenData.user_id || 'unknown';

    const userId = await findOrCreateUser(req, {
      platform: 'garmin',
      platformUserId: String(garminUserId),
      displayName: 'Garmin User', // Will be updated when first activity comes in
      profilePic: null,
      weight: null,
      accessToken,
      refreshToken: tokenData.refresh_token || '',
      tokenExpiresAt: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      scopes: 'activity:read user:read',
    });

    // Register for push notifications
    await registerUser(garminUserId, accessToken);

    const token = createSessionToken(userId);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${process.env.SITE_URL}/callback.html?success=true&name=Garmin%20User&user_id=${userId}&platform=garmin`,
        'Set-Cookie': getSessionCookie(token),
      },
    });
  } catch (err) {
    console.error('Garmin OAuth callback error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=token_exchange_failed&platform=garmin` },
    });
  }
};
