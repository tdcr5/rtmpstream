const codec = require('./codec');
const RtmpClient = require('./rtmpclient');
const Utils = require('./utils');
const gop = require('./gop');
const av = require('./av');
const EventEmitter = require('events');
// const logger = require("../../logger").log4js.getLogger('rtmp');
const logger = require("console")

const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');



class RtmpPullStreamInternal extends EventEmitter {

    _gopCache = undefined;
    _pullClient = undefined;
    _yuvConv = undefined;
    _vdecoder = undefined;
    _adecoder = undefined;
    _pcmfltpConv = undefined;

    _h264file = undefined;
    _yuvfile = undefined;
    _rgbfile = undefined;
    _decoderstart = false;
    

    constructor(pullUrl) {

        super();

        let streamPath = 'rmtp-pull-' + Utils.GenRandomString(6);

        this._pullClient = new RtmpClient(streamPath, pullUrl, false);
        this._gopCache = new gop.GopCache();
     

        // this._h264file = fs.createWriteStream('./1.h264', {encoding:'binary'});
        // this._yuvfile = fs.createWriteStream('./2.yuv', {encoding:'binary'});
        // this._rgbfile = fs.createWriteStream('./3.rgb', {encoding:'binary'});
    
    
        this._pullClient.on('videoinfo', videoinfo => {
    
            console.log(`rtmp:${streamPath} video:${videoinfo.vtype} width:${videoinfo.width} height:${videoinfo.height}`);

            this._vdecoder = new codec.VideoDecoder(videoinfo.vtype);
            this._yuvConv = new codec.YUVConverter(videoinfo.width, videoinfo.height);

            parentPort.postMessage({cmdtype:'vinfo', 
                                    params:{'width': videoinfo.width,
                                            'height': videoinfo.height}});


            logger.info(`RTMP Pull Stream videoinfo update, width:${videoinfo.width} Height:${videoinfo.height}`);
        });
    
        this._pullClient.on('videodata', packet => {
    
            this._gopCache.addPacket(packet);

            this.decode();
    
        });

        this._pullClient.on('audioinfo', audioinfo => {

            console.log(`rtmp:${streamPath} audio:${audioinfo.atype} samples:${audioinfo.sample} channels:${audioinfo.channels} depth:${audioinfo.depth} profile:${audioinfo.profile}`);

            this._adecoder = new codec.AudioDecoder(audioinfo.atype, audioinfo.sample, audioinfo.channels, audioinfo.depth, audioinfo.profile);
            this._pcmfltpConv = new codec.PCM_FLTPConverter(audioinfo.sample, audioinfo.channels, audioinfo.depth);

            parentPort.postMessage({cmdtype:'ainfo', 
                                    params:{'atype': audioinfo.atype,
                                            'sample': audioinfo.sample,
                                            'channels':audioinfo.channels,
                                            'depth': audioinfo.depth}});

            logger.info(`RTMP Pull Stream audioinfo update, sample:${audioinfo.sample} channels:${audioinfo.channels} depth:${audioinfo.depth}`);
    
        });

        this._pullClient.on('audiodata', packet => {
    
            this._gopCache.addPacket(packet);

            this.decode()
    
        });

        logger.info(`RTMP Pull Stream ${streamPath} Url ${pullUrl} Created`);

    }

    async decode() {

        if (this._gopCache.isEmpty()) {

            return;
        }

        if (this._decoderstart) {

            return;
        }

        this._decoderstart = true;

        let avpacket = this._gopCache.getPacket();

        if (avpacket.avtype === av.AVType.Video) {

            await this.handleVideo(avpacket);

        } else {

            await this.handleAudio(avpacket);
        }

        this._decoderstart = false;

        this.decode();
    }

    
    async handleVideo(avpacket) {

           let {yuvbuf, timestamp: pts} = await this._vdecoder.decode(avpacket.payload, avpacket.timestamp);

           if (!yuvbuf) {

               logger.warn(`RTMP Pull Stream decoder h264 fail, may be frame cache`);
               return;
           }

           let rgbabuf = await this._yuvConv.toRGBA(yuvbuf);

           if (!rgbabuf) {

                logger.error(`RTMP Pull Stream convert yuv to rgb error`);
                return;
           }

          parentPort.postMessage({cmdtype:'rgbadata', 
                                    params:{'rgbabuf': rgbabuf,
                                            'pts': pts}}, [rgbabuf.buffer]);

    }


    async handleAudio(avpacket) {

    
        let pcm_fltpbufs = await this._adecoder.decode(avpacket.payload);

        if (!pcm_fltpbufs) {
            logger.warn(`RTMP Pull Stream decoder aac fail, may be frame cache`);
            return;
        }

        let pcm_s16buf = await this._pcmfltpConv.toPCMSigned(pcm_fltpbufs);

        if (!pcm_s16buf) {
            logger.error(`RTMP Pull Stream convert fltp to s16 error`);
            return;
        }

        parentPort.postMessage({cmdtype:'pcmdata', 
                                params:{'pcm_s16buf': pcm_s16buf,
                                        'pts': avpacket.timestamp}}, [pcm_s16buf.buffer]);


      

 }

 
    start() {
        logger.info(`RTMP Pull Stream start`);
        this._pullClient.start();
    }

    stop() {

        this._pullClient.stop(); 
        logger.info(`RTMP Pull Stream stop`);
    }

    async destroy() {


    }

}

class RtmpPullStream extends EventEmitter  {

    _worker = undefined

    constructor(fileurl) {

        super();

        this._worker = new Worker(__filename, {workerData:{fileurl}});
        this._worker.on('error', (error) => {

            logger.error(`RTMP Pull Stream work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                logger.error(`RTMP Pull Stream Worker thread stopped with exit code ${code}`);

            } else {

                logger.info(`RTMP Pull Stream Worker thread stopped with exit code 0`);
            }
        });

        this._worker.on('message', ({cmdtype, params}) => {

            switch (cmdtype) {

                case 'vinfo': {
    
                    this.emit('vinfo', params.width, params.height);
                    break;
                }
    
                case 'ainfo': {
    
                    this.emit('ainfo', params.sample, params.channels, params.depth);
                    break;
                }

                case 'rgbadata': {
    
                   this.emit('rgbadata', params.rgbabuf, params.pts);
                    break;
                }
    
                case 'pcmdata': {
    
                    this.emit('pcmdata', params.pcm_s16buf.buffer, params.pts);
                    break;
                }
            }

        });

        logger.info(`RTMP Pull Stream Create Worker Thread Success`);

    
    }
   
    start() {
        this._worker.postMessage({cmdtype:'start'});
    }

    stop() {

        this._worker.postMessage({cmdtype:'stop'});
    }

    async destroy() {

        await this._worker.terminate();
        logger.info(`Rtmp Pull Stream Destroy Worker Thread Success`);
    }

}

function WorkerThread() {


    workerData.pullstream = new RtmpPullStreamInternal(workerData.fileurl);

    parentPort.on('message', msg => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let pullstream = workerData.pullstream;

        switch (cmdtype) {

            case 'start': {

                pullstream.start();
                break;
            }

            case 'stop': {

                pullstream.stop();
                break;
            }
        }

    })

}


if (!isMainThread) {

    WorkerThread();

}


module.exports = RtmpPullStream;