// Google Encoded Polyline encoder/decoder
// Used for compact storage of GPS tracks

export function encode(coordinates) {
  if (!coordinates?.length) return null;

  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coordinates) {
    output += encodeValue(Math.round(lat * 1e5) - prevLat);
    output += encodeValue(Math.round(lng * 1e5) - prevLng);
    prevLat = Math.round(lat * 1e5);
    prevLng = Math.round(lng * 1e5);
  }

  return output;
}

export function decode(encoded) {
  if (!encoded) return [];

  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coords.push([lat / 1e5, lng / 1e5]);
  }

  return coords;
}

function encodeValue(value) {
  value = value < 0 ? ~(value << 1) : (value << 1);
  let encoded = '';
  while (value >= 0x20) {
    encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  encoded += String.fromCharCode(value + 63);
  return encoded;
}

// Simplify a coordinate array using Douglas-Peucker to reduce polyline size.
// Keeps the shape but reduces point count.
export function simplify(coords, tolerance = 0.00005) {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let maxIdx = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDist(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplify(coords.slice(0, maxIdx + 1), tolerance);
    const right = simplify(coords.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function perpendicularDist(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  }
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.sqrt(dx ** 2 + dy ** 2);
}
