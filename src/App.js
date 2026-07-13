// App.js  —  Frontend of the flyhostel viewer

import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import Tab from './Tab';
import InteractiveText from './interactiveText';
import { RequestQueue } from './queue';
import { BlobsTable, VerticalBlobsTable } from './blobs_table';
import SelectComponent from './selectComponent';
import { FIRST_FRAME, BACKEND_SERVER, PLACEHOLDER_IMAGE, BACKEND_PORT } from './constants';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PEValidator from './PEValidator';

const MAX_SIMULTANEOUS_REQUESTS = 1;
const requestQueue = new RequestQueue(MAX_SIMULTANEOUS_REQUESTS);

function queuedAxiosGet(url) {
  const source = axios.CancelToken.source();
  const request = () =>
    axios
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
  const [trackingPoseData, setTrackingPoseData] = useState([]);
  const [contoursData, setContoursData] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoFrameRate, setVideoFrameRate] = useState(1);
  const [recordingFramerate, setRecordingFramerate] = useState(null);
  const [flies, setFlies] = useState([]);
  const [selectedFly, setSelectedFly] = useState(null);
  const [showPose, setShowPose] = useState(true);   // controls BOTH request + draw

  // Native frame dimensions. Detected from the first decoded image
  // (or from a backend endpoint if you add one).
  const [nativeSize, setNativeSize] = useState(null); // { width, height }

  const FrameWithSquareRef = useRef(null);
  const [number_of_animals, setNumberOfAnimals] = useState(6);
  const [activeTab, setActiveTab] = useState('idtrackerai_viewer');

  const fetchFlies = useCallback(async () => {
    try {
      const { data } = await axios.get(
        `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/pe/flies`
      );

      setFlies(data);

      if (data.length) {
        setSelectedFly(data[0]);
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
      const url = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/framerate`;
      const response = await axios.get(url);
      const raw =
        response.data?.framerate ??
        response.data?.RECORDING_FRAMERATE ??
        response.data;
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        setRecordingFramerate(numeric);
        setVideoFrameRate(numeric);
      }
    } catch (error) {
      console.error('Error fetching recording framerate:', error);
    }
  }, []);

  useEffect(() => { fetchFramerate(); }, []);

  useEffect(() => {
    fetchFlies();
  }, [fetchFlies]);

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

  // Probe the first decoded frame to learn the native image size.
  const probeImageSize = (blobUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = blobUrl;
    });

  const updateFrame = (blobData) => {
    const url = URL.createObjectURL(blobData);
    setFrame(url);
    if (!nativeSize) {
      probeImageSize(url)
        .then((dims) => setNativeSize(dims))
        .catch(() => {});
    }
  };

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

  const validatePoseData = (dataArray) => dataArray;

  const fetchFrame = async (fn) => {
    try {
      const n = parseInt(fn, 10);
      const frameUrl = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/frame/${n}`;
      const trackingUrl = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/tracking/${n}?pose=${showPose ? 1 : 0}`;
      const preprocessUrl = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/preprocess/${n}`;

      const [frameResponse, trackingResponse, preprocessResponse] = await Promise.all([
        queuedAxiosGet(frameUrl),
        axios.get(trackingUrl),
        axios.get(preprocessUrl),
      ]);

      updateFrame(frameResponse.data);

      setTrackingData(validateData(trackingResponse.data.tracking_data || []));
      setTrackingPoseData(validatePoseData(trackingResponse.data.pose || {}));
      setNumberOfAnimals(trackingResponse.data.number_of_animals || 0);
      setContoursData(preprocessResponse.data.contours || []);
    } catch (error) {
      console.error('Error fetching data: ', error);
    }
  };

  useEffect(() => { fetchFrame(frameNumber); }, [frameNumber, showPose]);

  useEffect(() => {
    if (!isPlaying || !videoFrameRate) return;
    const id = setInterval(() => {
      setFrameNumber((p) => (p + videoFrameRate) % 15750000);
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying, videoFrameRate]);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* ── Header ── */}
      <div style={{ padding: '4px 12px 0' }}>
        <h1 style={{ margin: 0, fontSize: '1.3em' }}>FlyHostel Viewer</h1>
        <h3 style={{ margin: 0, fontSize: '0.8em', fontWeight: 'normal', color: '#555' }}>
          Developed at Liu Lab @ VIB-KU Leuven Center for Neuroscience
        </h3>
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

            />
          </div>


          {/* Right: controls */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>

            <SelectComponent
              onExperimentChange={(firstFrame) => {
                requestQueue.cancelAll();
                fetchFramerate();
                setNativeSize(null);
                setFrameNumber(firstFrame);
              }}
            />

            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #ccc', boxSizing: 'border-box' }}>
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
        />
      </div>
    </div>
  );
}

export default App;