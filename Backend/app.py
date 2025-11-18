from flask import Flask, jsonify
from flask_cors import CORS
import psycopg2
import geopandas as gpd
from shapely.geometry import Point
import json
import pandas as pd

app = Flask(__name__)
CORS(app)


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

    cur.execute('SELECT * FROM "gta25_g1"."Fussgaenger_in_Polygon_copy"') #"Fussgaenger_in_Polygon" einsetzen für korrekte Tabelle -> _copy hat fake unfallstelle drin

    print('Data fetched')
    data = cur.fetchall()

    conn.close()

    return jsonify(data), 200


@app.route('/get_buffers', methods=['GET'])
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
            FROM poi_event
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


if __name__ == '__main__':
    app.run(port=8989, debug=True)
