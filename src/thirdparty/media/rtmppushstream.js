const codec = require('./codec');
const RtmpClient = require('./rtmpclient');
const Utils = require('./utils');
const gop = require('./gop');
const av = require('./av');
const EventEmitter = require('events');
const AudioBufferEx = require('../splitebufferex');
// const logger = require("../../logger").log4js.getLogger('rtmp');
const logger = require("console")
const beamcoder = require('../beamcoder_contextaware');
const CalTs = require('./calts')

const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');


// Rtmp推流工具
// 视频 rgba-> yuv -> h264
// 音频 pcm -> resample pcm -> aac/pcma/pcmu
class RtmpPushStreamInternal extends EventEmitter {

    _pushClient = undefined;

    _gopCache = undefined;
    _encoder = undefined;  //h264编码器信息

    _rgbConv = undefined;
    _vEncoder = undefined;

    _inputAudioParam = undefined;
    _outputAudioParam = undefined

    _aEncoder = undefined;   //audio编码器
    _pcmFilter = undefined;  //audio重采样

    _pcmFilterCalTs = undefined;
    _aEncoderCalTs = undefined; 


    _pcmCache = undefined;

    _spliteSampleNum = 0;
    _spliteChannel = 0;

    _lastAudioPts = -1;


    _isReady = false;
    _encodeStart = false;



    constructor(pushUrl, encoder) {

        super();

        let streamPath = 'rmtp-push-' + Utils.GenRandomString(6);
        this._pushClient = new RtmpClient(streamPath, pushUrl, true);
        this._gopCache = new gop.GopCache();

        this._encoder = encoder;

        this._pushClient.on('pushstatus', ready => {

             this._isReady = ready;

             if (this._isReady) {
                
                this._pushClient.sendAACSequenceHeader();
            
            }
        })


        logger.info(`RTMP Push Stream ${streamPath} Url ${pushUrl} Created`)
    
    }

    setVideoInfo(width, height) {

        this._vEncoder = new codec.VideoEncoder(width, height, av.VideoType.H264, this._encoder);
        this._rgbConv = new codec.RGBConvert(width, height);

        let vinfo = new av.VideoInfo();
        vinfo.vtype = av.VideoType.H264;
        vinfo.width = width;
        vinfo.height = height;

        this._pushClient.setVideoInfo(vinfo);

        logger.info(`RTMP Push Stream Set VideoInfo ${width} ${height}`);

    }

    setAudioInfo(inputAudioParam, outputAudioParams) {

        //原始数据必须是pcm
        this._inputAudioParam = inputAudioParam; //sample, channels， depth
        this._outputAudioParam = outputAudioParams; //format, sample, channels, depth

        this._inputAudioParam.channelLayout = this._inputAudioParam.channels === 1 ? 'mono' : 'stereo';
        this._inputAudioParam.format = this._inputAudioParam.depth === 8 ? 's8' : 's16';

        this._outputAudioParam.channelLayout = this._outputAudioParam.channels === 1 ? 'mono' : 'stereo';

        switch(this._outputAudioParam.format){

            case 'aac': {
                this._outputAudioParam.audioType = av.AudioType.AAC;
                this._outputAudioParam.profile = av.AACProfile.AAC_LC;
                break;
            }

            case 'pcma': {
                this._outputAudioParam.audioType = av.AudioType.PCMA;
                break;
            }

            case 'pcmu': {
                this._outputAudioParam.audioType = av.AudioType.PCMU;
                break;
            }

            default: {

                logger.error(`RTMP Push Stream Set AudioInfo Faile, unsupport format:${this._outputAudioParam.format}`);
                return;
            }
        }

        let ainfo = new av.AudioInfo();

        ainfo.atype = this._outputAudioParam.audioType;
        ainfo.sample = this._outputAudioParam.sample;
        ainfo.channels = this._outputAudioParam.channels;
        ainfo.depth = this._outputAudioParam.depth;

        if (this._outputAudioParam.audioType === av.AudioType.AAC) {

            ainfo.profile = this._outputAudioParam.profile; //当是aac，该参数才起作用

        }

        this._pushClient.setAudinInfo(ainfo);

        if (this._isReady) {

            this._pushClient.sendAACSequenceHeader(); //内部会做是否是aac判断
             
        }

        logger.info(`RTMP Push Stream Set AudioInfo 
                    Input  sample:${this._inputAudioParam.sample} channels:${this._inputAudioParam.channels} depth:${this._inputAudioParam.depth} 
                    output format:${this._inputAudioParam.format} sample:${this._inputAudioParam.sample} channels:${this._inputAudioParam.channels} depth:${this._inputAudioParam.depth}`);
    }


