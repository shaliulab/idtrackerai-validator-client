// interactiveText.js

import React, { useState, useEffect } from 'react';

const InteractiveText = React.forwardRef(({ value, setValue, id, labelText }, ref) => {
    // Local draft so the field can be empty or mid-edit without the parent
    // rejecting it and snapping the value back.
    const [draft, setDraft] = useState(String(value ?? ''));

    useEffect(() => { setDraft(String(value ?? '')); }, [value]);

    const handleInputChange = (event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            setValue(parsed);
        }
    };

    const handleBlur = () => {
        // Discard an unusable draft and show the last accepted value.
        const parsed = parseInt(draft, 10);
        if (Number.isNaN(parsed) || parsed <= 0) setDraft(String(value ?? ''));
    };

    return (
        <div>
            <label htmlFor={id}>{labelText}</label>
            <input
                ref={ref}
                style={{ width: 100 }}
                type="number"
                step="1"
                min="1"
                value={draft}
                id={id}
                onChange={handleInputChange}
                onBlur={handleBlur}
                onKeyDown={(e) => e.stopPropagation()}
            />
        </div>
    );
});

InteractiveText.displayName = 'InteractiveText';

export default InteractiveText;