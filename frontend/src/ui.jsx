// Small shared presentational pieces (kept out of App.jsx to avoid circular imports).
export const PRODUCT_NAME = 'AI-Powered Fake News Detection & Verification System';

export function PageTitle({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-title">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon, title, text }) {
  return <div className="empty-state"><span><Icon size={24} /></span><b>{title}</b><p>{text}</p></div>;
}

const LABELS = {
  LIKELY_REAL: ['Likely real', 'green'],
  POTENTIALLY_FAKE: ['Likely fake', 'red'],
  PARTIALLY_TRUE: ['Partially true', 'amber'],
  INCONCLUSIVE: ['Inconclusive', 'gray']
};
export const labelText = key => (LABELS[key] || LABELS.INCONCLUSIVE)[0];

export function Prediction({ label }) {
  const [text, color] = LABELS[label] || LABELS.INCONCLUSIVE;
  return <span className={`prediction ${color}`}><i />{text}</span>;
}

export function Skeleton({ height = 18, width = '100%', style }) {
  return <span className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export const INPUT_LABELS = { text: 'Text', url: 'URL', image: 'Image', video: 'Video' };