    pushRGBAData(rgbabuf, timestamp) {

        let apkt = new av.AVPacket();
        apkt.payload = rgbabuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = true;

        this._gopCache.addPacket(apkt);
        this.encode();
    }

    pushI420Data(yuvbuf, timestamp) {
        

        let apkt = new av.AVPacket();
        apkt.payload = yuvbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = false;

        this._gopCache.addPacket(apkt);
        this.encode();
    }

    pushPCMData(pcmbuf, timestamp) {
        
        let apkt = new av.AVPacket();
        apkt.payload = pcmbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Audio;

        this._gopCache.addPacket(apkt);
        this.encode();
    }

    async encode() {

        if (!this._isReady) {

            logger.warn(`RTMP Push Stream try video encode but not ready now`);
            return;
        }

        if (this._gopCache.isEmpty()) {
            return;
        }

        if (this._encodeStart) {

            return;
        }

        this._encodeStart = true;

        let avpacket = this._gopCache.getPacket();

        if (avpacket.avtype === av.AVType.Video) {

            await this.handleVideo(avpacket);

        } else {

            await this.handleAudio(avpacket);
        }

        this._encodeStart = false;

        this.encode();

    }


    async handleVideo(avpacket) {

        let isrgba = avpacket.isrgba;
        let yuvbuf;

        if (isrgba) {

            yuvbuf = await this._rgbConv.toYUV(avpacket.payload);

            if (!yuvbuf) {
    
                logger.error(`RTMP Push Stream convert rgb to yuv error`);
                return;
            }

        } else {

            yuvbuf = avpacket.payload;
        }

        let {buf, keyframe, timestamp:pts} = await this._vEncoder.encode(yuvbuf, avpacket.timestamp);

        if (!buf) {
            logger.warn(`RTMP Push Stream H264 encoder fail, may be current frame cache`);
            return;
        }
      
        this._pushClient.pushVideo(buf, keyframe, pts);

    }


