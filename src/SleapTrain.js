// SleapTrain.js  —  "Train a model" panel of the SLEAP labels tab (sleap_train.py): queues
// sleap-train on the open labels file with the config of a previous model (default the newest
// complete one) in the GPU queue, shows that training's state and the models made so far,
// and the GPU queue card.
import React, { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import GpuQueueCard from './GpuQueue';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error ?? err.message;

export default function SleapTrain({ active, file }) {
  const { log } = useConsole();
  const [models, setModels] = useState(null);
  const [base, setBase] = useState('');
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([api.get('/api/sleap/models'), api.get('/api/sleap/train', { params: { file } })]);
      const list = unwrap(m.data).models;
      setModels(list);
      setBase((b) => b || list.find((x) => x.complete)?.name || '');
      setEntry(unwrap(t.data).entry);
      setError(null);
    } catch (err) {
      setError(errorOf(err));
    }
  }, [file]);

  useEffect(() => {
    if (!active) return undefined;
    fetchAll();
    const timer = setInterval(fetchAll, 10000);
    return () => clearInterval(timer);
  }, [active, fetchAll]);

  const train = async () => {
    if (!window.confirm(`Queue sleap-train on ${file} with the config of ${base}? It is saved first; it starts when the GPU has room `
      + 'and reads the file then. The model goes to the models folder under SLEAP\'s name.')) return;
    try {
      unwrap((await api.post('/api/sleap/train', { file, base_model: base })).data);
      log('info', `sleap-train on ${file} queued`);
      fetchAll();
    } catch (err) {
      log('error', `sleap-train: ${errorOf(err)}`);
    }
  };

  const isTrain = file?.startsWith('labels_train');
  const p = entry?.progress;
  return (
    <div className="sc-tab" style={{ paddingBottom: 0 }}>
      <section className="card">
        <div className="card-header">
          Train a model on {file}
          <span className="spacer" />
          {entry && <span className={`ov-normal sc-badge ${entry.status === 'running' ? 'sc-rec' : ''}`}>
            {entry.status === 'running' ? `training${p ? ` · ${p.done}/${p.total} epochs` : ''}` : `GPU queue #${entry.position}`}
          </span>}
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && <div className="ov-warn">{error}</div>}
          <div className="toolbar">
            <label className="field">Config of
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                {(models || []).filter((m) => m.complete).map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </label>
            <button className="btn-primary" onClick={train} disabled={!isTrain || !base || Boolean(entry)}
                    title={isTrain ? 'sleap-train in the GPU queue' : 'Train on a labels_train*.slp file'}>
              <i className="fa fa-play" style={{ marginRight: 6 }} />Queue training
            </button>
            {entry?.status === 'queued' && <span className="sc-small">{entry.reason || 'starting…'}</span>}
            {entry?.status === 'running' && p?.run && <span className="mono sc-small">{p.run}{p.val_loss != null ? ` · best val_loss ${p.val_loss.toExponential(3)}` : ''}</span>}
          </div>
          {models && (
            <div className="ov-scroll" style={{ maxHeight: 220 }}>
              <table className="ov-table">
                <thead><tr><th>Model</th><th>Frames</th><th>Epochs</th><th>Best val_loss</th><th /></tr></thead>
                <tbody>
                  {models.slice(0, 12).map((m) => (
                    <tr key={m.name}>
                      <td className="mono">{m.name}</td>
                      <td className="qc-num">{m.n.toLocaleString()}</td>
                      <td className="qc-num">{m.epochs ?? '–'}</td>
                      <td className="qc-num">{m.val_loss != null ? m.val_loss.toExponential(3) : '–'}</td>
                      <td className="sc-muted">{m.complete ? '' : 'no best_model.h5'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <GpuQueueCard active={active} />
    </div>
  );
}
