import { createHash, randomBytes } from 'crypto';
import { getSupabase } from './supabase.mjs';

const AUTH_URL = 'https://apis.garmin.com/tools/oauth2/authorizeUser';
const TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const API_BASE = 'https://apis.garmin.com';

// Generate PKCE challenge pair
export function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function getOAuthURL(state, codeChallenge) {
  const params = new URLSearchParams({
    client_id: process.env.GARMIN_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/garmin-callback`,
    response_type: 'code',
    scope: 'activity:read user:read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeToken(code, codeVerifier) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GARMIN_CLIENT_ID,
      client_secret: process.env.GARMIN_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.SITE_URL}/api/garmin-callback`,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Garmin token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(connectionId) {
  const db = getSupabase();
  const { data: conn } = await db
    .from('platform_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', connectionId)
    .single();

  if (!conn) throw new Error(`Garmin connection ${connectionId} not found`);

  if (conn.token_expires_at && conn.token_expires_at > Math.floor(Date.now() / 1000) + 60) {
    return conn.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GARMIN_CLIENT_ID,
      client_secret: process.env.GARMIN_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Garmin token refresh failed: ${res.status}`);

  const data = await res.json();
  await db
    .from('platform_connections')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || conn.refresh_token,
      token_expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  return data.access_token;
}

// Register for push notifications after OAuth
export async function registerUser(token, accessToken) {
  const res = await fetch(`${API_BASE}/wellness-api/rest/user/registration`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pushUrl: `${process.env.SITE_URL}/api/garmin-webhook`,
    }),
  });
  if (!res.ok) {
    console.error('Garmin user registration failed:', res.status);
  }
}

// Map Garmin activity summary (from push payload) to our normalized format
export function normalizeActivity(garminActivity) {
  const sportTypeMap = {
    CYCLING: 'Ride',
    RUNNING: 'Run',
    WALKING: 'Walk',
    HIKING: 'Hike',
    SWIMMING: 'Swim',
    STRENGTH_TRAINING: 'WeightTraining',
    INDOOR_CYCLING: 'Ride',
    VIRTUAL_RIDE: 'VirtualRide',
    TRAIL_RUNNING: 'Run',
    MOUNTAIN_BIKING: 'Ride',
    GRAVEL_CYCLING: 'Ride',
  };

  const startDate = garminActivity.startTimeInSeconds
    ? new Date(garminActivity.startTimeInSeconds * 1000).toISOString()
    : null;

  return {
    name: garminActivity.activityName || 'Garmin Activity',
    sport_type: sportTypeMap[garminActivity.activityType] || garminActivity.activityType || 'Workout',
    start_date: startDate,
    distance: garminActivity.distanceInMeters || 0,
    moving_time: garminActivity.durationInSeconds || 0,
    elapsed_time: garminActivity.elapsedDurationInSeconds || garminActivity.durationInSeconds || 0,
    total_elevation_gain: garminActivity.totalElevationGainInMeters || 0,
    average_speed: garminActivity.averageSpeedInMetersPerSecond || 0,
    max_speed: garminActivity.maxSpeedInMetersPerSecond || 0,
    average_watts: garminActivity.averagePowerInWatts || null,
    max_watts: garminActivity.maxPowerInWatts || null,
    average_heartrate: garminActivity.averageHeartRateInBeatsPerMinute || null,
    suffer_score: null,
    external_id: garminActivity.activityId?.toString(),
    garmin_device: garminActivity.deviceName || null,
  };
}
