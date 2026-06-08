import React, { useEffect, useState } from "react";
import Select from 'react-select';
import axios from 'axios';
import { BACKEND_SERVER, BACKEND_PORT, FIRST_FRAME } from './constants';


async function postLoad(experiment) {
  const response = await axios.post(
    `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/load`,
    { experiment }
  );
  return response.data;
}


const SelectComponent = ({ onExperimentChange }) => {
  const defaultOption = { value: "", label: "Browse available experiments..." };
  const [options, setOptions] = useState([defaultOption]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    axios.get(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/list`)
      .then(response => {
        const data = response.data["experiments"];
        if (Array.isArray(data)) {
          setOptions([defaultOption, ...data.map(item => ({ value: item, label: item }))]);
        }
      })
      .catch(err => console.error("Error fetching experiments:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleLoad = async (experiment) => {
    const trimmed = experiment.trim();
    if (!trimmed) return;
    setIsSwitching(true);
    setError(null);
    try {
      const data = await postLoad(trimmed);
      const firstFrame = data.first_frame ?? FIRST_FRAME;
      if (onExperimentChange) onExperimentChange(firstFrame);
    } catch (err) {
      const msg = err.response?.data?.error ?? err.message;
      setError(`Failed to switch: ${msg}`);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleDropdownChange = (selectedOption) => {
    if (!selectedOption?.value) return;
    setInputValue(selectedOption.value);
    handleLoad(selectedOption.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLoad(inputValue);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. FlyHostel4/6X/2023-08-31_13-00-00"
          disabled={isSwitching}
          style={{ flex: 1, padding: "6px 10px", fontSize: 14, borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button
          onClick={() => handleLoad(inputValue)}
          disabled={isSwitching || !inputValue.trim()}
          style={{ padding: "6px 16px", fontSize: 14, borderRadius: 4, cursor: "pointer" }}
        >
          {isSwitching ? "Loading…" : "Select"}
        </button>
      </div>

      {isLoading ? (
        <p style={{ margin: 0, color: "#888", fontSize: 13 }}>Loading experiment list…</p>
      ) : (
        <Select
          options={options}
          onChange={handleDropdownChange}
          defaultValue={defaultOption}
          isDisabled={isSwitching}
          placeholder="Browse available experiments..."
        />
      )}

      {error && <p style={{ color: "red", marginTop: 4, fontSize: 13 }}>{error}</p>}
    </div>
  );
};

export default SelectComponent;
