// Group viewer card "ROIs & segmentation": the ROIs of the loaded experiment's
// idtrackerai settings (database, <date>.toml, landmarks.toml, <date>.conf; read-only,
// from /api/rois), drawn on the frame, and a segmentation preview with one of them
// (contours from /api/preprocess?source=, also for experiments without database).
// Which kinds are shown is kept across experiments (fh-rois-shown, fh-rois-segment).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';
import CardResizer from './CardResizer';

const COLORS = {
  database: '#f59e0b',
  toml: '#06b6d4',
  landmarks: '#ec4899',
  conf: '#84cc16',
};

// Source ids name files of one experiment (<date>.toml): kinds hold across experiments
export function sourceKind(id) {
  if (id === 'database') return 'database';
  if (id === 'landmarks.toml') return 'landmarks';
  if (id?.endsWith('.toml')) return 'toml';
  return 'conf';
}

const KIND_TITLES = {
  database: 'idtrackerai_conf stored in the database',
  toml: 'idtrackerai settings the experiment was tracked with',
  landmarks: 'idtrackerai settings marking the landmarks',
  conf: 'idtrackerai v4 settings (used for experiments without database)',
};

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function range([lo, hi]) {
  return `${lo ?? '−∞'}–${hi ?? '∞'}`;
}

