import { getSupabase } from './lib/supabase.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'start_date';
  const order = url.searchParams.get('order') || 'desc';
  const userId = url.searchParams.get('user_id');
  const sportType = url.searchParams.get('sport_type');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const allowedSorts = ['start_date', 'distance', 'average_speed', 'moving_time', 'elevation_gain'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'start_date';
  const ascending = order === 'asc';

  const db = getSupabase();

  // Try new schema first (users table)
  let query = db
    .from('activities')
    .select('*, users!inner(id, display_name, profile_pic, share_with_group)')
    .eq('users.share_with_group', true)
    .not('roast', 'is', null)
    .order(sortCol, { ascending })
    .limit(limit);

  if (userId) query = query.eq('user_id', userId);
  if (sportType) query = query.eq('sport_type', sportType);

  let { data, error } = await query;

  // Fallback to legacy schema if new tables don't exist yet
  if (error && error.message?.includes('users')) {
    let legacyQuery = db
      .from('activities')
      .select('*, athletes!inner(id, firstname, lastname, profile_pic, share_with_group)')
      .eq('athletes.share_with_group', true)
      .not('roast', 'is', null)
      .order(sortCol, { ascending })
      .limit(limit);

    if (userId) legacyQuery = legacyQuery.eq('athlete_id', parseInt(userId));
    if (sportType) legacyQuery = legacyQuery.eq('sport_type', sportType);

    const legacy = await legacyQuery;
    data = legacy.data;
    error = legacy.error;

    if (error) {
      console.error('Leaderboard query error:', error);
      return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
    }

    // Normalize legacy shape to match new shape
    data = (data || []).map(a => ({
      ...a,
      source_platform: a.source_platform || 'strava',
      users: a.athletes ? {
        id: a.athletes.id,
        display_name: `${a.athletes.firstname} ${a.athletes.lastname}`,
        profile_pic: a.athletes.profile_pic,
      } : null,
    }));

    const { data: athletes } = await db
      .from('athletes')
      .select('id, firstname, lastname')
      .eq('is_tracked', true)
      .eq('share_with_group', true)
      .order('firstname');

    return new Response(JSON.stringify({
      activities: data || [],
      users: (athletes || []).map(a => ({
        id: a.id,
        display_name: `${a.firstname} ${a.lastname}`,
      })),
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
    });
  }

  if (error) {
    console.error('Leaderboard query error:', error);
    return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
  }

  // Users for filter dropdown
  const { data: users } = await db
    .from('users')
    .select('id, display_name')
    .eq('is_tracked', true)
    .eq('share_with_group', true)
    .order('display_name');

  return new Response(JSON.stringify({
    activities: data || [],
    users: users || [],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30',
    },
  });
};
