import React, { useEffect, useState } from "react";
import Select from 'react-select';
import axios from 'axios';
import { BACKEND_SERVER } from './constants'

const SelectComponent = () => {
  const defaultOption = { value: "", label: "Select an option..." };
  const [options, setOptions] = useState([defaultOption]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    setIsLoading(true);
    const response = await axios.get(`http://${BACKEND_SERVER}:5000/api/list`);
    const data = response.data["experiments"];
    console.log(data);
    if (data != null) {
      // Map data to match react-select's expected shape
      const formattedData = data.map((item) => ({ value: item, label: item }));
      setOptions([defaultOption, ...formattedData]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);
//   fetchData()

  const handleSelectChange = async (selectedOption) => {
    console.log(`Option selected:`, selectedOption["value"]);
    let config={}

    await axios.post(`http://${BACKEND_SERVER}:5000/api/load`, {"experiment": selectedOption["value"]}, config)
    .then(response => {
    if (response.status === 0) {
        console.log(response.data["message"]);   
    } else if (response.status === 200) {
        console.log(response.data["message"]);
    } else {
    // Handle non-OK status codes
    console.log("Error:", response.status);
    }})
    .catch(error => {
        // Handle request error
        console.error("Request error:", error);
    });
  };

  return (
    <div>
      {isLoading ? (
        <p>Loading options...</p>
      ) : (
        <>
          <Select 
            options={options}
            onChange={handleSelectChange}
            defaultValue={options[0]}
          />
          <p>Experiment selection does not take effect until you select a new frame. Please move the slider or change the frame in the text box</p>
        </>
      )}
    </div>
  );
};

export default SelectComponent;
