// import React, { useEffect } from 'react';
// const ScrollNumberInput = ({ value, setValue, id, labelText, focusElementRef }) => {

//     useEffect(() => {
//         // Define the wheel event handler
//         const handleWheel = (event) => {
//             event.preventDefault();
//             setValue((prevValue) => event.deltaY < 0 ? prevValue + 1 : prevValue - 1);
//         };

//         const focusElement = focusElementRef.current;
//         focusElement.addEventListener('wheel', handleWheel, { passive: false });

//         return function cleanup() {
//             if (focusElement) {
//                 focusElement.removeEventListener('wheel', handleWheel, { passive: false });
//             }
//         };
//     }, [setValue, focusElementRef]);

//     const handleChange = (event) => {
//         //setValue(Number(event.target.value));
//     }

//     return (
//         <label htmlFor={id}>
//           {labelText}
//           <input 
//               type="number"
//               id={id}
//               value={value}
//               onChange={handleChange}
//           />
//         </label>
//     );
// }



import React, { useEffect, useRef } from 'react';
import debounce from 'lodash.debounce';

const ScrollNumberInput = ({ value, setValue, videoFrameRate, id, labelText, focusElementRef }) => {
    // Create a debounced function to update the frame number
    const debouncedSetValue = useRef(
        debounce((updateFunction) => {
            setValue((prevValue) => updateFunction(prevValue));
        }, 100)
    ).current;

    useEffect(() => {
        const handleWheel = (event) => {
            event.preventDefault();
            const delta = event.deltaY < 0 ? videoFrameRate : -videoFrameRate;

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
    }, [debouncedSetValue, focusElementRef]);

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