    async createAudioEncoderAndFilter() {

        if (this._outputAudioParam.audioType === av.AudioType.AAC) {

            // pcm(s8/s16) -> fltp
            this._pcmFilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: this._inputAudioParam.sample,
                                                            sampleFormat: this._inputAudioParam.format,
                                                            channelLayout: this._inputAudioParam.channelLayout,
                                                            timeBase: [1, 1000]
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._outputAudioParam.sample,
                                                            sampleFormat: 'fltp',
                                                            channelLayout: this._outputAudioParam.channelLayout
                                                        }
                                                        ],
                                                        filterSpec: `aformat=sample_fmts=fltp:channel_layouts=${this._outputAudioParam.channelLayout}`
                                                    });

            
            // fltp -> aac
            this._aEncoder = beamcoder.encoder({ name: 'aac',
                                                 profile: this._outputAudioParam.profile - 1, 
                                                 sample_rate: this._outputAudioParam.sample,
                                                 channels: this._outputAudioParam.channels,
                                                 sample_fmt:'fltp',
                                                 channel_layout: this._outputAudioParam.channelLayout,
                                                });

            this._spliteSampleNum = 1024;
            this._spliteChannel = this._outputAudioParam.channels;
            this._splitBytePerSample =  4;

            this._pcmCache = new AudioBufferEx(this._spliteSampleNum*this._splitBytePerSample, 
            1000.0/(this._outputAudioParam.sample*this._splitBytePerSample),
            this._spliteChannel);


        } else if (this._outputAudioParam.audioType === av.AudioType.PCMA || this._outputAudioParam.audioType === av.AudioType.PCMU) {

            // pcm(s8/s16) -> s16
            this._pcmFilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: this._inputAudioParam.sample,
                                                            sampleFormat: this._inputAudioParam.format,
                                                            channelLayout: this._inputAudioParam.channelLayout,
                                                            timeBase: [1, 1000]
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._outputAudioParam.sample,
                                                            sampleFormat: 's16',
                                                            channelLayout: this._outputAudioParam.channelLayout
                                                        }
                                                        ],
                                                        filterSpec: `aformat=sample_fmts=s16:channel_layouts=${this._outputAudioParam.channelLayout}`
                                                    });

            // s16 -> pcma/pcmu
            this._aEncoder = beamcoder.encoder({ name: this._outputAudioParam.audioType === av.AudioType.PCMA ? 'pcm_alaw' : 'pcm_mulaw',
                                                 sample_rate: this._outputAudioParam.sample,
                                                 channels: this._outputAudioParam.channels,
                                                 sample_fmt:'s16',
                                                 channel_layout: this._outputAudioParam.channelLayout,
                                                });

            this._spliteSampleNum = 512;
            this._spliteChannel = 1;
            this._splitBytePerSample =  this._outputAudioParam.channels*this._outputAudioParam.depth/8;

            this._pcmCache = new AudioBufferEx(this._spliteSampleNum*this._splitBytePerSample, 
            1000.0/(this._outputAudioParam.sample*this._splitBytePerSample),
            this._spliteChannel);

        } else {

            logger.error(`RTMP Push Stream Set AudioInfo Fail, outputParams format not support`)
            return
        }

        this._pcmFilterCalTs = new CalTs(this._inputAudioParam.sample, this._outputAudioParam.sample);
   


    }

    async handleAudio(avpacket) {

        if (!this._outputAudioParam) {

            logger.warn(`RTMP Push Stream start encode, but audio info not set`);
            return;
        }

        if (!this._pcmFilter || !this._aEncoder) {

            await this.createAudioEncoderAndFilter();
        }

        let pts = avpacket.timestamp;
        let samplenum = avpacket.payload.length/this._inputAudioParam.channels*8/this._inputAudioParam.depth;

        this._pcmFilterCalTs.inc(samplenum, pts);


        let frame = beamcoder.frame({
             format: this._inputAudioParam.format,
             sample_rate: this._inputAudioParam.sample,
             time_base: [1, 1000],
             channels: this._inputAudioParam.channels,
             channel_layout:this._inputAudioParam.channelLayout,
             nb_samples:samplenum
          }).alloc();

        avpacket.payload.copy(frame.data[0], 0, 0);
    
      //  console.log(`--- recv audio pts ${pts}`);
        let filter_result = await this._pcmFilter.filter([frame]);

        if (filter_result[0].frames.length <= 0) {

            return
        }

        for (let frame of filter_result[0].frames) {

            let filterpts = this._pcmFilterCalTs.getTs(frame.nb_samples)

           

            if (frame.data.length > 1) {

                this._pcmCache.addBuffer(filterpts, 
                                         frame.data[0].slice(0, this._splitBytePerSample*frame.nb_samples), 
                                         frame.data[1].slice(0, this._splitBytePerSample*frame.nb_samples));

              //  console.log(`--- fliter ${frame.nb_samples} audio pts ${filterpts}`);

            } else {

                this._pcmCache.addBuffer(filterpts, 
                                         frame.data[0].slice(0, this._splitBytePerSample*frame.nb_samples));
            }

        }

        await this._pcmCache.splitAsync(async (encodePts, pcmbuf, pcmbuf1) => {

            let frame = beamcoder.frame({
                format: this._aEncoder.sample_fmt,
                sample_rate: this._outputAudioParam.sample,
                time_base: [1, 1000],
                channels: this._outputAudioParam.channels,
                channel_layout: this._outputAudioParam.channelLayout,
                nb_samples:this._spliteSampleNum
             }).alloc();
   
           for(let i = 0; i < this._spliteChannel; i++) {

                let buf = undefined;

                if (i === 0) {
                    buf = pcmbuf;
                } else {
                    buf = pcmbuf1;
                }
   
                buf.copy(frame.data[i], 0, 0, buf.length);
           }

           let packets = await this._aEncoder.encode(frame);

           if (packets.packets.length <= 0) {
   
               return
           }
   
           for (let packet of packets.packets) {
   
               let encodedBuf = Buffer.alloc(packet.size);
               packet.data.copy(encodedBuf, 0, 0, packet.size);
   
            //   console.log(`--- Encode ${this._spliteSampleNum} audio pts ${encodePts}`);
   
               this._pushClient.pushAudio(encodedBuf, encodePts);

               encodePts++;
         
           }

        }) 

    }

    start() {
        logger.info(`RTMP Push Stream Start`);
        this._pushClient.start();
    }

    stop() {

        this._pushClient.stop(); 
        this._isReady = false;
        logger.info(`RTMP Push Stream Stop`);
    }

    async destroy() {


    }

}


