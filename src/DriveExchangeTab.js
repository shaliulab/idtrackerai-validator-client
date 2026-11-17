// DriveExchangeTab.js  —  "Drive exchange" tab: experiments and their Annotate tab annotations through a
// shared Google Drive folder (idtrackerai_validator_server/gdrive_exchange.py), so people running their
// own instance annotate by themselves.
//
// - Google Drive card: the rclone remote (configured once with `rclone config`) and your annotator name.
// - Loaded experiment card. Publisher (or not shared yet): Publish to Drive ("Whole experiment" tick:
//   the whole folder, or a minimal bundle: clips of the scene frames, cut-down database, contours,
//   scenes; exchange_bundle.py), Update annotations on Drive
//   (snapshot + scenes only), the annotators' uploads with Check (a merge plan). Annotator (downloaded from
//   Drive): Upload my annotations, Check for updates (the publisher's newer snapshot: merged work of
//   everyone, solver proposals, scenes).
// - A merge plan lists what comes in and the frames changed on both sides (conflicts), each kept from
//   here or taken from there; "newest" picks by save time. Apply writes it.
// - Experiments on Drive: every published experiment, Download (into $FLYHOSTEL_VIDEOS) / Open.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import { formatBytes } from './DataManagementTab';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error ?? err.message;
const flat = (name) => (name || '').replace(/\//g, '_').replace(/_arenas_(\d+)$/, '_arena$1');

const ago = (seconds) => {
  if (!seconds) return '';
  const s = Date.now() / 1000 - seconds;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleString() : '');

function useStoredFlag(key, initial) {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? initial : v === 'true'; } catch { return initial; }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
  };
  return [value, set];
}

function RoleBadge({ exchange }) {
  if (!exchange) return <span className="ov-badge" title="Not published from here, not downloaded from Drive">not shared</span>;
  if (exchange.role === 'publisher') return <span className="ov-badge ov-badge-loaded" title="Published to Drive from here">publisher</span>;
  return <span className="ov-badge ov-badge-repeat" title={`Downloaded from Drive (published by ${exchange.publisher || '?'})`}>annotator</span>;
}

