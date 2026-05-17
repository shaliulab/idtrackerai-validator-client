import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import Tab from './Tab';
import InteractiveText from './interactiveText';
import { RequestQueue } from './queue';
import { BlobsTable, VerticalBlobsTable } from './blobs_table';
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

  // Fetch recording framerate from backend.
  useEffect(() => {
    let isMounted = true;

    const fetchFramerate = async () => {
      try {
        const url = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/framerate`;
        const response = await axios.get(url);
        const raw =
          response.data?.framerate ??
          response.data?.RECORDING_FRAMERATE ??
          response.data;
        const numeric = Number(raw);
        if (isMounted && Number.isFinite(numeric) && numeric > 0) {
          setRecordingFramerate(numeric);
          setVideoFrameRate(numeric);
        } else {
          console.warn('Invalid framerate from backend:', response.data);
        }
      } catch (error) {
        console.error('Error fetching recording framerate:', error);
      }
    };

    fetchFramerate();
    return () => { isMounted = false; };
  }, []);

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
        <Tab id="pose_viewer" activeTab={activeTab} setActiveTab={setActiveTab}>
          Pose viewer
        </Tab>
      </div>

      <div className="tab-content">
        {activeTab === 'idtrackerai_viewer' && (
          <div>
            <h2>What can I do with this web application?</h2>
            <ul>
              <li>Select from an array of experiments</li>
              <li>Browse any frame from that experiment with a slider (like Youtube) and an input box</li>
              <li>Move 1, 10, 45000 (1 chunk of 5 minutes) frames back and forth</li>
              <li>Move to the beginning of the next chunk or the end of the previous one</li>
              <li>Move to the previous/next frame where an AI has intervened (either YOLOv7 or idtrackerai)</li>
              <li>Move to the previous/next frame where the AI could not solve an identity (there is at least one fly with identity=0)</li>
              <li>Move to the first previous/next frame where all identities are restored</li>
              <li>
                Playback the video at the desired framerate. 1 frame is displayed every half a second, and
                the number of frames skipped at each step is given by the playback framerate input box
              </li>
            </ul>

            <p>The goal is to:</p>
            <p>1) visualize the identity assignments produced by YOLOv7+idtrackerai,</p>
            <p>2) be able to correct or improve them if needed</p>
            <p>3) The plots produced in the analysis will also be displayed, as well as behavioral labels</p>
            <p>So far, only the first goal is achieved</p>

            <p>Remember to make sure the BACKEND_SERVER constant reflects the current ip address of the server</p>

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