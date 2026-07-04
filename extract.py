import cv2
import sys

video_path = sys.argv[1]
cap = cv2.VideoCapture(video_path)
count = 0
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
    if count % 10 == 0:
        cv2.imwrite(f"/Library/WebServer/Documents/Projects/Scholium/frame_{count}.jpg", frame)
    count += 1
cap.release()
print(f"Extracted {count} frames.")
