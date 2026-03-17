const leaderboard = document.getElementById('leaderboard');
const filterUser = document.getElementById('filter-user');
const filterSport = document.getElementById('filter-sport');
const sortBy = document.getElementById('sort-by');
const userNav = document.getElementById('user-nav');
const userGreeting = document.getElementById('user-greeting');
const controls = document.getElementById('controls');
const loggedOutCta = document.getElementById('logged-out-cta');
const stravaLogo = document.getElementById('strava-logo');

let isLoggedIn = false;
let hasStrava = false;

function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function formatDistance(meters) {
  if (!meters || meters === 0) return '--';
  if (meters < 1000) return `${fmt(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds) {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatSpeed(mps) {
  if (!mps || mps === 0) return '--';
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function platformBadges(activity) {
  const links = activity.platform_links || {};
  const labels = { strava: 'Strava', wahoo: 'Wahoo', garmin: 'Garmin', upload: 'Upload' };
  const classes = { strava: 'badge-strava', wahoo: 'badge-wahoo', garmin: 'badge-garmin', upload: 'badge-upload' };

  const platforms = Object.keys(links);
  if (!platforms.length && activity.source_platform) {
    platforms.push(activity.source_platform);
  }

  return platforms
    .map(p => `<span class="platform-badge ${classes[p] || ''}">${labels[p] || p}</span>`)
    .join(' ');
}

function activityLinks(activity) {
  const links = activity.platform_links || {};
  const parts = [];

  if (links.strava) {
    parts.push(`<a href="https://www.strava.com/activities/${links.strava}" target="_blank" rel="noopener" class="view-on-strava">View on Strava</a>`);
  }
  if (links.garmin) {
    parts.push(`<a href="https://connect.garmin.com/modern/activity/${links.garmin}" target="_blank" rel="noopener" class="view-on-garmin">View on Garmin</a>`);
  }
  if (links.wahoo) {
    parts.push(`<span class="view-on-wahoo">Recorded with Wahoo</span>`);
  }

  if (!parts.length && activity.source_platform === 'strava') {
    const id = activity.source_activity_id || activity.id;
    parts.push(`<a href="https://www.strava.com/activities/${id}" target="_blank" rel="noopener" class="view-on-strava">View on Strava</a>`);
  }

  return parts.join(' ');
}

function renderCard(a) {
  const user = a.users || a.athletes;
  const displayName = user?.display_name || `${user?.firstname || '?'} ${user?.lastname || ''}`;
  const profilePic = user?.profile_pic || '';

  const stats = [];
  if (a.distance > 0) stats.push({ label: 'Distance', value: formatDistance(a.distance) });
  stats.push({ label: 'Time', value: formatDuration(a.moving_time) });
  if (a.average_speed > 0) stats.push({ label: 'Avg Speed', value: formatSpeed(a.average_speed) });
  if (a.elevation_gain > 0) stats.push({ label: 'Elevation', value: `${fmt(a.elevation_gain)} m` });
  if (a.average_watts) stats.push({ label: 'Avg Watts', value: `${fmt(a.average_watts)} W` });
  if (a.suffer_score) stats.push({ label: 'Suffer', value: a.suffer_score });

  const statsHTML = stats
    .map((s) => `<div class="stat"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`)
    .join('');

  return `
    <div class="activity-card">
      <div class="card-header">
        ${profilePic ? `<img src="${profilePic}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="athlete-name">${displayName}</span>
        <span class="activity-date">${formatDate(a.start_date)}</span>
        ${platformBadges(a)}
        <span class="activity-type">${a.sport_type}</span>
      </div>
      <div class="activity-name">"${a.name}"</div>
      <div class="stats-grid">${statsHTML}</div>
      ${a.route_polyline ? `<div class="activity-map" id="map-${a.id}"></div>` : ''}
      <div class="roast">${a.roast}</div>
      ${activityLinks(a)}
    </div>
  `;
}

async function checkAuth() {
  try {
    const res = await fetch('/api/get-user');
    const data = await res.json();
    if (data.user) {
      isLoggedIn = true;
      userNav.classList.remove('hidden');
      userGreeting.textContent = data.user.display_name;

      if (data.connections) {
        hasStrava = data.connections.some(c => c.platform === 'strava');
      }
    }
  } catch {
    // Not logged in
  }
}

async function loadLeaderboard() {
  const params = new URLSearchParams();
  if (filterUser.value) params.set('user_id', filterUser.value);
  if (filterSport.value) params.set('sport_type', filterSport.value);
  if (sortBy.value) params.set('sort', sortBy.value);

  leaderboard.innerHTML = '<div class="loading">Loading commentary...</div>';

  try {
    const res = await fetch(`/api/get-leaderboard?${params}`);
    const data = await res.json();

    // Populate user filter
    const users = data.users || data.athletes || [];
    if (users.length && filterUser.options.length <= 1) {
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.display_name || `${u.firstname} ${u.lastname}`;
        filterUser.appendChild(opt);
      }
    }

    if (!data.activities?.length) {
      leaderboard.innerHTML = '';
      if (!isLoggedIn) {
        loggedOutCta.classList.remove('hidden');
      } else {
        leaderboard.innerHTML = `<div class="empty-state">
          <p>No commentary yet.</p>
          <p style="margin-top: 8px;"><a href="/upload.html">Upload an activity</a> or <a href="/settings.html">connect a platform</a> to get started.</p>
        </div>`;
      }
      return;
    }

    // Show filters and Strava logo when there's content
    controls.classList.remove('hidden');
    if (hasStrava || data.activities.some(a => a.platform_links?.strava || a.source_platform === 'strava')) {
      stravaLogo.classList.remove('hidden');
    }

    leaderboard.innerHTML = data.activities.map(renderCard).join('');

    // Initialize maps for activities with polylines
    for (const a of data.activities) {
      if (a.route_polyline) {
        const el = document.getElementById(`map-${a.id}`);
        if (el && typeof L !== 'undefined') {
          const coords = decodePolyline(a.route_polyline);
          if (coords.length > 1) {
            const map = L.map(el, {
              zoomControl: false,
              attributionControl: false,
              dragging: false,
              scrollWheelZoom: false,
              doubleClickZoom: false,
              touchZoom: false,
            });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
              maxZoom: 18,
            }).addTo(map);
            const polyline = L.polyline(coords, { color: '#c9a84c', weight: 3, opacity: 0.9 });
            polyline.addTo(map);
            map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
          }
        }
      }
    }
  } catch (err) {
    leaderboard.innerHTML = '<div class="empty-state"><p>Failed to load. Try again later.</p></div>';
    console.error(err);
  }
}

