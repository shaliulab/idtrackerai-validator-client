// App.js  —  Frontend of the flyhostel viewer

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import FrameWithSquare, { FrameDisplayOptions } from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import Tab from './Tab';
import InteractiveText from './interactiveText';
import FramePlayer from './framePlayer';
import { BlobsTable } from './blobs_table';
import SelectComponent, { postLoad } from './selectComponent';
import CardResizer from './CardResizer';
import Splitter from './Splitter';

import { FIRST_FRAME, PLACEHOLDER_IMAGE, LABEL_FIELD } from './constants';
import PEValidator from './PEValidator';
import DeletePEAnnotations from './DeletePEAnnotations';
import HelpTab from './HelpTab';
import OverviewTab from './OverviewTab';
import DataManagementTab from './DataManagementTab';
import QcTab from './QcTab';
import PoseTab from './PoseTab';
import SleapLabelsTab from './SleapLabelsTab';
import MonitorTab from './MonitorTab';
import ValidationCsvBuilder from './ValidationCsvBuilder';
import CvatLinks from './CvatLinks';
import RoiPanel from './RoiPanel';
import api from './api';
import MessageConsole, { useConsole, useConsoleState, consoleHeight } from './MessageConsole';

// Loaded (with hls.js) off the viewer's critical path.
const EthogramViewer = lazy(() => import('./EthogramViewer'));
const DataCollectorTab = lazy(() => import('./DataCollectorTab'));

// ── Theme tokens ──────────────────────────────────────────────────────────
// Most styling reads the CSS variables in index.css (switched by
// <html data-theme>); these mirror them for the components that still take a
// `theme` prop (PEValidator, EthogramViewer, MessageConsole, FlyRow).
const THEMES = {
  light: {
    bg: '#f4f6f9',
    text: '#1f2937',
    subtext: '#64748b',
    border: '#dbe1e8',
    panelBg: '#ffffff',
    buttonBg: '#ffffff',
  },
  dark: {
    bg: '#16181d',
    text: '#e2e8f0',
    subtext: '#94a3b8',
    border: '#323843',
    panelBg: '#1f232a',
    buttonBg: '#2a2f38',
  },
};

// Frames shown per second during playback (at most; the server may be slower).
const PLAYBACK_FPS = 10;

// By default the frame fills the height left between the tab bar and the
// console, but never more than this share of the window width (the side panel
// needs room). Dragging the splitter next to it sets its width instead.
const FRAME_MAX_WIDTH_SHARE = 0.5;
const FRAME_MIN_SIZE = 320;
const SIDE_MIN_WIDTH = 320;
const SPLITTER_WIDTH = 12;
const PAGE_BOTTOM_GAP = 12;

// Logos shown right of the lab name. Drop the image files in
// idtrackerai-validator-client/public/logos/ under these names; a missing file
// is simply not shown.
const LOGOS = [
  { src: `${import.meta.env.BASE_URL}logos/logo1.png`, alt: 'Logo 1' },
  { src: `${import.meta.env.BASE_URL}logos/logo2.png`, alt: 'Logo 2' },
];

// Commit of the root repository the server runs from (/api/version).
function VersionTag() {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    api.get('/api/version').then((r) => setVersion(r.data)).catch(() => {});
  }, []);
  if (!version?.commit) return null;
  return (
    <span
      className="app-version"
      title={`idtrackerai-validator-server commit ${version.commit} (${version.date})`
        + (version.dirty ? ', with uncommitted changes' : '')}
    >
      {version.commit}{version.dirty ? '*' : ''}
    </span>
  );
}

// File the displayed blobs were read from and when idtrackerai last wrote it
function BlobsSourceTag({ info }) {
  if (!info) return null;
  if (info.error) {
    return <span className="chip" style={{ color: 'var(--danger)' }} title={info.error}>chunk {info.chunk}: no blobs</span>;
  }
  // idtrackerai/session_000063/tracking/blobs_collection.npy -> 000063/tracking
  const short = info.path.replace(/^idtrackerai\/session_/, '').replace(/\/blobs_collection(_\w+)?\.npy$/, (m, s) => (s || ''));
  const written = info.mtime ? new Date(info.mtime * 1000).toLocaleString() : '?';
  return <span className="chip" title={`${info.path}, written ${written}`}>{short}</span>;
}

function Logos() {
  const [failed, setFailed] = useState({});
  const shown = LOGOS.filter((l) => !failed[l.src]);
  if (!shown.length) return null;
  return (
    <div className="app-logos">
      {shown.map((l) => (
        <img
          key={l.src}
          src={l.src}
          alt={l.alt}
          onError={() => setFailed((f) => ({ ...f, [l.src]: true }))}
        />
      ))}
    </div>
  );
}

