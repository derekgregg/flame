import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { platform } = await req.json();
  if (!['strava', 'wahoo', 'garmin'].includes(platform)) {
    return new Response(JSON.stringify({ error: 'Invalid platform' }), { status: 400 });
  }

  const db = getSupabase();

  // Check that user has at least one other connection
  const { data: connections } = await db
    .from('platform_connections')
    .select('id, platform')
    .eq('user_id', userId);

  const otherConnections = (connections || []).filter(c => c.platform !== platform);
  if (otherConnections.length === 0) {
    return new Response(JSON.stringify({ error: 'Cannot disconnect your only platform. Delete your account instead.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete activities from this platform
  await db.from('activities')
    .delete()
    .eq('user_id', userId)
    .eq('source_platform', platform);

  // Remove the platform connection
  await db.from('platform_connections')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform);

  console.log(`User ${userId} disconnected ${platform}`);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
