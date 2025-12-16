# GTA Project Group A
This Flask-based web application offers a variety of endpoints for interacting with a PostgreSQL database. The app was developed to collect data on perceived dangerous spots in pedestrian traffic. It also provides users with a danger index showing how close they are to previous accident locations and how long they have been there. 

## Overview
The backend is a Flask application that handles:
- User authentication
- Storing trajectories and danger points
- Calculating danger index
- Returning heatmap data
- Returning geospatial accident buffers
- Managing cached danger calculations


## Prerequisites
- "gta24" conda environment
- PostgreSQL database
- The following packages: flask, flask_cors, psycopg2, pandas, geopandas, shapely.geometry, hashlib, json (loaded in app.py)


## Running the Application
To start the Flask application, follow these steps:

1. Activate the conda environment
2. Navigate to the project directory
3. Launch the Flask application by running python `app.py`.

Once started, the application will be available in your web browser at `http://localhost:8989`.


## Project Files
- **app.py**: The main Flask application containing all API endpoints.
- **db_login.json**: Holds the local database access credentials.
- **project_area.geojson**: Specifies the spatial boundary used to filter trajectories.
- **project_area_hoengg.geojson**: Defines the spatial boundary used for analysis on Hoenggerberg to make it easier to test the web app.
-> must replace the file `project_area.geojson` in the app.py for the use of the app at Honggerberg (1x)
- **trajectory_danger_cache (PG Admin table)**: Stores precomputed danger indices for faster retrieval.


## API Endpoints
- **`GET /test_deploy`**: Test the deployment of the app.
- **`GET /`**: Test the connection to the server.
- **`GET /test_data`**: Fetch data from the database.
- **`GET /get_buffers`**: Returns all accident points as a 7-meter buffer (Union), returned as GeoJSON (EPSG:4326).
- **`GET /app/test_deploy/get_buffers`**: Same function as /get_buffers, but accessible under the deployment path.
- **`GET /heatmap`**: Get all POIs with coordinates and severity weighting for heat map visualization.
- **`GET /app/test_deploy/heatmap`**: Same function as /heatmap, but accessible under the deployment path.
- **`GET /register`**: Creates a new user (username + password), stores password hash in the database.
- **`GET /login`**: Checks login data and returns user_id upon successful authentication.
- **`GET /trajectory_details/<int:traj_id>`**: Returns complete trajectory details (start, end, all points) without perimeter filter.
- **`GET /user_trajectories_90/<int:user_id>`**: Returns only the trajectories of a user where ≥90% of the points lie within the perimeter.
- **`GET /trajectory_details_90/<int:traj_id>`**: Returns trajectory details only if at least 90% of the points lie within the perimeter.
- **`GET /danger_index/<traj_id>`**: Calculates the danger index live based on all buffer zones around accident locations (no data is stored).
- **`GET /danger_index_save/<traj_id>`**: Calculates the Danger Index once after completing the trajectory and stores it in the cache (trajectory_danger_cache).
- **`GET /danger_index_average`**: Calculates the average of all stored danger indices, but only for trajectories where at least 90% lie within the perimeter.


