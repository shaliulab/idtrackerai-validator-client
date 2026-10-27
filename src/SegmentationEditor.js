// Data collector tab: the idtrackerai settings (<date>.toml, landmarks.toml, arenas.toml) of a
// fetched experiment, edited like idtrackerai v6's segmentation app: ROI list (+/- polygon or
// ellipse, drawn by clicking on the frame), number of animals, intensity and area thresholds,
// and the blobs the segmentation finds in the shown frame (/api/collector/segment, refreshed
// as settings change). Save writes the toml (and <date>.conf), see data_collector.py.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiUrl } from './api';
import { useConsole, useConsoleState, consoleHeight } from './MessageConsole';
import { useElementSize } from './layout';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error ?? err.message;

const ROI_TYPES = ['+ Polygon', '+ Ellipse', '- Polygon', '- Ellipse'];
const AREA_SIMPLE_MAX = 10000;
const AREA_RANGE_MAX = 60000;
const UPPER_LIMIT_WARNING = 'This will enable an upper limit for blob areas.\n\n'
  + 'Large blobs from animal crossings should NOT be filtered out. Only blobs that do not '
  + 'correspond to animals should be excluded.\n\nDo you want to enable the upper limit?';

// "+ Polygon [[x, y], ...]" / "+ Ellipse {'center': [x, y], 'axes': [a, b], 'angle': d}"
export function parseRoi(label) {
  const text = (label || '').trim();
  const sign = text[0];
  const shape = text.slice(2, 9);
  if (!'+-'.includes(sign) || !['Polygon', 'Ellipse'].includes(shape)) throw new Error(`Not a ROI: ${text}`);
  const data = JSON.parse(text.slice(10).replace(/'/g, '"'));
  if (shape === 'Polygon') {
    if (!Array.isArray(data) || data.length < 3) throw new Error('A polygon needs 3 points or more');
    return { sign, shape, points: data };
  }
  if (!data.center || !data.axes) throw new Error('An ellipse needs center, axes and angle');
  return { sign, shape, center: data.center, axes: data.axes, angle: data.angle || 0 };
}

const ellipseLabel = (type, e) => `${type} {'center': [${e.center[0]}, ${e.center[1]}], 'axes': [${e.axes[0]}, ${e.axes[1]}], 'angle': ${e.angle}}`;
const polygonLabel = (type, pts) => `${type} [${pts.map(([x, y]) => `[${x.toFixed(1)}, ${y.toFixed(1)}]`).join(', ')}]`;

function roiPath(ctx, roi) {
  ctx.beginPath();
  if (roi.shape === 'Polygon') {
    roi.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else {
    ctx.ellipse(roi.center[0], roi.center[1], roi.axes[0], roi.axes[1], (roi.angle * Math.PI) / 180, 0, 2 * Math.PI);
  }
}

// settings of a toml -> editor state
function toDraft(settings) {
  const s = settings || {};
  const intensity = s.intensity_ths || [0, 130];
  const area = s.area_ths || [50, 'inf'];
  return {
    ...s,
    intensity_ths: [Number(intensity[0]), Number(intensity[1])],
    area_ths: [Number(area[0]), area[1] == null || area[1] === 'inf' ? 'inf' : Number(area[1])],
    number_of_animals: Number(s.number_of_animals ?? 0),
    roi_enabled: s.roi_list != null && s.roi_list.length > 0,
    roi_list: s.roi_list || [],
    exclusive_rois: !!s.exclusive_rois,
    check_segmentation: !!s.check_segmentation,
    track_wo_identities: !!s.track_wo_identities,
  };
}

function fromDraft(draft) {
  const { roi_enabled: enabled, ...settings } = draft;
  if (!enabled) settings.roi_list = null;
  return settings;
}

const intensityModeOf = ([lo, hi]) => (lo === 0 ? 'dark' : hi === 255 ? 'bright' : 'custom');

// ── Frame with ROIs, blobs and the ROI being drawn; wheel zoom, drag pan ─────
function SegmentationCanvas({ imageUrl, width, height, rois, blobs, drawing, selected, markers, onPoint, onRemovePoint }) {
  const [box, setBox] = useState(null);
  const size = useElementSize(box);
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [view, setView] = useState(null);           // {scale, x, y}: canvas px = (image px - x) * scale
  const drag = useRef(null);

  useEffect(() => {
    if (!imageUrl) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setImage(img); };
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl]);

  // square, as wide as the column but fitting the window above the console
  const consoleState = useConsoleState();
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const room = windowHeight - consoleHeight(consoleState?.open ?? true, consoleState?.height) - 150;
  const side = Math.max(240, Math.floor(Math.min(size.width, room)));
  const fit = useCallback(() => (width ? { scale: side / Math.max(width, height), x: 0, y: 0 } : null), [side, width, height]);
  useEffect(() => { setView(fit()); }, [fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const toScreen = () => ctx.setTransform(view.scale, 0, 0, view.scale, -view.x * view.scale, -view.y * view.scale);
    toScreen();
    if (image) ctx.drawImage(image, 0, 0, width, height);
    const px = 1 / view.scale;

    // ROI mask (v6: red, alpha 50), - ROIs cut out of it
    if (rois) {
      const mask = document.createElement('canvas');
      mask.width = canvas.width; mask.height = canvas.height;
      const m = mask.getContext('2d');
      m.setTransform(view.scale, 0, 0, view.scale, -view.x * view.scale, -view.y * view.scale);
      rois.forEach((roi) => {
        if (!roi) return;
        m.globalCompositeOperation = roi.sign === '+' ? 'source-over' : 'destination-out';
        m.fillStyle = 'rgb(255, 0, 0)';
        roiPath(m, roi);
        m.fill();
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 50 / 255;
      ctx.drawImage(mask, 0, 0);
      ctx.globalAlpha = 1;
      toScreen();
      if (selected) {
        ctx.strokeStyle = '#7CFC00';
        ctx.lineWidth = 2 * px;
        roiPath(ctx, selected);
        ctx.stroke();
      }
    }

    // blobs (v6: fill (60, 160, 255, 150), edge #286384)
    ctx.fillStyle = 'rgba(60, 160, 255, 0.59)';
    ctx.strokeStyle = '#286384';
    ctx.lineWidth = px;
    (blobs || []).forEach((contour) => {
      ctx.beginPath();
      contour.forEach((p, i) => {
        const [x, y] = Array.isArray(p[0]) ? p[0] : p;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // preprocess_sample.csv centroids of this frame
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = 2 * px;
    (markers || []).forEach(([x, y]) => {
      const r = 18 * px;
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
    });

    // ROI being drawn
    if (drawing) {
      const pts = drawing.points;
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#349650';
      if (drawing.type.endsWith('Polygon') && pts.length > 1) {
        ctx.setLineDash([]);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        if (pts.length > 2) {
          ctx.setLineDash([5 * px, 8 * px]);
          ctx.beginPath();
          ctx.moveTo(...pts[pts.length - 1]); ctx.lineTo(...pts[0]);
          ctx.stroke();
        }
      }
      if (drawing.ellipse) {
        ctx.setLineDash([5 * px, 8 * px]);
        roiPath(ctx, { shape: 'Ellipse', ...drawing.ellipse });
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#349650';
      pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5 * px, 0, 2 * Math.PI); ctx.fill(); });
    }
  }, [image, view, width, height, rois, blobs, drawing, selected, markers, side]);

  const toImage = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [view.x + (e.clientX - rect.left) / view.scale, view.y + (e.clientY - rect.top) / view.scale];
  };

  const onWheel = (e) => {
    if (!view) return;
    const [ix, iy] = toImage(e);
    const scale = Math.min(Math.max(view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), fit().scale), 8);
    const rect = canvasRef.current.getBoundingClientRect();
    setView({ scale, x: ix - (e.clientX - rect.left) / scale, y: iy - (e.clientY - rect.top) / scale });
  };

  // the page must not scroll while zooming
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const stop = (e) => e.preventDefault();
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);

  const onMouseDown = (e) => {
    if (!view) return;
    if (e.button === 2 && drawing) { onRemovePoint(toImage(e), 20 / view.scale); return; }
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
  };
  const onMouseMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView({ ...d.view, x: d.view.x - dx / d.view.scale, y: d.view.y - dy / d.view.scale });
  };
  const onMouseUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && drawing) onPoint(toImage(e));
  };

  return (
    <div ref={setBox} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={side}
        height={side}
        style={{ width: side, height: side, display: 'block', borderRadius: 6, cursor: drawing ? 'crosshair' : 'grab' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { drag.current = null; }}
        onDoubleClick={() => { if (!drawing) setView(fit()); }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

// ── Slider + number input ─────────────────────────────────────────────────
function SliderField({ label, value, min, max, onChange, title }) {
  return (
    <label className="sc-slider" title={title}>
      {label && <span className="sc-slider-label">{label}</span>}
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} value={value}
             onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  );
}

export default function SegmentationEditor({ experiment, active, highlight, frameRequest, onSaved }) {
  const { log, trackJob } = useConsole();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);        // draft as last loaded / saved
  const [intensityMode, setIntensityMode] = useState('dark');
  const [frameNumber, setFrameNumber] = useState(null);
  const [blobs, setBlobs] = useState({ contours: [], areas: [] });
  const [drawing, setDrawing] = useState(null);    // {type, points, ellipse}
  const [choosingType, setChoosingType] = useState(false);
  const [selectedRoi, setSelectedRoi] = useState(null);
  const [editing, setEditing] = useState(null);    // {index, text}
  const [force, setForce] = useState(false);
  const [nArenas, setNArenas] = useState(4);
  const [busy, setBusy] = useState(false);

  const store = info?.store;
  const chunksize = store?.chunksize || 1;
  const chunks = store?.chunks || [];
  const firstFrame = chunks.length ? chunks[0] * chunksize : 0;
  const lastFrame = chunks.length ? (chunks[chunks.length - 1] + 1) * chunksize - 1 : 0;

  const loadFile = useCallback((files, name) => {
    const file = files.find((f) => f.name === name);
    if (!file || !file.settings) { setDraft(null); setSaved(null); return; }
    const d = toDraft(file.settings);
    setDraft(d);
    setSaved(d);
    setIntensityMode(intensityModeOf(d.intensity_ths));
    setSelectedRoi(null);
    setDrawing(null);
  }, []);

  const fetchInfo = useCallback(async (keepFile) => {
    if (!experiment) { setInfo(null); return; }
    try {
      const data = unwrap((await api.get('/api/collector/settings', { params: { experiment } })).data);
      setInfo(data);
      setError(null);
      const names = data.files.map((f) => f.name);
      const name = keepFile && names.includes(keepFile) ? keepFile : (names.includes(`${data.date_time}.toml`) ? `${data.date_time}.toml` : names[0] || null);
      setFileName(name);
      loadFile(data.files, name);
      return data;
    } catch (err) {
      setInfo(null);
      setError(errorOf(err));
      return null;
    }
  }, [experiment, loadFile]);

  // a new experiment: its files, at the frame its toml was annotated on
  useEffect(() => {
    fetchInfo(null).then((data) => {
      if (!data) return;
      const cs = data.store.chunksize;
      const file = data.files.find((f) => f.settings?.video_paths?.length);
      const match = file && /(\d{6})\.mp4$/.exec(file.settings.video_paths[0]);
      const chunk = match && data.store.chunks.includes(Number(match[1])) ? Number(match[1])
        : data.store.chunks.includes(100) ? 100 : data.store.chunks[0];
      setFrameNumber(chunk != null ? chunk * cs : null);
    });
  }, [experiment, fetchInfo]);

  // preprocess-sample viewer: show one of its frames
  useEffect(() => {
    if (frameRequest?.frame_number != null) setFrameNumber(frameRequest.frame_number);
  }, [frameRequest]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const parsedRois = useMemo(() => {
    if (!draft?.roi_enabled) return null;
    return draft.roi_list.map((label) => { try { return parseRoi(label); } catch { return null; } });
  }, [draft]);

  // blobs of the frame with the current settings (debounced)
  useEffect(() => {
    if (!draft || frameNumber == null || !experiment) return undefined;
    const timer = setTimeout(() => {
      api.post('/api/collector/segment', {
        experiment, frame_number: frameNumber,
        intensity_ths: draft.intensity_ths, area_ths: draft.area_ths,
        roi_list: draft.roi_enabled ? draft.roi_list.filter((l, i) => parsedRois[i]) : null,
      }).then((r) => setBlobs(unwrap(r.data)))
        .catch((err) => { setBlobs({ contours: [], areas: [] }); log('error', `Segmentation: ${errorOf(err)}`); });
    }, 200);
    return () => clearTimeout(timer);
  }, [experiment, frameNumber, draft?.intensity_ths, draft?.area_ths, draft?.roi_enabled, draft?.roi_list, parsedRois, log]); // eslint-disable-line react-hooks/exhaustive-deps

  // ellipse preview while drawing one (cv2.fitEllipse on the server, as v6)
  const drawingPoints = drawing?.points;
  useEffect(() => {
    if (!drawing?.type.endsWith('Ellipse') || drawingPoints.length < 5) {
      if (drawing?.ellipse) setDrawing((d) => d && { ...d, ellipse: null });
      return;
    }
    api.post('/api/collector/fit_ellipse', { points: drawingPoints })
      .then((r) => setDrawing((d) => (d && d.points === drawingPoints ? { ...d, ellipse: unwrap(r.data) } : d)))
      .catch(() => {});
  }, [drawingPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishDrawing = useCallback(async () => {
    if (!drawing) return;
    const { type, points } = drawing;
    setDrawing(null);
    if (!points.length) return;
    try {
      let label;
      if (type.endsWith('Polygon')) {
        if (points.length < 3) throw new Error('Polygons can only be defined with 3 points or more');
        label = polygonLabel(type, points);
      } else {
        if (points.length < 5) throw new Error('Ellipses can only be defined with 5 points (exact fit) or more (approximated fit)');
        label = ellipseLabel(type, unwrap((await api.post('/api/collector/fit_ellipse', { points })).data));
      }
      setDraft((d) => ({ ...d, roi_list: [...d.roi_list, label] }));
      setSelectedRoi(null);
    } catch (err) {
      log('warning', `ROI not added: ${errorOf(err)}`);
    }
  }, [drawing, log]);

  const save = useCallback(async () => {
    if (!draft || !fileName) return;
    if (draft.number_of_animals === 0 && !draft.track_wo_identities) {
      log('warning', 'Define the number of animals, or tick "Track without identities"');
      return;
    }
    setBusy(true);
    try {
      const data = unwrap((await api.post('/api/collector/settings', { experiment, file: fileName, settings: fromDraft(draft) })).data);
      log('success', `Saved ${data.written}${data.conf ? ` and ${data.conf}` : ''}`);
      if (data.conf_error) log('error', data.conf_error);
      await fetchInfo(fileName);
      onSaved?.();
    } catch (err) {
      log('error', `Could not save ${fileName}: ${errorOf(err)}`);
    } finally {
      setBusy(false);
    }
  }, [draft, fileName, experiment, log, fetchInfo, onSaved]);

  const propose = async () => {
    setBusy(true);
    try {
      const job = await trackJob(unwrap((await api.post('/api/collector/propose', { experiment, force })).data));
      const output = job.result?.output;
      if (output) log(job.status === 'done' ? 'info' : 'error', `roi-proposer:\n${output}`);
      await fetchInfo(fileName);
    } catch (err) {
      log('error', `roi-proposer: ${errorOf(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // a new arenas.toml (one ellipse per arena), opened unsaved: adjust it, then Save
  const makeArenas = async () => {
    if (dirty && !window.confirm('Discard the unsaved changes?')) return;
    if (info.files.some((f) => f.name === 'arenas.toml')
        && !window.confirm('arenas.toml exists: replace it in the editor with a new proposal? (nothing is written until you save)')) return;
    setBusy(true);
    try {
      const data = unwrap((await api.post('/api/collector/arenas_proposal', { experiment, frame_number: frameNumber, n: nArenas })).data);
      const d = toDraft(data.settings);
      setFileName('arenas.toml');
      setDraft(d);
      setSaved(null);
      setIntensityMode(intensityModeOf(d.intensity_ths));
      setSelectedRoi(null);
      setDrawing(null);
      log(data.source === 'detected' ? 'success' : 'warning', data.source === 'detected'
        ? `arenas.toml: ${nArenas} arenas detected in chunk ${Math.floor(frameNumber / chunksize)}; check them and save`
        : `arenas.toml: ${data.detected} arena${data.detected === 1 ? '' : 's'} detected instead of ${nArenas}: laid out on a grid, adjust the ellipses (double click to edit, or draw them) and save`);
    } catch (err) {
      log('error', `arenas.toml: ${errorOf(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const stepFrame = useCallback((delta) => {
    setFrameNumber((f) => Math.min(Math.max((f ?? firstFrame) + delta, firstFrame), lastFrame));
  }, [firstFrame, lastFrame]);

  // keys while the tab is shown: ←/→ frame (Shift: 10 s), Enter finishes a ROI, Esc cancels, Ctrl+S saves
  const keyState = useRef({});
  keyState.current = { finishDrawing, save, stepFrame, drawing, framerate: store?.framerate || 1, dirty, selectedRoi };
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const k = keyState.current;
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); k.save(); return; }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Enter' && k.drawing) { e.preventDefault(); k.finishDrawing(); }
      else if (e.key === 'Escape' && k.drawing) setDrawing(null);
      else if (e.key === 'ArrowRight') { e.preventDefault(); k.stepFrame(e.shiftKey ? Math.round(10 * k.framerate) : 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); k.stepFrame(e.shiftKey ? -Math.round(10 * k.framerate) : -1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!experiment) return <div className="card-body sc-muted">Choose an experiment that is here (Settings ▸ in the table above).</div>;
  if (error) return <div className="card-body ov-warn">{error}</div>;
  if (!info) return <div className="card-body sc-muted">Loading…</div>;

  const files = info.files;
  const nBlobs = blobs.contours.length;
  const expected = draft?.number_of_animals;
  const markers = highlight && highlight.frame_number === frameNumber ? highlight.points : null;
  const imageUrl = frameNumber != null
    ? apiUrl(`/api/collector/frame?experiment=${encodeURIComponent(experiment)}&frame_number=${frameNumber}`) : null;
  const chunk = frameNumber != null ? Math.floor(frameNumber / chunksize) : null;
  const intensity = draft?.intensity_ths || [0, 0];
  const area = draft?.area_ths || [0, 'inf'];
  const upper = area[1] !== 'inf';

  const setIntensityModeTo = (mode) => {
    setIntensityMode(mode);
    if (mode === 'dark') set({ intensity_ths: [0, intensity[1] === 255 ? 130 : intensity[1]] });
    else if (mode === 'bright') set({ intensity_ths: [intensity[0] === 0 ? 130 : intensity[0], 255] });
  };
  const toggleUpper = (on) => {
    if (on && !window.confirm(UPPER_LIMIT_WARNING)) return;
    set({ area_ths: [area[0], on ? Math.max(area[0], AREA_RANGE_MAX) : 'inf'] });
  };
  const moveRoi = (i, delta) => {
    const list = [...draft.roi_list];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ roi_list: list });
    setSelectedRoi(j);
  };
  const deleteRoi = (i) => {
    set({ roi_list: draft.roi_list.filter((_, k) => k !== i) });
    setSelectedRoi(null);
  };
  const commitEdit = () => {
    try {
      parseRoi(editing.text);
      const list = [...draft.roi_list];
      list[editing.index] = editing.text.trim();
      set({ roi_list: list });
      setEditing(null);
    } catch (err) {
      log('warning', `ROI not changed: ${err.message}`);
    }
  };

  return (
    <div className="sc-editor">
      {/* ── left: settings (layout of idtrackerai v6's segmentation app) ── */}
      <div className="sc-panel">
        <div className="sc-row">
          <span className="sc-label">Settings file</span>
          <select value={fileName || ''} onChange={(e) => {
            if (dirty && !window.confirm('Discard the unsaved changes?')) return;
            setFileName(e.target.value);
            loadFile(files, e.target.value);
          }}>
            {!files.length && !fileName && <option value="">none yet</option>}
            {fileName && !files.some((f) => f.name === fileName) && <option value={fileName}>{fileName} (new)</option>}
            {files.map((f) => <option key={f.name} value={f.name}>{f.name}{f.ai_proposed ? ' (AI)' : ''}</option>)}
          </select>
          {files.find((f) => f.name === fileName)?.ai_proposed && (
            <span className="sc-badge sc-ai" title="Proposed by roi-proposer and not reviewed yet: check it and save it">AI proposed</span>
          )}
          {dirty && <span className="sc-badge sc-dirty">unsaved</span>}
        </div>
        <div className="sc-row">
          <button onClick={propose} disabled={busy} title="roi-proposer propose: ROIs from the YOLO model, other settings from the latest annotated experiment of the same camera">
            <i className="fa fa-magic" style={{ marginRight: 6 }} />Propose with roi-proposer
          </button>
          <label className="check field" title="Overwrite the existing tomls (otherwise only missing ones are written)">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> overwrite
          </label>
          {info.preview && (
            <a href={apiUrl(`/api/collector/preview?experiment=${encodeURIComponent(experiment)}&t=${info.preview}`)} target="_blank" rel="noreferrer">
              rois_proposal.jpg
            </a>
          )}
        </div>
        {!info.arena && (
          <div className="sc-row">
            <span className="sc-label" title="arenas.toml: one ellipse per arena, the regions imgstore-crop-arenas cuts the recording into">Split into</span>
            <input type="number" min={2} max={16} value={nArenas} style={{ width: 60 }}
                   onChange={(e) => setNArenas(Math.max(2, Math.min(16, Number(e.target.value) || 2)))} />
            <span>arenas</span>
            <button onClick={makeArenas} disabled={busy || frameNumber == null}
                    title="Propose arenas.toml with this many arenas, detected on the frame shown (a grid when the detector does not find exactly that many); it opens unsaved">
              <i className="fa fa-th-large" style={{ marginRight: 6 }} />Make arenas.toml
            </button>
          </div>
        )}
        {files.find((f) => f.name === fileName)?.error && <div className="ov-warn">{files.find((f) => f.name === fileName).error}</div>}

        {draft && (
          <>
            <hr className="sc-hr" />
            {/* Regions of interest */}
            <div className="sc-row">
              <label className="check field">
                <input type="checkbox" checked={draft.roi_enabled} onChange={(e) => { set({ roi_enabled: e.target.checked }); setDrawing(null); }} />
                <b>Regions of interest</b>
              </label>
              <span className="spacer" style={{ flex: 1 }} />
              {drawing ? (
                <>
                  <span className="sc-muted">{drawing.type}: {drawing.points.length} pts</span>
                  <button className="btn-primary" onClick={finishDrawing} title="Enter">Done</button>
                  <button onClick={() => setDrawing(null)} title="Esc">Cancel</button>
                </>
              ) : (
                <button disabled={!draft.roi_enabled} onClick={() => setChoosingType((v) => !v)}>+ Add</button>
              )}
            </div>
            {choosingType && !drawing && (
              <div className="sc-roi-types">
                {ROI_TYPES.map((type) => (
                  <button key={type} disabled={type[0] === '-' && draft.roi_list.length === 0}
                          onClick={() => { setDrawing({ type, points: [], ellipse: null }); setChoosingType(false); setSelectedRoi(null); }}>
                    {type}
                  </button>
                ))}
              </div>
            )}
            {drawing && (
              <div className="sc-hint">
                Click on the frame to add points (right click removes the nearest one); {drawing.type.endsWith('Ellipse') ? '5 or more' : '3 or more'} points, then Enter.
              </div>
            )}
            {draft.roi_enabled && (
              <ul className="sc-roi-list">
                {draft.roi_list.map((label, i) => (
                  <li key={`${i}-${label}`} className={`${selectedRoi === i ? 'on' : ''} ${parsedRois?.[i] ? '' : 'bad'}`}
                      onClick={() => setSelectedRoi(selectedRoi === i ? null : i)}
                      onDoubleClick={() => setEditing({ index: i, text: label })}
                      title="Click: highlight on the frame · double click: edit the text">
                    {editing?.index === i ? (
                      <input autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                             onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                             onBlur={() => setEditing(null)} onClick={(e) => e.stopPropagation()} />
                    ) : <code>{label}</code>}
                    {selectedRoi === i && editing?.index !== i && (
                      <span className="sc-roi-actions" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => moveRoi(i, -1)} title="Up">↑</button>
                        <button onClick={() => moveRoi(i, 1)} title="Down">↓</button>
                        <button onClick={() => deleteRoi(i)} title="Delete">✕</button>
                      </span>
                    )}
                  </li>
                ))}
                {!draft.roi_list.length && <li className="sc-muted">No ROI: + Add</li>}
              </ul>
            )}
            {draft.roi_enabled && draft.roi_list.length > 1 && (
              <label className="check field" style={{ alignSelf: 'flex-end' }}>
                <input type="checkbox" checked={draft.exclusive_rois} onChange={(e) => set({ exclusive_rois: e.target.checked })} /> Exclusive ROIs
              </label>
            )}
            <hr className="sc-hr" />

            <div className="sc-row">
              <span className="sc-label">Number of animals</span>
              <input type="number" min={0} max={1000} value={draft.number_of_animals}
                     onChange={(e) => set({ number_of_animals: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 70 }} />
              {info.group_size != null && info.group_size !== draft.number_of_animals && fileName !== 'arenas.toml' && (
                <span className="ov-warn" title="From the NX folder">folder says {info.group_size}</span>
              )}
            </div>

            <div className="sc-block">
              <div className="sc-row">
                <span className="sc-label">Blob intensity thresholds</span>
                <select value={intensityMode} onChange={(e) => setIntensityModeTo(e.target.value)}>
                  <option value="dark">Dark animals</option>
                  <option value="bright">Bright animals</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              {intensityMode === 'dark' && (
                <SliderField label="max" min={0} max={255} value={intensity[1]} onChange={(v) => set({ intensity_ths: [0, v] })} />
              )}
              {intensityMode === 'bright' && (
                <SliderField label="min" min={0} max={255} value={intensity[0]} onChange={(v) => set({ intensity_ths: [v, 255] })} />
              )}
              {intensityMode === 'custom' && (
                <>
                  <SliderField label="min" min={0} max={255} value={intensity[0]} onChange={(v) => set({ intensity_ths: [Math.min(v, intensity[1]), intensity[1]] })} />
                  <SliderField label="max" min={0} max={255} value={intensity[1]} onChange={(v) => set({ intensity_ths: [intensity[0], Math.max(v, intensity[0])] })} />
                </>
              )}
            </div>

            <div className="sc-block">
              <div className="sc-row">
                <span className="sc-label">Blob area thresholds</span>
                <span className="spacer" style={{ flex: 1 }} />
                <label className="check field"><input type="checkbox" checked={upper} onChange={(e) => toggleUpper(e.target.checked)} /> Upper limit</label>
              </div>
              <SliderField label="min" min={1} max={upper ? AREA_RANGE_MAX : AREA_SIMPLE_MAX} value={area[0]}
                           onChange={(v) => set({ area_ths: [upper ? Math.min(v, area[1]) : v, area[1]] })} />
              {upper && (
                <SliderField label="max" min={1} max={AREA_RANGE_MAX} value={area[1]} onChange={(v) => set({ area_ths: [area[0], Math.max(v, area[0])] })} />
              )}
            </div>

            {/* Blob info (v6 BlobInfoWidget) */}
            <div className={`sc-blobinfo ${expected && nBlobs !== expected ? 'bad' : 'ok'}`}>
              <b>{nBlobs}</b> blob{nBlobs === 1 ? '' : 's'} in this frame{expected ? <> · {expected} animal{expected === 1 ? '' : 's'}</> : null}
              {blobs.areas.length > 0 && (
                <div className="sc-areas">
                  areas: {[...blobs.areas].sort((a, b) => b - a).map((a) => Math.round(a)).join(', ')}
                </div>
              )}
            </div>
            <hr className="sc-hr" />

            <label className="check field"><input type="checkbox" checked={draft.check_segmentation} onChange={(e) => set({ check_segmentation: e.target.checked })} /> Stop tracking if #blobs &gt; #animals</label>
            <label className="check field"><input type="checkbox" checked={draft.track_wo_identities} onChange={(e) => set({ track_wo_identities: e.target.checked })} /> Track without identities</label>
            {draft.use_bkg && <div className="ov-warn">use_bkg is on: the preview segments without background subtraction</div>}
            <div className="sc-row" style={{ marginTop: 6 }}>
              <button className="btn-primary" onClick={save} disabled={busy || !dirty && files.find((f) => f.name === fileName)?.ai_proposed === false}
                      title="Ctrl+S · writes the toml (old one in toml_backups/); the main toml also becomes the .conf preprocess-sample reads">
                <i className="fa fa-floppy-o" style={{ marginRight: 6 }} />Save {fileName}
              </button>
              <button onClick={() => loadFile(files, fileName)} disabled={!dirty}>Revert</button>
              <span className="sc-muted">{info.conf ? `${info.date_time}.conf ✓` : `no ${info.date_time}.conf yet`}</span>
            </div>
          </>
        )}
        {!draft && files.length === 0 && <div className="sc-muted">No toml yet: Propose with roi-proposer.</div>}
      </div>

      {/* ── right: the frame ── */}
      <div className="sc-view">
        <div className="sc-row">
          <span className="readout">
            <span>Frame <b>{frameNumber ?? '–'}</b></span>
            <span>Chunk <b>{chunk ?? '–'}</b></span>
            {chunks.length > 0 && <span>chunks here <b>{chunks[0]}–{chunks[chunks.length - 1]}</b></span>}
          </span>
        </div>
        <SegmentationCanvas
          imageUrl={imageUrl}
          width={store.width}
          height={store.height}
          rois={parsedRois}
          blobs={blobs.contours}
          drawing={drawing}
          selected={selectedRoi != null ? parsedRois?.[selectedRoi] : null}
          markers={markers}
          onPoint={(p) => setDrawing((d) => d && { ...d, points: [...d.points, p] })}
          onRemovePoint={(p, radius) => setDrawing((d) => {
            if (!d || !d.points.length) return d;
            const dist = d.points.map(([x, y]) => Math.hypot(x - p[0], y - p[1]));
            const i = dist.indexOf(Math.min(...dist));
            return dist[i] < radius ? { ...d, points: d.points.filter((_, k) => k !== i) } : d;
          })}
        />
        <input type="range" className="sc-scrub" min={firstFrame} max={lastFrame} value={frameNumber ?? firstFrame}
               onChange={(e) => setFrameNumber(Number(e.target.value))} />
        <div className="transport">
          <button onClick={() => stepFrame(-chunksize)} title="Previous chunk">⏮ chunk</button>
          <button onClick={() => stepFrame(-Math.round(10 * (store.framerate || 1)))} title="Shift+←">−10 s</button>
          <button onClick={() => stepFrame(-1)} title="←">−1</button>
          <button onClick={() => stepFrame(1)} title="→">+1</button>
          <button onClick={() => stepFrame(Math.round(10 * (store.framerate || 1)))} title="Shift+→">+10 s</button>
          <button onClick={() => stepFrame(chunksize)} title="Next chunk">chunk ⏭</button>
          <button onClick={() => {
            const c = chunks[Math.floor(Math.random() * chunks.length)];
            setFrameNumber(c * chunksize + Math.floor(Math.random() * chunksize));
          }} title="A random frame of the chunks here">Random</button>
          <label className="field">Chunk
            <input type="number" value={chunk ?? ''} min={chunks[0]} max={chunks[chunks.length - 1]}
                   onChange={(e) => e.target.value !== '' && setFrameNumber(Number(e.target.value) * chunksize)} />
          </label>
        </div>
        <div className="sc-hint">Wheel: zoom · drag: pan · double click: fit · ←/→ frame (Shift: 10 s)</div>
      </div>
    </div>
  );
}
