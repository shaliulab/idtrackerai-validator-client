import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import FrameWithSquare from './FrameWithSquare';
import Buttons from './buttons';
import Slider from './slider';

import { FRAMERATE } from './constants';

const STEP=FRAMERATE/2;

function App() {
  const [frame, setFrame] = useState(null);
  const [frameNumber, setFrameNumber] = useState(2250000); // Default frame number
  const [trackingData, setTrackingData] = useState([{"identity": 0, "x": null, "y": null}]); // Default frame number
  const [fetchedFrame, setFetchedFrame] = useState(0);
  const canvasRef = useRef(null);
  const [sliderWidth, setSliderWidth] = useState(1192);
  const [isPlaying, setIsPlaying] = useState(false);



  useEffect(() => {

    const updateFrame = (value) => {
      // If your server responds with an image, you might want to display the image instead:
      setFrame(URL.createObjectURL(value));

      if (canvasRef.current) {
        setSliderWidth(canvasRef.current.width);
      }
  }


    const fetchFrame = async (frameNumber) => {

      axios.get(`http://localhost:5000/api/frame/${parseInt(frameNumber)}`,  { responseType: 'blob' })
      .then(response => {
        updateFrame(response.data);
        setFetchedFrame(frameNumber);
  
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


  useEffect(() => {
    const timerId = setTimeout(() => {
      setFrameNumber(frameNumber);
    }, 500);

    return () => {
      clearTimeout(timerId);
    };
  }, [frameNumber]);


  useEffect(() => {
    (async function fetchTrackingData() {
        axios.get(`http://localhost:5000/api/tracking/${parseInt(fetchedFrame)}`)
        .then(response => {
          // If your server responds with an image, you might want to display the image instead:
          setTrackingData(response.data);
          console.log(response.data)
        })
        .catch(error => {
          console.error("Error fetching frame: ", error);
        });
    })();
  }, [fetchedFrame]);


  return (
      <div className="App">
      {frame && <FrameWithSquare imageURL={frame} trackingData={trackingData} ref={canvasRef}/>}
      { <Slider isPlaying={isPlaying} frameNumber={frameNumber} setFrameNumber={setFrameNumber} sliderWidth={sliderWidth} /> }
      <p>Current frame: {frameNumber}</p>
      { <Buttons frameNumber={frameNumber} setFrameNumber={setFrameNumber} setIsPlaying={setIsPlaying} />}


      </div>
  );
}

export default App;