function RoiPanel({ experiment, segmentationSource, setSegmentationSource, onOverlaysChange, segmentation }) {
  const [open, setOpen] = useState(() => readStored('fh-rois-open', false));
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);
  const [shownKinds, setShownKinds] = useState(() => readStored('fh-rois-shown', []));
  const [segmentKind, setSegmentKind] = useState(() => readStored('fh-rois-segment', null));
  const [expanded, setExpanded] = useState(null);     // source id whose ROI list is shown

  useEffect(() => writeStored('fh-rois-open', open), [open]);
  useEffect(() => writeStored('fh-rois-shown', shownKinds), [shownKinds]);
  useEffect(() => writeStored('fh-rois-segment', segmentKind), [segmentKind]);

  const fetchSources = useCallback(async () => {
    if (!experiment) { setSources([]); return; }
    try {
      const { data } = await api.get('/api/rois');
      setSources(data.sources || []);
      setError(null);
    } catch (err) {
      setSources([]);
      setError(err.response?.data?.error || err.message);
    }
  }, [experiment]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // Overlays drawn on the frame
  const overlays = useMemo(() => sources
    .filter((s) => !s.error && shownKinds.includes(sourceKind(s.id)))
    .map((s) => ({ id: s.id, color: COLORS[sourceKind(s.id)], rois: s.rois })), [sources, shownKinds]);
  useEffect(() => { onOverlaysChange(overlays); }, [overlays, onOverlaysChange]);

  // Segmentation source of this experiment for the remembered kind
  useEffect(() => {
    const source = sources.find((s) => !s.error && sourceKind(s.id) === segmentKind);
    setSegmentationSource(source ? source.id : null);
  }, [sources, segmentKind, setSegmentationSource]);

  const toggleShown = (kind) => setShownKinds((kinds) => (
    kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]
  ));

  const segmented = sources.find((s) => s.id === segmentationSource);
  const expected = segmented?.settings?.number_of_animals;
  const count = segmentation?.contours?.length ?? 0;
  const badge = segmentationSource
    ? `${count} blob${count === 1 ? '' : 's'}`
    : shownKinds.length > 0 && overlays.length > 0 ? 'ROIs shown' : null;

  return (
    <section className="card roi-card">
      <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <i className={`fa fa-caret-${open ? 'down' : 'right'}`} />
        ROIs &amp; segmentation
        <span className="spacer" />
        {badge && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{badge}</span>}
      </div>

      {open && (
        <div className="card-body roi-body">
          {error && <div className="roi-error">{error}</div>}
          {!error && sources.length === 0 && (
            <div className="roi-muted">No idtrackerai settings (database, .toml or .conf) for this experiment</div>
          )}

          {sources.length > 0 && (
            <table className="roi-table">
              <thead>
                <tr>
                  <th title="Draw the ROIs on the frame">ROIs</th>
                  <th>Source</th>
                  <th title="intensity_ths">Intensity</th>
                  <th title="area_ths (pixels)">Area</th>
                  <th title="number_of_animals">N</th>
                  <th title="Segment the frame with these settings">Segment</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const kind = sourceKind(s.id);
                  if (s.error) {
                    return (
                      <tr key={s.id}>
                        <td />
                        <td title={s.path}>{s.id}</td>
                        <td colSpan={4} className="roi-error">{s.error}</td>
                      </tr>
                    );
                  }
                  const { settings } = s;
                  const notes = [
                    settings.use_bkg && 'background subtraction (not applied in the preview)',
                    settings.resolution_reduction !== 1 && `resolution reduction ${settings.resolution_reduction} (not applied in the preview)`,
                    settings.track_wo_identities && 'tracked without identities',
                    settings.apply_roi === false && 'ROI not applied',
                  ].filter(Boolean);
                  return (
                    <React.Fragment key={s.id}>
                      <tr>
                        <td>
                          <label className="roi-swatch" style={{ '--roi-color': COLORS[kind] }}>
                            <input type="checkbox" checked={shownKinds.includes(kind)}
                                   disabled={s.rois.length === 0} onChange={() => toggleShown(kind)} />
                          </label>
                        </td>
                        <td title={`${KIND_TITLES[kind]}${s.path ? `\n${s.path}` : ''}${notes.length ? `\n${notes.join('\n')}` : ''}`}>
                          <button className="roi-link" onClick={() => setExpanded((e) => (e === s.id ? null : s.id))}>
                            <i className={`fa fa-caret-${expanded === s.id ? 'down' : 'right'}`} /> {s.id}
                          </button>
                          {notes.length > 0 && <i className="fa fa-info-circle roi-muted" style={{ marginLeft: 4 }} />}
                        </td>
                        <td>{range(settings.intensity)}</td>
                        <td>{range(settings.area)}</td>
                        <td>{settings.number_of_animals ?? '–'}</td>
                        <td>
                          <input type="radio" name="roi-segment" checked={segmentationSource === s.id}
                                 onChange={() => setSegmentKind(kind)} />
                        </td>
                      </tr>
                      {expanded === s.id && (
                        <tr className="roi-details">
                          <td />
                          <td colSpan={5}>
                            {s.rois.length === 0 && <div className="roi-muted">No ROI: the whole frame is segmented</div>}
                            <ol>
                              {s.rois.map((roi, i) => (
                                <li key={i} title={roi.label}>
                                  {roi.sign === '-' ? 'removes ' : ''}{roi.shape}, {roi.vertices.length} vertices
                                  {roi.label.length > 9 && <code>{roi.label.slice(2)}</code>}
                                </li>
                              ))}
                            </ol>
                            {notes.map((n) => <div key={n} className="roi-muted">{n}</div>)}
                            {settings.video_paths?.length > 0 && (
                              <div className="roi-muted">Configured on {settings.video_paths.join(', ')}</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {sources.length > 0 && (
            <div className="toolbar">
              <label className="field check">
                <input type="radio" name="roi-segment" checked={!segmentationSource}
                       onChange={() => setSegmentKind(null)} />
                No segmentation preview
              </label>
              <span className="spacer" />
              <button onClick={fetchSources} title="Read the files again">
                <i className="fa fa-refresh" />
              </button>
            </div>
          )}

          {segmentationSource && (
            <div className={`roi-readout${expected != null && count !== expected ? ' roi-warn' : ''}`}>
              {segmentation?.error
                ? segmentation.error
                : <>
                    <b>{count}</b> blob{count === 1 ? '' : 's'}{expected != null && ` (${expected} animals)`}
                    {segmentation?.areas?.length > 0 && (
                      <> · areas {segmentation.areas.map((a) => Math.round(a)).join(', ')}</>
                    )}
                  </>}
            </div>
          )}
        </div>
      )}
      {open && <CardResizer id="viewer-rois" />}
    </section>
  );
}

export default RoiPanel;
