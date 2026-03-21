import { getUserIdFromRequest } from './lib/auth.mjs';
import { getSupabase } from './lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = getSupabase();

  // Find all connected platforms for this user
  const { data: connections } = await db
    .from('platform_connections')
    .select('platform, platform_user_id')
    .eq('user_id', userId);

  if (!connections?.length) {
    return Response.json({ error: 'No platforms connected' }, { status: 400 });
  }

  const results = [];

  for (const conn of connections) {
    if (conn.platform === 'strava') {
      try {
        await fetch(`${process.env.SITE_URL}/api/backfill-activities-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            athleteId: conn.platform_user_id,
            platform: 'strava',
          }),
        });
        results.push({ platform: 'strava', status: 'syncing' });
      } catch (err) {
        console.error('Strava sync dispatch error:', err);
        results.push({ platform: 'strava', status: 'error' });
      }
    } else if (conn.platform === 'wahoo') {
      try {
        await fetch(`${process.env.SITE_URL}/api/backfill-activities-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, platform: 'wahoo' }),
        });
        results.push({ platform: 'wahoo', status: 'syncing' });
      } catch (err) {
        console.error('Wahoo sync dispatch error:', err);
        results.push({ platform: 'wahoo', status: 'error' });
      }
    }
  }

  return Response.json({ results });
};
