import { getSupabase } from './supabase.mjs';
import { generateRoast } from './claude.mjs';
import { computeDedupKey, findDuplicate } from './dedup.mjs';

// Build a platform link entry
function platformLink(platform, platformActivityId) {
  return { [platform]: platformActivityId };
}

// Store an activity from any platform and generate a roast.
// When a cross-platform duplicate is detected, merge platform links
// so the card shows "View on Strava" + "View on Garmin" etc.
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

    // Cross-platform duplicate — merge platform links and fill missing data
    const { data: existing } = await db
      .from('activities')
      .select('platform_links, average_watts, max_watts, suffer_score, source_platform')
      .eq('id', dup.id)
      .single();

    const mergedLinks = {
      ...(existing?.platform_links || {}),
      [dup.source_platform]: dup.source_activity_id,
      [platform]: platformActivityId,
    };

    const mergeFields = {
      platform_links: mergedLinks,
    };

    // Fill in missing data from the new source
    if (!existing?.average_watts && activity.average_watts) mergeFields.average_watts = activity.average_watts;
    if (!existing?.max_watts && activity.max_watts) mergeFields.max_watts = activity.max_watts;
    if (!existing?.suffer_score && activity.suffer_score) mergeFields.suffer_score = activity.suffer_score;

    // If the new source is Strava and existing isn't, also store the Strava ID
    // so "View on Strava" link works (required by Strava API agreement)
    if (platform === 'strava' && existing?.source_platform !== 'strava') {
      mergeFields.source_platform = 'strava';
      mergeFields.source_activity_id = platformActivityId;
    }

    await db.from('activities').update(mergeFields).eq('id', dup.id);
    console.log(`Merged ${platform} activity ${platformActivityId} into existing ${dup.source_platform} activity ${dup.id}`);
    return { stored: true, reason: 'merged', activityDbId: dup.id };
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
    platform_links: platformLink(platform, platformActivityId),
  };

  // Keep legacy athlete_id for Strava activities during migration
  if (platform === 'strava') {
    row.athlete_id = parseInt(platformActivityId.split(':')[0]) || null;
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
