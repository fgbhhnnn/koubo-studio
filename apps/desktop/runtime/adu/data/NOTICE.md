# OpenCV Haar cascade

`haarcascade_frontalface_default.xml` is the standard frontal-face cascade from
[OpenCV](https://github.com/opencv/opencv/blob/4.12.0/data/haarcascades/haarcascade_frontalface_default.xml)
(created by Rainer Lienhart). It is shipped here because current
`opencv-python-headless` wheels no longer include the XML files.

The XML retains the Intel License Agreement For Open Source Computer Vision
Library (see the comment at the top of the file). The name of Intel Corporation
is not used to endorse this project.

`face_detection_yunet_2023mar.onnx` is YuNet from the
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
face-detection model (Apache License 2.0). It is used on OpenCV 5, which no
longer ships `CascadeClassifier`. OpenCV 4 still prefers the Haar cascade above.
