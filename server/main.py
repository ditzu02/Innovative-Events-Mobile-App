from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import psycopg2
import os
from pathlib import Path

app = Flask(__name__)
CORS(app)

# load .env from the same folder as main.py
dotenv_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path)

# Load environment variables 
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

# Debug prints
print("DEBUG USER:", DB_USER)
print("DEBUG PASSWORD:", DB_PASSWORD)
print("DEBUG HOST:", DB_HOST)
print("DEBUG PORT:", DB_PORT)
print("DEBUG DBNAME:", DB_NAME)
print("WORKING DIRECTORY:", os.getcwd())

@app.route("/api/test-db")
def test_db():
    try:
        connection = psycopg2.connect(
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME
        )

        cursor = connection.cursor()
        cursor.execute("SELECT NOW();")
        result = cursor.fetchone()

        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "time": str(result[0])
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        })

if __name__ == "__main__":
    app.run(debug=True)
