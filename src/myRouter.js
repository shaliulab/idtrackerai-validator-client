import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { BACKEND_SERVER } from './constants'

function MyRouter() {
    let { datasetName } = useParams();
    console.log("Fetching to api/get");

    useEffect(() => {
        console.log("Fetching to api/get");
        fetch(`http://${BACKEND_SERVER}:5000/api/get/${datasetName}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        .then(response => response.json())
        .then(data => console.log(data))
        .catch(error => console.error('Error:', error));
    }, [datasetName]); // Dependency array


    return <div>Loading dataset ${datasetName}...</div>;
};

export default MyRouter;
