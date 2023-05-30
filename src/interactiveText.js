import React, { useRef, useEffect } from 'react';

const InteractiveText = React.forwardRef(({ frameNumber, setFrameNumber }, ref) => {
    
    const handleInputChange = (event) => {
        const newValue = parseInt(event.target.value);
        if (!isNaN(newValue)) {
            setFrameNumber(newValue);
        }
    };

    return(
        <input 
            style={{width: 100}}
            type="number"
            step="1" 
            value={frameNumber} 
            onChange={handleInputChange} 
        />
    )

}); 

export default InteractiveText