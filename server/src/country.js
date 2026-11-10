// Every job gets a country so it can be filtered by it. The LLM supplies one
// for new jobs; when it doesn't (or for jobs stored before the field existed),
// it's worked out from well-known city and state names in the location.

const ALIASES = {
  pk: 'Pakistan',
  pakistan: 'Pakistan',
  au: 'Australia',
  australia: 'Australia',
  worldwide: 'Worldwide',
  anywhere: 'Worldwide',
  global: 'Worldwide',
};

// Matched as whole words, case-insensitive.
const PLACES = {
  Pakistan: [
    'pakistan', 'islamabad', 'rawalpindi', 'lahore', 'karachi', 'peshawar', 'faisalabad',
    'multan', 'quetta', 'sialkot', 'gujranwala', 'abbottabad', 'bahawalpur', 'sargodha',
  ],
  Australia: [
    'australia', 'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'canberra', 'hobart',
    'darwin', 'gold coast', 'geelong', 'vic', 'nsw', 'qld', 'act', 'tas',
  ],
};

const PATTERNS = Object.entries(PLACES).map(([country, places]) => [
  country,
  new RegExp(`\\b(${places.map((p) => p.replace(/ /g, '\\s+')).join('|')})\\b`, 'i'),
]);

// "pakistan" / "PK" -> "Pakistan"; anything else is returned in title case.
export function canonicalCountry(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed || /^(null|unknown|n\/a)$/i.test(trimmed)) return null;
  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function guessCountry(location) {
  if (!location) return null;
  for (const [country, pattern] of PATTERNS) {
    if (pattern.test(location)) return country;
  }
  return null;
}

export function resolveCountry(job) {
  return canonicalCountry(job.country) ?? guessCountry(job.location);
}
