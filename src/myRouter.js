import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';

function MyRouter() {
    let { datasetName } = useParams();
    fetch(`http://localhost:5000/api/get/${datasetName}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    .then(response => response.json())
    // .then(data => console.log(data))
    .catch(error => console.error('Error:', error));


    return <div>Loading dataset ${datasetName}...</div>;
};

export default MyRouter;
