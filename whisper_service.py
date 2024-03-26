from flask import Flask, request, jsonify
import whisper
from werkzeug.utils import secure_filename
import os
from datetime import datetime

app = Flask(__name__)

# It's a good practice to limit the maximum upload size, e.g., 16MB
# app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Define the path for saving uploaded files (temporary)
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def transcribe_audio(file_path):
    model = whisper.load_model("base")
    result = model.transcribe(file_path)
    return result['text']

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'file' not in request.files:
        return jsonify(error="No file part"), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify(error="No selected file"), 400
    if file:
        filename = secure_filename(file.filename)
        # Add timestamp to filename to avoid overwrites
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        filename_with_timestamp = f"{timestamp}_{filename}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename_with_timestamp)
        file.save(save_path)
        transcription = transcribe_audio(save_path)
        # Optionally, remove the file after processing
        os.remove(save_path)
        return jsonify(transcription=transcription)
