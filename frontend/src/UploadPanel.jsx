import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Image as ImageIcon, Loader2, ShieldCheck, Upload, Video as VideoIcon, X } from 'lucide-react';
import api from './services/api';

const CONFIG = {
  image: { accept: 'image/jpeg,image/png,image/webp', types: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 8, label: 'JPEG, PNG or WEBP', Icon: ImageIcon, hint: 'Text in the image is read with OCR and then analyzed. The image itself is not checked for manipulation.', stages: ['Uploading', 'Extracting Text (OCR)', 'Analyzing Claims', 'Checking Evidence', 'Preparing Report'] },
  video: { accept: 'video/mp4,video/quicktime', types: ['video/mp4', 'video/quicktime'], maxMB: 50, label: 'MP4 or MOV', Icon: VideoIcon, hint: 'Up to 8 frames are sampled across the video and read with OCR, and speech is transcribed when the speech model is available. The full video is not reviewed.', stages: ['Uploading', 'Extracting Frames, Text and Speech', 'Analyzing Claims', 'Checking Evidence', 'Preparing Report'] }
};
const formatSize = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reports whether the FastAPI media service is running so the user sees an actionable warning before uploading.
function useMediaService() {
  const [state, setState] = useState({ checked: false, ok: true });
  useEffect(() => {
    let live = true;
    api.get('/model/health').then(r => live && setState({ checked: true, ok: true, caps: r.data.capabilities })).catch(e => live && setState({ checked: true, ok: false, message: e.response?.data?.message || 'The AI media-processing service could not be checked.' }));
    return () => { live = false; };
  }, []);
  return state;
}

export default function UploadPanel({ kind, onResult }) {
  const cfg = CONFIG[kind];
  const service = useMediaService();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { clear(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  function clear() {
    setFile(null); setPreview(''); setProgress(0); setPhase('idle'); setStageIndex(0); setError('');
    if (input.current) input.current.value = '';
  }
  function choose(picked) {
    setError('');
    if (!picked) return;
    if (!cfg.types.includes(picked.type)) return setError(`Unsupported file type. Choose a ${cfg.label} file.`);
    if (picked.size > cfg.maxMB * 1048576) return setError(`That file is ${formatSize(picked.size)}. The limit is ${cfg.maxMB} MB.`);
    if (picked.size === 0) return setError('That file is empty.');
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }
  async function submit(e) {
    e.preventDefault();
    if (!file || phase !== 'idle') return;
    setError(''); setProgress(0); setStageIndex(0); setPhase('uploading');
    const form = new FormData();
    form.append('file', file);
    try {
      const { data: job } = await api.post(`/verify/${kind}`, form, {
        timeout: 0,
        onUploadProgress: ev => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : 0)
      });
      setPhase('processing'); setStageIndex(1);
      // The backend analyzes in the background; poll until the saved report is ready.
      for (let i = 0; i < 400; i++) {
        await sleep(1500);
        const { data: state } = await api.get(`/verify/jobs/${job.jobId}`);
        setStageIndex(Math.max(1, state.stageIndex));
        if (state.status === 'failed') throw Object.assign(new Error(state.error || 'The analysis failed.'), { fromJob: true });
        if (state.status === 'completed') {
          const { data } = await api.get(`/verify/${state.reportId}`);
          onResult(data.verification);
          clear();
          return;
        }
      }
      throw Object.assign(new Error('The analysis is taking too long. Check the history page later.'), { fromJob: true });
    } catch (err) {
      setError(err.fromJob ? err.message : err.response?.data?.message || 'The upload could not be completed. Check that the backend is running and try again.');
      setPhase('idle'); setProgress(0); setStageIndex(0);
    }
  }
  const busy = phase !== 'idle';
  const { Icon } = cfg;
  return (
    <form className="verify-form" onSubmit={submit}>
      {service.checked && !service.ok && (
        <div className="alert-banner" role="alert"><AlertTriangle size={22} /><div><b>Media service not running</b><span>{service.message}</span></div></div>
      )}
      <div className="form-section-label"><span>01</span><div><b>Upload {kind === 'image' ? 'an image' : 'a video'}</b><small>{cfg.label} · up to {cfg.maxMB} MB</small></div></div>
      {!file ? (
        <div
          className={`dropzone ${drag ? 'dropzone-active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
        >
          <span className="dropzone-icon"><Upload size={26} /></span>
          <b>Drag and drop your {kind} here</b>
          <small>or</small>
          <button type="button" className="button button-outline" onClick={() => input.current?.click()}><Icon size={18} /> Choose a file</button>
          <input ref={input} className="visually-hidden" type="file" accept={cfg.accept} aria-label={`Choose ${kind} file`} onChange={e => choose(e.target.files?.[0])} />
        </div>
      ) : (
        <div className="file-preview">
          <div className="preview-media">
            {kind === 'image' ? <img src={preview} alt="Selected upload preview" /> : <video src={preview} controls preload="metadata" />}
          </div>
          <div className="file-meta">
            <div><b title={file.name}>{file.name}</b><small>{formatSize(file.size)} · {file.type}</small></div>
            <button type="button" className="button button-outline" onClick={clear} disabled={busy} aria-label="Remove selected file"><X size={16} /> Remove</button>
          </div>
        </div>
      )}
      {busy && (
        <div className="progress-block" role="status" aria-live="polite">
          <ol className="stepper">
            {cfg.stages.map((label, i) => {
              const done = i < stageIndex || (phase === 'processing' && i === 0);
              const current = !done && i === (phase === 'uploading' ? 0 : stageIndex);
              return <li key={label} className={done ? 'step-done' : current ? 'step-current' : ''}><span>{done ? <Check size={14} /> : current ? <Loader2 size={14} className="spin" /> : i + 1}</span>{label}{i === 0 && phase === 'uploading' ? ` ${progress}%` : ''}</li>;
            })}
          </ol>
          <div className="progress-track"><span style={{ width: `${phase === 'uploading' ? progress * 0.2 : 20 + (stageIndex / (cfg.stages.length - 1)) * 80}%` }} /></div>
          <small>{kind === 'video' ? 'Large videos can take up to a minute or two. You can leave this page; the report will be saved to History.' : 'This usually takes a few seconds.'}</small>
        </div>
      )}
      <div className="safe-note"><ShieldCheck size={18} /><span>{cfg.hint} Files are checked by content type, processed temporarily, and not stored.</span></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button" disabled={!file || busy}>{busy ? <><Loader2 size={18} className="spin" /> Working…</> : <>Analyze {kind} <ArrowRight size={18} /></>}</button>
    </form>
  );
}
