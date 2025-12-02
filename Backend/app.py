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


@app.route('/test_deploy', methods=['GET'])
def test_deploy():
    return jsonify({'message': 'Hello World!'}), 200

@app.route('/', methods=['GET'])
def home():
    return jsonify('Connection established'), 200

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


@app.route('/get_buffers', methods=['GET'])
@app.route('/app/test_deploy/get_buffers', methods=['GET'])
def get_buffers():

    # 1) DB Credentials laden
    with open('db_login.json', 'r') as file:
        db_credentials = json.load(file)

    conn = psycopg2.connect(**db_credentials)

    # 2) Daten abfragen (Schema prüfen!)
    sql = '''
        SELECT "AccidentLocation_CHLV95_E", 
               "AccidentLocation_CHLV95_N"
        FROM gta25_g1."Fussgaenger_in_Polygon_copy";
    '''
    df = pd.read_sql(sql, conn)
    conn.close()

    # 3) Null-Werte entfernen
    df = df.dropna(subset=["AccidentLocation_CHLV95_E", "AccidentLocation_CHLV95_N"])

    # 4) Punkte erzeugen
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(
            df["AccidentLocation_CHLV95_E"], 
            df["AccidentLocation_CHLV95_N"]
        ),
        crs="EPSG:2056"
    )

    # 5) Buffer erzeugen
    gdf["geometry"] = gdf.buffer(7)

    # 6) Alle Buffer zu Clustern verschmelzen
    union = gdf.unary_union

    # 7) Mehrere Polygone aufteilen
    if union.geom_type == "Polygon":
        geoms = [union]
    else:
        geoms = list(union.geoms)

    # 8) Neues GeoDataFrame
    merged_gdf = gpd.GeoDataFrame(geometry=geoms, crs="EPSG:2056")

    # 9) In WGS84 konvertieren
    merged_gdf = merged_gdf.to_crs("EPSG:4326")

    # 10) GeoJSON zurückgeben
    return merged_gdf.to_json(), 200, {"Content-Type": "application/json"}


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





# DB Login
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


@app.route("/user_trajectories/<int:user_id>")
def user_trajectories(user_id):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, started_at, ended_at
        FROM trajectory
        WHERE user_id = %s
        ORDER BY started_at DESC
    """, (user_id,))

    rows = cur.fetchall()

    trajectories = [{
        "id": r[0],
        "started_at": r[1].isoformat(),
        "ended_at": r[2].isoformat() if r[2] else None
    } for r in rows]

    cur.close()
    conn.close()
    return jsonify(trajectories)


@app.route("/trajectory_details/<int:traj_id>")
def trajectory_details(traj_id):
    conn = get_conn()
    cur = conn.cursor()

    # 1. Metadaten
    cur.execute("""
        SELECT id, started_at, ended_at
        FROM trajectory
        WHERE id = %s
    """, (traj_id,))
    t = cur.fetchone()

    # 2. Punkte
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




if __name__ == '__main__':
    app.run(port=8989, debug=True)