class RtmpPushStream  {

    _worker = undefined

    constructor(pushUrl, encoder) {
        this._worker = new Worker(__filename, {workerData:{pushUrl, encoder}});
        this._worker.on('error', (error) => {

            logger.error(`RTMP Push Stream work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                logger.error(`RTMP Push Stream Worker thread stopped with exit code ${code}`);

            } else {

                logger.info(`RTMP Push Stream Worker thread stopped with exit code 0`);
            }
        });

        logger.info(`RTMP Push Stream Create Worker Thread Success`);

    }

    setVideoInfo(width, height) {

        this._worker.postMessage({cmdtype:'setvideoinfo', 
                                  params:{width, height}});
    }

    setAudioInfo(inputAudioParam, outputAudioParam) {

        this._worker.postMessage({cmdtype:'setaudioinfo', 
                                  params:{inputAudioParam, outputAudioParam}});
    }


    pushRGBAData(rgbabuf, timestamp) {

        this._worker.postMessage({cmdtype:'pushrgbadata', 
                                  params:{rgbabuf, timestamp}});
    }

    pushI420Data(yuvbuf, timestamp) {

        this._worker.postMessage({cmdtype:'pushi420data', 
                                  params:{yuvbuf, timestamp}});
    }

    pushPCMData(pcmbuf, timestamp) {

        this._worker.postMessage({cmdtype:'pushpcmdata', 
                                  params:{pcmbuf, timestamp}});
    }
   
    start() {
        this._worker.postMessage({cmdtype:'start'});
    }

    stop() {

        this._worker.postMessage({cmdtype:'stop'});

    }

    async destroy() {

        await this._worker.terminate();
        logger.info(`Rtmp Push Stream Destroy Worker Thread Success`);
    }

}

function WorkerThread() {


    workerData.pushstream = new RtmpPushStreamInternal(workerData.pushUrl, workerData.encoder);

    parentPort.on('message', msg => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let pushstream = workerData.pushstream;

        switch (cmdtype) {

            case 'start': {

                pushstream.start();
                break;
            }

            case 'stop': {

                pushstream.stop();
                break;
            }

            case 'setvideoinfo': {

                pushstream.setVideoInfo(params.width, params.height);
                break;
            }

            case 'setaudioinfo': {

                pushstream.setAudioInfo(params.inputAudioParam, params.outputAudioParam);
                break;
            }

            case 'pushrgbadata': {

                pushstream.pushRGBAData(Buffer.from(params.rgbabuf), params.timestamp);
                break;
            }

            case 'pushi420data': {

                pushstream.pushI420Data(Buffer.from(params.yuvbuf), params.timestamp);
                break;
            }
            case 'pushpcmdata': {

                pushstream.pushPCMData(Buffer.from(params.pcmbuf), params.timestamp);
                break;
            }

        }

    })

}


if (!isMainThread) {

    WorkerThread();

}


module.exports = RtmpPushStream;