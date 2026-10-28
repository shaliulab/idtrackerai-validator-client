// SleapLabelsTab.js  —  "SLEAP labels" tab: pose ground truth of the loaded experiment
//
// Edits the SLEAP training files of /api/sleap (idtrackerai_validator_server/sleap_labels.py),
// as sleap-label does: one user instance per frame of a fly's chunk video. The list
// holds the frames of the loaded experiment in the chosen file (labelled, predicted or
// suggested); "Label a frame" opens any frame of a fly (its chunk video is added to the
// file when first labelled). The frame starts from the user instance, else the
// prediction of the file, else the fly's pose file, else the mean instance of the file
// laid along the fly's body (server side).
// Edits are sent as they happen (one queue, in order); the server writes the file a
// couple of seconds after the last one. Its `request` prop ({fly, frameNumber}) opens
// a fly's frame: used by the Pose tab.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api, { apiUrl } from './api';
import { useElementSize, useFillHeight } from './layout';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const fix = (v, d = 1) => (v == null ? '–' : v.toFixed(d));
const errorOf = (err) => err.response?.data?.error || err.message;
const keyOf = (f) => `${f.chunk}/${f.lid}/${f.idx}`;
const flyNo = (fly) => (fly ? fly.split('__').pop() : '?');
const FILE_KEY = 'fh-sleap-file';
const FILTERS = [['all', 'All'], ['todo', 'To label'], ['done', 'Labelled']];
const UNDO_DEPTH = 200;

// Okabe-Ito: left side orange, right side sky blue, head yellow, body reddish purple
function nodeColor(name) {
  if (/^[fmr]LL|^lW$/.test(name)) return '#e69f00';
  if (/^[fmr]RL|^rW$/.test(name)) return '#56b4e9';
  if (name === 'proboscis' || name === 'head') return '#f0e442';
  return '#cc79a7';
}

const placed = (p) => p && p[0] != null && p[1] != null;

