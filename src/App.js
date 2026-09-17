// App.js  —  Frontend of the flyhostel viewer

import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import Tab from './Tab';
import InteractiveText from './interactiveText';
import { RequestQueue } from './queue';
import { BlobsTable } from './blobs_table';
import SelectComponent, { postLoad } from './selectComponent';

import { FIRST_FRAME, PLACEHOLDER_IMAGE, LABEL_FIELD } from './constants';
import PEValidator from './PEValidator';
import api from './api';

const MAX_SIMULTANEOUS_REQUESTS = 1;
const requestQueue = new RequestQueue(MAX_SIMULTANEOUS_REQUESTS);

// ── Theme tokens ──────────────────────────────────────────────────────────
// Only the colors App.js itself controls live here. Child components
// (FrameWithSquare, BlobsTable, Buttons, …) keep their own styling; to make
// them follow the theme you'd pass `theme` down as a prop and swap their
// hard-coded colors for these tokens.
const THEMES = {
  light: {
    bg: '#ffffff',
    text: '#000000',
    subtext: '#555555',
    border: '#cccccc',
    panelBg: '#ffffff',
    buttonBg: '#f0f0f0',
  },
  dark: {
    bg: '#1e1e1e',
    text: '#e0e0e0',
    subtext: '#a0a0a0',
    border: '#444444',
    panelBg: '#2a2a2a',
    buttonBg: '#333333',
  },
};

// Uses the shared `api` instance so the request inherits its baseURL
// (same-origin in production). `axios` is still imported only for
// CancelToken and isCancel, which live on the default export, not on instances.
function queuedAxiosGet(url) {
  const source = axios.CancelToken.source();
  const request = () =>
    api
      .get(url, { responseType: 'blob', cancelToken: source.token })
      .finally(() => {
        const index = requestQueue.pendingRequests.indexOf(request);
        if (index !== -1) requestQueue.pendingRequests.splice(index, 1);
      });
  request.cancel = () => source.cancel('Operation canceled by user.');
  return requestQueue.add(request);
}

// 120px budget for header + tabs + padding; cap width to 46% so the right
// panel always has at least half the viewport for controls.
const FRAME_SIZE = Math.min(
  window.innerHeight - 120,
  Math.floor(window.innerWidth * 0.46),
);

