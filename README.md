# rtmpstream
这是一个rtmp 客户端的demo，演示了从远端拉取rmtp流后，媒体数据解封解码成原始数据，然后再编码封装通过rtmp推出去，媒体数据格式转换如下

video:
pull rtmp stream -> flv -> h264 -> yuv -> rgba -> yuv -> h264 -> flv -> push rtmp stream

audio:
pull rtmp stream -> flv -> aac -> pcm-fltp -> pcm-s16le -> pcm-fltp -> aac -> flv -> push rtmp stream