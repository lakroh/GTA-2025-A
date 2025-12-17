# Collected Data Group A
All open-source and user data can be found in the database (PG Admin). We weren't quite sure what to submit here.

## Collected Data:

users: user_id, username, password_hash
poi_event: id, trajectory_id, ts, geom, type, severity, lat, lng, user_id
trajectory: id, started_at, ended_at, geom, user_id
trajectory_point: id, trajectory_id, ts, geom, lat, lng, user_id

## Cache for faster calculation:

trajectory_danger_cache: trajectory_id, danger_index, total_points
