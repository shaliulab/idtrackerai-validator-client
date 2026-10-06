// interactiveText.js

import React, { useState, useEffect } from 'react';

const InteractiveText = React.forwardRef(({ value, setValue, id, labelText, title }, ref) => {
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
        <label className="field" htmlFor={id} title={title}>
            {labelText}
            <input
                ref={ref}
                type="number"
                step="1"
                min="1"
                value={draft}
                id={id}
                onChange={handleInputChange}
                onBlur={handleBlur}
                onKeyDown={(e) => e.stopPropagation()}
            />
        </label>
    );
});

InteractiveText.displayName = 'InteractiveText';

export default InteractiveText;