import React, { useEffect, useState } from "react";
import Select from 'react-select';
import axios from 'axios';

const SelectComponent = () => {
  const [options, setOptions] = useState([]);

  const fetchData = async () => {
    const response = await axios.get("http://localhost:5000/api/list");
    const data = response.data["experiments"];
    console.log(data);
    if (data != null) {
      // Map data to match react-select's expected shape
      const formattedData = data.map((item) => ({ value: item, label: item }));
      setOptions(formattedData);
    }
  };


  useEffect(() => {
    fetchData();
  }, []);

  const handleSelectChange = async (selectedOption) => {
    console.log(`Option selected:`, selectedOption["value"]);
    // let config={headers: {"Access-Control-Allow-Origin": "http://localhost:3000"}}
    let config={}


    const response = await axios.post("http://localhost:5000/api/load", {"experiment": selectedOption["value"]}, config)
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
    <div><Select 
      options={options}
      onChange={handleSelectChange}
    />
    <button onClick={fetchData}>Refresh</button>
    </div>

    
  );
};

export default SelectComponent;