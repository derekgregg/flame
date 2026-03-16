import { getSupabase } from './lib/supabase.mjs';
import { getActivity, normalizeActivity } from './lib/strava.mjs';
import { processActivity } from './lib/activity.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { athleteId, activityId, platform } = JSON.parse(event.body);

  // Currently only handles Strava — Wahoo/Garmin process inline in their webhooks
  if (platform && platform !== 'strava') {
    return { statusCode: 200, body: 'Non-Strava platforms process inline' };
  }

  if (!athleteId || !activityId) {
    return { statusCode: 400, body: 'Missing athleteId or activityId' };
  }

  const db = getSupabase();
  const stravaAthleteId = String(athleteId);

  // Find user via platform connection
  const { data: conn } = await db
    .from('platform_connections')
    .select('user_id')
    .eq('platform', 'strava')
    .eq('platform_user_id', stravaAthleteId)
    .single();

  // Fallback to legacy athletes table
  let userId = conn?.user_id;
  let user;

  if (userId) {
    const { data } = await db.from('users').select('*').eq('id', userId).eq('is_tracked', true).single();
    user = data;
  }

  if (!user) {
    // Legacy path: check athletes table
    const { data: athlete } = await db
      .from('athletes')
      .select('*')
      .eq('id', athleteId)
      .eq('is_tracked', true)
      .single();

    if (!athlete) {
      console.log(`Athlete ${athleteId} not tracked, skipping`);
      return { statusCode: 200, body: 'Not tracked' };
    }

    // Legacy processing
    const rawActivity = await getActivity(athleteId, activityId);
    const { generateRoast } = await import('./lib/claude.mjs');

    await db.from('activities').upsert({
      id: rawActivity.id,
      athlete_id: athleteId,
      name: rawActivity.name,
      distance: rawActivity.distance,
      moving_time: rawActivity.moving_time,
      elapsed_time: rawActivity.elapsed_time,
      elevation_gain: rawActivity.total_elevation_gain,
      average_speed: rawActivity.average_speed,
      max_speed: rawActivity.max_speed,
      average_watts: rawActivity.average_watts || null,
      max_watts: rawActivity.max_watts || null,
      suffer_score: rawActivity.suffer_score || null,
      start_date: rawActivity.start_date,
      sport_type: rawActivity.sport_type || rawActivity.type,
      source_platform: 'strava',
      source_activity_id: String(rawActivity.id),
    });

    if (athlete.weight) rawActivity.athlete_weight = athlete.weight;
    try {
      const roast = await generateRoast(rawActivity, athlete);
      await db.from('activities')
        .update({ roast, roast_generated_at: new Date().toISOString() })
        .eq('id', activityId);
    } catch (err) {
      console.error(`Roast generation failed for ${activityId}:`, err);
    }
    return { statusCode: 200, body: 'OK (legacy)' };
  }

  // New path: fetch from Strava and process through unified pipeline
  const rawActivity = await getActivity(athleteId, activityId);
  const activity = normalizeActivity(rawActivity);

  await processActivity({
    userId,
    platform: 'strava',
    platformActivityId: String(activityId),
    activity,
    user,
  });

  return { statusCode: 200, body: 'OK' };
};
