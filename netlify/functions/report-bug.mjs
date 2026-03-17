import { getUserIdFromRequest } from './lib/auth.mjs';

const GITHUB_REPO = 'derekgregg/directeur';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!process.env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500 });
  }

  const userId = getUserIdFromRequest(req);
  const { title, description, page, type } = await req.json();

  if (!title?.trim()) {
    return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });
  }

  const isBug = type !== 'feature';
  const prefix = isBug ? '[Bug]' : '[Feature]';
  const labels = isBug ? ['bug', 'user-reported'] : ['enhancement', 'user-reported'];

  const body = [
    description?.trim() || '_No description provided._',
    '',
    '---',
    `**Type:** ${isBug ? 'Bug Report' : 'Feature Request'}`,
    `**Reported from:** ${page || 'unknown'}`,
    `**User:** ${userId || 'not logged in'}`,
    `**Date:** ${new Date().toISOString()}`,
    `**User-Agent:** ${req.headers.get('user-agent') || 'unknown'}`,
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `${prefix} ${title.trim()}`,
      body,
      labels,
    }),
  });

  if (!res.ok) {
    console.error('GitHub issue creation failed:', res.status, await res.text());
    return new Response(JSON.stringify({ error: 'Failed to create issue' }), { status: 500 });
  }

  const issue = await res.json();

  return new Response(JSON.stringify({ success: true, issueNumber: issue.number }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
