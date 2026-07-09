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

  // Native frame dimensions. Detected from the first decoded image
  // (or from a backend endpoint if you add one).
  const [nativeSize, setNativeSize] = useState(null); // { width, height }

  const FrameWithSquareRef = useRef(null);
  const [number_of_animals, setNumberOfAnimals] = useState(6);
  const [activeTab, setActiveTab] = useState('idtrackerai_viewer');

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
      const trackingUrl = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/tracking/${n}`;
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

  useEffect(() => { fetchFrame(frameNumber); }, [frameNumber]);

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
      {activeTab === 'idtrackerai_viewer' && (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 12, padding: '0 12px 8px', alignItems: 'flex-start' }}>

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
      )}
      {activeTab === 'pe_validator' && <PEValidator identity={1} />}
    </div>
  );
}

export default App;