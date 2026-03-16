import Anthropic from '@anthropic-ai/sdk';

let client;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatSpeed(mps) {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function buildPrompt(activity, athlete) {
  const stats = [];
  stats.push(`Activity type: ${activity.sport_type}`);
  stats.push(`Name: "${activity.name}"`);
  if (activity.distance > 0) stats.push(`Distance: ${formatDistance(activity.distance)}`);
  stats.push(`Moving time: ${formatDuration(activity.moving_time)}`);
  stats.push(`Elapsed time: ${formatDuration(activity.elapsed_time)}`);
  if (activity.total_elevation_gain > 0) stats.push(`Elevation gain: ${activity.total_elevation_gain}m`);
  if (activity.average_speed > 0) stats.push(`Average speed: ${formatSpeed(activity.average_speed)}`);
  if (activity.max_speed > 0) stats.push(`Max speed: ${formatSpeed(activity.max_speed)}`);
  if (activity.average_watts) stats.push(`Average watts: ${activity.average_watts}W`);
  if (activity.max_watts) stats.push(`Max watts: ${activity.max_watts}W`);
  if (activity.suffer_score) stats.push(`Suffer score: ${activity.suffer_score}`);

  const timeDiff = activity.elapsed_time - activity.moving_time;
  if (timeDiff > 60) stats.push(`Time spent stopped: ${formatDuration(timeDiff)}`);

  // Determine power category if watts data is available
  let powerContext = '';
  if (activity.average_watts && activity.athlete_weight) {
    const wkg = (activity.average_watts / activity.athlete_weight).toFixed(2);
    stats.push(`W/kg (avg): ${wkg}`);
    powerContext = `\nThe athlete's average power-to-weight is ${wkg} W/kg. For reference, here are male cycling categories by FTP W/kg:
- World Class (intl. pro): 5.78–6.40
- Exceptional (domestic pro): 5.15–5.69
- Excellent (Cat 1): 4.80–5.07
- Very Good (Cat 2): 4.27–4.53
- Good (Cat 3): 3.64–4.00
- Moderate (Cat 4): 3.20–3.47
- Fair (Cat 5): 2.58–2.84
- Untrained: 1.86–2.49
Use this to place the athlete in a category and roast (or grudgingly respect) them accordingly.`;
  } else if (activity.average_watts) {
    powerContext = `\nFor reference, a median male cyclist averages ~286W for 20min efforts. Use this to calibrate your mockery.`;
  }

  return `You are a brutally funny cycling commentator channeling the spirit of the Velominati. Your job is to roast this activity with savage, hilarious commentary. Be creative, specific to the stats, and merciless. Reference actual numbers.

You live by The Rules (velominati.com). Work in references when the activity warrants it, e.g.:
- Rule #5 (Harden The Fuck Up) — when the effort is soft
- Rule #9 (bad weather = badass) — when conditions are rough
- Rule #10 (it never gets easier, you just go faster) — when they're slow
- Rule #12 (correct number of bikes is n+1) — if relevant
- Rule #24 (use kilometers, not miles)
- Rule #33 (shave your guns)
- Rule #42 (a bike race shall never include swimming or running) — for multisport
- Rule #47 (drink Tripels, don't ride triples) — for triple chainrings or beer references
- Rule #90 (never get out of the big ring) — when power is low
Don't force a Rule reference if it doesn't fit — only use them when they land naturally.
${powerContext}

Guidelines:
- Keep it to 2-3 sentences max
- Be funny and creative, not just mean
- Reference specific stats that are weak, impressive, or funny
- Short walks, low distances, and slow speeds deserve EXTRA savage treatment
- If someone stopped a lot (big gap between moving and elapsed time), roast them for it
- If the activity name is funny or tryhard, roast that too
- Low suffer scores mean they weren't even trying
- Don't use hashtags or emojis
- When referencing a Rule, just say "Rule #X" naturally — don't quote the full text

Athlete: ${athlete.firstname} ${athlete.lastname}
${stats.join('\n')}

Generate a single roast:`;
}

export async function generateRoast(activity, athlete) {
  const prompt = buildPrompt(activity, athlete);

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}
