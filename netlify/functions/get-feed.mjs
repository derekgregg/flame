import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

// Personal activity feed — shows the logged-in user's own activities
export default async (req) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'start_date';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const allowedSorts = ['start_date', 'distance', 'average_speed', 'moving_time', 'elevation_gain'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'start_date';

  const db = getSupabase();

  const { data, error } = await db
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .not('roast', 'is', null)
    .order(sortCol, { ascending: false })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
  }

  return new Response(JSON.stringify({ activities: data || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
