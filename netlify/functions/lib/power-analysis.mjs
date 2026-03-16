// Power analysis module — computes best efforts and detects intervals
// from per-second power data (from FIT files or Strava streams).

const BEST_EFFORT_DURATIONS = [
  { key: '5s', seconds: 5, label: '5 sec' },
  { key: '15s', seconds: 15, label: '15 sec' },
  { key: '30s', seconds: 30, label: '30 sec' },
  { key: '1min', seconds: 60, label: '1 min' },
  { key: '3min', seconds: 180, label: '3 min' },
  { key: '5min', seconds: 300, label: '5 min' },
  { key: '8min', seconds: 480, label: '8 min' },
  { key: '10min', seconds: 600, label: '10 min' },
  { key: '15min', seconds: 900, label: '15 min' },
  { key: '20min', seconds: 1200, label: '20 min' },
  { key: '30min', seconds: 1800, label: '30 min' },
  { key: '45min', seconds: 2700, label: '45 min' },
  { key: '60min', seconds: 3600, label: '60 min' },
  { key: '90min', seconds: 5400, label: '90 min' },
];

// Compute best (max average) power for each duration using a sliding window.
// Input: array of per-second power values (index = second)
// Returns: { '15s': 850, '30s': 720, '1min': 520, ... }
export function computeBestEfforts(powerData) {
  if (!powerData?.length) return null;

  const efforts = {};

  for (const { key, seconds } of BEST_EFFORT_DURATIONS) {
    if (powerData.length < seconds) continue;

    let maxAvg = 0;
    let windowSum = 0;

    for (let i = 0; i < powerData.length; i++) {
      windowSum += powerData[i] || 0;
      if (i >= seconds) windowSum -= powerData[i - seconds] || 0;
      if (i >= seconds - 1) {
        const avg = windowSum / seconds;
        if (avg > maxAvg) maxAvg = avg;
      }
    }

    efforts[key] = Math.round(maxAvg);
  }

  return Object.keys(efforts).length > 0 ? efforts : null;
}

// Compute Normalized Power (NP) from per-second power data.
// NP = 4th root of (average of (30s rolling avg power)^4)
export function computeNormalizedPower(powerData) {
  if (!powerData?.length || powerData.length < 30) return null;

  // 30-second rolling average
  const rollingAvg = [];
  let windowSum = 0;
  for (let i = 0; i < powerData.length; i++) {
    windowSum += powerData[i] || 0;
    if (i >= 30) windowSum -= powerData[i - 30] || 0;
    if (i >= 29) {
      rollingAvg.push(windowSum / 30);
    }
  }

  // Raise to 4th power, average, then 4th root
  const avg4th = rollingAvg.reduce((sum, v) => sum + Math.pow(v, 4), 0) / rollingAvg.length;
  return Math.round(Math.pow(avg4th, 0.25));
}

// Compute Intensity Factor (IF) = NP / FTP
export function computeIntensityFactor(np, ftp) {
  if (!np || !ftp) return null;
  return parseFloat((np / ftp).toFixed(2));
}

// Compute Training Stress Score (TSS) = (duration_s * NP * IF) / (FTP * 3600) * 100
export function computeTSS(durationSeconds, np, ftp) {
  if (!durationSeconds || !np || !ftp) return null;
  const ifactor = np / ftp;
  return Math.round((durationSeconds * np * ifactor) / (ftp * 3600) * 100);
}

// Compute Variability Index (VI) = NP / average power
// High VI (>1.05) = surgy/uneven effort
// Low VI (~1.0) = steady/time trial style
export function computeVariabilityIndex(np, avgPower) {
  if (!np || !avgPower) return null;
  return parseFloat((np / avgPower).toFixed(2));
}

// Detect intervals — periods of sustained high power followed by recovery.
// An interval is: power > threshold for >= minDuration seconds, separated by
// recovery periods where power drops below threshold.
export function detectIntervals(powerData, ftp) {
  if (!powerData?.length || !ftp) return null;

  const threshold = ftp * 0.85; // 85% of FTP = tempo/threshold boundary
  const minDuration = 30; // Minimum 30 seconds to count as an interval
  const minRecovery = 15; // Minimum 15 seconds between intervals

  const intervals = [];
  let inInterval = false;
  let intervalStart = 0;
  let intervalPowerSum = 0;
  let intervalMaxPower = 0;
  let recoveryCount = 0;

  for (let i = 0; i < powerData.length; i++) {
    const power = powerData[i] || 0;

    if (power >= threshold) {
      if (!inInterval) {
        inInterval = true;
        intervalStart = i;
        intervalPowerSum = 0;
        intervalMaxPower = 0;
      }
      intervalPowerSum += power;
      if (power > intervalMaxPower) intervalMaxPower = power;
      recoveryCount = 0;
    } else if (inInterval) {
      recoveryCount++;
      if (recoveryCount >= minRecovery) {
        // End of interval
        const duration = i - recoveryCount - intervalStart;
        if (duration >= minDuration) {
          intervals.push({
            start: intervalStart,
            duration,
            avg_power: Math.round(intervalPowerSum / duration),
            max_power: intervalMaxPower,
            pct_ftp: Math.round((intervalPowerSum / duration / ftp) * 100),
          });
        }
        inInterval = false;
      }
    }
  }

  // Close any open interval
  if (inInterval) {
    const duration = powerData.length - intervalStart;
    if (duration >= minDuration) {
      intervals.push({
        start: intervalStart,
        duration,
        avg_power: Math.round(intervalPowerSum / duration),
        max_power: intervalMaxPower,
        pct_ftp: Math.round((intervalPowerSum / duration / ftp) * 100),
      });
    }
  }

  // Only return if it looks like a structured workout (3+ intervals)
  return intervals.length >= 3 ? intervals : null;
}

// Run full power analysis on per-second power data.
// Returns an enrichment object to store on the activity.
export function analyzePower(powerData, ftp, avgPower) {
  const bestEfforts = computeBestEfforts(powerData);
  const np = computeNormalizedPower(powerData);
  const vi = computeVariabilityIndex(np, avgPower);
  const ifactor = computeIntensityFactor(np, ftp);
  const tss = computeTSS(powerData.length, np, ftp);
  const intervals = detectIntervals(powerData, ftp);

  return {
    best_efforts: bestEfforts,
    normalized_power: np,
    variability_index: vi,
    intensity_factor: ifactor,
    tss,
    intervals,
  };
}
