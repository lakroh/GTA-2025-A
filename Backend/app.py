from flask import Flask, jsonify
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import psycopg2
import json

app = Flask(__name__)

# Endpoint to receive and store location data
@app.route('/test_deploy', methods=['GET'])
def test_deploy():
    """
    Funktion user to test the deployment of the app
    """
    return jsonify({'message': 'Hello World!'}), 200

@app.route('/', methods=['GET'])
def home():
    """
    function to test the connection to the server
    """
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

    cur.execute('SELECT * FROM "gta25_g1"."Fussgaenger_in_Polygon"')

    print('Data fetched')
    data = cur.fetchall()

    conn.close()

    return jsonify(data), 200

if __name__ == '__main__':
    app.run(port=8989, debug=True)
