from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
import geopandas as gpd
from shapely.geometry import Point
import json
import pandas as pd
import hashlib

app = Flask(__name__)
CORS(app)

def create_app():
    return app

#Test
@app.route('/test_deploy', methods=['GET'])
def test_deploy():
    return jsonify({'message': 'Hello World!'}), 200

#Test
@app.route('/', methods=['GET'])
def home():
    return jsonify('Connection established'), 200

#DB query control
@app.route('/test_data', methods=['GET'])
def test_data():
    """
    function to test the connection to the server
    """
    with open('db_login.json', 'r') as file:
        db_credentials = json.load(file)
    
    conn = psycopg2.connect(**db_credentials)
    cur = conn.cursor()

    cur.execute('SELECT * FROM "gta25_g1"."Fussgaenger_in_Polygon_copy"')

    print('Data fetched')
    data = cur.fetchall()

    conn.close()

    return jsonify(data), 200

#Buffer (7m radius) around accident sites
@app.route('/get_buffers', methods=['GET'])
@app.route('/app/test_deploy/get_buffers', methods=['GET'])
def get_buffers():

    with open('db_login.json', 'r') as file:
        db_credentials = json.load(file)

    conn = psycopg2.connect(**db_credentials)

    sql = '''
        SELECT "AccidentLocation_CHLV95_E", 
               "AccidentLocation_CHLV95_N"
        FROM gta25_g1."Fussgaenger_in_Polygon_copy";
    '''
    df = pd.read_sql(sql, conn)
    conn.close()

    df = df.dropna(subset=["AccidentLocation_CHLV95_E", "AccidentLocation_CHLV95_N"])

    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(
            df["AccidentLocation_CHLV95_E"], 
            df["AccidentLocation_CHLV95_N"]
        ),
        crs="EPSG:2056"
    )

    gdf["geometry"] = gdf.buffer(7)

    union = gdf.unary_union

    if union.geom_type == "Polygon":
        geoms = [union]
    else:
        geoms = list(union.geoms)

    merged_gdf = gpd.GeoDataFrame(geometry=geoms, crs="EPSG:2056")

    merged_gdf = merged_gdf.to_crs("EPSG:4326")

    return merged_gdf.to_json(), 200, {"Content-Type": "application/json"}

#Use all POIs for heatmap
@app.route("/heatmap", methods=["GET"])
@app.route("/app/test_deploy/heatmap", methods=["GET"])
def get_heatmap():
    try:
        with open('db_login.json', 'r') as file:
            cred = json.load(file)

        conn = psycopg2.connect(**cred)
        cur = conn.cursor()

        query = """
            SELECT 
                ST_Y(geom) AS lat,
                ST_X(geom) AS lon,
                COALESCE(severity, 1) AS weight
            FROM gta25_g1.poi_event
            WHERE geom IS NOT NULL;
        """

        cur.execute(query)
        rows = cur.fetchall()

        cur.close()
        conn.close()

        data = [
            {"lat": r[0], "lon": r[1], "weight": float(r[2])}
            for r in rows
        ]

        return jsonify(data), 200

    except Exception as e:
        print("HEATMAP ERROR:", e)
        return jsonify({"error": str(e)}), 500



#DB connection helper function + password hashing
with open("db_login.json") as f:
    cfg = json.load(f)

def get_conn():
    return psycopg2.connect(
        dbname=cfg["database"],
        user=cfg["user"],
        password=cfg["password"],
        host=cfg["host"],
        port=cfg["port"]
    )

def hash_pw(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

#User registration
@app.post("/register")
def register():
    data = request.get_json()
    username = data["username"]
    pw_hash = hash_pw(data["password"])

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT user_id FROM users WHERE username=%s", (username,))
    if cur.fetchone():
        return jsonify({"success": False, "error": "exists"})

    cur.execute(
        "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING user_id",
        (username, pw_hash)
    )
    user_id = cur.fetchone()[0]
    conn.commit()

    return jsonify({"success": True, "user_id": user_id})

#User-Login
@app.post("/login")
def login():
    data = request.get_json()
    username = data["username"]
    pw_hash = hash_pw(data["password"])

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT user_id FROM users WHERE username=%s AND password_hash=%s",
        (username, pw_hash)
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"success": False})

    return jsonify({"success": True, "user_id": row[0]})

#Load perimeter for 90% logic and danger index
project_area = gpd.read_file("project_area.geojson")
#Use the line below to test the web app at Honggerberg.
#project_area = gpd.read_file("project_area_hoengg.geojson")
perimeter_geom = project_area.geometry.unary_union

