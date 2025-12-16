# Web-App GTA Group A
This project is a web application developed to identify dangerous spots in pedestrian traffic and provide users with feedback on how dangerous their living environment is. The app is currently available for the area between Zurich Central Station and ETH Zentrum.


## Features
- **Login and Registration**: By creating an account and logging in, users gain access to the app and to their trajectories.
- **Live Map**: The application renders OpenStreetMap tiles, tracks the user's movement, saves and displays trajectories, and visualizes buffers and heatmaps.
- **Tracking**: GPS-based trajectory tracking, saved in the database via GeoServer WFS, only trajectories with >= 90% inside the project perimeter are considered valid for statistics, automatic session restoration via localStorage.
- **Perimeter Filtering**: Defines our analysis area.
- **Trajectory Handling**: The user can start a trajectory, stop it via a modal with the options Continue, Delete, or Save, and after saving, the trajectory is uploaded to the backend.
- **Danger Spots**: Each POI has: position, description, severity
- **Heatmap**: Generated from all POI inside the perimeter, Visualisation uses Leaflet.heat
- **Danger Index**: Based on intersections between trajectory points and official accident buffers, stored in trajectory_danger_cache for fast future access


## Some of the most important functions
- **startTracking()**: Start a new trajectory. 
- **onPosition(pos)**: Controls movement, pop-ups, and buffer logic. 
- **stopTracking()**: Controlled completion of recording.
- **getCurrentBufferId(lat, lng)**: Decides whether a pop-up appears. 
- **showBufferPopup()**: Automatically opens the Danger Spot modal when entering a new buffer.
- **onModalSubmit(e)**: Saves danger spots.
- **trajSave (Save-Button-Handler)**: Stops tracking, Saves trajectory, Saves points, Saves POIs, Saves geometry, Calculates and caches danger index -> short: from local to database
- **loadBuffers()**: Loads all danger zones.
- **loadDangerIndex(trajId)**: Loads the calculated Danger Index. 
- **loadAverageDangerIndex()**: Loads the average Danger Index from the cache.



## Technologies Used
- **HTML/CSS**: Responsible for the layout and visual styling of the web application.
- **JavaScript**: Enables the app's functionality and interactive features.
- **Leaflet**: Provides mapping and geolocation capabilities, including drawing trajectories and generating the heatmap.
- **GeoServer**: Manages geospatial data and processes WFS requests.
- **Turf.js** for geospatial checks (point-in-polygon)


### Prerequisites
- A modern web browser with JavaScript enabled (for example Chrome)
- An active internet connection to load external libraries (Leaflet CDN, Turf.js, jQuery)


### Usage
1. Open `index.html` in your web browser.
2. Register a new account or log in with your existing credentials.
3. Start a new trajectory by clicking the "Start Trajectory" button.
4. Move around the city, the trajectory points are stored automatically (every 8 seconds).
6. When you encounter a dangerous pedestrian-traffic spot, save it using the "Save Danger Point" button.
7. Click "Stop Trajectory" to end the trip and choose whether you want to save, delete, or continue it.
8. You can choose to view the Heatmap. 
9. Under Personal Details you view all your past trajectories
10. Open individual trajectories to see: duration, distance, average speed, danger index per trajectory and overall average danger index.


## Project Files
- `index.html`: The main HTML file for the web application.
- `main.css`: Contains all styling rules for the application's layout and design.
- `main.js`: Includes the core functionality and complete client-side logic of the application.
- `project_area.geojson`: Defines the spatial boundary used for analysis.
- `project_area_hoengg.geojson`: Defines the spatial boundary used for analysis on Hoenggerberg to make it easier to test the web app.
-> must replace the file `project_area.geojson` in the app.js for the use of the app at Honggerberg (2x)
