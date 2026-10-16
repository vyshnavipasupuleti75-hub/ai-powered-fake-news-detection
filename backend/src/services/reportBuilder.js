// Builds the human-readable summary, disagreement handling and next steps from ACTUAL model/evidence output.
const LABEL = { LIKELY_REAL: 'Likely real', POTENTIALLY_FAKE: 'Likely fake', PARTIALLY_TRUE: 'Partially true', INCONCLUSIVE: 'Inconclusive' };
const INPUT = { text: 'text submission', url: 'article', image: 'image', video: 'video' };

// If external evidence points the opposite way from the classifier, the result is not trusted: mark for review.
function reconcile(classification, evidence) {
  const status = evidence?.evidenceAssessment?.status;
  const p = classification.prediction;
  const clash = (p === 'LIKELY_REAL' && status === 'CONTRADICTED') || (p === 'POTENTIALLY_FAKE' && status === 'SUPPORTED');
  if (!clash) return { prediction: p, reviewNeeded: p !== 'INCONCLUSIVE' && status === 'MIXED', modelPrediction: p, disagreement: '' };
  return {
    prediction: 'INCONCLUSIVE', reviewNeeded: true, modelPrediction: p,
    disagreement: `The classifier said "${LABEL[p]}" but retrieved fact-checks point the other way (${status.toLowerCase()}). The result is marked inconclusive and needs human review.`
  };
}

function summarize({ inputType, text, prediction, modelPrediction, confidence, evidenceAssessment, supportingEvidence, contradictoryEvidence, relatedSources, disagreement, media, modelVersion }) {
  const parts = [];
  const chars = text.length;
  const classified = chars >= 20;
  if (inputType === 'image' || inputType === 'video') {
    parts.push(chars ? `Text was extracted from the ${inputType} (${chars.toLocaleString('en-US')} characters).` : `No usable text was extracted from the ${inputType}, so nothing was classified.`);
  } else parts.push(`Analyzed a ${INPUT[inputType]} of ${chars.toLocaleString('en-US')} characters.`);
  if (classified) {
    parts.push(`Quoted start: “${text.replace(/\s+/g, ' ').slice(0, 110)}${chars > 110 ? '…' : ''}”.`);
    if (modelPrediction === 'INCONCLUSIVE' && confidence != null) parts.push(`The classifier (${modelVersion}) was not confident enough to give a label (top score ${Math.round(confidence * 100)}%).`);
    else if (confidence != null) parts.push(`The classifier (${modelVersion}) labeled the wording "${LABEL[modelPrediction]}" with a model score of ${Math.round(confidence * 100)}%. This reflects how closely the wording matches patterns in its training data, not whether the claim is true.`);
    else parts.push('No classifier result was available, so no label was produced.');
  }
  const nFact = supportingEvidence.length + contradictoryEvidence.length;
  if (classified) {
    if (nFact) parts.push(`Evidence: ${nFact} published fact-check(s) were retrieved (${supportingEvidence.length} supporting, ${contradictoryEvidence.length} contradicting); overall ${evidenceAssessment.status.toLowerCase()}.`);
    else parts.push(`Evidence: no published fact-check was retrieved, so the claim was not independently verified${relatedSources.length ? `; ${relatedSources.length} background page(s) are listed for context only` : ''}.`);
  }
  if (disagreement) parts.push(disagreement);
  if (media?.kind === 'video') parts.push(`Video coverage: ${media.framesAnalyzed} sampled frame(s) read with OCR; speech transcript ${media.transcript?.status === 'completed' ? 'available' : 'not available'}.`);
  parts.push(`Final result: ${LABEL[prediction]}.`);
  return parts.join(' ');
}

function nextSteps({ inputType, prediction, supportingEvidence, contradictoryEvidence, media, reviewNeeded }) {
  const steps = [];
  if (!supportingEvidence.length && !contradictoryEvidence.length) steps.push('Search the claim in independent fact-checking databases and reputable news outlets; none were matched automatically.');
  if (reviewNeeded) steps.push('Review the retrieved fact-checks yourself and confirm they concern the same claim.');
  if (inputType === 'url') steps.push('Check who publishes the article, who wrote it, and whether it cites primary sources.');
  if (inputType === 'image') steps.push('Run a reverse image search to find where the image first appeared; this system does not check images for manipulation.');
  if (inputType === 'video') {
    steps.push('Find the original upload and compare it with this copy; only sampled frames were read and no visual authenticity check exists.');
    if (media?.transcript?.status !== 'completed') steps.push('Listen to the audio yourself; it was not transcribed for this report.');
  }
  if (prediction === 'INCONCLUSIVE') steps.push('Treat the claim as unverified until a reliable source confirms or refutes it.');
  steps.push('Open the primary sources linked in this report before sharing the claim.');
  return steps;
}

module.exports = { reconcile, summarize, nextSteps, LABEL };
