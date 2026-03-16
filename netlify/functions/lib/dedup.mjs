import { getSupabase } from './supabase.mjs';

// Generate a dedup fingerprint from activity characteristics.
// Tolerances: start time rounded to nearest minute, duration to nearest minute,
// distance to nearest 100m. This handles minor platform discrepancies.
export function computeDedupKey(activity) {
  const startMs = new Date(activity.start_date).getTime();
  const startMinute = Math.floor(startMs / 60000);
  const durationMinute = Math.round((activity.moving_time || 0) / 60);
  const distanceHecto = Math.round((activity.distance || 0) / 100);

  return `${startMinute}:${durationMinute}:${distanceHecto}`;
}

// Check if a duplicate activity already exists for this user.
// Returns the existing activity if found, null otherwise.
//
// Strategy:
// 1. Exact match on source_platform + source_activity_id (same activity re-processed)
// 2. Dedup key match for same user (cross-platform duplicate)
// 3. Time window overlap (start within 2min, duration within 10%, distance within 10%)
export async function findDuplicate(userId, activity, sourcePlatform, sourceActivityId) {
  const db = getSupabase();

  // Layer 1: Same source — this is an update, not a duplicate
  if (sourceActivityId) {
    const { data } = await db
      .from('activities')
      .select('id, source_platform')
      .eq('source_platform', sourcePlatform)
      .eq('source_activity_id', sourceActivityId)
      .single();
    if (data) return { ...data, reason: 'same_source' };
  }

  // Layer 2: Dedup key match
  const dedupKey = computeDedupKey(activity);
  if (dedupKey && userId) {
    const { data } = await db
      .from('activities')
      .select('id, source_platform, source_activity_id')
      .eq('user_id', userId)
      .eq('dedup_key', dedupKey)
      .neq('source_platform', sourcePlatform)
      .single();
    if (data) return { ...data, reason: 'dedup_key' };
  }

  // Layer 3: Fuzzy time/distance overlap
  if (activity.start_date && userId) {
    const startMs = new Date(activity.start_date).getTime();
    const windowStart = new Date(startMs - 2 * 60000).toISOString();
    const windowEnd = new Date(startMs + 2 * 60000).toISOString();

    const { data: candidates } = await db
      .from('activities')
      .select('id, source_platform, source_activity_id, moving_time, distance')
      .eq('user_id', userId)
      .neq('source_platform', sourcePlatform)
      .gte('start_date', windowStart)
      .lte('start_date', windowEnd);

    if (candidates) {
      for (const c of candidates) {
        const durationMatch = !activity.moving_time || !c.moving_time ||
          Math.abs(activity.moving_time - c.moving_time) / Math.max(activity.moving_time, c.moving_time) < 0.1;
        const distanceMatch = !activity.distance || !c.distance ||
          Math.abs(activity.distance - c.distance) / Math.max(activity.distance, c.distance) < 0.1;
        if (durationMatch && distanceMatch) {
          return { ...c, reason: 'fuzzy_match' };
        }
      }
    }
  }

  return null;
}

// Source priority: prefer the platform with richer data.
// Returns true if newSource should replace existingSource.
const PRIORITY = { garmin: 1, wahoo: 2, strava: 3 };

export function shouldReplace(existingSource, newSource) {
  // Strava is highest priority because of "View on Strava" link requirement
  return (PRIORITY[newSource] || 0) > (PRIORITY[existingSource] || 0);
}
