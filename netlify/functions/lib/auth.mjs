import { createHmac } from 'crypto';
import { getSupabase } from './supabase.mjs';

const SECRET = () => process.env.JWT_SECRET || process.env.ADMIN_SECRET;
const COOKIE_NAME = 'flame_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', SECRET())
    .update(`${header}.${body}`)
    .digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(userId) {
  return sign({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  });
}

export function getSessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function getUserIdFromRequest(req) {
  const cookies = req.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const payload = verify(match[1]);
  return payload?.sub || null;
}

export async function getUser(userId) {
  const db = getSupabase();
  const { data } = await db
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

export async function getUserConnections(userId) {
  const db = getSupabase();
  const { data } = await db
    .from('platform_connections')
    .select('id, platform, platform_user_id, platform_profile, created_at')
    .eq('user_id', userId)
    .order('created_at');
  return data || [];
}

// Find or create a user from a platform OAuth response.
// If the request has a session cookie, link to that existing user.
// Otherwise, check if this platform account already exists, or create a new user.
export async function findOrCreateUser(req, { platform, platformUserId, displayName, profilePic, weight, accessToken, refreshToken, tokenExpiresAt, scopes }) {
  const db = getSupabase();
  let userId = getUserIdFromRequest(req);

  // Check if this platform account is already connected
  const { data: existing } = await db
    .from('platform_connections')
    .select('user_id')
    .eq('platform', platform)
    .eq('platform_user_id', platformUserId)
    .single();

  if (existing) {
    // Platform account already linked — update tokens
    await db
      .from('platform_connections')
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        scopes,
        updated_at: new Date().toISOString(),
      })
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId);

    // Update user profile if this is the primary connection
    const updates = { updated_at: new Date().toISOString() };
    if (weight) updates.weight = weight;
    await db.from('users').update(updates).eq('id', existing.user_id);

    return existing.user_id;
  }

  // If logged in, link to existing user
  if (!userId) {
    // Create a new user
    const { data: newUser, error } = await db
      .from('users')
      .insert({
        display_name: displayName,
        profile_pic: profilePic,
        weight: weight || null,
      })
      .select('id')
      .single();
    if (error) throw error;
    userId = newUser.id;
  }

  // Create platform connection
  const { error: connError } = await db
    .from('platform_connections')
    .insert({
      user_id: userId,
      platform,
      platform_user_id: platformUserId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: tokenExpiresAt,
      scopes,
      platform_profile: { displayName, profilePic },
    });
  if (connError) throw connError;

  return userId;
}
