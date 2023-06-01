import React, { useRef, useEffect } from 'react';

const InteractiveText = React.forwardRef(({ value, setValue, id, labelText }, ref) => {
    
    const handleInputChange = (event) => {
        const newValue = parseInt(event.target.value);
        if (!isNaN(newValue)) {
            setValue(newValue);
        }
    };

    return(
        <div>
        <label htmlFor={id}>{labelText}</label>
        <input 
            style={{width: 100}}
            type="number"
            step="1" 
            value={value}
            id={id} 
            onChange={handleInputChange}
        />
        </div>
    )

}); 

export default InteractiveText