function SleapCanvas({ image, size, nodes, edges, draft, ghost, selected, setSelected, showLabels,
                       onMove, onCommit, onToggle, onPlace, onUsePrediction }) {
  const canvasRef = useRef(null);
  const [view, setView] = useState({ zoom: 1, cx: null, cy: null });   // centre in image px
  const drag = useRef(null);
  const [hover, setHover] = useState(null);
  const w = image?.naturalWidth || 100;
  const h = image?.naturalHeight || 100;
  const cx = view.cx ?? w / 2;
  const cy = view.cy ?? h / 2;
  const scale = (size / Math.max(w, h)) * view.zoom;
  const toScreen = useCallback(([x, y]) => [(x - cx) * scale + size / 2, (y - cy) * scale + size / 2], [cx, cy, scale, size]);
  const toImage = useCallback((sx, sy) => [(sx - size / 2) / scale + cx, (sy - size / 2) / scale + cy], [cx, cy, scale, size]);

  // a new image of another size (another video) starts unzoomed
  useEffect(() => { setView({ zoom: 1, cx: null, cy: null }); }, [w, h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    if (!image) return;
    ctx.imageSmoothingEnabled = false;
    const [ix, iy] = toScreen([0, 0]);
    ctx.drawImage(image, ix, iy, w * scale, h * scale);
    const index = Object.fromEntries(nodes.map((n, i) => [n, i]));

    const drawSkeleton = (points, style, width, dash) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      for (const [a, b] of edges) {
        const p = points[index[a]];
        const q = points[index[b]];
        if (!placed(p) || !placed(q) || p[2] === false || q[2] === false) continue;
        ctx.beginPath();
        ctx.moveTo(...toScreen(p));
        ctx.lineTo(...toScreen(q));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    if (ghost) {
      drawSkeleton(ghost.map((p) => p && [p[0], p[1], true]), 'rgba(200,200,200,0.55)', 1, [3, 3]);
      ghost.forEach((p, i) => {
        if (!p) return;
        const [x, y] = toScreen(p);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.strokeStyle = nodeColor(nodes[i]);
        ctx.globalAlpha = draft ? 0.45 : 0.9;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }
    if (draft) {
      drawSkeleton(draft, 'rgba(255,255,255,0.7)', 1.5, []);
      draft.forEach((p, i) => {
        if (!placed(p)) return;
        const [x, y] = toScreen(p);
        const active = i === selected || i === hover;
        const r = active ? 7 : 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        if (p[2]) {
          ctx.fillStyle = nodeColor(nodes[i]);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // not visible: hollow, dashed (sleap-label keeps its position)
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = nodeColor(nodes[i]);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (i === selected) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (showLabels || active) {
          ctx.font = '12px sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(nodes[i], x + 9, y - 7);
          ctx.fillStyle = '#fff';
          ctx.fillText(nodes[i], x + 9, y - 7);
        }
      });
    }
  }, [image, size, w, h, scale, toScreen, nodes, edges, draft, ghost, selected, hover, showLabels]);

  const local = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const nodeAt = (sx, sy) => {
    if (!draft) return null;
    let best = null;
    draft.forEach((p, i) => {
      if (!placed(p)) return;
      const [x, y] = toScreen(p);
      const d = Math.hypot(x - sx, y - sy);
      if (d < 12 && (!best || d < best.d)) best = { i, d };
    });
    return best?.i ?? null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const [sx, sy] = local(e);
    const i = nodeAt(sx, sy);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (i != null) {
      setSelected(i);
      drag.current = { kind: 'node', i, moved: false };
    } else if (draft && selected != null && !placed(draft[selected])) {
      onPlace(selected, ...toImage(sx, sy));
      drag.current = null;
    } else {
      drag.current = { kind: 'pan', sx, sy, cx, cy };
    }
  };
  const onPointerMove = (e) => {
    const [sx, sy] = local(e);
    const d = drag.current;
    if (!d) { setHover(nodeAt(sx, sy)); return; }
    if (d.kind === 'node') {
      d.moved = true;
      const [x, y] = toImage(sx, sy);
      onMove(d.i, Math.max(0, Math.min(w, x)), Math.max(0, Math.min(h, y)));
    } else {
      setView((v) => ({ ...v, cx: d.cx - (sx - d.sx) / scale, cy: d.cy - (sy - d.sy) / scale }));
    }
  };
  const onPointerUp = () => {
    if (drag.current?.kind === 'node' && drag.current.moved) onCommit();
    drag.current = null;
  };
  const onWheel = (e) => {
    const [sx, sy] = local(e);
    const [x, y] = toImage(sx, sy);
    const zoom = Math.max(1, Math.min(12, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const s = (size / Math.max(w, h)) * zoom;
    // keep the image point under the pointer
    setView({ zoom, cx: x - (sx - size / 2) / s, cy: y - (sy - size / 2) / s });
  };
  // the page must not scroll while zooming
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const stop = (e) => e.preventDefault();
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);

  return (
    <div className="pose-canvas-wrap" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block', cursor: hover != null ? 'grab' : 'crosshair' }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)} onWheel={onWheel}
              onDoubleClick={(e) => {
                const [sx, sy] = local(e);
                if (!draft && ghost) onUsePrediction();
                else if (nodeAt(sx, sy) == null) setView({ zoom: 1, cx: null, cy: null });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                const i = nodeAt(...local(e));
                if (i != null) { setSelected(i); onToggle(i); }
              }} />
      {!image && <div className="pose-canvas-msg">Loading the frame…</div>}
      {image && !draft && (
        <div className="pose-canvas-msg">
          {ghost ? 'Not labelled: double click (or Enter) to start from the prediction drawn' : 'Not labelled and no prediction: start from the mean instance (Enter)'}
        </div>
      )}
    </div>
  );
}

export default function SleapLabelsTab({ active, currentExperiment, request, viewerFrame, onOpenInPose }) {
  const { log } = useConsole();
  const [files, setFiles] = useState([]);
  const [file, setFile] = useState(() => { try { return localStorage.getItem(FILE_KEY); } catch { return null; } });
  const [data, setData] = useState(null);         // /api/sleap/labels
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [flyFilter, setFlyFilter] = useState('');
  const [current, setCurrent] = useState(null);   // {chunk, lid, idx, fly, frame_number}
  const [frame, setFrame] = useState(null);       // /api/sleap/frame of current
  const [image, setImage] = useState(null);
  const [draft, setDraft] = useState(null);       // [[x, y, visible]] per node, null = no user instance
  const [selected, setSelected] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [status, setStatus] = useState(null);     // dirty, saving, last_saved, error
  const [pending, setPending] = useState(0);      // writes queued here
  const [newFly, setNewFly] = useState('');
  const [newFrame, setNewFrame] = useState('');
  const [rootEl, setRootEl] = useState(null);
  const [viewEl, setViewEl] = useState(null);
  const fillHeight = useFillHeight(rootEl, [active, data]);
  const { width: viewWidth } = useElementSize(viewEl);
  const queue = useRef(Promise.resolve());
  const undo = useRef([]);                        // [{key, target, before}]
  const latest = useRef(0);
  const draftRef = useRef(null);
  draftRef.current = draft;

  useEffect(() => { try { if (file) localStorage.setItem(FILE_KEY, file); } catch { /* ignore */ } }, [file]);

  const fetchFiles = useCallback(() => api.get('/api/sleap/files').then((r) => {
    const list = unwrap(r.data).files;
    setFiles(list);
    setFile((f) => (list.some((x) => x.name === f) ? f : list[0]?.name ?? null));
  }).catch((err) => log('error', `SLEAP files: ${errorOf(err)}`)), [log]);

  useEffect(() => { if (active && !files.length) fetchFiles(); }, [active, files.length, fetchFiles]);

  const fetchLabels = useCallback(() => {
    if (!file) return Promise.resolve();
    setLoading(true);
    return api.get('/api/sleap/labels', { params: { file } })
      .then((r) => { const d = unwrap(r.data); setData(d); setStatus(d); })
      .catch((err) => { setData(null); log('error', `SLEAP labels of ${file}: ${errorOf(err)}`); })
      .finally(() => setLoading(false));
  }, [file, log]);

  // read when first shown for this file and experiment
  const fetchedFor = useRef(null);
  useEffect(() => {
    if (!active || !file || !currentExperiment || fetchedFor.current === `${file}|${currentExperiment}`) return;
    fetchedFor.current = `${file}|${currentExperiment}`;
    fetchLabels();
  }, [active, file, currentExperiment, fetchLabels]);

  // another experiment or file: nothing open
  useEffect(() => { setCurrent(null); setFrame(null); setDraft(null); undo.current = []; }, [file, currentExperiment]);

  useEffect(() => {
    if (data?.flies?.length && !data.flies.includes(newFly)) setNewFly(data.flies[0]);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (viewerFrame != null && newFrame === '') setNewFrame(String(viewerFrame)); }, [viewerFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = data?.nodes || [];
  const frames = useMemo(() => (data?.frames || []).filter((f) => (
    (filter === 'all' || (filter === 'done' ? f.user : !f.user)) && (!flyFilter || f.fly === flyFilter)
  )), [data, filter, flyFilter]);

  // Frame + image of `current`; the latest request wins
  useEffect(() => {
    if (!current || !file) return;
    const id = ++latest.current;
    setImage(null);
    setSelected(null);
    const params = { file, chunk: current.chunk, lid: current.lid, idx: current.idx };
    api.get('/api/sleap/frame', { params })
      .then((r) => {
        if (id !== latest.current) return;
        const d = unwrap(r.data);
        setFrame(d);
        setDraft(d.user);
      })
      .catch((err) => { if (id === latest.current) { setFrame({ error: errorOf(err) }); setDraft(null); } });
    const img = new Image();
    img.onload = () => { if (id === latest.current) setImage(img); };
    img.onerror = () => { if (id === latest.current) log('error', `Could not read frame ${current.idx} of chunk ${current.chunk}`); };
    img.src = apiUrl(`/api/sleap/image?${new URLSearchParams({ ...params })}`);
  }, [current, file, log]);

  // Writes: one queue, sent in order
  const send = useCallback((target, points) => {
    setPending((n) => n + 1);
    queue.current = queue.current.then(() => api.post('/api/sleap/frame', { file, ...target, points })
      .then((r) => {
        const d = unwrap(r.data);
        setStatus(d);
        setData((old) => {
          if (!old) return old;
          const k = keyOf(target);
          const rest = old.frames.filter((f) => keyOf(f) !== k);
          const before = old.frames.find((f) => keyOf(f) === k);
          if (!d.user && !before?.predicted && !before?.suggested) return { ...old, frames: rest };
          const entry = { ...(before || { suggested: false }), ...target, user: d.user, predicted: d.predicted };
          const list = [...rest, entry].sort((a, b) => (a.fly || '').localeCompare(b.fly || '') || a.frame_number - b.frame_number);
          return { ...old, frames: list };
        });
      })
      .catch((err) => log('error', `Not saved (frame ${target.frame_number}): ${errorOf(err)}`))
      .finally(() => setPending((n) => n - 1)));
  }, [file, log]);

  const targetOf = useCallback(() => current && {
    chunk: current.chunk, lid: current.lid, idx: current.idx, fly: frame?.fly ?? current.fly, frame_number: current.frame_number,
  }, [current, frame]);

  // Changes of the current frame: undo keeps what it was before, then it is sent
  const before = useRef(null);
  const commit = useCallback((points, previous = before.current) => {
    const target = targetOf();
    if (!target) return;
    undo.current.push({ key: keyOf(target), target, before: previous });
    if (undo.current.length > UNDO_DEPTH) undo.current.shift();
    before.current = null;
    setDraft(points);
    send(target, points);
  }, [targetOf, send]);

  const edit = useCallback((change) => {
    const old = draftRef.current;
    if (!old) return;
    const points = change(old.map((p) => [...p]));
    commit(points, old);
  }, [commit]);

  const onMove = useCallback((i, x, y) => {
    setDraft((d) => {
      if (before.current == null) before.current = d;
      const next = d.map((p) => [...p]);
      next[i] = [x, y, placed(d[i]) ? d[i][2] : true];   // a moved point keeps its visibility
      return next;
    });
  }, []);
  const onDragEnd = useCallback(() => commit(draftRef.current), [commit]);
  const toggleVisible = useCallback((i) => edit((p) => {
    if (placed(p[i])) p[i][2] = !p[i][2];
    return p;
  }), [edit]);
  const place = useCallback((i, x, y) => edit((p) => { p[i] = [x, y, true]; return p; }), [edit]);

  // where a new instance starts: the prediction of the file, of the pose file, else the template
  const ghost = useMemo(() => {
    if (!frame || frame.error) return null;
    return frame.predicted?.points || frame.pose_file || null;
  }, [frame]);
  // the template: the mean instance of the file laid along the fly (head at either end)
  const start = useCallback((from) => {
    const template = frame?.template;
    let points;
    if (from === 'prediction' && ghost) {
      points = ghost.map((p, i) => (p ? [p[0], p[1], true] : template ? [template[i][0], template[i][1], false] : [null, null, false]));
    } else if (template) points = template.map((p) => [...p]);
    else return;
    commit(points, null);
  }, [ghost, frame, commit]);
  // head and tail swapped: every point turned 180° around the thorax (else their centre)
  const rotate = useCallback(() => edit((p) => {
    const t = p[nodes.indexOf('thorax')];
    const pts = p.filter(placed);
    const [cx, cy] = placed(t) ? t : [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
    return p.map((q) => (placed(q) ? [2 * cx - q[0], 2 * cy - q[1], q[2]] : q));
  }), [edit, nodes]);
  const remove = useCallback(() => {
    if (!draft) return;
    if (!window.confirm('Delete the user instance of this frame? (Ctrl+Z brings it back)')) return;
    commit(null, draft);
  }, [draft, commit]);

  const undoLast = useCallback(() => {
    const last = undo.current.pop();
    if (!last) { log('info', 'Nothing to undo'); return; }
    send(last.target, last.before);
    if (current && keyOf(current) === last.key) setDraft(last.before);
    else queue.current = queue.current.then(() => setCurrent({ ...last.target }));   // read once written
  }, [send, current, log]);

  const saveNow = useCallback(() => {
    queue.current = queue.current.then(() => api.post('/api/sleap/save', { file })
      .then((r) => { setStatus(unwrap(r.data)); log('success', `${file} saved`); })
      .catch((err) => { setStatus(err.response?.data || null); log('error', `${file} not saved: ${errorOf(err)}`); }));
  }, [file, log]);

  const reload = useCallback(() => {
    if (status?.dirty && !window.confirm(`Drop the ${status.dirty} change(s) not written to ${file} yet and read it again?`)) return;
    api.post('/api/sleap/reload', { file })
      .then((r) => {
        const d = unwrap(r.data);
        if (d.dropped) log('warning', `${d.dropped} change(s) dropped`);
        undo.current = [];
        return fetchLabels().then(() => setCurrent((c) => c && { ...c }));
      })
      .catch((err) => log('error', `Could not read ${file} again: ${errorOf(err)}`));
  }, [file, status, fetchLabels, log]);

  // The server writes a couple of seconds after the last change: follow it
  useEffect(() => {
    if (!file || !(status?.dirty || status?.saving)) return undefined;
    const timer = setInterval(() => {
      api.get('/api/sleap/status', { params: { file } }).then((r) => setStatus(unwrap(r.data))).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [file, status?.dirty, status?.saving]);

  const openFly = useCallback((fly, frameNumber) => {
    api.get('/api/sleap/locate', { params: { fly, frame_number: frameNumber } })
      .then((r) => {
        const d = unwrap(r.data);
        if (!d.has_video) log('warning', `${fly} has no single-animal video of chunk ${d.chunk}: this frame cannot be labelled`);
        setCurrent({ chunk: d.chunk, lid: d.lid, idx: d.idx, fly: d.fly, frame_number: d.frame_number });
      })
      .catch((err) => log('error', `Cannot open frame ${frameNumber} of ${fly}: ${errorOf(err)}`));
  }, [log]);

  useEffect(() => {
    if (request && data) openFly(request.fly, request.frameNumber);
  }, [request, data?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const position = current ? frames.findIndex((f) => keyOf(f) === keyOf(current)) : -1;
  const step = useCallback((d) => {
    if (!frames.length) return;
    let i;
    if (position >= 0) i = position + d;
    else if (current) {
      // not in the list: the next / previous one in its order
      const after = frames.findIndex((f) => (f.fly || '') > (current.fly || '') || (f.fly === current.fly && f.frame_number > current.frame_number));
      i = d > 0 ? (after < 0 ? frames.length : after) : (after < 0 ? frames.length : after) - 1;
    } else i = d > 0 ? 0 : frames.length - 1;
    if (i >= 0 && i < frames.length) setCurrent({ ...frames[i] });
  }, [frames, position, current]);

  // keys (while shown, not in a field)
  const keys = useRef({});
  keys.current = { step, undoLast, saveNow, toggleVisible, rotate, selected, draft, ghost, start, nodes };
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = keys.current;
      if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); k.undoLast(); return; }
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); k.saveNow(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); k.step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); k.step(1); }
      else if (e.key === 'Tab' && k.nodes.length) {
        e.preventDefault();
        const n = k.nodes.length;
        setSelected((s) => (s == null ? (e.shiftKey ? n - 1 : 0) : (s + (e.shiftKey ? n - 1 : 1)) % n));
      }
      else if ((e.key === 'v' || e.key === 'V') && k.selected != null && k.draft) k.toggleVisible(k.selected);
      else if ((e.key === 'r' || e.key === 'R') && k.draft) k.rotate();
      else if (e.key === 'Enter' && !k.draft) { e.preventDefault(); k.start(k.ghost ? 'prediction' : 'template'); }
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const counts = useMemo(() => {
    const all = data?.frames || [];
    return { all: all.length, done: all.filter((f) => f.user).length };
  }, [data]);
  // the frame card: header, image, the actions below it
  const mainHeight = fillHeight ? fillHeight - 60 : 640;
  const size = Math.max(260, Math.min((viewWidth || 600) - 24, mainHeight - 140));
  const saveState = pending > 0 ? 'Sending…' : status?.error ? 'Not saved' : status?.saving ? 'Saving…'
    : status?.dirty ? `${status.dirty} change${status.dirty > 1 ? 's' : ''} to write…`
    : status?.last_saved ? `Saved ${new Date(status.last_saved * 1000).toLocaleTimeString()}` : 'No changes';
  const fileInfo = files.find((f) => f.name === file);

  if (!files.length) {
    return <div className="ov"><div className="card ov-controls toolbar">{active ? 'Looking for SLEAP label files…' : ''}</div></div>;
  }

  return (
    <div className="ov" ref={setRootEl}>
      <div className="card ov-controls toolbar">
        <label className="field">
          File
          <select value={file || ''} onChange={(e) => setFile(e.target.value)}>
            {files.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </label>
        {fileInfo && <span className="ov-count" title={`Last modified ${new Date(fileInfo.mtime * 1000).toLocaleString()}`}>
          {data?.totals ? `${data.totals.user_frames.toLocaleString()} labelled frames in ${data.totals.videos} videos` : ''}
        </span>}
        <button onClick={reload} title="Read the file again from disk (drops changes not written yet)">Reload</button>
        <span className="toolbar-sep" />
        <span className={`sl-save${status?.error ? ' sl-save-error' : ''}`} title={status?.error || 'Changes are written to the file a couple of seconds after the last one'}>
          {saveState}
        </span>
        <button onClick={saveNow} disabled={!status?.dirty} title="Write the file now (Ctrl+S)">Save now</button>
        <button onClick={undoLast} title="Undo the last change (Ctrl+Z)">↶ Undo</button>
        <span className="toolbar-sep" />
        <label className="field">
          Label a frame of
          <select value={newFly} onChange={(e) => setNewFly(e.target.value)}>
            {(data?.flies || []).map((f) => <option key={f} value={f}>fly {flyNo(f)}</option>)}
          </select>
        </label>
        <label className="field">
          frame
          <input type="number" value={newFrame} style={{ width: 110 }} onChange={(e) => setNewFrame(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && newFrame !== '') openFly(newFly, Number(newFrame)); }} />
        </label>
        <button onClick={() => newFrame !== '' && openFly(newFly, Number(newFrame))} disabled={!newFly || newFrame === ''}>Open</button>
        <button onClick={() => viewerFrame != null && setNewFrame(String(viewerFrame))} title="The Group viewer's frame">Viewer frame</button>
      </div>

      {status?.error && <div className="card qc-pad sl-error">{status.error}</div>}

      <div className="sl-main" style={{ height: mainHeight }}>
        <section className="card sl-list">
          <header className="card-header">
            <span>Frames of this experiment</span>
            <span className="ov-count">{counts.done} / {counts.all} labelled</span>
          </header>
          <div className="sl-filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={filter === k ? 'btn-primary' : undefined} onClick={() => setFilter(k)}>{label}</button>
            ))}
            <select value={flyFilter} onChange={(e) => setFlyFilter(e.target.value)} title="Fly">
              <option value="">all flies</option>
              {(data?.flies || []).map((f) => <option key={f} value={f}>fly {flyNo(f)}</option>)}
            </select>
          </div>
          <div className="ov-scroll sl-scroll">
            {loading && <div className="qc-muted qc-pad">Reading {file}…</div>}
            {!loading && data && !frames.length && (
              <div className="qc-muted qc-pad">No frames {filter === 'all' ? '' : filter === 'todo' ? 'to label ' : 'labelled '}of this experiment in {file}. Label any frame with “Label a frame of”.</div>
            )}
            <table className="pe-table ov-table pose-table sl-table">
              <tbody>
                {frames.map((f) => (
                  <tr key={keyOf(f)} className={current && keyOf(current) === keyOf(f) ? 'pose-selected' : undefined}
                      onClick={() => setCurrent({ ...f })} ref={current && keyOf(current) === keyOf(f) ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
                    <td title={f.user ? 'Labelled' : f.predicted ? 'Prediction only' : 'Suggested'}>
                      <span className={`sl-dot ${f.user ? 'sl-done' : f.predicted ? 'sl-pred' : 'sl-sugg'}`} />
                    </td>
                    <td>fly {flyNo(f.fly)}</td>
                    <td className="qc-num">{f.frame_number.toLocaleString()}</td>
                    <td className="qc-muted">chunk {f.chunk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qc-muted qc-pad">
            <span className="sl-dot sl-done" /> labelled <span className="sl-dot sl-pred" /> prediction only <span className="sl-dot sl-sugg" /> suggested
          </div>
        </section>

        <section className="card sl-view" ref={setViewEl}>
          <header className="card-header">
            {current ? (
              <span>
                Fly {flyNo(frame?.fly ?? current.fly)} · frame {current.frame_number.toLocaleString()}
                <span className="ov-count"> · chunk {current.chunk}, local id {current.lid}, index {current.idx}{position >= 0 ? ` · ${position + 1} of ${frames.length}` : ''}</span>
              </span>
            ) : <span>No frame open</span>}
            <span className="spacer" />
            <button onClick={() => step(-1)} title="Previous frame of the list (←)">◀</button>
            <button onClick={() => step(1)} title="Next frame of the list (→)">▶</button>
            <label className="field"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />Labels</label>
          </header>
          <div className="card-body">
            {current && !frame?.error && (
              <SleapCanvas image={image} size={size} nodes={nodes} edges={data?.edges || []} draft={draft} ghost={ghost}
                           selected={selected} setSelected={setSelected} showLabels={showLabels}
                           onMove={onMove} onCommit={onDragEnd} onToggle={toggleVisible} onPlace={place}
                           onUsePrediction={() => start('prediction')} />
            )}
            {frame?.error && <div className="qc-muted">{frame.error}</div>}
            {!current && <div className="qc-muted">Pick a frame in the list, or open any frame of a fly with “Label a frame of”.</div>}
            {current && (
              <div className="toolbar sl-actions">
                {!draft && <button className="btn-primary" disabled={!ghost} onClick={() => start('prediction')}
                                   title={frame?.predicted ? 'The prediction stored in the file' : 'The prediction of the fly\'s pose file'}>
                  Start from prediction (Enter)</button>}
                {!draft && <button onClick={() => start('template')} disabled={!frame?.template}
                                   title="The mean instance of the file, laid along the fly (the head may end up at the tail: Rotate 180°)">
                  Start from mean instance</button>}
                {draft && <button onClick={rotate} title="Turn every point 180° around the thorax: head and abdomen swapped (R)">Rotate 180°</button>}
                {draft && <button onClick={remove} title="Delete this frame's user instance">Delete label</button>}
                {current && onOpenInPose && frame?.fly && <button onClick={() => onOpenInPose(frame.fly, current.frame_number)}>Open in Pose</button>}
                <span className="qc-muted">
                  Drag a point to move it · right click: visible / not visible (V) · Tab: next point · wheel: zoom · drag the image: pan · double click: reset zoom
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="card sl-side">
          <header className="card-header">
            <span>Points</span>
            <span className="spacer" />
            {draft && <span className="ov-count">{draft.filter((p) => placed(p) && p[2]).length} of {nodes.length} visible</span>}
          </header>
          <div className="ov-scroll">
            <table className="pe-table ov-table pose-table">
              <thead><tr><th>Body part</th><th>x</th><th>y</th><th title="Visible">Vis.</th><th title="Score of the prediction drawn dashed">Pred.</th></tr></thead>
              <tbody>
                {nodes.map((name, i) => {
                  const p = draft?.[i];
                  return (
                    <tr key={name} className={i === selected ? 'pose-selected' : undefined} onClick={() => setSelected(i)}>
                      <td><span className="qc-swatch" style={{ background: nodeColor(name), border: '1px solid #0006' }} />{name}</td>
                      <td className="qc-num">{placed(p) ? fix(p[0]) : ''}</td>
                      <td className="qc-num">{placed(p) ? fix(p[1]) : draft ? <span className="qc-muted">{i === selected ? 'click the image' : 'not placed'}</span> : ''}</td>
                      <td>{draft && <input type="checkbox" checked={!!(placed(p) && p[2])} disabled={!placed(p)}
                                           onClick={(e) => e.stopPropagation()} onChange={() => toggleVisible(i)} />}</td>
                      <td className="qc-num qc-muted">{frame?.predicted?.points?.[i] ? fix(frame.predicted.points[i][2], 2) : frame?.pose_file?.[i] ? fix(frame.pose_file[i][2], 2) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {frame && !frame.error && (
            <div className="qc-muted qc-pad">
              Prediction drawn: {frame.predicted ? `in the file (score ${fix(frame.predicted.score, 2)})` : frame.pose_file ? 'the fly\'s pose file' : 'none'}
              {frame.video ? '' : ' · chunk video not in the file yet: added when labelled'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
