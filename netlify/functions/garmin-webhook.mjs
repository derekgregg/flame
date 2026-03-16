import { getSupabase } from './lib/supabase.mjs';
import { normalizeActivity } from './lib/garmin.mjs';
import { processActivity } from './lib/activity.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.json();
  console.log('Garmin webhook event:', JSON.stringify(body));

  const db = getSupabase();

  // Garmin sends different payload types
  // Activities come as { activities: [...] }
  // Deregistrations come as { deregistrations: [...] }

  // Handle deregistrations
  if (body.deregistrations) {
    for (const dereg of body.deregistrations) {
      const garminUserId = String(dereg.userId);
      const { data: conn } = await db
        .from('platform_connections')
        .select('id, user_id')
        .eq('platform', 'garmin')
        .eq('platform_user_id', garminUserId)
        .single();

      if (conn) {
        // Delete Garmin-sourced activities for this user
        await db.from('activities')
          .delete()
          .eq('user_id', conn.user_id)
          .eq('source_platform', 'garmin');
        // Remove the connection
        await db.from('platform_connections').delete().eq('id', conn.id);
        console.log(`Garmin user ${garminUserId} deregistered — connection removed`);
      }
    }
    return new Response('OK', { status: 200 });
  }

  // Handle activity deletions
  if (body.activityDeletions) {
    for (const deletion of body.activityDeletions) {
      await db.from('activities')
        .delete()
        .eq('source_platform', 'garmin')
        .eq('source_activity_id', String(deletion.activityId));
    }
    return new Response('OK', { status: 200 });
  }

  // Handle new/updated activities
  const activities = body.activities || [];
  for (const garminActivity of activities) {
    const garminUserId = String(garminActivity.userId || garminActivity.ownerUserId);

    const { data: conn } = await db
      .from('platform_connections')
      .select('user_id')
      .eq('platform', 'garmin')
      .eq('platform_user_id', garminUserId)
      .single();

    if (!conn) {
      console.log(`Garmin user ${garminUserId} not connected, skipping`);
      continue;
    }

    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', conn.user_id)
      .eq('is_tracked', true)
      .single();

    if (!user) continue;

    const activity = normalizeActivity(garminActivity);
    const activityId = String(garminActivity.activityId || garminActivity.summaryId);

    try {
      await processActivity({
        userId: conn.user_id,
        platform: 'garmin',
        platformActivityId: activityId,
        activity,
        user,
      });
    } catch (err) {
      console.error(`Garmin activity processing error for ${activityId}:`, err);
    }
  }

  return new Response('OK', { status: 200 });
};
