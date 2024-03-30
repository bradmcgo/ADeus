from flask import Flask, request, jsonify
import whisper
from werkzeug.utils import secure_filename
import os
from datetime import datetime
from pydub import AudioSegment
from transcribeHallu import loadModel
from transcribeHallu import transcribePrompt

app = Flask(__name__)

# It's a good practice to limit the maximum upload size, e.g., 16MB
# app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Define the path for saving uploaded files (temporary)
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def boost_volume(file_path, decibels=10):
    audio_segment = AudioSegment.from_file(file_path)
    louder_segment = audio_segment + decibels  # Increase volume by `decibels` dB
    louder_segment.export(file_path, format="wav")

def transcribe_audio(file_path):
    model = whisper.load_model("base")
    result = model.transcribe(file_path, language="en", compression_ratio_threshold=1.35, temperature=0)
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

        # Boost the volume before transcribing
        boost_volume(save_path, decibels=50)  # Adjust the decibels as necessary

        ##### The audio language may be different from the one for the output transcription.
        path = save_path
        lngInput = "en"

        # ##### Activate this for music file to get a minimal processing
        isMusic = False

        # ##### Need to be adapted for each language.
        # ##### For prompt examples, see transcribeHallu.py getPrompt(lng:str)
        lng = "en"
        prompt = "Whisper, Ok. "\
            +"A pertinent sentence for your purpose in your language. "\
            +"Ok, Whisper. Whisper, Ok. "\
            +"Ok, Whisper. Whisper, Ok. "\
            +"Please find here, an unlikely ordinary sentence. "\
            +"This is to avoid a repetition to be deleted. "\
            +"Ok, Whisper. "

        # ##### Model size to use
        modelSize = "medium"
        loadModel("0",modelSize=modelSize)

        result = transcribePrompt(path=path, lng=lng, prompt=prompt, lngInput=lngInput,isMusic=isMusic)

        # Optionally, remove the file after processing
        os.remove(save_path)
        return jsonify(transcription=result)
        