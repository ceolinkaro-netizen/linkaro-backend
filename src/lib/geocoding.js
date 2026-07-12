const env = require("../config/env");

// Google Geocoding API — tolerant of informal/local addressing (house
// numbers, sector/markaz names) the way the mobile app's native OS
// geocoders are, unlike the free OSM/Nominatim geocoder this replaced.
async function geocodeAddress(street, city, countryName, countryCode, state) {
  if (!env.googleMapsApiKey) {
    console.warn("GOOGLE_MAPS_API_KEY not configured; skipping geocoding");
    return null;
  }

  const country = countryName || "Pakistan";
  const code = countryCode || "PK";
  const statePart = state ? `, ${state}` : "";
  const address = encodeURIComponent(`${street}, ${city}${statePart}, ${country}`);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&components=country:${code}&key=${env.googleMapsApiKey}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK" || !data.results?.length) {
    console.error("Google Geocoding API error:", data.status, data.error_message);
    return null;
  }

  const { lat, lng } = data.results[0].geometry.location;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { latitude: lat, longitude: lng };
}

// Kept for backwards compatibility with any callers that haven't been updated yet.
async function geocodeAddressPakistan(street, city) {
  return geocodeAddress(street, city, "Pakistan", "PK");
}

module.exports = { geocodeAddress, geocodeAddressPakistan };
