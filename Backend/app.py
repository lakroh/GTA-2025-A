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
    """
    Holt die Koordinaten aus der DB, erzeugt Buffer (z.B. 20 m Radius),
    und gibt sie als GeoJSON zurück.
    """
    with open('db_login.json', 'r') as file:
        db_credentials = json.load(file)

    conn = psycopg2.connect(**db_credentials)
    sql = 'SELECT "AccidentLocation_CHLV95_E", "AccidentLocation_CHLV95_N" FROM "gta25_g1"."Fussgaenger_in_Polygon_copy"'
    df = pd.read_sql(sql, conn)
    conn.close()

    # Geometrie erzeugen (CH LV95 = EPSG:2056)
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df["AccidentLocation_CHLV95_E"], df["AccidentLocation_CHLV95_N"]),
        crs="EPSG:2056"
    )

    # 7m als Vorschlag (Anpassen vor Abgabe)
    gdf["geometry"] = gdf.buffer(7)

    union = gdf.unary_union

    # ⚡ 2) Falls MultiPolygon, in einzelne Polygone aufteilen
    if union.geom_type == "Polygon":
        geoms = [union]
    else:
        geoms = list(union.geoms)

    # ⚡ 3) GeoDataFrame aus Clustern bauen
    merged_gdf = gpd.GeoDataFrame(geometry=geoms, crs="EPSG:2056")

    # WGS84 für Leaflet
    merged_gdf = merged_gdf.to_crs("EPSG:4326")

    # ⚡ 4) GeoJSON zurückgeben
    return merged_gdf.to_json(), 200, {"Content-Type": "application/json"}


if __name__ == '__main__':
    app.run(port=8989, debug=True)
