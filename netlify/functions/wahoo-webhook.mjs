import { getSupabase } from './lib/supabase.mjs';
import { normalizeActivity } from './lib/wahoo.mjs';
import { processActivity } from './lib/activity.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.json();
  console.log('Wahoo webhook event:', JSON.stringify(body));

  // Verify webhook token
  if (body.webhook_token !== process.env.WAHOO_WEBHOOK_TOKEN) {
    console.warn('Wahoo webhook token mismatch');
    return new Response('Forbidden', { status: 403 });
  }

  const eventType = body.event_type;

  // Only process workout creation/update
  if (!eventType?.startsWith('workout')) {
    return new Response('OK', { status: 200 });
  }

  const workout = body.workout;
  const workoutSummary = body.workout_summary;
  if (!workout) {
    return new Response('OK', { status: 200 });
  }

  const db = getSupabase();
  const wahooUserId = String(body.user?.id || workout.user_id);

  // Look up user from platform connection
  const { data: conn } = await db
    .from('platform_connections')
    .select('user_id')
    .eq('platform', 'wahoo')
    .eq('platform_user_id', wahooUserId)
    .single();

  if (!conn) {
    console.log(`Wahoo user ${wahooUserId} not connected, skipping`);
    return new Response('OK', { status: 200 });
  }

  const { data: user } = await db
    .from('users')
    .select('*')
    .eq('id', conn.user_id)
    .eq('is_tracked', true)
    .single();

  if (!user) {
    console.log(`User for Wahoo ${wahooUserId} not tracked, skipping`);
    return new Response('OK', { status: 200 });
  }

  // Handle deletion
  if (eventType === 'workout_summary.deleted' || eventType === 'workout.deleted') {
    await db.from('activities')
      .delete()
      .eq('source_platform', 'wahoo')
      .eq('source_activity_id', String(workout.id));
    return new Response('OK', { status: 200 });
  }

  const activity = normalizeActivity(workout, workoutSummary);

  // Process in background (webhook must respond quickly)
  // For Wahoo, the data is in the payload so we can process inline
  // since we don't need a secondary API call
  try {
    await processActivity({
      userId: conn.user_id,
      platform: 'wahoo',
      platformActivityId: String(workout.id),
      activity,
      user,
    });
  } catch (err) {
    console.error('Wahoo activity processing error:', err);
  }

  return new Response('OK', { status: 200 });
};
