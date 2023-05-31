import React, { useRef, useEffect } from 'react';

const InteractiveText = React.forwardRef(({ value, setValue }, ref) => {
    
    const handleInputChange = (event) => {
        const newValue = parseInt(event.target.value);
        if (!isNaN(newValue)) {
            setValue(newValue);
        }
    };

    return(
        <input 
            style={{width: 100}}
            type="number"
            step="1" 
            value={value} 
            onChange={handleInputChange} 
        />
    )

}); 

export default InteractiveText