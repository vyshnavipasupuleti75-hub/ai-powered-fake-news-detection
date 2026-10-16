const { evidenceApiKey } = require('../config/env');

const TIMEOUT_MS = 7000;
const USER_AGENT = 'AI-FakeNews-Verification-System/1.0 (academic project)';

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function searchQuery(text) {
  return text.replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 24).join(' ');
}

const stripHtml = value => String(value || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();

// Wikipedia pages are background context only. They are never labelled as supporting or contradicting a claim.
async function wikipediaContext(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&srprop=snippet%7Ctimestamp&format=json&origin=*`;
  const data = await getJson(url);
  const retrievedAt = new Date();
  return (data?.query?.search || []).map(item => ({
    title: item.title, publisher: 'Wikipedia (en.wikipedia.org)',
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
    publishedAt: item.timestamp ? new Date(item.timestamp) : undefined,
    excerpt: stripHtml(item.snippet).slice(0, 400), retrievedAt
  }));
}

function ratingDirection(rating) {
  const r = String(rating || '').toLowerCase();
  if (/half|mixed|partly|partially|mixture|unproven|unverified|needs context|misleading context/.test(r)) return 'mixed';
  if (/false|fake|incorrect|pants|wrong|misleading|hoax|fabricated|inaccurate/.test(r)) return 'contradicted';
  if (/true|correct|accurate|right|genuine/.test(r)) return 'supported';
  return 'mixed';
}

// Published fact-checks from Google's Fact Check Tools API (requires EVIDENCE_API_KEY).
async function factChecks(query) {
  const data = await getJson(`https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(query)}&languageCode=en&pageSize=5&key=${encodeURIComponent(evidenceApiKey)}`);
  const retrievedAt = new Date();
  const out = [];
  for (const claim of data.claims || []) {
    for (const review of claim.claimReview || []) {
      if (!review.url) continue;
      out.push({
        direction: ratingDirection(review.textualRating),
        item: { title: review.title || claim.text || 'Fact check', publisher: review.publisher?.name || review.publisher?.site || 'Unknown publisher', url: review.url,
          publishedAt: review.reviewDate ? new Date(review.reviewDate) : undefined,
          excerpt: `Claim reviewed: "${String(claim.text || '').slice(0, 200)}" — Rating: ${review.textualRating || 'n/a'}`, rating: review.textualRating || '', retrievedAt }
      });
    }
  }
  return out;
}

// Returns an honest evidence assessment: INCONCLUSIVE unless a published fact-check was actually retrieved.
async function gatherEvidence(text) {
  const query = searchQuery(text);
  const result = { factChecked: false, supportingEvidence: [], contradictoryEvidence: [], relatedSources: [], evidenceAssessment: { status: 'INCONCLUSIVE', note: '', retrievedAt: new Date() }, limitations: [] };
  if (query.length < 10) { result.evidenceAssessment.note = 'There was too little text to search for evidence.'; return result; }
  const notes = [];
  try { result.relatedSources = await wikipediaContext(query); }
  catch { result.limitations.push('Background lookup (Wikipedia) was unavailable.'); }
  if (evidenceApiKey) {
    try {
      const checks = await factChecks(query);
      result.factChecked = true;
      for (const { direction, item } of checks) (direction === 'supported' ? result.supportingEvidence : direction === 'contradicted' ? result.contradictoryEvidence : result.relatedSources).push(item);
      if (!checks.length) notes.push('No published fact-check matched this text.');
      const s = result.supportingEvidence.length, c = result.contradictoryEvidence.length;
      if (s && !c) result.evidenceAssessment.status = 'SUPPORTED';
      else if (c && !s) result.evidenceAssessment.status = 'CONTRADICTED';
      else if (s && c) result.evidenceAssessment.status = 'MIXED';
      if (s || c) notes.push('Fact-checks were matched to this text by search; confirm that each reviewed claim is the same claim.');
    } catch { result.limitations.push('The fact-check lookup failed, so no fact-check evidence was retrieved.'); }
  } else {
    result.limitations.push('No fact-check API key is configured (EVIDENCE_API_KEY), so published fact-checks were not searched.');
  }
  if (result.evidenceAssessment.status === 'INCONCLUSIVE') notes.push('No reliable evidence was found that settles this claim. Related pages are background context only.');
  result.evidenceAssessment.note = notes.join(' ');
  result.evidenceAssessment.retrievedAt = new Date();
  return result;
}

module.exports = { gatherEvidence, ratingDirection, searchQuery };
