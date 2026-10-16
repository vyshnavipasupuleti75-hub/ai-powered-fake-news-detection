// Shared report sections: extracted text, media coverage, evidence assessment and related sources.
const STATUS_TEXT = {
  SUPPORTED: 'Supported by retrieved fact-checks',
  CONTRADICTED: 'Contradicted by retrieved fact-checks',
  MIXED: 'Mixed fact-check results',
  INCONCLUSIVE: 'Inconclusive — no reliable evidence settled this'
};

function Source({ item }) {
  return (
    <a className="evidence-item" href={item.url} target="_blank" rel="noreferrer noopener">
      <b>{item.title}</b>
      <span>{item.publisher}{item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString()}` : ''}{item.retrievedAt ? ` · retrieved ${new Date(item.retrievedAt).toLocaleString()}` : ''}</span>
      {item.excerpt && <p className="evidence-excerpt">{item.excerpt}</p>}
      <small>{item.url}</small>
    </a>
  );
}

export function MediaSummary({ v }) {
  const m = v.media;
  if (!m) return null;
  return (
    <section className="report-block">
      <h3>{m.kind === 'video' ? 'Video processing' : 'Image processing'}</h3>
      <ul>
        <li>OCR engine: {m.ocrEngine} · {m.ocrLineCount} text line(s) read</li>
        {m.kind === 'image' && <li>Dimensions: {m.width}×{m.height}px</li>}
        {m.kind === 'video' && <li>Frames analyzed: {m.framesAnalyzed} of {m.framesRequested} sampled · duration {m.durationSeconds}s{m.timedOut ? ' · hit the time limit' : ''}</li>}
        {m.kind === 'video' && <li>Speech transcription: {m.transcript?.status === 'completed' ? `completed (${m.transcript.model}${m.transcript.language ? `, ${m.transcript.language}` : ''})` : `not available${m.transcript?.reason ? ` — ${m.transcript.reason}` : ''}`}</li>}
      </ul>
      {m.transcript?.status === 'completed' && <div className="segments"><h4>Speech transcript (automatic, may contain errors)</h4><p>{m.transcript.text}</p></div>}
      {m.segments?.length > 0 && (
        <div className="segments">
          <h4>Extracted text{m.kind === 'video' ? ' by timestamp' : ''}</h4>
          {m.segments.map((s, i) => <p key={i}>{s.timestampSeconds != null && <span className="ts">{s.timestampSeconds}s</span>}{s.text}</p>)}
        </div>
      )}
    </section>
  );
}

export function EvidenceSections({ v }) {
  const a = v.evidenceAssessment;
  return (
    <>
      {a && (
        <section className="report-block">
          <h3>Evidence assessment</h3>
          <p><b>{STATUS_TEXT[a.status] || a.status}</b></p>
          {a.note && <p className="muted">{a.note}</p>}
        </section>
      )}
      <section className="report-block"><h3>Supporting evidence</h3>{v.supportingEvidence?.length ? v.supportingEvidence.map((e, i) => <Source key={i} item={e} />) : <p className="muted">No supporting evidence was retrieved.</p>}</section>
      <section className="report-block"><h3>Contradictory evidence</h3>{v.contradictoryEvidence?.length ? v.contradictoryEvidence.map((e, i) => <Source key={i} item={e} />) : <p className="muted">No contradictory evidence was retrieved.</p>}</section>
      {v.relatedSources?.length > 0 && (
        <section className="report-block"><h3>Related background (not evidence for or against the claim)</h3>{v.relatedSources.map((e, i) => <Source key={i} item={e} />)}</section>
      )}
    </>
  );
}
