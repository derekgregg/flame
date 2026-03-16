import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const url = new URL(req.url);
  const uploadId = url.searchParams.get('id');

  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload id' }), { status: 400 });
  }

  const db = getSupabase();
  const { data } = await db
    .from('uploads')
    .select('status, error_message, activity_id')
    .eq('id', uploadId)
    .eq('user_id', userId)
    .single();

  if (!data) {
    return new Response(JSON.stringify({ error: 'Upload not found' }), { status: 404 });
  }

  return new Response(JSON.stringify({
    status: data.status,
    error: data.error_message || null,
    activityId: data.activity_id || null,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
