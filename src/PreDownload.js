// "Pre-download" card of the Annotate tab: fetch every frame of the scenes (images as H.264 decoded here, boxes,
// proposals, saved annotations) into this browser, so stepping through them asks the server nothing (annotatePack.js)
import React, { useEffect, useMemo, useState } from 'react';
import { storageEstimate, persistStorage } from './annotatePack';

const MB = 1e6;
const fmtMB = (b) => (b == null ? '…' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / MB)} MB`);
const fmtS = (s) => (s == null || !Number.isFinite(s) ? '…' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const BYTES_PER_FRAME = 21000;   // estimate before the server has built a chunk (stream ~20 kB + data ~0.3 kB a frame)

export default function PreDownload({ pack, version, shownScenes, chunksize, currentChunk, log }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('fh-annotate-predownload-open') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('fh-annotate-predownload-open', open ? '1' : '0'); } catch { /* ignore */ } }, [open]);
  const [scope, setScope] = useState(() => { try { return localStorage.getItem('fh-annotate-predownload-scope') || 'listed'; } catch { return 'listed'; } });
  useEffect(() => { try { localStorage.setItem('fh-annotate-predownload-scope', scope); } catch { /* ignore */ } }, [scope]);
  const [progress, setProgress] = useState(null);
  const [estimate, setEstimate] = useState(null);
  useEffect(() => { if (open) storageEstimate().then(setEstimate); }, [open, version]);
  useEffect(() => { if (open && pack && !pack.status) pack.refresh().catch((err) => log('warning', `Pre-download: ${err.message}`)); }, [open, pack, log]);

  const status = pack?.status;
  // the chunks asked for, in the order the scenes are worked through (the open frame's chunk first)
  const chunks = useMemo(() => {
    if (!status || !chunksize) return [];
    const have = new Set(status.chunks.map((c) => c.chunk));
    let list;
    if (scope === 'all') list = status.chunks.map((c) => c.chunk);
    else {
      const seen = new Set();
      list = [];
      for (const s of shownScenes) {
        for (const c of [Math.floor(s.start / chunksize), Math.floor((s.start + s.length - 1) / chunksize)]) {
          if (have.has(c) && !seen.has(c)) { seen.add(c); list.push(c); }
        }
      }
    }
    if (currentChunk != null && list.includes(currentChunk)) list = [currentChunk, ...list.filter((c) => c >= currentChunk && c !== currentChunk), ...list.filter((c) => c < currentChunk)];
    return list;
  }, [status, scope, shownScenes, chunksize, currentChunk]);

  const summary = useMemo(() => {
    if (!status || !pack) return null;
    const by = new Map(status.chunks.map((c) => [c.chunk, c]));
    let frames = 0; let bytes = 0; let keptFrames = 0; let built = 0;
    for (const c of chunks) {
      const s = by.get(c);
      frames += s.frames;
      bytes += s.built ? s.bytes + (s.data_bytes ?? s.frames * 300) : s.frames * BYTES_PER_FRAME;
      if (s.built) built += 1;
      const st = pack.stored(c);
      if (st.video && st.data) keptFrames += s.frames;
    }
    return { frames, bytes, keptFrames, built };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, chunks, pack, version, progress]);

  const running = !!pack?.run;
  const start = async () => {
    if (!pack || !chunks.length) return;
    const free = estimate ? estimate.quota - estimate.usage : null;
    const needed = summary ? Math.max(0, summary.bytes * (1 - summary.keptFrames / Math.max(1, summary.frames))) : 0;
    if (free != null && needed > free * 0.9) {
      log('error', `Pre-download: ~${fmtMB(needed)} needed, the browser lets this site keep ${fmtMB(free)} more. Pick fewer scenes (ZT range, filter) or clear other experiments`);
      return;
    }
    const persisted = await persistStorage();
    if (!persisted) log('info', 'Pre-download: the browser may drop what is kept here when it runs short of space (storage not persistent)');
    log('info', `Pre-download: ${summary.frames.toLocaleString()} frames in ${chunks.length} chunks (~${fmtMB(needed)})…`);
    try {
      const r = await pack.download(chunks, setProgress);
      log(r.cancelled ? 'warning' : 'info', `Pre-download ${r.cancelled ? 'stopped' : 'done'}: ${fmtMB(r.bytes)} in ${fmtS(r.seconds)}`);
    } catch (err) {
      log('error', `Pre-download: ${err?.response?.data?.error || err.message}`);
    }
    storageEstimate().then(setEstimate);
  };
  const clear = async () => {
    if (!pack || !window.confirm(`Delete the ${fmtMB(pack.keptBytes())} pre-downloaded for this experiment from this browser? (The annotations are on the server: nothing is lost)`)) return;
    await pack.clear();
    setProgress(null);
    storageEstimate().then(setEstimate);
    log('info', 'Pre-download deleted from this browser');
  };

  const p = running ? progress : null;
  const pct = p && p.toFetch ? (100 * p.bytes) / p.toFetch : p && p.total ? (100 * p.frames) / p.total : summary && summary.frames ? (100 * summary.keptFrames) / summary.frames : 0;
  return (
    <section className="card bx-pre">
      <header className="card-header" onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer' }}>
        <span>{open ? '▾' : '▸'} Pre-download</span>
        <span className="ov-count">
          {summary ? `${summary.keptFrames.toLocaleString()} / ${summary.frames.toLocaleString()} frames here (${fmtMB(pack.keptBytes())})` : pack?.error ? pack.error : ''}
          {running && p ? ` · ${p.phase === 'waiting' ? 'waiting for the server' : 'downloading'} ${Math.round(pct)}%` : ''}
        </span>
        {!pack?.videoOk && <span className="bx-pre-warn" title="WebCodecs (VideoDecoder) is missing: only the boxes are pre-downloaded, the images still come from the server">no video decoding in this browser</span>}
      </header>
      {open && (
        <div className="card-body bx-pre-body">
          <div className="toolbar">
            <label className="field" title="Which scenes: those listed (the To do / ◆ / ⚑ filter and the ZT range of the list), or every scene. Whole chunks are fetched">
              Scenes
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={running}>
                <option value="listed">listed ({shownScenes.length.toLocaleString()})</option>
                <option value="all">all</option>
              </select>
            </label>
            <span className="ov-count" title="Frames of the chunks holding those scenes; size of the frames (H.264, ~20 kB a frame) and of their boxes; built = made on the server already">
              {summary ? `${summary.frames.toLocaleString()} frames · ${chunks.length} chunks · ~${fmtMB(summary.bytes)} · built on the server ${summary.built} / ${chunks.length}` : 'reading…'}
            </span>
            {estimate && (
              <span className="ov-count" title="What this site keeps in the browser, of what the browser allows it">
                · browser storage {fmtMB(estimate.usage)} of {fmtMB(estimate.quota)}
              </span>
            )}
            <span className="spacer" />
            {running ? (
              <button className="btn-danger" onClick={() => pack.cancel()} title="Stop after the chunks being fetched (what is fetched stays; Pre-download again resumes)">■ Stop</button>
            ) : (
              <button className="btn-primary" onClick={start} disabled={!summary || !chunks.length || summary.keptFrames === summary.frames}
                      title="Fetch every frame of these scenes into this browser (resumes where it stopped). The server makes what it has not made yet (H.264 + boxes, minutes); stepping through them then asks the server nothing">
                {summary && summary.frames && summary.keptFrames === summary.frames ? '✓ All here'
                  : `⇩ ${summary && summary.keptFrames ? 'Resume pre-download' : 'Pre-download'}`}
              </button>
            )}
            <button onClick={clear} disabled={running || !pack?.keptBytes()} title="Delete what is kept in this browser for this experiment">Clear</button>
          </div>
          {(running || progress) && (
            <div className="bx-pre-progress">
              <div className="bx-pre-bar"><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
              <span className="ov-count">
                {p ? <>
                  {p.frames.toLocaleString()} / {p.total.toLocaleString()} frames · {p.chunks} / {p.nChunks} chunks · {fmtMB(p.bytes)} of ~{fmtMB(p.toFetch)} fetched
                  {' · '}{fmtS(p.seconds)}{p.eta != null && p.frames < p.total ? ` · ~${fmtS(p.eta)} left` : ''}
                  {p.serverBuilt < p.nChunks ? ` · server built ${p.serverBuilt} / ${p.nChunks}${p.serverJob ? ` (${Math.round(100 * (p.serverJob.items?.[0]?.progress || 0))}% of its job)` : ''}` : ''}
                </> : progress ? `Last run: ${progress.phase}, ${fmtMB(progress.bytes)} in ${fmtS(progress.seconds)}` : ''}
              </span>
            </div>
          )}
          <div className="qc-muted">
            Frames kept here open without asking the server (images decoded in the browser). Saves still go to the
            server at once; frames they change (continuity proposals after a saved frame, labels carried) are read
            from the server again. Kept until cleared, also after reloading the page; fetched again only when the
            scenes, the tracking or another person's saves change them.
          </div>
        </div>
      )}
    </section>
  );
}
