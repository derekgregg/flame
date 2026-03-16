import { getSupabase } from './lib/supabase.mjs';

// Scheduled function — runs daily to enforce data retention
export default async () => {
  const db = getSupabase();

  // Strava: 7-day retention required by API agreement
  const stravaCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stravaData, error: stravaError } = await db
    .from('activities')
    .delete()
    .eq('source_platform', 'strava')
    .lt('start_date', stravaCutoff)
    .select('id');

  const stravaCount = stravaData?.length || 0;
  console.log(`Purged ${stravaCount} Strava activities older than 7 days`);
  if (stravaError) console.error('Strava purge error:', stravaError);

  // Wahoo/Garmin: 30-day retention (no hard limit, but keep things tidy)
  const otherCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: otherData, error: otherError } = await db
    .from('activities')
    .delete()
    .neq('source_platform', 'strava')
    .lt('start_date', otherCutoff)
    .select('id');

  const otherCount = otherData?.length || 0;
  console.log(`Purged ${otherCount} Wahoo/Garmin activities older than 30 days`);
  if (otherError) console.error('Other purge error:', otherError);

  // Clean up expired oauth_state entries
  await db.from('oauth_state').delete().lt('expires_at', new Date().toISOString());

  return new Response(JSON.stringify({ purged: { strava: stravaCount, other: otherCount } }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '0 3 * * *', // Daily at 3am UTC
};
