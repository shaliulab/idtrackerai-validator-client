import React, { useRef, useEffect } from 'react';

const HEIGHT=100;
const WIDTH=100;
const RGB_COLORS=[
  [128.0, 0.0, 0.0, 0.0],
  [242.0819964349376, 0.0, 0.0, 0.0],
  [255.0, 76.8, 0.0, 0.0],
  [255.0, 177.1921568627451, 0.0, 0.0],
  [206.45161290322582, 255.0, 41.29032258064515, 0.0],
  [122.2517394054396, 255.0, 125.49019607843135, 0.0],
  [41.29032258064515, 255.0, 206.45161290322577, 0.0],
  [0.0, 197.2519970951344, 255.0, 0.0], [0.0, 104.29629629629633, 255.0, 0.0],
  [0.0, 7.622367465504766, 242.08199643493768, 0.0]
]

const color_to_hex = function(color) {
  return("#"+
  (parseInt(color[0])).toString(16).padStart(2, '0') +
  (parseInt(color[1])).toString(16).padStart(2, '0') +
  (parseInt(color[2])).toString(16).padStart(2, '0')
  )
}

const COLORS = [];
RGB_COLORS.forEach(color => {

  var hex_color=color.slice(0, 3);
  COLORS.push(hex_color);
})


const FrameWithSquare = React.forwardRef(({ imageURL, trackingData }, ref) => {
  const canvasRef = useRef();


  useEffect(() => {
    const context = ref.current.getContext('2d');
    const img = canvasRef.current;
    img.src = imageURL;
    
    img.onload = function() {

      ref.current.width = img.width
      ref.current.height = img.height
      context.clearRect(0, 0, ref.current.width, ref.current.height);
      context.drawImage(img, 0, 0, ref.current.width, ref.current.height);
      console.log("");
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
        if (animal.identity != null) {
          color = color_to_hex(COLORS[parseInt(animal.identity) % COLORS.length ])
        }

        console.log(animal);
        drawSquare(context, animal, color);
        writeIdentity(context, animal, color);

      });    
    };
  }, [imageURL, trackingData, ref]);


  return (
    <div>
      <canvas ref={ref} />
      <img ref={canvasRef} style={{ display: 'none', width: 1000 }} alt="" />
    </div>
  );
});

export default FrameWithSquare;
