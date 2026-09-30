import sys
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import MobileNetV2, preprocess_input, decode_predictions

def get_dominant_color(image, k=3):
    img = image.resize((100, 100))
    arr = np.array(img).reshape(-1, 3)
    kmeans = KMeans(n_clusters=k, n_init=10)
    kmeans.fit(arr)
    colors = kmeans.cluster_centers_.astype(int)
    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    dominant = colors[labels[np.argmax(counts)]]
    return tuple(dominant)

def predict_subject(image):
    model = MobileNetV2(weights='imagenet')
    img = image.resize((224, 224))
    x = np.expand_dims(np.array(img), axis=0)
    x = preprocess_input(x)
    preds = model.predict(x)
    results = decode_predictions(preds, top=1)[0]
    return results[0][1]  # label

def infer_scene(label):
    # simple mapping
    if label in ['fox', 'wolf', 'dog', 'cat', 'lion', 'tiger']:
        return '野外自然环境'
    elif label in ['bird', 'airplane']:
        return '天空'
    else:
        return '室内影棚或通用场景'

if __name__ == '__main__':
    path = sys.argv[1]
    image = Image.open(path).convert('RGB')
    main_color = get_dominant_color(image)
    subject = predict_subject(image)
    scene = infer_scene(subject)
    print(f'主体：{subject}')
    print(f'主色：{main_color}')
    print(f'场景：{scene}')
    print('IMAGE_INPUT_SCENARIO_OK')
