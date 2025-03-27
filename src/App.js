import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import Tab from './Tab' 
import InteractiveText from './interactiveText' 
import { RequestQueue } from './queue'
import { BlobsTable, VerticalBlobsTable } from './blobs_table'
import { FRAMERATE, MIN_FN, CHUNKSIZE, BACKEND_SERVER, DEFAULT_CHUNK } from './constants';
import { PLACEHOLDER_IMAGE } from './constants'
import { BACKEND_PORT } from './constants'

import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'; // v6


const MAX_SIMULTANEOUS_REQUESTS = 1;
const requestQueue = new RequestQueue(MAX_SIMULTANEOUS_REQUESTS);


function queuedAxiosGet(url) {
  const source = axios.CancelToken.source();
  const request = () => axios.get(url, { 
    responseType: 'blob',
    cancelToken: source.token,
  }).finally(() => {
    let index = requestQueue.pendingRequests.indexOf(request);
    if (index !== -1) {
      requestQueue.pendingRequests.splice(index, 1);
    }
  });

  request.cancel = () => source.cancel('Operation canceled by user.');

  return requestQueue.add(request);
}


function App() {
  const [frame, setFrame] = useState(PLACEHOLDER_IMAGE);
  const [frameNumber, setFrameNumber] = useState(CHUNKSIZE*DEFAULT_CHUNK); // Default frame number
  const [trackingData, setTrackingData] = useState([]); // Default frame number
  const [contoursData, setContoursData] = useState([]); // Default frame number
  const [sliderWidth, setSliderWidth] = useState(1192);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoFrameRate, setVideoFrameRate] = useState(FRAMERATE);
  const FrameWithSquareRef = useRef(null);
  const [number_of_animals, setNumberOfAnimals] = useState(6);
  const [activeTab, setActiveTab] = useState('idtrackerai_viewer');

  useEffect(() => {

    const updateFrame = (value) => {
      setFrame(URL.createObjectURL(value));

      if (FrameWithSquareRef.current) {
        setSliderWidth(FrameWithSquareRef.current.width);
      }
    }


    function fetchTrackingData(value) {
        axios.get(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/tracking/${parseInt(value)}`)
        .then(response => {
          const validatedData = validateData(response.data["tracking_data"]);
          console.log(validatedData);
          setTrackingData(validatedData);
          setNumberOfAnimals(response.data["number_of_animals"])
        })
        .catch(error => {
          console.error("Error fetching frame: ", error);
        });
    }

  function fetchPreprocessData(value) {
      axios.get(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/preprocess/${parseInt(value)}`)
      .then(response => {
        const contours = response.data["contours"];
        setContoursData(contours);
      })
      .catch(error => {
        console.error("Error fetching frame contours: ", error);
      });
  }


  const fetchFrame = async (frameNumber) => {

      queuedAxiosGet(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/frame/${parseInt(frameNumber)}`)
      .then(response => {      
        updateFrame(response.data);
        fetchTrackingData(frameNumber);
        fetchPreprocessData(frameNumber);
      })
      .catch(error => {
        console.error("Error fetching frame: ", error);
      });
    };
    
    fetchFrame(frameNumber);
  
  }, [frameNumber]);

  useEffect(() => {
    if (isPlaying) {
      const intervalId = setInterval(() => {
        setFrameNumber(prevFrameNumber => ( prevFrameNumber + videoFrameRate ) % 15750000 );
      }, 500);
  
      return () => clearInterval(intervalId); // cleanup on unmount
    }
  }, [isPlaying, videoFrameRate]);


  const validateData = (dataArray) => {
    const filteredData=dataArray.filter(item => {
      // Check if all attributes are set (not null or undefined)
      return (
        item.frame_number != null && 
        item.in_frame_index != null && 
        item.x != null &&
        item.y != null &&
        item.identity != null &&
        item.modified != null
      );
    })
    for (let i=0; i < filteredData.length; i++) {
      filteredData[i]["x"]=Math.round(filteredData[i]["x"]);
      filteredData[i]["y"]=Math.round(filteredData[i]["y"]);
      filteredData[i]["ZT"]=(filteredData[i]["t"]/3600).toFixed(2);
    }
    return(filteredData);
  };
  
  return (
    <div className="App">
      <h1>FlyHostel Viewer</h1>
      <h3>Developed at Liu Lab @ VIB-KU Leuven Center for Brain & Disease Research</h3>

      {/* Tab headers */}
      <div className="tabs">
        <Tab id="idtrackerai_viewer" activeTab={activeTab} setActiveTab={setActiveTab}>Idtrackerai viewer</Tab>
        <Tab id="pose_viewer" activeTab={activeTab} setActiveTab={setActiveTab}>Pose viewer</Tab>
      </div>

      {/* Tab content */}
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
            <li>Playback the video at the desired framerate. 1 frame is displayed every half a second, and the number of frames skipped at each step is given by the playback framerate input box</li>
            </ul>

            <p>The goal is to:</p>
            <p>1) visualize the identity assignments produced by YOLOv7+idtrackerai,</p>
            <p>2) be able to correct or improve them if needed</p>
            <p>3) The plots produced in the analysis will also be displayed, as well as behavioral labels</p>
            <p>So far, only the first goal is achieved</p>

            <p>Remember to make sure the BACKEND_SERVER constant reflects the current ip address of the server</p>

 
          
            <div className="dashboard-container">
              <div className="column-container">
                <div className="left-column">
                  {frame && <FrameWithSquare imageURL={frame} videoFrameRate={videoFrameRate} trackingData={trackingData} contoursData={contoursData} frameNumber={frameNumber} setFrameNumber={setFrameNumber} number_of_animals={number_of_animals} ref={FrameWithSquareRef}/>}
                  <InteractiveText value={videoFrameRate} setValue={setVideoFrameRate} id="playback_framerate" labelText="Playback Framerate  "  />
                  <Slider isPlaying={isPlaying} frameNumber={frameNumber} setFrameNumber={setFrameNumber} sliderWidth={sliderWidth} />
                </div>
                <div className="right-column">
                  <div className="table-container">
                    <BlobsTable Data={trackingData} />
                  </div>
                </div>
              </div>
              <div className="button-group">
                <Buttons frameNumber={frameNumber} setFrameNumber={setFrameNumber} isPlaying={isPlaying} setIsPlaying={setIsPlaying} requestQueue={requestQueue} />
              </div>
            </div>

          </div>
        )}
      </div>


    </div>
  );
  
}

export default App;
