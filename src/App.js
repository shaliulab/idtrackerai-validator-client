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
import { FIRST_FRAME, BACKEND_SERVER, PLACEHOLDER_IMAGE, BACKEND_PORT, DISPLAY_SIZE } from './constants';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

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

function App() {
  const [frame, setFrame] = useState(PLACEHOLDER_IMAGE);
  const [frameNumber, setFrameNumber] = useState(FIRST_FRAME);
  const [trackingData, setTrackingData] = useState([]);
  const [trackingPoseData, setTrackingPoseData] = useState([]);
  const [contoursData, setContoursData] = useState([]);
  const [sliderWidth, setSliderWidth] = useState(DISPLAY_SIZE);
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
    setSliderWidth(DISPLAY_SIZE);
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

      setTrackingData(validateData(trackingResponse.data['tracking_data']));
      setTrackingPoseData(validatePoseData(trackingResponse.data['pose']));
      setNumberOfAnimals(trackingResponse.data['number_of_animals']);
      setContoursData(preprocessResponse.data['contours']);
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
    <div className="App">
      <h1>FlyHostel Viewer</h1>
      <h3>Developed at Liu Lab @ VIB-KU Leuven Center for Brain & Disease Research</h3>

      <div className="tabs">
        <Tab id="idtrackerai_viewer" activeTab={activeTab} setActiveTab={setActiveTab}>
          Idtrackerai viewer
        </Tab>
      </div>

      <div className="tab-content">
        {activeTab === 'idtrackerai_viewer' && (
          <div>

            <SelectComponent
              onExperimentChange={(firstFrame) => {
                requestQueue.cancelAll();
                fetchFramerate();
                setFrameNumber(firstFrame);
              }}
            />

            <div className="dashboard-container">
              <div style={{ width: DISPLAY_SIZE }}>

                {/* Table above the frame, matched to frame width */}
                <div
                  style={{
                    width: '100%',
                    maxHeight: 220,
                    overflowY: 'auto',
                    marginBottom: 8,
                    border: '1px solid #ccc',
                    boxSizing: 'border-box',
                  }}
                >
                  <BlobsTable Data={trackingData} />
                </div>

                {/* Frame + its controls */}
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
                  displayWidth={DISPLAY_SIZE}
                  displayHeight={DISPLAY_SIZE}
                  nativeSize={nativeSize}
                />

                <InteractiveText
                  value={videoFrameRate}
                  setValue={setVideoFrameRate}
                  id="playback_framerate"
                  labelText="Playback Framerate  "
                />
                <Slider
                  isPlaying={isPlaying}
                  recordingFramerate={recordingFramerate}
                  frameNumber={frameNumber}
                  setFrameNumber={setFrameNumber}
                  sliderWidth={sliderWidth}
                />

                {/* Buttons now sit inside the same width-locked column */}
                <div
                  className="button-group"
                  style={{
                    width: '100%',
                    marginTop: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
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


          </div>
        )}
      </div>
    </div>
  );
}

export default App;