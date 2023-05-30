import React, { useRef, useEffect, useState } from 'react';

const HEIGHT=100;
const WIDTH=100;

function generateColorPalette(numColors) {
  const colors = [];

  for (let i = 0; i < numColors; i++) {
    // Hue value changes for each color, covering the whole spectrum (0-360)
    const hue = Math.floor((i / numColors) * 360);
    // Saturation is 100%, lightness is 50% for the most vibrant colors
    colors.push(`hsl(${hue}, 100%, 50%)`);
  }

  return colors;
}


const FrameWithSquare = React.forwardRef(({ imageURL, trackingData }, ref) => {
  const canvasRef = useRef();
  const inputRef = useRef(); // create a ref for the input field
  const [showBanner, setShowBanner] = useState(false);
  const [bannerText, setBannerText] = useState("");


  const handleClick = (event) => {
    // Get the bounding rectangle of the target element
    const rect = event.target.getBoundingClientRect();

    // Calculate the click coordinates relative to the element
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Log the coordinates
    console.log(`Clicked at ${x}, ${y}`);

    // Check if the click falls within any of the rectangles
    trackingData.forEach((animal) => {
      if (
        x >= animal.x - WIDTH/2 &&
        x <= animal.x + WIDTH/2 &&
        y >= animal.y - HEIGHT/2 &&
        y <= animal.y + HEIGHT/2
      ) {
        setShowBanner(true);
        console.log(`Clicked within rectangle for animal with identity ${animal.identity}`);
      }
    });
  }

  const handleInputChange = (e) => {
    setBannerText(e.target.value);
  };

  const closeBanner = () => {
    console.log("User entered " + bannerText);
    setShowBanner(false);
    setBannerText("");
  };



  useEffect(() => {
    const context = ref.current.getContext('2d');
    const img = canvasRef.current;
    img.src = imageURL;

    const number_of_animals=trackingData.length;
    const colors = generateColorPalette(number_of_animals);
    
    img.onload = function() {

      ref.current.width = img.width
      ref.current.height = img.height
      context.clearRect(0, 0, ref.current.width, ref.current.height);
      context.drawImage(img, 0, 0, ref.current.width, ref.current.height);

      trackingData.forEach(animal => {
        const drawSquare = (context, animal, color) => {
          context.beginPath();
          context.rect(animal.x-WIDTH/2, animal.y-HEIGHT/2, WIDTH, HEIGHT);
          context.lineWidth = 2;
          context.strokeStyle = color;
          context.stroke();
        };

        const writeIdentity = (context, animal, color) => {

          context.font = "35px Arial";
          // Draw the index number on the top left corner of the square
          context.fillStyle=color;
          context.fillText(animal.identity.toString(), animal.x, animal.y);
          // context.fillText(animal.identity.toString(), animal.x-WIDTH/2, animal.y-HEIGHT/2-10);
        }
        
        var color = "#000000";
        if (animal.identity != null & animal.identity != 0) {
          color = colors[parseInt(animal.identity) % number_of_animals ]
        }

        drawSquare(context, animal, color);
        writeIdentity(context, animal, color);

      });    
    };
  }, [imageURL, trackingData, ref]);


  // this effect runs whenever showBanner changes
  useEffect(() => {
    if (showBanner && inputRef.current) {
      inputRef.current.focus(); // focus the input field when the banner is shown
    }
  }, [showBanner]);


  const handleOkClick = (e) => {
    e.preventDefault(); // prevent form from refreshing the page
    closeBanner();
  };



  return (
    <div onClick={handleClick}>
      <canvas ref={ref} />
      <img ref={canvasRef} style={{ display: 'none', width: 1000 }} alt="" />
      {showBanner && (
        <form onSubmit={handleOkClick} className="banner">
          <input 
            type="text"
            onChange={handleInputChange}
            value={bannerText} 
            ref={inputRef} // assign the ref to the input field

          />
          <button type="submit">OK</button>
        </form>
      )}
    </div>
  );
});

export default FrameWithSquare;
