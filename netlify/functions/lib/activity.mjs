import { getSupabase } from './supabase.mjs';
import { generateRoast } from './claude.mjs';
import { computeDedupKey, findDuplicate } from './dedup.mjs';
import { analyzePower } from './power-analysis.mjs';

function buildEnrichmentData(activity) {
  const data = {};
  if (activity.power_curve) data.best_efforts = activity.power_curve;
  if (activity.power_analysis) {
    if (activity.power_analysis.best_efforts) data.best_efforts = activity.power_analysis.best_efforts;
    if (activity.power_analysis.variability_index) data.variability_index = activity.power_analysis.variability_index;
    if (activity.power_analysis.intensity_factor) data.intensity_factor = activity.power_analysis.intensity_factor;
    if (activity.power_analysis.tss) data.tss = activity.power_analysis.tss;
    if (activity.power_analysis.intervals) data.intervals = activity.power_analysis.intervals;
  }
  return Object.keys(data).length > 0 ? data : null;
}

// Fetch Strava power streams and run power analysis.
// Returns enrichment data or null.
async function fetchStravaPowerAnalysis(platformActivityId, athleteId, ftp, avgPower) {
  try {
    const { getActivityStreams } = await import('./strava.mjs');
    const streams = await getActivityStreams(athleteId, platformActivityId);
    if (!streams) return null;

    // Strava returns streams as array of { type, data } or keyed object
    let powerData;
    if (Array.isArray(streams)) {
      const powerStream = streams.find(s => s.type === 'watts');
      powerData = powerStream?.data;
    } else {
      powerData = streams.watts?.data;
    }

    if (!powerData?.length) return null;

    return analyzePower(powerData, ftp, avgPower);
  } catch (err) {
    console.error('Strava streams fetch failed:', err.message);
    return null;
  }
}

