import { getSupabase } from './lib/supabase.mjs';
import { exchangeToken } from './lib/strava.mjs';
import { findOrCreateUser, createSessionToken, getSessionCookie } from './lib/auth.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=${error}` },
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
        headers: { Location: `${process.env.SITE_URL}/callback.html?error=invalid_state` },
      });
    }
    // Clean up
    await db.from('oauth_state').delete().eq('state', state);
  }

  try {
    const tokenData = await exchangeToken(code);
    const athlete = tokenData.athlete;

    // Find or create user, link Strava connection
    const userId = await findOrCreateUser(req, {
      platform: 'strava',
      platformUserId: String(athlete.id),
      displayName: `${athlete.firstname} ${athlete.lastname}`,
      profilePic: athlete.profile_medium || athlete.profile,
      weight: athlete.weight || null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: tokenData.expires_at,
      scopes: 'read,activity:read_all',
    });

    // Also upsert into legacy athletes table for backwards compat during migration
    await db.from('athletes').upsert({
      id: athlete.id,
      firstname: athlete.firstname,
      lastname: athlete.lastname,
      profile_pic: athlete.profile_medium || athlete.profile,
      weight: athlete.weight || null,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenData.expires_at,
      is_tracked: true,
    });

    // Trigger backfill
    fetch(`${process.env.SITE_URL}/.netlify/functions/backfill-activities-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, athleteId: athlete.id, platform: 'strava' }),
    }).catch((err) => console.error('Backfill trigger error:', err));

    const token = createSessionToken(userId);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${process.env.SITE_URL}/callback.html?success=true&name=${encodeURIComponent(athlete.firstname)}&user_id=${userId}&platform=strava`,
        'Set-Cookie': getSessionCookie(token),
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=token_exchange_failed` },
    });
  }
};
