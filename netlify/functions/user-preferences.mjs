import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.json();
  const { share_with_group, weight, display_name, userId: bodyUserId, athleteId } = body;

  // Accept either session cookie or explicit userId (for backwards compat)
  let userId = getUserIdFromRequest(req);

  // Fallback: accept userId in body (legacy callback flow)
  if (!userId && bodyUserId) {
    userId = bodyUserId;
  }
  if (!userId && athleteId) {
    // Legacy: look up user by Strava athlete ID
    const db = getSupabase();
    const { data: conn } = await db
      .from('platform_connections')
      .select('user_id')
      .eq('platform', 'strava')
      .eq('platform_user_id', String(athleteId))
      .single();
    if (conn) userId = conn.user_id;
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const db = getSupabase();
  const updates = {};
  if (share_with_group !== undefined) updates.share_with_group = share_with_group;
  if (weight !== undefined) updates.weight = weight > 0 ? weight : null;
  if (display_name) updates.display_name = display_name;
  updates.updated_at = new Date().toISOString();

  const { error } = await db.from('users').update(updates).eq('id', userId);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
