from flask import Flask, jsonify
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

app = Flask(__name__)

# Pfad zur CSV-Datei
CSV_PATH = "Fussgaenger_in_Polygon Kopie.csv"

# Spaltennamen der LV95-Koordinaten
E_COL = "AccidentLocation_CHLV95_E"  # Easting
N_COL = "AccidentLocation_CHLV95_N"  # Northing

@app.route("/buffers")
def get_buffers():
    df = pd.read_csv(CSV_PATH)
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df[E_COL], df[N_COL]),
        crs="EPSG:2056"
    )
    gdf["geometry"] = gdf.buffer(7)
    gdf = gdf.to_crs("EPSG:4326")
    return jsonify(gdf.__geo_interface__)

if __name__ == "__main__":
    app.run(debug=True)





#2. Weg ohne CSV Datei
from flask import Flask, jsonify
import geopandas as gpd
import psycopg2
import json

app = Flask(__name__)

# Pfad zur DB-Login-Datei
DB_LOGIN_PATH = "db_login.json"

# ---------- Verbindung zur Datenbank aufbauen ----------
with open(DB_LOGIN_PATH) as f:
    db_params = json.load(f)

def get_connection():
    """Erstellt eine Verbindung zur PostGIS-Datenbank."""
    return psycopg2.connect(
        user=db_params["user"],
        password=db_params["password"],
        host=db_params["host"],
        port=db_params["port"],
        database=db_params["database"]
    )

# ---------- Route /buffers ----------
@app.route("/buffers")
def get_buffers():
    """Lädt Unfallpunkte aus PostGIS, erstellt 7m Buffer, gibt GeoJSON zurück."""
    
    # Verbindung öffnen
    conn = get_connection()

    # Tabelle auslesen (achte auf Groß-/Kleinschreibung und Anführungszeichen)
    sql = 'SELECT * FROM "Fussgaenger_in_Polygon";'
    gdf = gpd.read_postgis(sql, conn, geom_col="geom")

    # Verbindung schließen
    conn.close()

    # Sicherstellen, dass CRS gesetzt ist (LV95)
    if gdf.crs is None:
        gdf.set_crs("EPSG:2056", inplace=True)

    # Buffer von 7m um jeden Punkt
    gdf["geometry"] = gdf.buffer(7)

    # Für Leaflet nach WGS84 transformieren
    gdf = gdf.to_crs("EPSG:4326")

    # Als GeoJSON zurückgeben
    return jsonify(gdf.__geo_interface__)

# ---------- Start ----------
if __name__ == "__main__":
    app.run(debug=True)
