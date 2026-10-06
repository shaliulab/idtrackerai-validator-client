// selectComponent.js

import React, { useEffect, useState } from "react";
import CreatableSelect from 'react-select/creatable';
import api from './api';
import { FIRST_FRAME } from './constants';
import { useConsole } from './MessageConsole';

// Module-level so it isn't a new object on every render (which would make the
// effect below need it as a dependency).
const defaultOption = { value: "", label: "Browse available experiments..." };

// react-select styles inline; route its colors through the theme's CSS variables.
const selectStyles = {
  container: (base) => ({ ...base, width: 420, maxWidth: '40vw' }),
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    background: 'var(--surface)',
    borderColor: state.isFocused ? 'var(--accent)' : 'var(--border-strong)',
    boxShadow: state.isFocused ? '0 0 0 2px var(--accent-soft)' : 'none',
    '&:hover': { borderColor: 'var(--accent)' },
  }),
  valueContainer: (base) => ({ ...base, padding: '0 8px' }),
  singleValue: (base) => ({ ...base, color: 'var(--text)', fontFamily: 'monospace', fontSize: 13 }),
  input: (base) => ({ ...base, color: 'var(--text)', fontFamily: 'monospace', fontSize: 13 }),
  placeholder: (base) => ({ ...base, color: 'var(--subtext)' }),
  indicatorsContainer: (base) => ({ ...base, height: 30 }),
  indicatorSeparator: (base) => ({ ...base, background: 'var(--border)' }),
  menu: (base) => ({ ...base, background: 'var(--surface)', border: '1px solid var(--border)', zIndex: 20 }),
  option: (base, state) => ({
    ...base,
    fontFamily: 'monospace',
    fontSize: 13,
    color: 'var(--text)',
    background: state.isSelected ? 'var(--accent-soft)' : state.isFocused ? 'var(--btn-hover)' : 'transparent',
  }),
};

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

export async function postLoad(experiment) {
  const response = await api.post('/api/load', { experiment });
  return unwrap(response.data);
}


const SelectComponent = ({ onExperimentChange }) => {
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [current, setCurrent] = useState("");
  const { log } = useConsole();

  useEffect(() => {
    api.get('/api/list')
      .then(response => {
        const data = unwrap(response.data)["experiments"];
        if (Array.isArray(data)) {
          setOptions(data.map(item => ({ value: item, label: item })));
        }
      })
      .catch(err => {
        console.error("Error fetching experiments:", err);
        log('error', `Could not load the experiment list: ${err.message}`);
      })
      .finally(() => setIsLoading(false));
  }, [log]);

  // The backend holds the loaded experiment, so it survives a page reload; ask it
  // rather than persisting anything client-side.
  useEffect(() => {
    api.get('/api/current_experiment')
      .then(r => {
        const exp = unwrap(r.data)?.experiment;
        if (exp) setCurrent(exp);
      })
      .catch(() => {});
  }, []);

  const handleLoad = async (experiment) => {
    const trimmed = experiment.trim();
    if (!trimmed) return;
    setIsSwitching(true);
    const previous = current;
    setCurrent(trimmed);
    try {
      const data = await postLoad(trimmed);
      const firstFrame = data.first_frame ?? FIRST_FRAME;
      log('info', `Loaded ${trimmed}`);
      if (onExperimentChange) onExperimentChange(firstFrame);
    } catch (err) {
      const msg = err.response?.data?.error ?? err.message;
      log('error', `Failed to load ${trimmed}: ${msg}`);
      setCurrent(previous);
    } finally {
      setIsSwitching(false);
    }
  };

  // Typing a path not in the list and pressing Enter "creates" it: load it as typed.
  return (
    <div onKeyDown={e => e.stopPropagation()} title="Experiment: pick one, or type its path and press Enter">
      <CreatableSelect
        options={options}
        value={current ? { value: current, label: current } : null}
        onChange={(option) => option?.value && option.value !== current && handleLoad(option.value)}
        onCreateOption={handleLoad}
        formatCreateLabel={(input) => `Load "${input}"`}
        isLoading={isLoading || isSwitching}
        isDisabled={isSwitching}
        placeholder={defaultOption.label}
        noOptionsMessage={() => "Type an experiment path, e.g. FlyHostel4/6X/2023-08-31_13-00-00"}
        styles={selectStyles}
      />
    </div>
  );
};

export default SelectComponent;
