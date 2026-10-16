import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, BadgeCheck, CircleHelp, Clock3, FileText, Search, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import api from './services/api';
import { Empty, INPUT_LABELS, PageTitle, PRODUCT_NAME, Prediction, Skeleton } from './ui';
import { InputBar, LabelDonut, ModelMetrics, TrendBar } from './Charts';

function useStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(e => setError(e.response?.data?.message || 'Sign in to load your workspace data.'));
  }, []);
  return { stats, error };
}

function StatCards({ stats, cards }) {
  return (
    <div className="stats-grid">
      {cards.map(([label, value, Icon]) => (
        <div className="stat-card" key={label}>
          <div className="stat-top"><span>{label}</span><Icon size={20} /></div>
          {stats ? <b>{value}</b> : <Skeleton height={34} width={70} style={{ margin: '14px 0 8px' }} />}
          <small>{stats ? 'From your saved analyses' : 'Loading…'}</small>
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ user }) {
  const { stats, error } = useStats();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const l = stats?.labels || {};
  return (
    <>
      <div className="product-banner">
        <span className="eyebrow">WORKSPACE</span>
        <h2>{PRODUCT_NAME}</h2>
        <p>Check text claims, article links, images and videos. Every result keeps the classifier, the evidence and the limitations separate.</p>
      </div>
      <PageTitle eyebrow="OVERVIEW" title={`Good ${greeting}${user?.name ? `, ${user.name.split(' ')[0]}` : ''}.`} subtitle="A live view of your saved analyses." action={<Link className="button" to="/verify"><Search size={18} /> Verify a claim</Link>} />
      {error && <div className="notice"><Shield size={19} />{error}</div>}
      <StatCards stats={stats} cards={[
        ['Total analyses', stats?.total ?? 0, FileText],
        ['Likely real', l.LIKELY_REAL || 0, BadgeCheck],
        ['Likely fake', l.POTENTIALLY_FAKE || 0, ShieldAlert],
        ['Inconclusive', (l.INCONCLUSIVE || 0) + (l.PARTIALLY_TRUE || 0), CircleHelp]
      ]} />
      <div className="stats-grid input-counts">
        {Object.entries(INPUT_LABELS).map(([k, label]) => (
          <div className="stat-card compact" key={k}><div className="stat-top"><span>{label} analyses</span></div>{stats ? <b>{stats.inputTypes?.[k] || 0}</b> : <Skeleton height={28} width={50} style={{ marginTop: 10 }} />}</div>
        ))}
      </div>
      <div className="dashboard-grid">
        <TrendBar trend={stats?.trend} />
        <LabelDonut labels={stats?.labels} />
      </div>
      <div className="dashboard-grid">
        <InputBar inputTypes={stats?.inputTypes} />
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recent analyses</h2><p>Latest results and their status</p></div><Link to="/history" className="panel-link">View all <ArrowRight size={16} /></Link></div>
          {!stats ? <Skeleton height={150} /> : stats.recent?.length ? stats.recent.map(v => (
            <Link className="recent-item" key={v._id} to={`/reports/${v._id}`}>
              <span className="recent-file"><FileText size={19} /></span>
              <span className="recent-copy"><b>{v.headline || v.submittedText?.slice(0, 45) || 'Analysis'}</b><small>{INPUT_LABELS[v.inputType]} · {new Date(v.createdAt).toLocaleDateString()} · {v.processingStatus || 'completed'}</small></span>
              <Prediction label={v.prediction} />
            </Link>
          )) : <Empty icon={Clock3} title="No analyses yet" text="Start with a claim you are curious about." />}
        </section>
      </div>
      <ModelMetrics />
      <div className="responsible-note"><ShieldCheck size={22} /><div><b>AI is a research aid, not a verdict.</b><span>The classifier looks at wording only. Its score is not the probability that a claim is true.</span></div><Link to="/verify">Start a review <ArrowRight size={16} /></Link></div>
    </>
  );
}

export function Analytics() {
  const { stats, error } = useStats();
  return (
    <>
      <PageTitle eyebrow="YOUR RESEARCH PATTERNS" title="Analytics" subtitle="Charts are computed from your stored analyses and the saved model evaluation, not from sample data." />
      {error && <div className="notice">{error}</div>}
      <StatCards stats={stats} cards={[
        ['Total analyses', stats?.total ?? 0, Activity],
        ['This month', stats?.thisMonth ?? 0, Clock3],
        ['With fact-check evidence', stats?.withEvidence ?? 0, ShieldCheck],
        ['Needing human review', stats?.reviewNeeded ?? 0, ShieldAlert]
      ]} />
      <div className="dashboard-grid">
        <LabelDonut labels={stats?.labels} />
        <InputBar inputTypes={stats?.inputTypes} />
      </div>
      <TrendBar trend={stats?.trend} title="Checks over time" subtitle="Daily activity, last 7 days" />
      <ModelMetrics />
    </>
  );
}
