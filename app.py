from flask import Flask, jsonify
import geopandas as gpd
from shapely.geometry import Point

app = Flask(__name__)

# Pfad zu deiner CSV-Datei
CSV_PATH = "Fussgaenger_in_Polygon.csv"

# Die Spaltennamen müssen zu deiner CSV passen
# (z. B. "X" und "Y" für LV95)
X_COL = "X"
Y_COL = "Y"

@app.route("/buffers")
def get_buffers():
    # CSV laden
    df = gpd.read_file(CSV_PATH) if CSV_PATH.endswith(".geojson") else gpd.read_file(CSV_PATH)
    try:
        df = gpd.read_file(CSV_PATH)
    except Exception:
        import pandas as pd
        df = pd.read_csv(CSV_PATH)
        df["geometry"] = df.apply(lambda r: Point(r[X_COL], r[Y_COL]), axis=1)
        df = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:2056")  # LV95

    # Buffer von 7m um jeden Punkt
    df["geometry"] = df.buffer(7)

    # Optional: Koordinatensystem für Leaflet (WGS84)
    df = df.to_crs("EPSG:4326")

    # Als GeoJSON zurückgeben
    return jsonify(df.__geo_interface__)

if __name__ == "__main__":
    app.run(debug=True)

