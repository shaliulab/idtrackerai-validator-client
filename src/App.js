import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';
import InteractiveText from './interactiveText' 
import { FRAMERATE, MIN_FN, BACKEND_SERVER } from './constants';
import { RequestQueue } from './queue'
import BlobsTable from './blobs_table'
import SelectComponent from './selectComponent'

const STEP=FRAMERATE;
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
  const [frame, setFrame] = useState(null);
  const [frameNumber, setFrameNumber] = useState(MIN_FN); // Default frame number
  const [trackingData, setTrackingData] = useState([]); // Default frame number
  const canvasRef = useRef(null);
  const [sliderWidth, setSliderWidth] = useState(1192);
  const [isPlaying, setIsPlaying] = useState(false);


  useEffect(() => {

    const updateFrame = (value) => {
      setFrame(URL.createObjectURL(value));

      if (canvasRef.current) {
        setSliderWidth(canvasRef.current.width);
      }
    }

    function fetchTrackingData(value) {
        axios.get(`http://${BACKEND_SERVER}:5000/api/tracking/${parseInt(value)}`)
        .then(response => {
          const validatedData = validateData(response.data);
          setTrackingData(validatedData);
        })
        .catch(error => {
          console.error("Error fetching frame: ", error);
        });
    }

    const fetchFrame = async (frameNumber) => {

      console.log(requestQueue.pendingRequests.length);

      queuedAxiosGet(`http://${BACKEND_SERVER}:5000/api/frame/${parseInt(frameNumber)}`)
      .then(response => {      
        updateFrame(response.data);
        fetchTrackingData(frameNumber);
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
        setFrameNumber(prevFrameNumber => ( prevFrameNumber + STEP ) % 15750000 );
      }, 500);
  
      return () => clearInterval(intervalId); // cleanup on unmount
    }
  }, [isPlaying]);


  const validateData = (dataArray) => {
    return dataArray.filter(item => {
      // Check if all attributes are set (not null or undefined)
      return (
        item.frame_number != null && 
        item.in_frame_index != null && 
        item.x != null &&
        item.y != null &&
        item.identity != null &&
        item.modified != null
      );
    });
  };

  
  return (
      <div className="App">
      <h1>FlyHostel Viewer</h1>
      <h3>Developed at Liu Lab @ VIB-KU Leuven Center for Brain & Disease Research</h3>
      <div className="dashboard-container">
              <div className="frame-container">
               { <SelectComponent /> }
               {frame && <FrameWithSquare imageURL={frame} trackingData={trackingData} ref={canvasRef}/>}
               { <InteractiveText frameNumber={frameNumber} setFrameNumber={setFrameNumber} /> }
               { <Slider isPlaying={isPlaying} frameNumber={frameNumber} setFrameNumber={setFrameNumber} sliderWidth={sliderWidth} /> }
              </div>
              <div className="table-container">
                  <BlobsTable Data={trackingData} />
              </div>
          </div>
          <div className="button-group">
              { <Buttons frameNumber={frameNumber} setFrameNumber={setFrameNumber} setIsPlaying={setIsPlaying} requestQueue={requestQueue} />}
          </div>
      </div>
  );
}

export default App;