const msg = document.getElementById('callback-message');
const params = new URLSearchParams(window.location.search);

const platformLabels = { strava: 'Strava', wahoo: 'Wahoo', garmin: 'Garmin', google: 'Google' };
const platform = params.get('platform') || 'strava';
const platformLabel = platformLabels[platform] || platform;

if (params.get('success')) {
  const name = params.get('name') || 'there';
  msg.innerHTML = `
    <h2>Welcome, ${name}!</h2>
    <p>Your ${platformLabel} account is connected.</p>
    <p style="margin-top: 12px; color: var(--text-muted); font-size: 0.85rem;">Redirecting to the leaderboard...</p>
  `;
  setTimeout(() => { window.location.href = '/'; }, 1500);
} else if (params.get('error')) {
  msg.className = 'callback-msg error';
  msg.innerHTML = `
    <h2>Connection Failed</h2>
    <p>${platformLabel} error: ${params.get('error')}</p>
    <p style="margin-top: 20px;"><a href="/">Try again</a></p>
  `;
} else {
  msg.innerHTML = `
    <p>Nothing to see here.</p>
    <p style="margin-top: 20px;"><a href="/">Go to leaderboard</a></p>
  `;
}
