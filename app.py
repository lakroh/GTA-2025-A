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
    # CSV laden
    df = pd.read_csv(CSV_PATH)

    # Geometrie aus Koordinaten erzeugen (LV95)
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df[E_COL], df[N_COL]),
        crs="EPSG:2056"
    )

    # Buffer mit 7 m um jeden Punkt
    gdf["geometry"] = gdf.buffer(7)

    # In WGS84 (EPSG:4326) umprojizieren, damit Leaflet sie korrekt anzeigt
    gdf = gdf.to_crs("EPSG:4326")

    # Als GeoJSON zurückgeben
    return jsonify(gdf.__geo_interface__)

if __name__ == "__main__":
    app.run(debug=True)
