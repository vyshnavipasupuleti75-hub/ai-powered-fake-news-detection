import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import api from './services/api';
import { Empty, INPUT_LABELS, Skeleton } from './ui';

// Accessible palette: each series is also named in the legend and tooltips, never colour-only.
export const COLORS = { real: '#1f8a6b', fake: '#c0392b', inconclusive: '#6b7689', partial: '#b7791f', blue: '#2f4fd8', violet: '#7c5cd6' };
const AXIS = { fill: '#3d4a63', fontSize: 13 };
// Chart entrance animation is skipped for users who prefer reduced motion.
const ANIMATE = typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Frame({ title, subtitle, children }) {
  return (
    <section className="panel chart-card">
      <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {children}
    </section>
  );
}

export function LabelDonut({ labels }) {
  const data = [
    { name: 'Likely real', value: labels?.LIKELY_REAL || 0, color: COLORS.real },
    { name: 'Likely fake', value: labels?.POTENTIALLY_FAKE || 0, color: COLORS.fake },
    { name: 'Inconclusive', value: (labels?.INCONCLUSIVE || 0) + (labels?.PARTIALLY_TRUE || 0), color: COLORS.inconclusive }
  ];
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <Frame title="Classification distribution" subtitle="Results across your saved analyses">
      {total ? (
        <div className="chart-wrap" role="img" aria-label={`Classification distribution: ${data.map(d => `${d.name} ${d.value}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.filter(d => d.value)} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} isAnimationActive={ANIMATE} animationDuration={800}>
                {data.filter(d => d.value).map(d => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} (${Math.round(v / total * 100)}%)`, n]} />
              <Legend formatter={(name) => `${name}: ${data.find(d => d.name === name)?.value}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty icon={BarChart3} title="No analyses yet" text="Complete a verification to see how your results are distributed." />}
    </Frame>
  );
}

export function InputBar({ inputTypes }) {
  const data = Object.keys(INPUT_LABELS).map(k => ({ name: INPUT_LABELS[k], count: inputTypes?.[k] || 0 }));
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <Frame title="Analyses by input type" subtitle="Text, article URL, image and video">
      {total ? (
        <div className="chart-wrap" role="img" aria-label={`Analyses by input type: ${data.map(d => `${d.name} ${d.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5f0" />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#eef2ff' }} formatter={v => [v, 'Analyses']} />
              <Bar dataKey="count" name="Analyses" fill={COLORS.blue} radius={[6, 6, 0, 0]} barSize={36} isAnimationActive={ANIMATE} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty icon={BarChart3} title="No analyses yet" text="Input-type counts appear after your first analysis." />}
    </Frame>
  );
}

export function TrendBar({ trend, title = 'Analysis activity', subtitle = 'Analyses per day, last 7 days' }) {
  const total = (trend || []).reduce((n, d) => n + d.count, 0);
  return (
    <Frame title={title} subtitle={subtitle}>
      {total ? (
        <div className="chart-wrap" role="img" aria-label="Analyses per day over the last seven days">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5f0" />
              <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#eef2ff' }} formatter={v => [v, 'Analyses']} />
              <Bar dataKey="count" name="Analyses" fill={COLORS.violet} radius={[6, 6, 0, 0]} barSize={30} isAnimationActive={ANIMATE} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty icon={BarChart3} title="No recent activity" text="Your daily activity will appear here." />}
    </Frame>
  );
}

// Reads the saved evaluation from the last real training run. Nothing here is hard-coded.
export function ModelMetrics() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    api.get('/model/metrics').then(r => setState({ data: r.data })).catch(e => setState({ error: e.response?.status === 404 ? 'No evaluation report exists yet. Run ai-engine/scripts/evaluate_model.py.' : e.response?.data?.message || 'The AI service is unavailable, so model metrics could not be loaded.' }));
  }, []);
  if (state.loading) return <Frame title="Model evaluation"><Skeleton height={220} /></Frame>;
  if (state.error) return <Frame title="Model evaluation"><Empty icon={BarChart3} title="Metrics unavailable" text={state.error} /></Frame>;
  const { metrics, meta } = state.data;
  const rows = metrics.labels.map(l => ({ name: l === 'FAKE' ? 'Fake' : 'Real', Precision: +metrics.perClass[l].precision.toFixed(3), Recall: +metrics.perClass[l].recall.toFixed(3), F1: +metrics.perClass[l]['f1-score'].toFixed(3) }));
  return (
    <Frame title="Model evaluation" subtitle={`${meta.modelVersion || 'Model'} · held-out test set of ${metrics.testRows.toLocaleString('en-US')} statements (${meta.dataset || 'dataset'})`}>
      <div className="metric-row">
        <div><b>{(metrics.accuracy * 100).toFixed(1)}%</b><span>Accuracy</span></div>
        <div><b>{(metrics.majorityBaselineAccuracy * 100).toFixed(1)}%</b><span>Majority-class baseline</span></div>
      </div>
      <div className="chart-wrap" role="img" aria-label={`Per-class precision, recall and F1: ${rows.map(r => `${r.name} precision ${r.Precision}, recall ${r.Recall}, F1 ${r.F1}`).join('; ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5f0" />
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 1]} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="Precision" fill={COLORS.blue} radius={[4, 4, 0, 0]} isAnimationActive={ANIMATE} animationDuration={800} />
            <Bar dataKey="Recall" fill={COLORS.violet} radius={[4, 4, 0, 0]} isAnimationActive={ANIMATE} animationDuration={800} />
            <Bar dataKey="F1" fill="#0f766e" radius={[4, 4, 0, 0]} isAnimationActive={ANIMATE} animationDuration={800} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">Confusion matrix (rows = true Fake, Real; columns = predicted Fake, Real): {JSON.stringify(metrics.confusionMatrix)}. Accuracy is on short political statements only and is far from perfect.</p>
    </Frame>
  );
}
