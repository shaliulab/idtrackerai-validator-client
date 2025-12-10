import React, { useEffect, useRef } from 'react';
import debounce from 'lodash.debounce';

const ScrollNumberInput = ({ value, setValue, videoFrameRate, id, labelText, focusElementRef }) => {
    // Create a debounced function to update the frame number
    const debouncedSetValue = useRef(
        debounce((updateFunction) => {
            setValue((prevValue) => updateFunction(prevValue));
        }, 100)
    ).current;

    // Store the latest videoFrameRate in a ref
    const videoFrameRateRef = useRef(videoFrameRate);

    useEffect(() => {
        // Update the ref whenever videoFrameRate changes
        videoFrameRateRef.current = videoFrameRate;
    }, [videoFrameRate]);

    useEffect(() => {
        const handleWheel = (event) => {
            event.preventDefault();
            const delta = event.deltaY < 0 ? Math.floor(videoFrameRateRef.current) : Math.ceil(-videoFrameRateRef.current);

            // Pass the update function to the debounced handler
            debouncedSetValue((prevValue) => prevValue + delta);
        };

        const focusElement = focusElementRef.current;
        if (focusElement) {
            focusElement.addEventListener('wheel', handleWheel, { passive: false });
        }

        return () => {
            if (focusElement) {
                focusElement.removeEventListener('wheel', handleWheel, { passive: false });
            }
            debouncedSetValue.cancel(); // Clean up debounce on unmount
        };
    }, [debouncedSetValue, focusElementRef]); // No need to include videoFrameRate here

    return (
        <label htmlFor={id}>
            {labelText}
            <input
                type="number"
                id={id}
                value={value} // Render the current frame number in the input
                onChange={(e) => setValue(Number(e.target.value))} // Update state on manual input
            />
        </label>
    );
};

export default ScrollNumberInput;
