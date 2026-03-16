import { getSupabase } from './supabase.mjs';

const API_BASE = 'https://api.wahooligan.com';
const TOKEN_URL = `${API_BASE}/oauth/token`;

export function getOAuthURL(state) {
  const params = new URLSearchParams({
    client_id: process.env.WAHOO_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/wahoo-callback`,
    response_type: 'code',
    scope: 'user_read workouts_read offline_data',
    state,
  });
  return `${API_BASE}/oauth/authorize?${params}`;
}

export async function exchangeToken(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.WAHOO_CLIENT_ID,
      client_secret: process.env.WAHOO_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.SITE_URL}/api/wahoo-callback`,
    }),
  });
  if (!res.ok) throw new Error(`Wahoo token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(connectionId) {
  const db = getSupabase();
  const { data: conn } = await db
    .from('platform_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', connectionId)
    .single();

  if (!conn) throw new Error(`Wahoo connection ${connectionId} not found`);

  // Wahoo tokens expire in 2 hours — refresh with 60s buffer
  if (conn.token_expires_at > Math.floor(Date.now() / 1000) + 60) {
    return conn.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.WAHOO_CLIENT_ID,
      client_secret: process.env.WAHOO_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Wahoo token refresh failed: ${res.status}`);

  const data = await res.json();
  await db
    .from('platform_connections')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 7200),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  return data.access_token;
}

async function getConnectionForUser(userId) {
  const db = getSupabase();
  const { data } = await db
    .from('platform_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('platform', 'wahoo')
    .single();
  return data;
}

export async function getUser(token) {
  const res = await fetch(`${API_BASE}/v1/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Wahoo user fetch failed: ${res.status}`);
  return res.json();
}

export async function getWorkout(userId, workoutId) {
  const conn = await getConnectionForUser(userId);
  if (!conn) throw new Error('No Wahoo connection');
  const token = await refreshAccessToken(conn.id);

  const res = await fetch(`${API_BASE}/v1/workouts/${workoutId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Wahoo workout fetch failed: ${res.status}`);
  return res.json();
}

export async function listWorkouts(userId, page = 1) {
  const conn = await getConnectionForUser(userId);
  if (!conn) throw new Error('No Wahoo connection');
  const token = await refreshAccessToken(conn.id);

  const res = await fetch(`${API_BASE}/v1/workouts?page=${page}&per_page=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Wahoo workouts list failed: ${res.status}`);
  return res.json();
}

// Configure per-user webhook after OAuth
export async function setupWebhook(token) {
  const res = await fetch(`${API_BASE}/v1/user`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user: {
        webhook_url: `${process.env.SITE_URL}/api/wahoo-webhook`,
        webhook_token: process.env.WAHOO_WEBHOOK_TOKEN,
        webhook_enabled: true,
      },
    }),
  });
  if (!res.ok) {
    console.error('Wahoo webhook setup failed:', res.status);
  }
}

// Map Wahoo workout data to our normalized activity format
export function normalizeActivity(workout, workoutSummary) {
  // Wahoo workout_type families: 0=cycling, 1=running, etc.
  const sportTypeMap = {
    0: 'Ride',
    1: 'Run',
    2: 'Swim',
    3: 'WeightTraining',
    4: 'Walk',
    5: 'Hike',
  };

  const ws = workoutSummary || {};
  return {
    name: workout.name || 'Wahoo Workout',
    sport_type: sportTypeMap[workout.workout_type_family_id] || 'Workout',
    start_date: workout.starts,
    distance: parseFloat(ws.distance_accum) || 0,
    moving_time: Math.round(parseFloat(ws.duration_active_accum) || 0),
    elapsed_time: Math.round(parseFloat(ws.duration_total_accum) || 0),
    total_elevation_gain: parseFloat(ws.ascent_accum) || 0,
    average_speed: parseFloat(ws.speed_avg) || 0,
    max_speed: parseFloat(ws.speed_max) || 0,
    average_watts: parseFloat(ws.power_avg) || null,
    max_watts: parseFloat(ws.power_max) || null,
    average_heartrate: parseFloat(ws.heart_rate_avg) || null,
    suffer_score: null, // Wahoo doesn't have suffer score
    external_id: workout.id?.toString(),
  };
}
