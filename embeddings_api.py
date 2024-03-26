from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer

app = Flask(__name__)
CORS(app)

# Load the model (this may take some time)
model = SentenceTransformer('all-mpnet-base-v2')

@app.route('/embeddings', methods=['POST'])
def get_embeddings():
    data = request.json
    texts = data.get('flattenedData', '')  # Expect texts to be a list

    if not texts:
        return jsonify({'error': 'Texts are required'}), 401

    # Generate embeddings
    embeddings = model.encode(texts, convert_to_tensor=False)

    # Convert tensor to list for JSON serialization
    embeddings_list = embeddings.tolist()

    return jsonify({'embeddings': embeddings_list})

if __name__ == '__main__':
    app.run(debug=True)