function App() {
  const [frame, setFrame] = useState(PLACEHOLDER_IMAGE);
  const [frameNumber, setFrameNumber] = useState(FIRST_FRAME);
  const [trackingData, setTrackingData] = useState([]);
  const [trackingPoseData, setTrackingPoseData] = useState({});
  const [contoursData, setContoursData] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoFrameRate, setVideoFrameRate] = useState(1);
  const [recordingFramerate, setRecordingFramerate] = useState(null);
  const [flies, setFlies] = useState([]);
  const [selectedFly, setSelectedFly] = useState(null);
  const [showPose, setShowPose] = useState(false);   // controls BOTH request + draw

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

  // Paint the page background too, not just the app container.
  useEffect(() => {
    document.body.style.backgroundColor = theme.bg;
    document.body.style.color = theme.text;
  }, [theme]);

  const toggleTheme = useCallback(
    () => setThemeName((t) => (t === 'light' ? 'dark' : 'light')),
    [],
  );

  // Native frame dimensions, read from the first decoded image.
  const [nativeSize, setNativeSize] = useState(null); // { width, height }

  const FrameWithSquareRef = useRef(null);
  const [number_of_animals, setNumberOfAnimals] = useState(6);
  const [activeTab, setActiveTab] = useState('idtrackerai_viewer');

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

  // Ctrl+1 / Ctrl+2 switch tabs
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;   // Ctrl only, not Cmd/Alt combos
      if (e.key === '1') { e.preventDefault(); setActiveTab('idtrackerai_viewer'); }
      else if (e.key === '2') { e.preventDefault(); setActiveTab('pe_validator'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl+Shift+1..9 select the Nth fly (only meaningful on the PE tab)
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || !e.shiftKey || e.metaKey || e.altKey) return;
      if (activeTab !== 'pe_validator') return;
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

  const updateFrame = (blobData) => {
    setFrame(URL.createObjectURL(blobData));
    if (!nativeSize) {
      // Read the dimensions from the blob rather than from the object URL:
      // the URL is revoked as soon as the next frame arrives, which can race
      // an <img> that has not finished decoding.
      createImageBitmap(blobData)
        .then((bmp) => {
          setNativeSize({ width: bmp.width, height: bmp.height });
          bmp.close();
        })
        .catch(() => {});
    }
  };

  // Release the previous object URL once React has committed the next one.
  // Without this, every frame during playback leaks a blob.
  useEffect(() => {
    return () => {
      if (typeof frame === 'string' && frame.startsWith('blob:')) {
        URL.revokeObjectURL(frame);
      }
    };
  }, [frame]);

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

  // Monotonic counter so a slow response for an older frame cannot overwrite
  // the state belonging to a newer one.
  const fetchSeqRef = useRef(0);

  const fetchFrame = async (fn) => {
    const seq = ++fetchSeqRef.current;
    try {
      const n = parseInt(fn, 10);
      const frameUrl = `/api/frame/${n}`;
      const trackingUrl = `/api/tracking/${n}?pose=${showPose ? 1 : 0}`;
      const preprocessUrl = `/api/preprocess/${n}`;

      const [frameResponse, trackingResponse, preprocessResponse] = await Promise.all([
        queuedAxiosGet(frameUrl),
        api.get(trackingUrl),
        api.get(preprocessUrl),
      ]);

      // A newer frame was requested while these were in flight. Applying this
      // response would leave the overlay describing a different frame than the
      // image on screen.
      if (seq !== fetchSeqRef.current) return;

      const tracking =
        typeof trackingResponse.data === 'string'
          ? JSON.parse(trackingResponse.data)
          : trackingResponse.data;
      const preprocess =
        typeof preprocessResponse.data === 'string'
          ? JSON.parse(preprocessResponse.data)
          : preprocessResponse.data;

      updateFrame(frameResponse.data);
      setTrackingData(validateData(tracking.tracking_data || []));
      setTrackingPoseData(validatePoseData(tracking.pose || {}));
      setNumberOfAnimals(tracking.number_of_animals || 0);
      setContoursData(preprocess.contours || []);
    } catch (error) {
      if (axios.isCancel(error)) return;   // expected when scrubbing fast
      console.error('Error fetching data: ', error);
    }
  };

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

  useEffect(() => {
    api.get('/api/use_val')
      .then(r => setUseVal(Boolean(r.data.use_val)))
      .catch(() => {});
  }, []);

  const toggleUseVal = async (checked) => {
    try {
      const { data } = await api.post('/api/use_val', { use_val: checked });
      setUseVal(Boolean(data.use_val));
      fetchFrameRange();                 // bounds differ between the two tables
      fetchFrame(frameNumber);           // reload tracking from the new source
    } catch (e) {
      console.error('Could not switch validation source:', e);
    }
  };

  useEffect(() => { fetchFrameRange(); }, [fetchFrameRange]);

  // fetchFrame is recreated on every render, so it cannot go in the dep array:
  // including it would refetch continuously.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchFrame(frameNumber); }, [frameNumber, showPose]);

  // Playback wraps at the real end of the experiment once /api/frame_range
  // has answered; before that it just advances.
  useEffect(() => {
    if (!isPlaying || !videoFrameRate) return;
    const id = setInterval(() => {
      setFrameNumber((p) => {
        const next = p + videoFrameRate;
        if (frameRange && next > frameRange.max) return frameRange.min;
        return next;
      });
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying, videoFrameRate, frameRange]);

  // Shared style for the two native <select> controls so they follow the theme.
  const selectStyle = {
    background: theme.panelBg,
    color: theme.text,
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    padding: '2px 6px',
  };

  const flatToSlash = (exp) => {
    const parts = exp.split('_');
    return parts.length < 3 ? exp
      : `${parts[0]}/${parts[1]}/${parts.slice(2).join('_')}`;
  };


  const switchToFly = useCallback(async (flyId) => {
    const experiment = flyId.split('__')[0];
    const current = selectedFly?.split('__')[0];
    if (experiment !== current) {
      // PEValidator's fly ids are flat (FlyHostel4_2X_2025-06-28_16-00-00);
      // /api/load expects the slash form, as typed in SelectComponent.
      const data = await postLoad(flatToSlash(experiment));
      requestQueue.cancelAll();
      fetchFramerate(); fetchFrameRange(); setNativeSize(null);
      setFrameNumber(data.first_frame ?? FIRST_FRAME);
      await fetchFlies();
    }
    setSelectedFly(flyId);
  }, [selectedFly, fetchFlies, fetchFramerate, fetchFrameRange]);
  

  return (
    <div style={{
      fontFamily: 'Arial, sans-serif',
      background: theme.bg,
      color: theme.text,
      minHeight: '100vh',
    }}>
      {/* ── Header ── */}
     <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '4px 12px 0',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3em' }}>FlyHostel Viewer</h1>
          <h3 style={{ margin: 0, fontSize: '0.8em', fontWeight: 'normal', color: theme.subtext }}>
            Developed at Liu Lab @ VIB-KU Leuven Center for Neuroscience
          </h3>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>


          <label
            title="Read tracking from IDENTITY_VAL (validated) instead of IDENTITY"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.buttonBg,
              color: theme.text,
              cursor: 'pointer',
              fontSize: '0.85em',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={useVal}
              onChange={(e) => toggleUseVal(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Validated tracking
          </label>

          <button
            onClick={toggleTheme}
            title="Toggle light/dark theme"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.buttonBg,
              color: theme.text,
              cursor: 'pointer',
              fontSize: '0.85em',
              whiteSpace: 'nowrap',
            }}
          >
            {themeName === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ padding: '2px 12px 4px' }}>
        <Tab id="idtrackerai_viewer" activeTab={activeTab} setActiveTab={setActiveTab}>Idtrackerai viewer</Tab>
        <Tab id="pe_validator"      activeTab={activeTab} setActiveTab={setActiveTab}>PE validation</Tab>
      </div>

      {/* ── Two-column body ── */}
      <div style={{
        display: activeTab === 'idtrackerai_viewer' ? 'flex' : 'none',
        flexDirection: 'row', gap: 12, padding: '0 12px 8px', alignItems: 'flex-start',
      }}>
        {/* Left: frame canvas */}
        <div style={{ flexShrink: 0 }}>
            <FrameWithSquare
              imageURL={frame}
              videoFrameRate={videoFrameRate}
              trackingData={trackingData}
              contoursData={contoursData}
              frameNumber={frameNumber}
              setFrameNumber={setFrameNumber}
              number_of_animals={number_of_animals}
              poseData={trackingPoseData}
              ref={FrameWithSquareRef}
              displayWidth={FRAME_SIZE}
              displayHeight={FRAME_SIZE}
              nativeSize={nativeSize}
              showPose={showPose}          // ← controlled
              setShowPose={setShowPose}     // ← controlled
              labelField={labelField}       // ← controlled
              setLabelField={setLabelField} // ← controlled
            />
        </div>


          {/* Right: controls */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>

            <SelectComponent
              onExperimentChange={(firstFrame) => {
                requestQueue.cancelAll();
                fetchFramerate();
                fetchFrameRange();
                setNativeSize(null);
                setFrameNumber(firstFrame);
              }}
            />

            <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${theme.border}`, background: theme.panelBg, boxSizing: 'border-box' }}>
              <BlobsTable Data={trackingData} setFrameNumber={setFrameNumber} />

            </div>

            <InteractiveText
              value={videoFrameRate}
              setValue={setVideoFrameRate}
              id="playback_framerate"
              labelText="Playback Framerate"
            />

            <Slider
              isPlaying={isPlaying}
              recordingFramerate={recordingFramerate}
              frameNumber={frameNumber}
              setFrameNumber={setFrameNumber}
              minFrame={frameRange?.min}
              maxFrame={frameRange?.max}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              <Buttons
                frameNumber={frameNumber}
                setFrameNumber={setFrameNumber}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                requestQueue={requestQueue}
                recordingFramerate={recordingFramerate}
              />
            </div>

          </div>
        </div>

      <div style={{ display: activeTab === 'pe_validator' ? 'block' : 'none' }}>
      <div style={{ padding: "12px" }}>
        <label>
          Fly:&nbsp;
          <select
            value={selectedFly || ""}
            onChange={e => setSelectedFly(e.target.value)}
            style={selectStyle}
          >
            {flies.map(fly => (
              <option key={fly} value={fly}>
                {fly}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PEValidator
            fly={selectedFly}
            active={activeTab === 'pe_validator'}
            onRequestFly={switchToFly}
        />
      </div>
    </div>
  );
}

export default App;