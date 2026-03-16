import { getSupabase } from './lib/supabase.mjs';

export default async (req) => {
  // GET = webhook validation from Strava
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
      return new Response(JSON.stringify({ 'hub.challenge': challenge }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST = incoming webhook event
  if (req.method === 'POST') {
    const event = await req.json();
    console.log('Strava webhook event:', JSON.stringify(event));

    const db = getSupabase();

    // Handle athlete deauthorization
    if (event.object_type === 'athlete' && event.updates?.authorized === 'false') {
      const stravaAthleteId = String(event.owner_id);

      // Find the platform connection and user
      const { data: conn } = await db
        .from('platform_connections')
        .select('id, user_id')
        .eq('platform', 'strava')
        .eq('platform_user_id', stravaAthleteId)
        .single();

      if (conn) {
        // Delete Strava-sourced activities
        await db.from('activities').delete().eq('user_id', conn.user_id).eq('source_platform', 'strava');
        // Remove the Strava connection
        await db.from('platform_connections').delete().eq('id', conn.id);

        // Check if user has other connections — if not, clean up
        const { data: remaining } = await db
          .from('platform_connections')
          .select('id')
          .eq('user_id', conn.user_id);
        if (!remaining?.length) {
          await db.from('users').delete().eq('id', conn.user_id);
        }
      }

      // Also clean legacy table
      await db.from('activities').delete().eq('athlete_id', event.owner_id);
      await db.from('athletes').delete().eq('id', event.owner_id);

      console.log(`Deauthorized Strava athlete ${stravaAthleteId} — data deleted`);
      return new Response('OK', { status: 200 });
    }

    // Only process activities
    if (event.object_type !== 'activity') {
      return new Response('OK', { status: 200 });
    }

    // Handle deleted activities
    if (event.aspect_type === 'delete') {
      await db.from('activities')
        .delete()
        .eq('source_platform', 'strava')
        .eq('source_activity_id', String(event.object_id));
      // Also try legacy ID
      await db.from('activities').delete().eq('id', event.object_id);
      return new Response('OK', { status: 200 });
    }

    // Dispatch to background function for processing
    fetch(`${process.env.SITE_URL}/.netlify/functions/process-activity-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athleteId: event.owner_id,
        activityId: event.object_id,
        platform: 'strava',
      }),
    }).catch((err) => console.error('Background dispatch error:', err));

    return new Response('OK', { status: 200 });
  }

  return new Response('Method not allowed', { status: 405 });
};
