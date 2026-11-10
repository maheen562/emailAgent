// The same job often appears in LinkedIn, Indeed and Rozee alerts with small
// differences ("Python Intern (Remote)" vs "python intern"). Jobs with the same
// key are stored once.

const NOISE = /\((remote|hybrid|on-?site|onsite|urgent|immediate joining)\)/gi;
const COMPANY_SUFFIX = /\b(pvt|private|ltd|limited|llc|inc|co|corp|corporation|smc)\b/g;

export function normalize(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(NOISE, ' ')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCompany(company) {
  return normalize(company).replace(COMPANY_SUFFIX, ' ').trim().replace(/\s+/g, ' ');
}

// Company + title identifies a job across boards. Locations are written too
// differently between boards to be reliable, so they're only used when the
// company is unknown.
export function dedupeKey(job) {
  const company = normalizeCompany(job.company);
  const title = normalize(job.title);
  return company ? `${company}|${title}` : `?|${title}|${normalize(job.location)}`;
}
