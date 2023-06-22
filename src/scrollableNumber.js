import React, { useEffect } from 'react';

const ScrollNumberInput = ({ value, setValue, id, labelText, focusElementRef }) => {

    useEffect(() => {
        // Define the wheel event handler
        const handleWheel = (event) => {
            event.preventDefault();
            const newValue = event.deltaY < 0 ? Number(value) + 1 : Number(value) - 1;
            // Check if new value is within the min/max range before updating the state
            setValue(newValue);
        };

        const focusElement = focusElementRef.current;
        focusElement.addEventListener('wheel', handleWheel, { passive: false });

        return function cleanup() {
            if (focusElement) {
                focusElement.removeEventListener('wheel', handleWheel, { passive: false });
            }
        };
    }, [value, setValue, focusElementRef]);

    const handleChange = (event) => {
        setValue(event.target.value);
    }

    return (
        <label htmlFor={id}>
          {labelText}
          <input 
              type="number"
              id={id}
              value={value}
              onChange={handleChange}
          />
        </label>
    );
}

export default ScrollNumberInput;