// Store an activity and generate commentary.
// An activity is the top-level object. It may be linked to one or more
// sources (strava, garmin, wahoo, upload) via platform_links.
export async function processActivity({ userId, platform, platformActivityId, activity, user }) {
  const db = getSupabase();
  const dedupKey = computeDedupKey(activity);

  // Check if this activity already exists
  const dup = await findDuplicate(userId, activity, platform, platformActivityId);

  if (dup) {
    // Activity already exists — merge this source into it
    const { data: existing } = await db
      .from('activities')
      .select('platform_links, average_watts, max_watts, suffer_score, avg_heart_rate, max_heart_rate, avg_cadence, normalized_power, lap_data, enrichment_data')
      .eq('id', dup.id)
      .single();

    const mergedLinks = {
      ...(existing?.platform_links || {}),
      [platform]: platformActivityId,
    };

    const updates = { platform_links: mergedLinks };

    // Fill in missing data from the new source (richer source wins per field)
    if (!existing?.average_watts && activity.average_watts) updates.average_watts = Math.round(activity.average_watts);
    if (!existing?.max_watts && activity.max_watts) updates.max_watts = Math.round(activity.max_watts);
    if (!existing?.suffer_score && activity.suffer_score) updates.suffer_score = Math.round(activity.suffer_score);
    if (!existing?.avg_heart_rate && activity.average_heartrate) updates.avg_heart_rate = Math.round(activity.average_heartrate);
    if (!existing?.max_heart_rate && activity.max_heartrate) updates.max_heart_rate = Math.round(activity.max_heartrate);
    if (!existing?.avg_cadence && activity.avg_cadence) updates.avg_cadence = Math.round(activity.avg_cadence);
    if (!existing?.normalized_power && activity.normalized_power) updates.normalized_power = Math.round(activity.normalized_power);
    if (!existing?.lap_data && activity.lap_data) updates.lap_data = activity.lap_data;
    if (!existing?.enrichment_data && activity.power_curve) {
      updates.enrichment_data = { power_curve: activity.power_curve };
    }

    // If the same source is updating, also refresh core fields
    if (dup.reason === 'same_source') {
      updates.name = activity.name;
      updates.distance = activity.distance;
      updates.moving_time = activity.moving_time;
      updates.elapsed_time = activity.elapsed_time;
      updates.elevation_gain = activity.total_elevation_gain;
      updates.average_speed = activity.average_speed;
      updates.max_speed = activity.max_speed;
      updates.sport_type = activity.sport_type;
      updates.dedup_key = dedupKey;
    }

    await db.from('activities').update(updates).eq('id', dup.id);
    console.log(`Merged ${platform}:${platformActivityId} into activity ${dup.id}`);
    return { stored: true, reason: dup.reason === 'same_source' ? 'updated' : 'merged', activityDbId: dup.id };
  }

  // New activity — insert
  const row = {
    user_id: userId,
    name: activity.name,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_watts: activity.average_watts ? Math.round(activity.average_watts) : null,
    max_watts: activity.max_watts ? Math.round(activity.max_watts) : null,
    suffer_score: activity.suffer_score ? Math.round(activity.suffer_score) : null,
    start_date: activity.start_date,
    sport_type: activity.sport_type,
    dedup_key: dedupKey,
    external_id: activity.external_id || null,
    platform_links: { [platform]: platformActivityId },
    // Source tracking (kept for queries and backwards compat)
    source_platform: platform,
    source_activity_id: platformActivityId,
    // Enrichment fields
    normalized_power: activity.normalized_power ? Math.round(activity.normalized_power) : null,
    avg_cadence: activity.avg_cadence ? Math.round(activity.avg_cadence) : null,
    max_cadence: activity.max_cadence ? Math.round(activity.max_cadence) : null,
    avg_heart_rate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    max_heart_rate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    calories: activity.calories ? Math.round(activity.calories) : null,
    lap_data: activity.lap_data || null,
    enrichment_data: buildEnrichmentData(activity),
  };

  // Keep legacy athlete_id for Strava during migration
  if (platform === 'strava') {
    row.athlete_id = parseInt(platformActivityId) || null;
  }

  const { data: inserted, error } = await db
    .from('activities')
    .upsert(row)
    .select('id')
    .single();

  if (error) {
    console.error('Activity insert error:', error);
    return { stored: false, reason: 'insert_error' };
  }

  const activityDbId = inserted?.id || row.id;

  // Fetch per-second power data from Strava streams (if available and not already analyzed)
  if (platform === 'strava' && activity.average_watts && !activity.power_analysis) {
    const athleteId = parseInt(platformActivityId) || row.athlete_id;
    const analysis = await fetchStravaPowerAnalysis(platformActivityId, athleteId, user?.ftp, activity.average_watts);
    if (analysis) {
      activity.power_analysis = analysis;
      activity.power_curve = analysis.best_efforts;
      if (analysis.normalized_power) activity.normalized_power = analysis.normalized_power;

      // Update the stored enrichment data
      await db.from('activities').update({
        enrichment_data: buildEnrichmentData(activity),
        normalized_power: analysis.normalized_power ? Math.round(analysis.normalized_power) : null,
      }).eq('id', activityDbId);
    }
  }

  // Generate commentary
  try {
    if (user?.weight) activity.athlete_weight = user.weight;
    if (user?.ftp) activity.athlete_ftp = user.ftp;
    const roast = await generateRoast(activity, {
      firstname: user?.display_name?.split(' ')[0] || '?',
      lastname: user?.display_name?.split(' ').slice(1).join(' ') || '',
    });
    await db
      .from('activities')
      .update({ roast, roast_generated_at: new Date().toISOString() })
      .eq('id', activityDbId);
    console.log(`Commentary generated for activity ${activityDbId}`);
  } catch (err) {
    console.error(`Commentary generation failed for activity ${activityDbId}:`, err);
  }

  return { stored: true, reason: 'new', activityDbId };
}
