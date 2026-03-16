import { getUserIdFromRequest, getUser, getUserConnections } from './lib/auth.mjs';

export default async (req) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await getUser(userId);
  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const connections = await getUserConnections(userId);

  return new Response(JSON.stringify({
    user: {
      id: user.id,
      display_name: user.display_name,
      profile_pic: user.profile_pic,
      weight: user.weight,
      share_with_group: user.share_with_group,
    },
    connections: connections.map(c => ({
      id: c.id,
      platform: c.platform,
      connected_at: c.created_at,
    })),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
