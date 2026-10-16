import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, CircleHelp, Copy, FileText, ShieldCheck } from 'lucide-react';
import api from './services/api';
import { INPUT_LABELS, PageTitle, PRODUCT_NAME, Prediction, Skeleton } from './ui';
import { EvidenceSections, MediaSummary } from './ReportDetails';

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text; document.body.appendChild(area); area.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(area); }
  return Promise.resolve();
}

const CAP_STYLE = { used: 'cap-used', unavailable: 'cap-off', skipped: 'cap-off', 'no text found': 'cap-off' };

export function ReportBody({ v }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await copyText(`${PRODUCT_NAME}\nReport ${v._id}\n\n${v.summary}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  return (
    <>
      <div className="report-label-row"><span>REPORT ID · {v._id}</span><Prediction label={v.prediction} /></div>
      <h2>{v.headline || 'Submitted claim'}</h2>
      <p className="report-meta-line">{INPUT_LABELS[v.inputType]} analysis · {new Date(v.createdAt).toLocaleString()} · status: {v.processingStatus}{v.processingMs ? ` · ${(v.processingMs / 1000).toFixed(1)}s` : ''}</p>
      {v.submittedUrl && <p className="report-meta-line">Source: <a href={v.submittedUrl} target="_blank" rel="noreferrer noopener">{v.submittedUrl}</a></p>}

      {v.disagreement && <div className="alert-banner" role="alert"><AlertTriangle size={22} /><div><b>Needs human review</b><span>{v.disagreement}</span></div></div>}

      <section className="report-block summary-block">
        <div className="block-head"><h3>Summary</h3><button type="button" className="button button-outline copy-btn" onClick={copy}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy summary</>}</button></div>
        <p>{v.summary || v.explanation}</p>
      </section>

      <section className="report-block">
        <h3>Model classification</h3>
        <p>{v.explanation}</p>
        <div className="kv">
          <span>Model</span><b>{v.modelVersion || 'Unavailable'}</b>
          <span>Model score</span><b>{v.confidence != null ? `${Math.round(v.confidence * 100)}%` : 'Not available'}</b>
          {v.modelPrediction && v.modelPrediction !== v.prediction && <><span>Raw model label</span><b><Prediction label={v.modelPrediction} /></b></>}
        </div>
        <p className="muted small">The score is the model's confidence in a wording pattern. It is not calibrated and is not the probability that the claim is true.</p>
      </section>

      <section className="report-block">
        <h3>{v.inputType === 'image' || v.inputType === 'video' ? 'Extracted text analyzed' : 'Text analyzed'}</h3>
        <blockquote>{v.submittedText || 'No readable text was extracted.'}</blockquote>
      </section>

      <MediaSummary v={v} />
      <EvidenceSections v={v} />

      {v.capabilities?.length > 0 && (
        <section className="report-block">
          <h3>What this analysis did and did not do</h3>
          <ul className="cap-list">{v.capabilities.map(c => <li key={c.name}><span className={`cap-pill ${CAP_STYLE[c.status] || 'cap-off'}`}>{c.status}</span><b>{c.name}</b><small>{c.note}</small></li>)}</ul>
        </section>
      )}

      <section className="report-block"><h3>Limitations</h3><ul>{v.limitations?.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
      {v.nextSteps?.length > 0 && <section className="report-block"><h3>Recommended next steps</h3><ol>{v.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ol></section>}
    </>
  );
}

export function Report() {
  const { id } = useParams();
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/verify/${id}`).then(r => setV(r.data.verification)).catch(e => setError(e.response?.data?.message || 'Report unavailable.')); }, [id]);
  return (
    <>
      <PageTitle eyebrow="VERIFICATION REPORT" title="Analysis report" subtitle={v ? `Created ${new Date(v.createdAt).toLocaleString()}` : 'Loading your report…'} action={<button className="button button-outline" onClick={() => window.print()}><FileText size={17} /> Print / save as PDF</button>} />
      {error ? <div className="notice">{error}</div> : !v ? <div className="panel"><Skeleton height={26} width="60%" /><Skeleton height={120} style={{ marginTop: 18 }} /></div> : (
        <div className="report-layout">
          <section className="panel report-content"><ReportBody v={v} />
            <div className="report-actions"><Link to="/verify" className="button">Verify another claim <ArrowRight size={17} /></Link><Link to="/history" className="text-link">Return to history</Link></div>
          </section>
          <aside className="aside-card"><span className="aside-icon"><ShieldCheck size={20} /></span><h3>Use this report carefully</h3><p>This report supports further research. It is not a substitute for reviewing primary sources.</p></aside>
        </div>
      )}
    </>
  );
}
