import { getSupabase } from './supabase.mjs';
import { generateRoast } from './claude.mjs';
import { computeDedupKey, findDuplicate, shouldReplace } from './dedup.mjs';

// Store an activity from any platform and generate a roast.
// Returns { stored: true/false, reason: string }
export async function processActivity({ userId, platform, platformActivityId, activity, user }) {
  const db = getSupabase();
  const dedupKey = computeDedupKey(activity);

  // Check for duplicates
  const dup = await findDuplicate(userId, activity, platform, platformActivityId);

  if (dup) {
    if (dup.reason === 'same_source') {
      // Same activity re-processed — update it
      await db.from('activities').update({
        name: activity.name,
        distance: activity.distance,
        moving_time: activity.moving_time,
        elapsed_time: activity.elapsed_time,
        elevation_gain: activity.total_elevation_gain,
        average_speed: activity.average_speed,
        max_speed: activity.max_speed,
        average_watts: activity.average_watts || null,
        max_watts: activity.max_watts || null,
        suffer_score: activity.suffer_score || null,
        sport_type: activity.sport_type,
        dedup_key: dedupKey,
        external_id: activity.external_id || null,
      }).eq('id', dup.id);
      return { stored: true, reason: 'updated', activityDbId: dup.id };
    }

    if (shouldReplace(dup.source_platform, platform)) {
      // New source is higher priority — replace
      await db.from('activities').update({
        source_platform: platform,
        source_activity_id: platformActivityId,
        name: activity.name,
        distance: activity.distance,
        moving_time: activity.moving_time,
        elapsed_time: activity.elapsed_time,
        elevation_gain: activity.total_elevation_gain,
        average_speed: activity.average_speed,
        max_speed: activity.max_speed,
        average_watts: activity.average_watts || null,
        max_watts: activity.max_watts || null,
        suffer_score: activity.suffer_score || null,
        sport_type: activity.sport_type,
        dedup_key: dedupKey,
        external_id: activity.external_id || null,
      }).eq('id', dup.id);
      return { stored: true, reason: 'replaced', activityDbId: dup.id };
    }

    // Existing source is higher priority — merge any missing fields
    const mergeFields = {};
    if (!dup.average_watts && activity.average_watts) mergeFields.average_watts = activity.average_watts;
    if (!dup.max_watts && activity.max_watts) mergeFields.max_watts = activity.max_watts;
    if (Object.keys(mergeFields).length > 0) {
      await db.from('activities').update(mergeFields).eq('id', dup.id);
    }
    return { stored: false, reason: `duplicate_from_${dup.source_platform}` };
  }

  // No duplicate — insert new activity
  const row = {
    user_id: userId,
    source_platform: platform,
    source_activity_id: platformActivityId,
    name: activity.name,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_watts: activity.average_watts || null,
    max_watts: activity.max_watts || null,
    suffer_score: activity.suffer_score || null,
    start_date: activity.start_date,
    sport_type: activity.sport_type,
    dedup_key: dedupKey,
    external_id: activity.external_id || null,
  };

  // Keep legacy athlete_id for Strava activities during migration
  if (platform === 'strava') {
    row.athlete_id = parseInt(platformActivityId.split(':')[0]) || null;
    // Use Strava activity ID as the row ID for backwards compat
    row.id = parseInt(platformActivityId) || undefined;
  }

  const { data: inserted, error } = await db
    .from('activities')
    .upsert(row, { onConflict: platform === 'strava' ? 'id' : 'source_platform,source_activity_id' })
    .select('id')
    .single();

  if (error) {
    console.error('Activity insert error:', error);
    return { stored: false, reason: 'insert_error' };
  }

  const activityDbId = inserted?.id || row.id;

  // Generate roast
  try {
    // Attach weight for W/kg
    if (user?.weight) {
      activity.athlete_weight = user.weight;
    }
    const roast = await generateRoast(activity, {
      firstname: user?.display_name?.split(' ')[0] || '?',
      lastname: user?.display_name?.split(' ').slice(1).join(' ') || '',
    });
    await db
      .from('activities')
      .update({ roast, roast_generated_at: new Date().toISOString() })
      .eq('id', activityDbId);
    console.log(`Roast generated for ${platform} activity ${platformActivityId}`);
  } catch (err) {
    console.error(`Roast generation failed for ${platformActivityId}:`, err);
  }

  return { stored: true, reason: 'new', activityDbId };
}
