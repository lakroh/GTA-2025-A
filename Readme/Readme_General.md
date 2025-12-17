# Web-App GTA Group A
This project is a web application developed to identify dangerous spots in pedestrian traffic and provide users with feedback on how dangerous their living environment is. The app is currently available for the area between Zurich Central Station and ETH Zentrum.

The Link to the Web App is the follwing: `https://lumatrace.tiiny.site`


## Structure
- Frontend
- Backend
- Database (GeoServer and PG Admin)


### Frontend
See ../Source Code/Frontend/readme.md


### Backend
See ../Source Code/Backend/readme.md


### Database
Link to GeoServer: https://baug-ikg-gis-01.ethz.ch:8443/geoserver/web/wicket/bookmarkable/org.geoserver.web.data.store.StorePage?3&filter=false&filter=false


#### Tables in PG Admin (PostgreSQL Database):
Open Data:
- Fussgaenger_in_Polygon: fid, AccidentUID, AccidentType, AccidentType_de, AccidentSeverityCategory, AccidentSeverityCategory_de, AccidentInvolvingPedestrian, AccidentInvolvingBicycle, AccidentInvolvingMotorcycle, RoadType, RoadType_de, AccidentLocation_CHLV95_E, AccidentLocation_CHLV95_N, CantonCode, MunicipalityCode, AccidentYear, AccidentMonth, AccidentMonth_de, AccidentWeekDay, AccidentWeekDay_de, AccidentHour, AccidentHour_text
-> only includes accidents that actually occurred within our perimeter

- Fussgaenger_in_Polygon_Copy: fid, AccidentUID, AccidentType, AccidentType_de, AccidentSeverityCategory, AccidentSeverityCategory_de, AccidentInvolvingPedestrian, AccidentInvolvingBicycle, AccidentInvolvingMotorcycle, RoadType, RoadType_de, AccidentLocation_CHLV95_E, AccidentLocation_CHLV95_N, CantonCode, MunicipalityCode, AccidentYear, AccidentMonth, AccidentMonth_de, AccidentWeekDay, AccidentWeekDay_de, AccidentHour, AccidentHour_text
-> in addition to the accidents that actually occurred within our perimeter, it also includes 9 fake accidents at Honggerberg to simplify testing of the web app

Collected Data:
- users: user_id, username, password_hash
- poi_event: id, trajectory_id, ts, geom, type, severity, lat, lng, user_id
- trajectory: id, started_at, ended_at, geom, user_id
- trajectory_point: id, trajectory_id, ts, geom, lat, lng, user_id

Cache for faster calculation:
- trajectory_danger_cache: trajectory_id, danger_index, total_points


# Authors
This web app was developed during the GTA Fall Semester 2025 by **Group A**:
- Laurenz Kroh
- Lara Maggioni
- Timon Merz
- Luisa Rihs
