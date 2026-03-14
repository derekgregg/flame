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
    console.log('Webhook event:', JSON.stringify(event));

    // Handle athlete deauthorization
    if (event.object_type === 'athlete' && event.updates?.authorized === 'false') {
      const db = getSupabase();
      const athleteId = event.owner_id;
      await db.from('activities').delete().eq('athlete_id', athleteId);
      await db.from('athletes').delete().eq('id', athleteId);
      console.log(`Deauthorized athlete ${athleteId} — data deleted`);
      return new Response('OK', { status: 200 });
    }

    // Only process activities
    if (event.object_type !== 'activity') {
      return new Response('OK', { status: 200 });
    }

    // Handle deleted activities
    if (event.aspect_type === 'delete') {
      const db = getSupabase();
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
      }),
    }).catch((err) => console.error('Background dispatch error:', err));

    return new Response('OK', { status: 200 });
  }

  return new Response('Method not allowed', { status: 405 });
};