filterUser.addEventListener('change', loadLeaderboard);
filterSport.addEventListener('change', loadLeaderboard);
sortBy.addEventListener('change', loadLeaderboard);

checkAuth().then(loadLeaderboard);

// Bug report modal
const bugModal = document.getElementById('bug-modal');
const bugLink = document.getElementById('report-bug-link');
const bugSubmit = document.getElementById('bug-submit');
const bugCancel = document.getElementById('bug-cancel');
const bugStatus = document.getElementById('bug-status');

if (bugLink) {
  bugLink.addEventListener('click', (e) => {
    e.preventDefault();
    bugModal.classList.remove('hidden');
  });
}

if (bugCancel) {
  bugCancel.addEventListener('click', () => bugModal.classList.add('hidden'));
}

if (bugModal) {
  bugModal.addEventListener('click', (e) => {
    if (e.target === bugModal) bugModal.classList.add('hidden');
  });
}

if (bugSubmit) {
  bugSubmit.addEventListener('click', async () => {
    const title = document.getElementById('bug-title').value.trim();
    if (!title) {
      bugStatus.innerHTML = '<p style="color: var(--flame);">Please describe the issue.</p>';
      return;
    }
    bugSubmit.disabled = true;
    bugSubmit.textContent = 'Submitting...';
    try {
      const res = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: document.getElementById('bug-description').value.trim(),
          page: window.location.pathname,
        }),
      });
      const data = await res.json();
      if (data.success) {
        bugStatus.innerHTML = `<p style="color: var(--gold);">Thanks! Issue #${data.issueNumber} created.</p>`;
        setTimeout(() => bugModal.classList.add('hidden'), 2000);
      } else {
        bugStatus.innerHTML = `<p style="color: var(--flame);">${data.error || 'Failed to submit.'}</p>`;
      }
    } catch {
      bugStatus.innerHTML = '<p style="color: var(--flame);">Failed to submit. Try again.</p>';
    }
    bugSubmit.disabled = false;
    bugSubmit.textContent = 'Submit';
  });
}