function App() {
  const [frame, setFrame] = useState(PLACEHOLDER_IMAGE);
  const [frameNumber, setFrameNumber] = useState(FIRST_FRAME);
  const [trackingData, setTrackingData] = useState([]);
  const [trackingPoseData, setTrackingPoseData] = useState({});
  const [contoursData, setContoursData] = useState([]);
  // Segmentation preview of the displayed frame ({contours, areas, error}) and the
  // ROIs drawn on it, both chosen in the "ROIs & segmentation" card
  const [segmentation, setSegmentation] = useState(null);
  const [roiOverlays, setRoiOverlays] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoFrameRate, setVideoFrameRate] = useState(1);
  const [recordingFramerate, setRecordingFramerate] = useState(null);
  const [flies, setFlies] = useState([]);
  const [selectedFly, setSelectedFly] = useState(null);
  const [showPose, setShowPose] = useState(false);   // controls BOTH request + draw
  // Last left click on the frame, in native pixels (picks blobs / points in the Validation CSV card)
  const [frameClick, setFrameClick] = useState(null);

  // ── Theme state (persisted across sessions) ──
  const [themeName, setThemeName] = useState(() => {
    try { return localStorage.getItem('fh-theme') || 'light'; }
    catch { return 'light'; }
  });
  const theme = THEMES[themeName] || THEMES.light;

  useEffect(() => {
    try { localStorage.setItem('fh-theme', themeName); } catch { /* ignore */ }
  }, [themeName]);

  // ── Which tracking field is drawn on the frame (persisted like the theme) ──
  const [labelField, setLabelField] = useState(() => {
    try { return localStorage.getItem('fh-label-field') || LABEL_FIELD; }
    catch { return LABEL_FIELD; }
  });

  useEffect(() => {
    try { localStorage.setItem('fh-label-field', labelField); } catch { /* ignore */ }
  }, [labelField]);

  // index.css switches its color variables on this attribute.
  useEffect(() => {
    document.documentElement.dataset.theme = themeName;
  }, [themeName]);

  const toggleTheme = useCallback(
    () => setThemeName((t) => (t === 'light' ? 'dark' : 'light')),
    [],
  );

  // Native frame dimensions, reported by FrameWithSquare from each drawn image.
  const [nativeSize, setNativeSize] = useState(null); // { width, height }

  const FrameWithSquareRef = useRef(null);
  const [number_of_animals, setNumberOfAnimals] = useState(6);
  const [activeTab, setActiveTab] = useState('group_viewer');
  // the Data collector tab is lazy-loaded and mounted once first shown
  const [visitedCollector, setVisitedCollector] = useState(false);
  useEffect(() => { if (activeTab === 'data_collector') setVisitedCollector(true); }, [activeTab]);
  // Loaded experiment (slash form), shown in the Overview table; bumped key remounts
  // the experiment picker after a load from elsewhere so it shows the new one.
  const [currentExperiment, setCurrentExperiment] = useState(null);
  // What the loaded experiment has. Without database (not analyzed yet) only its
  // recording and idtrackerai's blobs_collections can be shown.
  const [experimentInfo, setExperimentInfo] = useState({ has_database: true, has_blobs: false });
  const noDatabase = experimentInfo.has_database
    ? null : 'Not available: the loaded experiment has no database (not analyzed yet)';
  const [pickerKey, setPickerKey] = useState(0);
  // Bumped after the PE annotations are wiped: remounts PEValidator so it reloads.
  const [peReloadKey, setPeReloadKey] = useState(0);
  const consoleState = useConsoleState();
  const consoleOpen = consoleState?.open ?? true;
  const consoleBodyHeight = consoleState?.height;
  const { log } = useConsole();

  // Display size of the frame. Auto (null share): as large as the window allows
  // without scrolling, keeping the native aspect ratio. Once the splitter is
  // dragged, its width is that share of the window width (persisted).
  const viewerRef = useRef(null);
  const [frameSize, setFrameSize] = useState({ width: 600, height: 600, available: 600 });
  const [frameWidthShare, setFrameWidthShare] = useState(() => {
    try { return Number(localStorage.getItem('fh-frame-width-share')) || null; }
    catch { return null; }
  });
  useEffect(() => {
    try {
      if (frameWidthShare) localStorage.setItem('fh-frame-width-share', String(frameWidthShare));
      else localStorage.removeItem('fh-frame-width-share');
    } catch { /* ignore */ }
  }, [frameWidthShare]);

  const aspect = nativeSize ? nativeSize.height / nativeSize.width : 1;
  const frameMaxWidth = () => {
    const el = viewerRef.current;
    const room = (el ? el.clientWidth : window.innerWidth) - SPLITTER_WIDTH - SIDE_MIN_WIDTH - 2;
    return Math.max(FRAME_MIN_SIZE, room);
  };
  useLayoutEffect(() => {
    const fit = () => {
      const el = viewerRef.current;
      if (!el || el.offsetParent === null) return;    // hidden tab: keep the last size
      const top = el.getBoundingClientRect().top + window.scrollY;
      const maxHeight = window.innerHeight - top - consoleHeight(consoleOpen, consoleBodyHeight) - PAGE_BOTTOM_GAP - 2;
      const wanted = frameWidthShare
        ? frameWidthShare * window.innerWidth
        : Math.min(window.innerWidth * FRAME_MAX_WIDTH_SHARE, maxHeight / aspect);
      const width = Math.floor(Math.min(frameMaxWidth(), Math.max(FRAME_MIN_SIZE, wanted)));
      setFrameSize({ width, height: Math.round(width * aspect), available: Math.max(0, maxHeight) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [aspect, consoleOpen, consoleBodyHeight, activeTab, frameWidthShare]);

  const dragStartWidth = useRef(0);
  const onFrameSplitterDrag = (dx) => {
    const width = Math.min(frameMaxWidth(), Math.max(FRAME_MIN_SIZE, dragStartWidth.current + dx));
    setFrameWidthShare(width / window.innerWidth);
  };

  const [animalMetadata, setAnimalMetadata] = useState({});

  const fetchAnimalMetadata = useCallback(async () => {
    try {
      const { data } = await api.get('/api/animal_metadata');
      setAnimalMetadata(typeof data === 'string' ? JSON.parse(data) : data);
    } catch (err) {
      console.error('Error fetching animal metadata:', err);
      setAnimalMetadata({});
    }
  }, []);

  useEffect(() => { fetchAnimalMetadata(); }, [fetchAnimalMetadata]);

  const fetchFlies = useCallback(async () => {
    try {
      const { data } = await api.get('/api/pe/flies');
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      setFlies(parsed);

      if (parsed.length) {
        setSelectedFly(parsed[0]);
      } else {
        setSelectedFly(null);
      }
    } catch (err) {
      console.error("Couldn't fetch flies", err);
      setFlies([]);
      setSelectedFly(null);
    }
  }, []);

  const [ethogramFlies, setEthogramFlies] = useState([]);   // [{fly, available}]

  const fetchEthogramFlies = useCallback(async () => {
    try {
      const { data } = await api.get('/api/ethogram/flies');
      setEthogramFlies(typeof data === 'string' ? JSON.parse(data) : data);
    } catch (err) {
      console.error("Couldn't fetch ethogram flies", err);
      setEthogramFlies([]);
    }
  }, []);

  useEffect(() => { fetchEthogramFlies(); }, [fetchEthogramFlies]);

  const fetchCurrentExperiment = useCallback(async () => {
    try {
      const { data } = await api.get('/api/current_experiment');
      const info = typeof data === 'string' ? JSON.parse(data) : data;
      setCurrentExperiment(info?.experiment ?? null);
      setExperimentInfo({ has_database: info?.has_database ?? true, has_blobs: !!info?.has_blobs });
    } catch {
      setCurrentExperiment(null);
    }
  }, []);

  useEffect(() => { fetchCurrentExperiment(); }, [fetchCurrentExperiment]);

  // Blobs table "etho" button: show that fly's ethogram at the displayed frame.
  const [ethogramRequest, setEthogramRequest] = useState(null);   // { fly, frameNumber, nonce }
  const ethogramIdentities = useMemo(
    () => new Set(ethogramFlies.filter((f) => f.available).map((f) => Number(f.fly.split('__')[1]))),
    [ethogramFlies],
  );
  const openEthogram = useCallback((identity, frame) => {
    const suffix = `__${String(identity).padStart(2, '0')}`;
    const entry = ethogramFlies.find((f) => f.fly.endsWith(suffix));
    if (!entry) {
      log('warning', `No ethogram found for fly ${identity} of the loaded experiment`);
      return;
    }
    setIsPlaying(false);
    setEthogramRequest({ fly: entry.fly, frameNumber: frame, nonce: Date.now() });
    setActiveTab('ethogram');
  }, [ethogramFlies, log]);

  // QC tab pose charts: show that fly in the Pose tab (at that frame, if given)
  const [poseRequest, setPoseRequest] = useState(null);   // { fly, frameNumber, nonce }
  const openPose = useCallback((fly, frame) => {
    setIsPlaying(false);
    setPoseRequest({ fly, frameNumber: frame, nonce: Date.now() });
    setActiveTab('pose');
  }, []);

  // Pose tab "Label in SLEAP": that fly's frame in the SLEAP labels tab
  const [sleapRequest, setSleapRequest] = useState(null);   // { fly, frameNumber, nonce }
  const openSleap = useCallback((fly, frame) => {
    setIsPlaying(false);
    setSleapRequest({ fly, frameNumber: frame, nonce: Date.now() });
    setActiveTab('sleap_labels');
  }, []);

  const fetchFramerate = useCallback(async () => {
    try {
      const response = await api.get('/api/framerate');
      const data =
        typeof response.data === 'string'
          ? JSON.parse(response.data)
          : response.data;
      const raw =
        data?.framerate ??
        data?.RECORDING_FRAMERATE ??
        data;
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        setRecordingFramerate(numeric);
        setVideoFrameRate(numeric);
      }
    } catch (error) {
      console.error('Error fetching recording framerate:', error);
    }
  }, []);

  useEffect(() => { fetchFramerate(); }, [fetchFramerate]);

  useEffect(() => { fetchFlies(); }, [fetchFlies]);

  // Ctrl+1 … Ctrl+9 switch tabs
  const hasDatabaseRef = useRef(true);
  hasDatabaseRef.current = experimentInfo.has_database;
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;   // Ctrl only, not Cmd/Alt combos
      if (e.key === '1') { e.preventDefault(); setActiveTab('group_viewer'); }
      else if (e.key === '2') { e.preventDefault(); if (hasDatabaseRef.current) setActiveTab('proboscis_extension'); }
      else if (e.key === '3') { e.preventDefault(); if (hasDatabaseRef.current) setActiveTab('ethogram'); }
      else if (e.key === '4') { e.preventDefault(); if (hasDatabaseRef.current) setActiveTab('qc'); }
      else if (e.key === '5') { e.preventDefault(); if (hasDatabaseRef.current) setActiveTab('pose'); }
      else if (e.key === '6') { e.preventDefault(); setActiveTab('overview'); }
      else if (e.key === '7') { e.preventDefault(); setActiveTab('data_management'); }
      else if (e.key === '8') { e.preventDefault(); setActiveTab('monitor'); }
      else if (e.key === '9') { e.preventDefault(); setActiveTab('help'); }
      else if (e.key === '0') { e.preventDefault(); setActiveTab('data_collector'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl+Shift+1..9 select the Nth fly (only meaningful on the PE tab)
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || !e.shiftKey || e.metaKey || e.altKey) return;
      if (activeTab !== 'proboscis_extension') return;
      const m = /^Digit([1-9])$/.exec(e.code);        // physical digit, Shift-proof
      if (!m) return;
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= flies.length) {
        e.preventDefault();
        setSelectedFly(flies[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flies, activeTab]);

  // Light validation: drop rows with missing fields, round to integers.
  // Coordinates are kept in NATIVE space — scaling happens at draw time.
  const validateData = (dataArray) => {
    const filtered = dataArray.filter(
      (it) =>
        it.frame_number != null &&
        it.in_frame_index != null &&
        it.x != null &&
        it.y != null &&
        it.identity != null &&
        it.modified != null,
    );
    return filtered.map((it) => ({
      ...it,
      x: Math.round(it.x),
      y: Math.round(it.y),
      ZT: it.ZT,
    }));
  };

  // Placeholder: pose data is passed through unchanged for now.
  const validatePoseData = (dataArray) => dataArray;

  // ── Frame player: loads image + tracking + contours per frame, latest seek wins ──
  const showPoseRef = useRef(showPose);
  showPoseRef.current = showPose;

  // Tracking source: 'db' (the experiment's database), 'blobs' (idtrackerai's
  // blobs_collection*.npy of the frame's chunk, to check an ongoing run) or 'none'
  // (the recording only). Set from experimentInfo on every experiment load.
  const [trackingSource, setTrackingSource] = useState('db');
  const trackingSourceRef = useRef(trackingSource);
  trackingSourceRef.current = trackingSource;
  // File the displayed blobs come from, or why there are none ({path, mtime, error})
  const [blobsInfo, setBlobsInfo] = useState(null);
  // Source (id of /api/rois) whose settings segment each frame, or null
  const [segmentationSource, setSegmentationSource] = useState(null);
  const segmentationSourceRef = useRef(segmentationSource);
  segmentationSourceRef.current = segmentationSource;

  const playerRef = useRef(null);
  if (playerRef.current === null) {
    playerRef.current = new FramePlayer({
      load: async (n) => {
        const image = await api.get(`/api/frame/${n}`, { responseType: 'blob' });
        // Segmentation is costly: only ask for contours when they are drawn.
        const segment = segmentationSourceRef.current;
        const [tracking, preprocess] = await Promise.all([
          trackingSourceRef.current === 'none'
            ? { data: { tracking_data: [] } }
            : api.get(`/api/tracking/${n}?pose=${showPoseRef.current ? 1 : 0}&source=${trackingSourceRef.current}`),
          segment
            ? api.get(`/api/preprocess/${n}?source=${encodeURIComponent(segment)}`)
              .catch((error) => ({ data: { contours: [], error: error.response?.data?.error || error.message } }))
            : null,
        ]);
        const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
        return {
          frameNumber: n,
          url: URL.createObjectURL(image.data),
          blob: image.data,
          tracking: unwrap(tracking.data),
          segmentation: preprocess && unwrap(preprocess.data),
        };
      },
      onDisplay: (bundle) => {
        setFrame(bundle.url);
        setTrackingData(validateData(bundle.tracking.tracking_data || []));
        setTrackingPoseData(validatePoseData(bundle.tracking.pose || {}));
        setNumberOfAnimals(bundle.tracking.number_of_animals || 0);
        setBlobsInfo(bundle.tracking.blobs || null);
        setContoursData(bundle.segmentation?.contours || []);
        setSegmentation(bundle.segmentation);
      },
      onError: (n, error) => {
        console.error(`Error loading frame ${n}:`, error);
        log('error', `Could not load frame ${n}: ${error.response?.data?.error || error.message}`);
      },
    });
  }
  const player = playerRef.current;

  const [frameRange, setFrameRange] = useState(null); // { min, max }

  const fetchFrameRange = useCallback(async () => {
    try {
      const { data } = await api.get('/api/frame_range');
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const min = Number(parsed.min_frame);
      const max = Number(parsed.max_frame);
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        setFrameRange({ min, max });
      }
    } catch (error) {
      console.error('Error fetching frame range:', error);
    }
  }, []);

  // Declared after fetchFrameRange: this handler calls it, and `const` is not
  // hoisted.
  const [useVal, setUseVal] = useState(false);

  // The server picks the source per experiment (validated for groups, raw for
  // single flies): read it at start-up and after every experiment load.
  const fetchUseVal = useCallback(() => {
    api.get('/api/use_val')
      .then(r => setUseVal(Boolean(r.data.use_val)))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchUseVal(); }, [fetchUseVal]);

  const toggleUseVal = async (checked) => {
    try {
      const { data } = await api.post('/api/use_val', { use_val: checked });
      setUseVal(Boolean(data.use_val));
      fetchFrameRange();                 // bounds differ between the two tables
      player.invalidate();               // reload tracking from the new source
    } catch (e) {
      console.error('Could not switch validation source:', e);
    }
  };

  useEffect(() => { fetchFrameRange(); }, [fetchFrameRange]);

  useEffect(() => { player.seek(frameNumber); }, [player, frameNumber]);

  // Tracking rows include pose or not: cached frames are stale when it changes.
  const firstShowPose = useRef(true);
  useEffect(() => {
    if (firstShowPose.current) { firstShowPose.current = false; return; }
    player.invalidate();
  }, [player, showPose]);

  // Each loaded experiment starts on its database, else its blobs, else the recording only
  useEffect(() => {
    setTrackingSource(experimentInfo.has_database ? 'db' : experimentInfo.has_blobs ? 'blobs' : 'none');
  }, [experimentInfo]);

  // PE and Ethograms need the database
  useEffect(() => {
    if (!experimentInfo.has_database) {
      setActiveTab((tab) => (tab === 'proboscis_extension' || tab === 'ethogram' || tab === 'qc' || tab === 'pose' || tab === 'sleap_labels' ? 'group_viewer' : tab));
    }
  }, [experimentInfo]);

  const firstTrackingSource = useRef(true);
  useEffect(() => {
    if (firstTrackingSource.current) { firstTrackingSource.current = false; return; }
    player.invalidate();
  }, [player, trackingSource]);

  const firstSegmentationSource = useRef(true);
  useEffect(() => {
    if (firstSegmentationSource.current) { firstSegmentationSource.current = false; return; }
    player.invalidate();
  }, [player, segmentationSource]);

  // Log each blobs_collection problem once, not once per frame
  const blobsError = trackingSource === 'blobs' ? blobsInfo?.error : null;
  useEffect(() => {
    if (blobsError) log('warning', blobsError);
  }, [blobsError, log]);

  // Playback: the player only advances once the next frame is loaded, so it never
  // runs ahead of the server. Speed = 2 x "Playback Framerate" recording frames per
  // second, as before; shown at up to PLAYBACK_FPS frames per second.
  const frameNumberRef = useRef(frameNumber);
  frameNumberRef.current = frameNumber;
  useEffect(() => {
    if (!isPlaying || !videoFrameRate) return undefined;
    const speed = 2 * Number(videoFrameRate);                    // recording frames / s
    const step = Math.max(1, Math.round(speed / PLAYBACK_FPS));
    player.play({
      from: frameNumberRef.current,
      step,
      intervalMs: (1000 * step) / speed,
      min: frameRange?.min,
      max: frameRange?.max,
      onAdvance: setFrameNumber,
    });
    return () => player.stop();
  }, [player, isPlaying, videoFrameRate, frameRange]);

  // Native <select>s are themed by index.css; kept as a prop for EthogramViewer.
  const selectStyle = {};

  // Readout above the slider: position of the displayed frame.
  const firstRow = trackingData[0];
  const chunksize = firstRow?.chunksize;

  // Everything that depends on the loaded experiment, refreshed after /api/load.
  const onExperimentLoaded = useCallback(async (firstFrame) => {
    // Load the new experiment's first frame, not the old frame number again.
    player.invalidate(firstFrame);
    setFrameNumber(firstFrame);
    fetchFramerate();
    fetchFrameRange();
    fetchUseVal();
    fetchAnimalMetadata();
    fetchEthogramFlies();
    fetchCurrentExperiment();
    await fetchFlies();
  }, [player, fetchCurrentExperiment, fetchFramerate, fetchFrameRange, fetchUseVal, fetchAnimalMetadata, fetchEthogramFlies, fetchFlies]);

  // Overview table "Open": load that experiment and show it in the Group viewer.
  const openExperiment = useCallback(async (experiment) => {
    try {
      const data = await postLoad(experiment);
      log('info', `Loaded ${experiment}`);
      setPickerKey((k) => k + 1);
      await onExperimentLoaded(data.first_frame ?? FIRST_FRAME);
      setActiveTab('group_viewer');
    } catch (err) {
      log('error', `Failed to load ${experiment}: ${err.response?.data?.error ?? err.message}`);
    }
  }, [log, onExperimentLoaded]);

  // Monitor tab: load the fly's experiment (unless loaded) and show the fly in the Ethograms or Pose tab,
  // at the frame the viewer starts at (or the displayed one when the experiment is already loaded)
  const openFly = useCallback(async (experiment, fly, tab) => {
    const flat = (name) => (name || '').replace(/\//g, '_').replace(/_arenas_(\d+)$/, '_arena$1');
    let frame = frameNumber;
    if (flat(currentExperiment) !== flat(experiment)) {
      try {
        const data = await postLoad(experiment);
        log('info', `Loaded ${experiment}`);
        setPickerKey((k) => k + 1);
        frame = data.first_frame ?? FIRST_FRAME;
        await onExperimentLoaded(frame);
      } catch (err) {
        log('error', `Failed to load ${experiment}: ${err.response?.data?.error ?? err.message}`);
        return;
      }
    }
    setIsPlaying(false);
    if (tab === 'pose') {
      setPoseRequest({ fly, frameNumber: frame, nonce: Date.now() });
    } else {
      setEthogramRequest({ fly, frameNumber: frame, nonce: Date.now() });
    }
    setActiveTab(tab);
  }, [currentExperiment, frameNumber, log, onExperimentLoaded]);

  const switchToFly = useCallback(async (flyId) => {
    const experiment = flyId.split('__')[0];
    const current = selectedFly?.split('__')[0];
    if (experiment !== current) {
      // PEValidator's fly ids are flat (FlyHostel4_2X_2025-06-28_16-00-00, or
      // FlyHostel1_4X_2026-10-13_17-00-00_arena1); /api/load takes either form.
      const data = await postLoad(experiment);
      await onExperimentLoaded(data.first_frame ?? FIRST_FRAME);
    }
    setSelectedFly(flyId);
  }, [selectedFly, onExperimentLoaded]);
  

  return (
    <div style={{
      minHeight: '100vh',
      // leave room for the console docked at the bottom
      paddingBottom: consoleHeight(consoleOpen, consoleBodyHeight),
      boxSizing: 'border-box',
    }}>
      {/* ── App bar: title, experiment (shared across tabs), global toggles ── */}
      <header className="app-bar">
        <VersionTag />
        <div className="app-title">
          <h1>FlyHostel Viewer</h1>
          <p>Liu Lab @ VIB-KU Leuven Center for Neuroscience</p>
        </div>

        <Logos />

        <SelectComponent
          key={`${selectedFly?.split('__')[0]}-${pickerKey}`}
          onExperimentChange={onExperimentLoaded}
        />

        <span className="spacer" />

        <div className="app-actions">
          <label className="chip" title="Database: the experiment's .db file. blobs_collection: idtrackerai's blobs_collection*.npy of the frame's chunk (idtrackerai/session_<chunk>/, most advanced step), e.g. to check an ongoing run. Grayed out when the experiment has none">
            Tracking
            <select value={trackingSource} onChange={(e) => setTrackingSource(e.target.value)}>
              <option value="db" disabled={!experimentInfo.has_database}>Database</option>
              <option value="blobs" disabled={!experimentInfo.has_blobs}>blobs_collection</option>
              <option value="none">None (recording only)</option>
            </select>
          </label>
          {trackingSource === 'blobs' && <BlobsSourceTag info={blobsInfo} />}
          <label className="chip check" title={trackingSource === 'db'
            ? 'Read tracking from IDENTITY_VAL (validated) instead of IDENTITY'
            : 'Only applies to the database'}>
            <input
              type="checkbox"
              checked={useVal}
              disabled={trackingSource !== 'db'}
              onChange={(e) => toggleUseVal(e.target.checked)}
            />
            Validated tracking
          </label>
          <button onClick={toggleTheme} title="Toggle light/dark theme">
            <i className={`fa ${themeName === 'light' ? 'fa-moon-o' : 'fa-sun-o'}`} style={{ marginRight: 6 }} />
            {themeName === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav className="tabs">
        <Tab id="data_collector" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+0">Data collector</Tab>
        <Tab id="group_viewer" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+1">Group viewer</Tab>
        <Tab id="proboscis_extension" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+2" disabled={noDatabase}>Proboscis extension (PE)</Tab>
        <Tab id="ethogram" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+3" disabled={noDatabase}>Ethograms</Tab>
        <Tab id="qc" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+4" disabled={noDatabase}>QC</Tab>
        <Tab id="pose" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+5" disabled={noDatabase}>Pose</Tab>
        <Tab id="sleap_labels" activeTab={activeTab} setActiveTab={setActiveTab} disabled={noDatabase}>SLEAP labels</Tab>
        <Tab id="overview" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+6">Metadata overview</Tab>
        <Tab id="data_management" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+7">Data management</Tab>
        <Tab id="monitor" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+8">Monitor</Tab>
        <Tab id="help" activeTab={activeTab} setActiveTab={setActiveTab} shortcut="Ctrl+9">
          <i className="fa fa-question-circle-o" style={{ marginRight: 6 }} />How to use
        </Tab>
      </nav>

      {/* ── Group viewer: frame | tracking table + navigation ── */}
      <div className="tab-panel" style={{ display: activeTab === 'group_viewer' ? 'block' : 'none' }}>
        <div className="viewer" ref={viewerRef}>
          <div className="card viewer-frame">
            <FrameWithSquare
              imageURL={frame}
              videoFrameRate={videoFrameRate}
              trackingData={trackingData}
              contoursData={contoursData}
              roiOverlays={roiOverlays}
              frameNumber={frameNumber}
              setFrameNumber={setFrameNumber}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              number_of_animals={number_of_animals}
              poseData={trackingPoseData}
              ref={FrameWithSquareRef}
              displayWidth={frameSize.width}
              displayHeight={frameSize.height}
              nativeSize={nativeSize}
              onNativeSize={setNativeSize}
              showPose={showPose}
              labelField={labelField}
              onFrameClick={setFrameClick}
            />
          </div>

          <Splitter
            direction="vertical"
            title="Drag to resize the frame · double click to fit the window"
            onDragStart={() => { dragStartWidth.current = frameSize.width; }}
            onDrag={onFrameSplitterDrag}
            onReset={() => setFrameWidthShare(null)}
          />

          <div className="viewer-side" style={{ height: Math.max(frameSize.height + 2, frameSize.available) }}>
            <section className="card viewer-table">
              <div className="card-header">
                Tracking
                <span className="spacer" />
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                  {trackingData.length} / {number_of_animals} animals detected
                </span>
              </div>
              <div className="scroll">
                <BlobsTable Data={trackingData} setFrameNumber={setFrameNumber}
                            frameRange={frameRange}
                            number_of_animals={number_of_animals}
                            animalMetadata={animalMetadata}
                            onOpenEthogram={openEthogram}
                            ethogramIdentities={ethogramIdentities} />
              </div>
              <CardResizer id="viewer-tracking" />
            </section>

            <section className="card">
              <div className="card-header">
                Navigation
                <span className="spacer" />
                <div className="readout" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                  <span>Frame <b>{frameNumber}</b></span>
                  {chunksize > 0 && <span>Chunk <b>{Math.floor(frameNumber / chunksize)}</b></span>}
                  {firstRow?.ZT && <span>ZT <b>{firstRow.ZT}</b></span>}
                </div>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Slider
                  isPlaying={isPlaying}
                  recordingFramerate={recordingFramerate}
                  frameNumber={frameNumber}
                  setFrameNumber={setFrameNumber}
                  minFrame={frameRange?.min}
                  maxFrame={frameRange?.max}
                />
                <Buttons
                  frameNumber={frameNumber}
                  setFrameNumber={setFrameNumber}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  recordingFramerate={recordingFramerate}
                  frameRange={frameRange}
                  active={activeTab === 'group_viewer'}
                />
                <div className="toolbar" style={{ justifyContent: 'center' }}>
                  <InteractiveText
                    value={videoFrameRate}
                    setValue={setVideoFrameRate}
                    id="playback_framerate"
                    labelText="Playback framerate"
                    title="Playback speed (2× this many recording frames per second) and frames skipped per mouse-wheel notch"
                  />
                  <FrameDisplayOptions
                    trackingData={trackingData}
                    showPose={showPose}
                    setShowPose={setShowPose}
                    labelField={labelField}
                    setLabelField={setLabelField}
                  />
                </div>
                <CvatLinks experiment={currentExperiment} frameNumber={frameNumber} />
              </div>
              <CardResizer id="viewer-navigation" />
            </section>

            <RoiPanel
              experiment={currentExperiment}
              segmentationSource={segmentationSource}
              setSegmentationSource={setSegmentationSource}
              onOverlaysChange={setRoiOverlays}
              segmentation={segmentation}
            />

            <ValidationCsvBuilder
              frameNumber={frameNumber}
              isPlaying={isPlaying}
              numberOfAnimals={number_of_animals}
              frameClick={frameClick}
              setFrameNumber={setFrameNumber}
            />
          </div>
        </div>
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'proboscis_extension' ? 'block' : 'none' }}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label className="field">
          Fly
          <select
            value={selectedFly || ""}
            onChange={e => setSelectedFly(e.target.value)}
          >
            {flies.map(fly => (
              <option key={fly} value={fly}>
                {fly}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <DeletePEAnnotations onDeleted={() => setPeReloadKey((k) => k + 1)} />
      </div>

      <PEValidator
            key={peReloadKey}
            fly={selectedFly}
            animalMetadata={animalMetadata}
            theme={theme}
            active={activeTab === 'proboscis_extension'}
            onRequestFly={switchToFly}
        />
      </div>

      <div style={{ display: activeTab === 'ethogram' ? 'block' : 'none' }}>
        <Suspense fallback={<div style={{ padding: 12 }}>Loading…</div>}>
          <EthogramViewer
            flies={ethogramFlies}
            request={ethogramRequest}
            animalMetadata={animalMetadata}
            active={activeTab === 'ethogram'}
            theme={theme}
            themeName={themeName}
            selectStyle={selectStyle}
            onOpenInViewer={(fn) => {
              setFrameNumber(fn);
              setActiveTab('group_viewer');
            }}
            onOpenInPose={openPose}
          />
        </Suspense>
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'qc' ? 'block' : 'none' }}>
        <QcTab
          active={activeTab === 'qc'}
          currentExperiment={currentExperiment}
          useVal={useVal}
          onOpenFrame={(fn) => {
            setIsPlaying(false);
            setFrameNumber(fn);
            setActiveTab('group_viewer');
          }}
          onOpenPose={openPose}
        />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'pose' ? 'block' : 'none' }}>
        <PoseTab
          active={activeTab === 'pose'}
          currentExperiment={currentExperiment}
          request={poseRequest}
          viewerFrame={frameNumber}
          framerate={recordingFramerate}
          chunksize={chunksize}
          ethogramFlies={ethogramFlies}
          onOpenInViewer={(fn) => {
            setIsPlaying(false);
            setFrameNumber(fn);
            setActiveTab('group_viewer');
          }}
          onOpenInEthogram={(fly, fn) => {
            // the Group viewer follows too, so both show this frame
            setFrameNumber(fn);
            openEthogram(Number(fly.split('__').pop()), fn);
          }}
          onLabelInSleap={openSleap}
        />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'sleap_labels' ? 'block' : 'none' }}>
        <SleapLabelsTab
          active={activeTab === 'sleap_labels'}
          currentExperiment={currentExperiment}
          request={sleapRequest}
          viewerFrame={frameNumber}
          onOpenInPose={openPose}
        />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
        <OverviewTab
          active={activeTab === 'overview'}
          currentExperiment={currentExperiment}
          onOpenExperiment={openExperiment}
        />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'data_management' ? 'block' : 'none' }}>
        <DataManagementTab active={activeTab === 'data_management'} currentExperiment={currentExperiment} />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'monitor' ? 'block' : 'none' }}>
        <MonitorTab active={activeTab === 'monitor'} onOpenExperiment={openExperiment} onOpenFly={openFly} />
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'data_collector' ? 'block' : 'none' }}>
        {visitedCollector && (
          <Suspense fallback={<div className="card card-body">Loading…</div>}>
            <DataCollectorTab active={activeTab === 'data_collector'} onOpenExperiment={openExperiment} />
          </Suspense>
        )}
      </div>

      <div className="tab-panel" style={{ display: activeTab === 'help' ? 'block' : 'none' }}>
        <HelpTab />
      </div>

      <MessageConsole theme={theme} />
    </div>
  );
}

export default App;