#Trajectory details (without 90% verification)
@app.route("/trajectory_details/<int:traj_id>")
def trajectory_details(traj_id):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, started_at, ended_at
        FROM trajectory
        WHERE id = %s
    """, (traj_id,))
    t = cur.fetchone()

    cur.execute("""
        SELECT lat, lng, ts
        FROM trajectory_point
        WHERE trajectory_id = %s
        ORDER BY ts ASC
    """, (traj_id,))
    pts = cur.fetchall()

    cur.close()
    conn.close()

    return jsonify({
        "id": t[0],
        "started_at": t[1].isoformat(),
        "ended_at": t[2].isoformat(),
        "points": [{
            "lat": p[0],
            "lng": p[1],
            "ts": p[2].isoformat()
        } for p in pts]
    })

#Trajectories 90% within perimeter
@app.route("/user_trajectories_90/<int:user_id>")
def user_trajectories_90(user_id):
    """
    Gibt nur jene Trajektorien zurück, bei denen >=90% der Punkte
    innerhalb des project_area-Perimeters liegen.
    """

    with open("db_login.json", "r") as f:
        creds = json.load(f)

    conn = psycopg2.connect(**creds)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, started_at, ended_at
        FROM "gta25_g1"."trajectory"
        WHERE user_id = %s;
    """, (user_id,))
    traj_rows = cur.fetchall()

    result = []

    for traj_id, started, ended in traj_rows:

        cur.execute("""
            SELECT lat, lng
            FROM "gta25_g1"."trajectory_point"
            WHERE trajectory_id = %s;
        """, (traj_id,))
        pts = cur.fetchall()

        if not pts:
            continue  

        total = len(pts)
        inside = 0

        for lat, lng in pts:
            if Point(lng, lat).within(perimeter_geom):
                inside += 1

        percentage = inside / total

        if percentage >= 0.9:
            result.append({
                "id": traj_id,
                "started_at": started,
                "ended_at": ended,
                "percent_inside": round(percentage * 100, 1)
            })

    conn.close()
    return jsonify(result)

#Trajectories Details with 90% filter
@app.route("/trajectory_details_90/<int:traj_id>")
def trajectory_details_90(traj_id):
    """
    Gibt Detaildaten nur zurück, wenn >=90% der Punkte
    innerhalb des Perimeters liegen.
    """

    with open("db_login.json", "r") as f:
        creds = json.load(f)

    conn = psycopg2.connect(**creds)
    cur = conn.cursor()

    cur.execute("""
        SELECT started_at, ended_at
        FROM "gta25_g1"."trajectory"
        WHERE id = %s;
    """, (traj_id,))
    row = cur.fetchone()

    if not row:
        return jsonify({"error": "trajectory not found"}), 404

    started_at, ended_at = row

    cur.execute("""
        SELECT lat, lng, ts
        FROM "gta25_g1"."trajectory_point"
        WHERE trajectory_id = %s
        ORDER BY ts;
    """, (traj_id,))
    pts = cur.fetchall()

    conn.close()

    if not pts:
        return jsonify({"error": "no points"}), 400

    total = len(pts)
    inside_pts = []

    inside_count = 0
    for lat, lng, ts in pts:
        p = Point(lng, lat)
        if p.within(perimeter_geom):
            inside_count += 1
            inside_pts.append({"lat": lat, "lng": lng, "ts": ts})

    percentage = inside_count / total

    if percentage < 0.9:
        return jsonify({"error": "trajectory outside perimeter"}), 403

    return jsonify({
        "started_at": started_at,
        "ended_at": ended_at,
        "points": inside_pts,
        "percent_inside": round(percentage * 100, 1)
    })

#Danger Index
@app.route("/danger_index/<traj_id>", methods=["GET"])
def danger_index(traj_id):
    try:
        with open('db_login.json', 'r') as file:
            db_credentials = json.load(file)

        conn = psycopg2.connect(**db_credentials)
        cur = conn.cursor()

        cur.execute("""
            SELECT lat, lng
            FROM "gta25_g1"."trajectory_point"
            WHERE trajectory_id = %s
            ORDER BY ts ASC
        """, (traj_id,))
        points = cur.fetchall()

        total = len(points)
        if total == 0:
            return jsonify({"danger_index": 0})

        df = pd.read_sql("""
            SELECT 
                "AccidentSeverityCategory",
                "AccidentLocation_CHLV95_E",
                "AccidentLocation_CHLV95_N"
            FROM gta25_g1."Fussgaenger_in_Polygon_copy"
        """, conn)

        conn.close()

        df = df.dropna(subset=["AccidentLocation_CHLV95_E", "AccidentLocation_CHLV95_N"])

        sev_map = {
            "as1": 4,
            "as2": 3,
            "as3": 2,
            "as4": 1
        }

        df["sev"] = df["AccidentSeverityCategory"].str.lower().map(sev_map)

        gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(
                df["AccidentLocation_CHLV95_E"],
                df["AccidentLocation_CHLV95_N"]
            ),
            crs="EPSG:2056"
        )

        gdf["geometry"] = gdf.buffer(7)

        gdf = gdf.to_crs("EPSG:4326")

        danger_sum = 0

        for lat, lng in points:
            pt = Point(lng, lat)

            hit = gdf[gdf.contains(pt)]

            if len(hit) > 0:
                sev_value = hit["sev"].max()
                danger_sum += sev_value


        danger_index = danger_sum / total

        return jsonify({
            "danger_index": round(danger_index, 3),
            "total_points": total
        })

    except Exception as e:
        print("DANGER INDEX ERROR:", e)
        return jsonify({"error": str(e)}), 500

