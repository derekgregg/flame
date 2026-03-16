import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

// Legacy endpoint — redirects to user-preferences logic
// Kept for backwards compatibility during migration
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { athleteId, share_with_group, weight } = await req.json();

  const db = getSupabase();

  // Try new schema: find user via session or platform connection
  let userId = getUserIdFromRequest(req);

  if (!userId && athleteId) {
    const { data: conn } = await db
      .from('platform_connections')
      .select('user_id')
      .eq('platform', 'strava')
      .eq('platform_user_id', String(athleteId))
      .single();
    if (conn) userId = conn.user_id;
  }

  // Update new users table if available
  if (userId) {
    const updates = { updated_at: new Date().toISOString() };
    if (share_with_group !== undefined) updates.share_with_group = share_with_group;
    if (weight !== undefined) updates.weight = weight > 0 ? weight : null;
    await db.from('users').update(updates).eq('id', userId);
  }

  // Also update legacy athletes table
  if (athleteId) {
    const legacyUpdates = {};
    if (share_with_group !== undefined) legacyUpdates.share_with_group = share_with_group;
    if (weight !== undefined) legacyUpdates.weight = weight > 0 ? weight : null;
    if (Object.keys(legacyUpdates).length > 0) {
      await db.from('athletes').update(legacyUpdates).eq('id', athleteId);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