function DriveSettings({ status, onSaved }) {
  const { log } = useConsole();
  const [remote, setRemote] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (status) { setRemote(status.remote || ''); setName(status.annotator || ''); }
  }, [status]);
  const changed = status && (remote !== (status.remote || '') || name !== (status.annotator || ''));
  const save = () => {
    setSaving(true);
    api.post('/api/exchange/config', { remote, annotator: name })
      .then(() => { log('success', 'Drive exchange settings saved'); onSaved(); })
      .catch((err) => log('error', `Drive exchange: ${errorOf(err)}`))
      .finally(() => setSaving(false));
  };
  const remoteName = (status?.remote || 'gdrive:').split(':')[0];
  return (
    <section className="card">
      <header className="card-header">
        <i className="fa fa-cloud" />
        <span>Google Drive</span>
        {status && (status.reachable
          ? <span className="ov-badge ov-badge-loaded">connected</span>
          : <span className="ov-badge xc-badge-bad">not connected</span>)}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="xc-link" onClick={() => setHelp(!help)}>{help ? 'Hide setup' : 'How to set up'}</button>
      </header>
      <div className="toolbar">
        <label className="field" title="rclone remote and folder shared with every annotator, e.g. gdrive:FlyHostelExchange">
          Shared folder
          <input type="text" value={remote} onChange={(e) => setRemote(e.target.value)}
                 onKeyDown={(e) => e.stopPropagation()} style={{ width: 260 }} />
        </label>
        <label className="field" title="Your name: your uploads go to annotations/<name>/ and your saved frames carry it (when the server has no login)">
          Your name
          <input type="text" value={name} placeholder="e.g. alice" onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => e.stopPropagation()} style={{ width: 140 }} />
        </label>
        <button className="solid" disabled={!changed || saving} onClick={save}>
          <i className={`fa ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{ marginRight: 6 }} />Save
        </button>
      </div>
      {status?.error && <div className="banner-danger dm-banner"><div>{status.error}</div></div>}
      {help && (
        <div className="card-body xc-help">
          <p>Experiments and annotations go through one Google Drive folder that the publisher shares with
            every annotator as <b>Editor</b>. Each person connects to it with <a href="https://rclone.org/drive/" target="_blank" rel="noreferrer">rclone</a>;
            your Google login stays in rclone's own configuration and is never sent to this server.</p>
          <ol>
            <li><b>Publisher</b> (once per annotator): in Google Drive, share the exchange folder (e.g. <code>FlyHostelExchange</code>) with
              the annotator's Google account as <b>Editor</b> and send them its link, <code>https://drive.google.com/drive/folders/&lt;FOLDER_ID&gt;</code>.
              The folder id is not a secret (sharing gives the access); your OAuth client id and secret are never needed by anyone else.</li>
            <li>Install the current rclone on the computer running this server (<a href="https://rclone.org/install/" target="_blank" rel="noreferrer">rclone.org/install</a>,
              e.g. <code>curl https://rclone.org/install.sh | sudo bash</code>). Not the Linux distribution's package: it is usually too old to sign in to Google.</li>
            <li>Run <code>rclone config</code>: <b>n</b> (new remote), name <code>{remoteName}</code>, storage <b>drive</b>;
              leave <b>client_id</b> and <b>client_secret</b> empty (Enter); scope <b>1</b> (full access: <i>drive.file</i> would hide the other people's files);
              <b>root_folder_id</b>: the <code>&lt;FOLDER_ID&gt;</code> of the link; <b>service_account_file</b>: Enter; advanced config <b>n</b>;
              web browser <b>y</b> and sign in with the Google account the folder is shared with; Shared Drive <b>n</b>; keep <b>y</b>, then <b>q</b>.
              On a computer without a browser (ssh) answer <b>n</b> and run the <code>rclone authorize "drive"</code> it prints on one that has a browser
              (same rclone version), then paste the result back.</li>
            <li>Check: <code>rclone lsd {remoteName}:</code> lists the published experiments, without error.</li>
            <li>Set <b>Shared folder</b> to <code>{remoteName}:</code> (remote name and colon, nothing after it: root_folder_id already points at the folder),
              <b>Your name</b> (it labels your uploads), and Save: the badge says connected. Instead of root_folder_id, a shortcut to the shared
              folder in My Drive also works; the shared folder is then <code>{remoteName}:FlyHostelExchange</code>.</li>
            <li>Annotators then <b>Download</b> an experiment below, annotate it in the Annotate tab, <b>Upload my annotations</b>, and <b>Check for updates</b> for the publisher's newer versions.</li>
            <li>Never paste the output of <code>rclone config</code> / <code>rclone config show</code> into a chat or email: it holds the sign-in token, which opens the whole Drive of that account.</li>
          </ol>
        </div>
      )}
    </section>
  );
}

function MergePlan({ plan, onApply, onCancel, onOpenFrame, applying }) {
  const [rule, setRule] = useState('newest');
  const [choice, setChoice] = useState({});
  useEffect(() => { setChoice({}); setRule('newest'); }, [plan]);
  const pick = (c) => choice[c.frame_number] ?? (rule === 'newest' ? c.default : rule);
  const fromThere = plan.conflicts.filter((c) => pick(c) === 'remote').length;
  const truncated = plan.n_conflicts > plan.conflicts.length;
  const side = (s) => (s ? `${s.author || '?'} · ${when(s.updated)} · ${s.n_boxes} box${s.n_boxes === 1 ? '' : 'es'} (${s.labels.join(' ') || '–'})` : 'not annotated');
  const source = plan.kind === 'pull' ? 'the publisher' : plan.annotator;
  return (
    <div className="xc-plan">
      <div className="xc-plan-summary">
        From <b>{source}</b>: <b>{plan.take}</b> frame{plan.take === 1 ? '' : 's'} to take, {plan.same} already the same,{' '}
        <b className={plan.n_conflicts ? 'xc-warn' : undefined}>{plan.n_conflicts} conflict{plan.n_conflicts === 1 ? '' : 's'}</b>
        {plan.kind === 'pull' && plan.bundle_updated && <> · <b>new bundle</b> (scenes and their frames updated)</>}
        {plan.kind === 'pull' && !plan.bundle_updated && plan.refreshed?.length > 0 && <> · scenes refreshed</>}
      </div>
      {plan.n_conflicts > 0 && (
        <>
          <div className="toolbar">
            <span>Frames changed on both sides:</span>
            <label className="field">
              keep
              <select value={rule} onChange={(e) => { setRule(e.target.value); setChoice({}); }}>
                <option value="newest">the newest save</option>
                <option value="local">the version here</option>
                <option value="remote">{`${source}'s version`}</option>
              </select>
            </label>
            {truncated && <span className="ov-count">first {plan.conflicts.length} of {plan.n_conflicts} shown (the rule applies to all)</span>}
          </div>
          <div className="ov-scroll xc-conflicts">
            <table className="pe-table ov-table">
              <thead><tr><th>Frame</th><th>Here</th><th>{source}</th></tr></thead>
              <tbody>
                {plan.conflicts.map((c) => (
                  <tr key={c.frame_number}>
                    <td><button className="xc-link mono" onClick={() => onOpenFrame?.(c.frame_number)} title="Open in the Annotate tab">{c.frame_number}</button></td>
                    {['local', 'remote'].map((k) => (
                      <td key={k}>
                        <label className="xc-choice">
                          <input type="radio" name={`c${c.frame_number}`} checked={pick(c) === k}
                                 onChange={() => setChoice((m) => ({ ...m, [c.frame_number]: k }))} />
                          {side(c[k])}
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="toolbar">
        <span className="ov-count">Save the frame open in the Annotate tab first: an unsaved edit there would overwrite what comes in.</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={onCancel} disabled={applying}>Discard</button>
        <button className="solid" disabled={applying} onClick={() => onApply(rule, choice)}
                title="Write these frames here (the rule decides the conflicts you did not pick one for)">
          <i className={`fa ${applying ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{ marginRight: 6 }} />
          Apply: take {plan.take + fromThere} frame{plan.take + fromThere === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function LoadedExperiment({ status, entry, currentExperiment, onChanged, onOpenFrame, onAnnotationsChanged }) {
  const { log, trackJob } = useConsole();
  const [local, setLocal] = useState(null);
  const [whole, setWhole] = useStoredFlag('fh-exchange-whole', false);
  const [busy, setBusy] = useState(null);
  const [plan, setPlan] = useState(null);
  const [applying, setApplying] = useState(false);
  const experiment = flat(currentExperiment);

  const fetchLocal = useCallback(() => {
    if (!currentExperiment) return;
    api.get('/api/exchange/local', { params: { experiment, size: 1 } })
      .then((r) => setLocal(unwrap(r.data)))
      .catch((err) => log('error', `Drive exchange: ${errorOf(err)}`));
  }, [currentExperiment, experiment, log]);
  useEffect(() => { setLocal(null); setPlan(null); fetchLocal(); }, [fetchLocal]);

  const job = useCallback((what, path, body, done) => {
    setBusy(what);
    return api.post(path, { experiment, ...body })
      .then((r) => trackJob(unwrap(r.data).job))
      .then((j) => {
        if (j?.status === 'done') done?.(j);
        fetchLocal();
        onChanged();
      })
      .catch((err) => log('error', `Drive exchange: ${errorOf(err)}`))
      .finally(() => setBusy(null));
  }, [experiment, trackJob, log, fetchLocal, onChanged]);

  if (!currentExperiment) return null;
  const exchange = local?.exchange;
  const role = exchange?.role;
  const manifest = entry?.manifest;
  const connected = status?.reachable;
  const annotators = entry?.annotators || [];
  const imported = exchange?.imports || {};

  const publish = (annotationsOnly) => {
    if (!annotationsOnly && !window.confirm(whole
      ? `Upload ${experiment} (${formatBytes(local?.bytes || 0)}, ${local?.n_files} files) to ${status.remote}?` +
        (manifest ? '\n\nIt is on Drive already: only what changed is sent.' : '')
      : `Make a minimal bundle of ${experiment} (clips of its scene frames, ~15 kB per frame; the first time it reads and ` +
        `segments every scene frame, which takes a while) and upload it to ${status.remote}?` +
        (manifest?.kind === 'minimal' ? '\n\nOnly the clips whose frames changed are made and sent again.' : ''))) return;
    job('publish', '/api/exchange/publish', { kind: whole ? 'full' : 'minimal', annotations_only: annotationsOnly },
      (j) => log('success', `${experiment} ${annotationsOnly ? 'annotations updated' : 'published'} on Drive (${formatBytes(j.result.bytes)})`));
  };
  const showPlan = (j) => setPlan(j.result ? { ...j.result, job_id: j.id } : null);
  const apply = (prefer, overrides) => {
    setApplying(true);
    api.post('/api/exchange/apply', { job_id: plan.job_id, prefer, overrides })
      .then((r) => {
        const out = unwrap(r.data);
        log('success', `Drive exchange: ${out.taken + out.conflicts_remote} frame(s) merged into ${experiment}` +
          (out.conflicts_local ? `, ${out.conflicts_local} conflict(s) kept from here` : '') +
          (out.proposals_copied ? ', solver proposals updated' : ''));
        setPlan(null);
        fetchLocal();
        onChanged();
        onAnnotationsChanged?.();
      })
      .catch((err) => log('error', `Drive exchange: ${errorOf(err)}`))
      .finally(() => setApplying(false));
  };

  return (
    <section className="card">
      <header className="card-header">
        <i className="fa fa-flask" />
        <span className="mono">{experiment}</span>
        {local && <RoleBadge exchange={exchange} />}
        {local?.annotations && <span className="ov-count">{local.annotations.frames} annotated frame{local.annotations.frames === 1 ? '' : 's'} here</span>}
      </header>
      <div className="card-body xc-body">
        {role !== 'annotator' && (
          <>
            <div className="toolbar">
              <label className="field" title="Whole experiment: the experiment folder as it is (every tab works with it). Unticked: a minimal bundle, only what the Annotate tab needs: clips of the scene frames, the database cut down to them, the blobs segmented here, the scenes">
                <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
                Whole experiment
              </label>
              <span className="ov-count">
                {local?.bytes != null && whole && `${formatBytes(local.bytes)}, ${local.n_files} files`}
                {!whole && 'minimal bundle: scene frames only (made when publishing)'}
              </span>
              {local && !local.scene_qc && <span className="ov-badge xc-badge-bad" title="No flyhostel/validation/scene_qc.csv: annotators get only the unsure chunk boundaries as scenes. Prepare scenes in the Annotate tab first.">no scenes prepared</span>}
              <span className="spacer" style={{ flex: 1 }} />
              <button className="solid" disabled={!connected || !!busy || !!local?.bundle} onClick={() => publish(false)}
                      title={manifest ? 'Send what changed in the folder, the annotations and the manifest' : 'Upload the experiment to the shared folder'}>
                <i className={`fa ${busy === 'publish' ? 'fa-spinner fa-spin' : 'fa-cloud-upload'}`} style={{ marginRight: 6 }} />
                {manifest ? 'Publish again' : 'Publish to Drive'}
              </button>
              <button disabled={!connected || !!busy || !manifest} onClick={() => publish(true)}
                      title="Send only a snapshot of the annotations here (merged work, solver proposals) and the scenes: annotators get them with Check for updates">
                Update annotations on Drive
              </button>
            </div>
            {manifest && (
              <div className="xc-line">
                On Drive since {when(manifest.first_published_at)}, last published {ago(manifest.published_at)} by {manifest.publisher} ({manifest.kind}, {formatBytes(manifest.bytes)}).
              </div>
            )}
            {manifest && (
              <>
                <h4 className="xc-h">Annotators</h4>
                {annotators.length === 0
                  ? <div className="xc-line">Nobody has uploaded annotations yet.</div>
                  : (
                    <table className="pe-table ov-table">
                      <thead><tr><th>Name</th><th>Uploaded</th><th>Frames</th><th>Their own</th><th>Last import</th><th /></tr></thead>
                      <tbody>
                        {annotators.map((a) => {
                          const last = imported[a.name];
                          const fresh = !last || (a.uploaded_at || 0) > last.at;
                          return (
                            <tr key={a.name}>
                              <td>{a.name}</td>
                              <td title={when(a.uploaded_at)}>{ago(a.uploaded_at)}</td>
                              <td>{a.frames ?? ''}</td>
                              <td>{a.own_frames ?? ''}</td>
                              <td title={last ? when(last.at) : ''}>{last ? `${ago(last.at)} (${last.taken + last.conflicts_remote} taken)` : 'never'}</td>
                              <td>
                                <button className={fresh ? 'solid' : undefined} disabled={!connected || !!busy}
                                        onClick={() => job(`import-${a.name}`, '/api/exchange/import', { annotator: a.name }, showPlan)}
                                        title="Download their annotations and compare them with the ones here (nothing is written yet)">
                                  <i className={`fa ${busy === `import-${a.name}` ? 'fa-spinner fa-spin' : 'fa-download'}`} style={{ marginRight: 6 }} />
                                  {fresh ? 'Check (new)' : 'Check'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
              </>
            )}
          </>
        )}
        {role === 'annotator' && (
          <>
            <div className="xc-line">
              Downloaded {ago(exchange.downloaded_at)} from {exchange.publisher || 'the publisher'}'s Drive folder
              {local?.bundle ? ` as a minimal bundle (${local.bundle.n_scenes} scenes, ${local.bundle.frames} frames: other frames are blank)` : ''}.
              {exchange.uploaded_at ? ` Your annotations were last uploaded ${ago(exchange.uploaded_at)}.` : ' Your annotations have not been uploaded yet.'}
              {manifest && manifest.published_at > (exchange.published_at || 0) && <b> The publisher has published updates.</b>}
            </div>
            <div className="toolbar">
              <button className="solid" disabled={!connected || !!busy || !status?.annotator_effective}
                      onClick={() => job('upload', '/api/exchange/upload', {}, (j) => log('success', `Uploaded ${j.result.frames} annotated frames of ${experiment}`))}
                      title={status?.annotator_effective ? `Upload your annotations to annotations/${status.annotator_effective}/` : 'Set your name first'}>
                <i className={`fa ${busy === 'upload' ? 'fa-spinner fa-spin' : 'fa-cloud-upload'}`} style={{ marginRight: 6 }} />Upload my annotations
              </button>
              <button disabled={!connected || !!busy} onClick={() => job('pull', '/api/exchange/pull', {}, showPlan)}
                      title="Download the publisher's latest annotations (everyone's merged work, solver proposals) and scenes, and compare (nothing is written yet)">
                <i className={`fa ${busy === 'pull' ? 'fa-spinner fa-spin' : 'fa-refresh'}`} style={{ marginRight: 6 }} />Check for updates
              </button>
            </div>
          </>
        )}
        {plan && <MergePlan plan={plan} applying={applying} onApply={apply} onCancel={() => setPlan(null)} onOpenFrame={onOpenFrame} />}
      </div>
    </section>
  );
}

export default function DriveExchangeTab({ active, currentExperiment, onOpenExperiment, onOpenFrame, onAnnotationsChanged }) {
  const { log, trackJob } = useConsole();
  const [status, setStatus] = useState(null);
  const [listing, setListing] = useState(null);
  const [listingBusy, setListingBusy] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [visited, setVisited] = useState(false);

  const fetchStatus = useCallback(() => api.get('/api/exchange/status')
    .then((r) => { const s = unwrap(r.data); setStatus(s); return s; })
    .catch((err) => { log('error', `Drive exchange: ${errorOf(err)}`); return null; }), [log]);
  const fetchListing = useCallback((refresh) => {
    setListingBusy(true);
    return api.get('/api/exchange/experiments', { params: refresh ? { refresh: 1 } : {} })
      .then((r) => setListing(unwrap(r.data)))
      .catch((err) => {
        setListing(err.response?.data ? unwrap(err.response.data) : null);
        log('error', `Drive exchange: ${errorOf(err)}`);
      })
      .finally(() => setListingBusy(false));
  }, [log]);
  // the listing only once the shared folder can be reached (the card says why not)
  const refreshAll = useCallback(() => fetchStatus().then((s) => s?.reachable && fetchListing(true)), [fetchStatus, fetchListing]);

  useEffect(() => {
    if (!active || visited) return;
    setVisited(true);
    refreshAll();
  }, [active, visited, refreshAll]);

  const entries = useMemo(() => listing?.experiments || [], [listing]);
  const loadedEntry = entries.find((e) => e.experiment === flat(currentExperiment));

  const download = (e) => {
    if (!window.confirm(`Download ${e.experiment} (${formatBytes(e.manifest?.bytes || 0)}) from Drive into this computer's videos folder?`)) return;
    setDownloading(e.experiment);
    api.post('/api/exchange/download', { experiment: e.experiment })
      .then((r) => trackJob(unwrap(r.data).job))
      .then((j) => {
        if (j?.status === 'done') log('success', `${e.experiment} downloaded to ${j.result.path}: Open it, then annotate in the Annotate tab`);
        fetchListing(false);
      })
      .catch((err) => log('error', `Drive exchange: ${errorOf(err)}`))
      .finally(() => setDownloading(null));
  };

  return (
    <div className="ov xc">
      <DriveSettings status={status} onSaved={refreshAll} />
      {currentExperiment
        ? <LoadedExperiment status={status} entry={loadedEntry} currentExperiment={currentExperiment}
                            onChanged={() => fetchListing(true)} onOpenFrame={onOpenFrame}
                            onAnnotationsChanged={onAnnotationsChanged} />
        : <section className="card"><div className="card-body">Load an experiment to publish it, or download one below.</div></section>}
      <section className="card">
        <header className="card-header">
          <i className="fa fa-cloud" />
          <span>Experiments on Drive</span>
          {listing?.at && <span className="ov-count">{entries.length} · listed {ago(listing.at)}</span>}
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={() => fetchListing(true)} disabled={listingBusy || !status?.reachable}>
            <i className={`fa ${listingBusy ? 'fa-spinner fa-spin' : 'fa-refresh'}`} style={{ marginRight: 6 }} />List again
          </button>
        </header>
        {listing && entries.length === 0 && !listingBusy && <div className="card-body">Nothing published in {listing.remote || status?.remote} yet.</div>}
        {entries.length > 0 && (
          <div className="ov-scroll">
            <table className="pe-table ov-table">
              <thead>
                <tr><th>Experiment</th><th>Kind</th><th>Size</th><th>Published</th><th>By</th><th>Annotated</th><th>Annotators</th><th>Here</th><th /></tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const m = e.manifest;
                  const loaded = e.experiment === flat(currentExperiment);
                  return (
                    <tr key={e.experiment}>
                      <td className="mono">{e.experiment}{loaded && <span className="ov-badge ov-badge-loaded">loaded</span>}</td>
                      <td>{m ? m.kind : <span title="No manifest: being published, or the publish failed">incomplete</span>}</td>
                      <td>{m ? formatBytes(m.bytes) : ''}</td>
                      <td title={m ? when(m.published_at) : ''}>{m ? ago(m.published_at) : ''}</td>
                      <td>{m?.publisher}</td>
                      <td>{m?.annotated_frames ?? ''}</td>
                      <td title={e.annotators.map((a) => `${a.name}: ${a.frames} frames, uploaded ${when(a.uploaded_at)}`).join('\n')}>
                        {e.annotators.map((a) => a.name).join(', ')}
                      </td>
                      <td>{e.local.exists ? <RoleBadge exchange={e.local.exchange} /> : ''}</td>
                      <td>
                        {e.local.exists
                          ? (!loaded && <button onClick={() => onOpenExperiment(e.experiment)}>Open</button>)
                          : (
                            <button className="solid" disabled={!m || !!downloading}
                                    title={m?.kind === 'minimal'
                                      ? `Copy the minimal bundle (${m.bundle?.n_scenes ?? '?'} scenes, ${m.bundle?.frames ?? '?'} frames) and the annotations to this computer`
                                      : 'Copy the experiment and its annotations to this computer'}
                                    onClick={() => download(e)}>
                              <i className={`fa ${downloading === e.experiment ? 'fa-spinner fa-spin' : 'fa-cloud-download'}`} style={{ marginRight: 6 }} />Download
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
