const env = require("../config/env");

// Mirrors the mobile app's location resolution (lib/screens/service_provider/
// service_provider_edit_profile_screen.dart): geocode "{street}, {city},
// Pakistan" and discard the result unless it falls within Pakistan's
// bounding box (lib/constants/pakistan_cities.dart's isWithinPakistan),
// guarding against a same-named place resolving abroad.
function isWithinPakistan(lat, lng) {
  return lat >= 23.5 && lat <= 37.5 && lng >= 60.5 && lng <= 77.5;
}

// Google Geocoding API — tolerant of informal/local addressing (house
// numbers, sector/markaz names) the way the mobile app's native OS
// geocoders are, unlike the free OSM/Nominatim geocoder this replaced
// (which failed outright on queries like "street 45, markaz, Rawalpindi").
async function geocodeAddressPakistan(street, city) {
  if (!env.googleMapsApiKey) {
    console.warn("GOOGLE_MAPS_API_KEY not configured; skipping geocoding");
    return null;
  }

  const address = encodeURIComponent(`${street}, ${city}, Pakistan`);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&components=country:PK&key=${env.googleMapsApiKey}`;

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
  if (!isWithinPakistan(lat, lng)) return null;

  return { latitude: lat, longitude: lng };
}

module.exports = { geocodeAddressPakistan, isWithinPakistan };