#Danger Index Storage (Cache)
@app.route("/danger_index_save/<traj_id>", methods=["POST"])
def danger_index_save(traj_id):
    """
    Berechnet den Danger Index EINMALIG nach dem Speichern einer Trajektorie
    und speichert das Resultat in trajectory_danger_cache.
    """

    try:
        with open("db_login.json", "r") as f:
            creds = json.load(f)

        conn = psycopg2.connect(**creds)
        cur = conn.cursor()

        cur.execute("""
            SELECT lat, lng
            FROM gta25_g1.trajectory_point
            WHERE trajectory_id = %s
            ORDER BY ts ASC
        """, (traj_id,))
        points = cur.fetchall()

        total = len(points)
        if total == 0:
            return jsonify({"error": "no points"}), 400

        inside = 0
        inside_pts = []

        for lat, lng in points:
            p = Point(lng, lat)
            if p.within(perimeter_geom):
                inside += 1
                inside_pts.append((lat, lng))

        perc = inside / total
        if perc < 0.9:
            cur.execute("""
                INSERT INTO trajectory_danger_cache (trajectory_id, danger_index, total_points)
                VALUES (%s, %s, %s)
                ON CONFLICT (trajectory_id) DO UPDATE 
                SET danger_index = EXCLUDED.danger_index,
                    total_points = EXCLUDED.total_points
            """, (traj_id, 0, total))

            conn.commit()
            return jsonify({"warning": "<90% inside, stored as 0"}), 200

        df = pd.read_sql("""
            SELECT 
                "AccidentSeverityCategory",
                "AccidentLocation_CHLV95_E",
                "AccidentLocation_CHLV95_N"
            FROM gta25_g1."Fussgaenger_in_Polygon_copy"
        """, conn)

        df = df.dropna(subset=["AccidentLocation_CHLV95_E", "AccidentLocation_CHLV95_N"])

        mapping = {"as1": 4, "as2": 3, "as3": 2, "as4": 1}
        df["sev"] = df["AccidentSeverityCategory"].str.lower().map(mapping)

        gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(
                df["AccidentLocation_CHLV95_E"],
                df["AccidentLocation_CHLV95_N"]
            ),
            crs="EPSG:2056"
        )

        gdf["geometry"] = gdf.buffer(7)
        gdf = gdf.to_crs("EPSG:4326")

        danger_sum = 0
        for lat, lng in inside_pts:
            pt = Point(lng, lat)
            hit = gdf[gdf.contains(pt)]
            if len(hit) > 0:
                max_sev = hit["sev"].max()
                danger_sum += max_sev


        danger_index = danger_sum / len(inside_pts)

        cur.execute("""
            INSERT INTO trajectory_danger_cache (trajectory_id, danger_index, total_points)
            VALUES (%s, %s, %s)
            ON CONFLICT (trajectory_id) DO UPDATE 
            SET danger_index = EXCLUDED.danger_index,
                total_points = EXCLUDED.total_points
        """, (traj_id, danger_index, total))

        conn.commit()
        conn.close()

        return jsonify({
            "trajectory_id": traj_id,
            "danger_index": round(danger_index, 3),
            "total_points": total
        })

    except Exception as e:
        print("ERROR danger_index_save:", e)
        return jsonify({"error": str(e)}), 500

#Danger Index Average
@app.get("/danger_index_average")
def danger_index_average():
    """
    Mittelwert aller danger_index-Werte aus trajectory_danger_cache,
    ABER nur für jene Trajektorien, deren Punkte zu ≥90% im Perimeter liegen.
    """
    try:
        with open("db_login.json", "r") as f:
            creds = json.load(f)

        conn = psycopg2.connect(**creds)
        cur = conn.cursor()

        cur.execute("""
            SELECT trajectory_id, danger_index 
            FROM gta25_g1.trajectory_danger_cache
            WHERE total_points > 0
        """)
        cached = cur.fetchall()

        valid_values = []

        for traj_id, d_index in cached:

            cur.execute("""
                SELECT lat, lng
                FROM gta25_g1.trajectory_point
                WHERE trajectory_id = %s
            """, (traj_id,))
            pts = cur.fetchall()

            if not pts:
                continue

            total = len(pts)
            inside = 0

            for lat, lng in pts:
                if Point(lng, lat).within(perimeter_geom):
                    inside += 1

            if total == 0:
                continue

            percentage = inside / total

            if percentage >= 0.9:
                valid_values.append(d_index)

        conn.close()

        if not valid_values:
            return jsonify({"average": 0, "count": 0})

        avg = sum(valid_values) / len(valid_values)

        return jsonify({
            "average": round(avg, 3),
            "count": len(valid_values)
        })

    except Exception as e:
        print("ERROR avg danger:", e)
        return jsonify({"error": str(e)}), 500




if __name__ == '__main__':
    app.run(port=8989, debug=True)
