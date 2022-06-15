const codec = require('./codec');
const Utils = require('./utils');
const gop = require('./gop');
const av = require('./av');
const EventEmitter = require('events');
const beamcoder = require('../beamcoder_contextaware');
// const logger = require("../../logger").log4js.getLogger('player');
const logger = require("console")
const AudioBuffer = require('../splitebuffer');
const copyFrametoYuvbuf = require('./codec.js').copyFrametoYuvbuf;
const abst = require('./abstimer')

const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');

  //fileplayer 流程控制实现控制一个有限状态机
  const PlayerState = {
    StatePlayEnd: 1,  //播放结束，未开始
    StateDumexing: 2, //开始解析同时开始播放
    StateDumexEndWaitForPlayEnd: 3 //解析结束，等待播放结束，因为内部有缓冲，所以解析结束时，肯定播放还没结束
};



class FilePlayerInternal extends EventEmitter {

    _url = undefined;
    _loop = 0;
    _options = undefined;

    _videoEnable = true;
    _audioEnable = true;

    

    //output video params
    _fps = 0;
    _width = 0;
    _height = 0;

    //output audio params
    _pcmformat = '';
    _sample = 0;
    _channels = 0;
    _depth = 0;

    //timer
    _videoInterval = undefined;
    _audioInterval = undefined;
    
    _demux = undefined;

    _vidoeDecoder = undefined;
    _audioDecoder = undefined;

    _yuvFilter = undefined;
    _pcmFilter = undefined;

    _state = PlayerState.StatePlayEnd;
    _isPause = false




    _demuxStart = false;
    _vindex = -2; // -2: 还没解析视频索引 -1：确认不存在视频索引 >=0：存在视频索引
    _aindex = -2;
    _playEndCnt = 0;

    _videoCache = undefined;
    _audioCache = undefined;

    _handle = undefined;
    
    constructor(inputParams, outParams, handle) {

        super();

        this._handle = handle;
        this._url = inputParams.url;
        this._options = inputParams.options
        this._loop = inputParams.loop;

        this._videoEnable = inputParams?.videoEnable ?? true;
        this._audioEnable = inputParams?.audioEnable ?? true;
    
        //output video params
        this._fps = outParams.fps;
        this._width = outParams.width;
        this._height = outParams.height;
    
        //output audio params
        this._sample = outParams.sample;
        this._channels = outParams.channels;
        this._depth = outParams.depth;

        this._videoCache = new gop.GopCache();
        let bytepersample = this._channels*this._depth/8;
     
        let audioFrameSampleNum = outParams?.audioFrameSampleNum ?? 1024;
        this._audioSpliteInterval = Math.floor(audioFrameSampleNum*1000/this._sample);
        this._audioCache = new AudioBuffer(audioFrameSampleNum*bytepersample);

        logger.info(`File Player(${this._handle}) Created`);

    }

    async createDemuxer() {


        if (!this._options) {

            this._demuxer = await beamcoder.demuxer(this._url);
            
        } else {

            this._demuxer = await beamcoder.demuxer({url:this._url, options:this._options});
        }

        if (!this._demuxer) {

            return
        }

        for(let i = 0; i < this._demuxer.streams.length; i++) {

            let codetype = this._demuxer.streams[i]?.codecpar?.codec_type;

            if (!codetype) {
                continue;
            }

            if (codetype === 'video') {

                this._vindex = i;

            } else if (codetype === 'audio') {

                this._aindex = i;
            }

        }

        let videoParam = {};
        let audioParam = {};
        let vfps = 0

        if (this._vindex >= 0) {

            this._vidoeDecoder = beamcoder.decoder({ demuxer: this._demuxer, stream_index: this._vindex});

            let vstream = this._demuxer.streams[this._vindex];

             let frameratearrlen  = vstream?.avg_frame_rate?.length ?? 0

             if (frameratearrlen > 0) {
                
                if (frameratearrlen > 1) {

                    vfps = vstream.avg_frame_rate[0]/vstream.avg_frame_rate[1]

                } else {

                    vfps = vstream.avg_frame_rate[0]
                }
             }

            let codecpar = vstream.codecpar;

            if (!codecpar) {

                return;
            }

            videoParam = codecpar;

            this._yuvFilter = await beamcoder.filterer({ filterType: 'video',
                                   inputParams: [{ width: codecpar.width,
                                                   height: codecpar.height,
                                                   pixelFormat: codecpar.format,
                                                   timeBase: vstream.time_base,
                                                   pixelAspect:[codecpar.width, codecpar.height]}],
                                  outputParams: [{ pixelFormat: 'yuv420p'}],
                                  filterSpec: `fps=fps=${this._fps},scale=${this._width}:${this._height}`});

        } else {

            this._vindex = -1;
        }

        if (this._aindex >= 0) {

            this._audioDecoder = beamcoder.decoder({ demuxer: this._demuxer, stream_index: this._aindex});

            let astream = this._demuxer.streams[this._aindex];

            let codecpar = astream.codecpar;

            if (!codecpar) {

                return;
            }

            audioParam = codecpar;

            let sampleformat = 's16';
            let channellayout = this._channels === 1 ? 'mono' : 'stereo';

            this._pcmFilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: codecpar.sample_rate,
                                                            sampleFormat: codecpar.format,
                                                            channelLayout: codecpar.channel_layout,
                                                            timeBase: astream.time_base
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._sample,
                                                            sampleFormat: sampleformat,
                                                            channelLayout: channellayout
                                                        }
                                                        ],
                                                        filterSpec: `aresample=${this._sample}, aformat=sample_fmts=${sampleformat}:channel_layouts=${channellayout}`
                                                    });

            logger.info(`pcm filter created`);

        } else {

            this._aindex = -1;
        }


        if (!this._notifyAVInfo) {
            videoParam.vfps = vfps
            parentPort.postMessage({
                cmdtype:'avinfo', 
                params:{videoParam, audioParam}
            });

            this._notifyAVInfo = true;
        }

    }

    async demux() {

        if (this._state !== PlayerState.StateDumexing) {

            return;
        }

        if (!this.needDemux()) {

            return;
        }

        if (this._demuxStart) {

            return;
        }

        this._demuxStart = true;

        if (!this._demuxer) {

            try {
                
                await this.createDemuxer();

            } catch (error) {

                if (!this._demuxer) {

                    logger.error(`File Player(${this._handle}) Parse Error(url=${this._url}), because Demuxe can not created`)
    
                    this._demuxStart = false;
    
                    this.demuxError(`File Url Error`);
                    return
                }
                
            }
        }


        let packet = await this._demuxer.read(); 

        if (packet) {

            if (packet.stream_index === this._vindex) {

                if (this._videoEnable) {

                    await this.handleVideo(packet);
                }
                
            } else if (packet.stream_index === this._aindex) {

                if (this._audioEnable) {

                    await this.handleAudio(packet);
                }

            } else {

                logger.warn(`File Player(${this._handle})(url=${this._url}) have more video or auido track`);
            }

        } else {

            logger.info(`File Player(${this._handle})(url=${this._url}) reach EOF`);

            this._playEndCnt++;

            this._demuxer.forceClose();
            this._demuxer = undefined;

            if (this._state === PlayerState.StateDumexing) {

                this._state = PlayerState.StateDumexEndWaitForPlayEnd;
            }
            
        }

        this._demuxStart = false;

        this.demux();
    }

    
    async handleVideo(packet) {

        let decframes = await this._vidoeDecoder.decode(packet);
        // Do something with the frame data

        if (decframes.frames.length === 0) {

            return
        }

        let filter_result = await this._yuvFilter.filter(decframes.frames);

        if (filter_result?.length <= 0 || filter_result[0]?.frames?.length <= 0) {
             return;
        }

        for(let filterframe of filter_result[0].frames) {

            let filterframebuf = filterframe.data[0];

            let yuvbuf = Buffer.alloc(filterframe.width*filterframe.height*3/2);

            copyFrametoYuvbuf(filterframe, yuvbuf);
            this._videoCache.addPacket(yuvbuf);
        }
    }


    async handleAudio(packet) {

        let decframes = await this._audioDecoder.decode(packet);
        // Do something with the frame data

        if (decframes.frames.length === 0) {

            return
        }

        let filter_result = await this._pcmFilter.filter(decframes.frames);

        if (filter_result?.length <= 0 || filter_result[0]?.frames?.length <= 0) {
             return;
        }

        for(let filterframe of filter_result[0].frames) {

            let filterframebuf = filterframe.data[0];

            let pcm_sbuf = Buffer.alloc(filterframe.nb_samples*this._channels*this._depth/8);
            filterframebuf.copy(pcm_sbuf, 0, 0, filterframe.nb_samples*this._channels*this._depth/8); 
            this._audioCache.addBuffer(pcm_sbuf);
        }
    
    }

    needDemux() {

        let videolimitframes = this._fps; //10帧视频
        let audiolimitsize = this._sample*this._channels*this._depth/8; //1秒音频数据


        if (this._videoEnable) {

            if (this._vindex === -2) {

                return true;

            } else if (this._vindex >= 0 && this._videoCache.size() < videolimitframes) {

                return true;
            }
        }

        if (this._audioEnable) {
           
            if (this._aindex === -2) {

                return true;

            } else if (this._aindex >= 0 && this._audioCache.size() < audiolimitsize) {

                return true;
            }
        }

        return false;

    }

 
    start() {

        if (this._state !== PlayerState.StatePlayEnd) {

            logger.warn(`File Player(${this._handle}) has Start`)
            return;
        }
      
        this._isPause = false
        this._playEndCnt = 0;
        this._state = PlayerState.StateDumexing;

        if (this._videoEnable) {

            let videoms = 1000/this._fps;
            this._videoInterval = abst.setInterval_ABSTimer(() => {

                if (this._isPause) {
                    return;
                }

                let yuvbuf = this._videoCache.getPacket();
    
                if (yuvbuf) {
    
                    parentPort.postMessage({
                        cmdtype:'yuvdata', 
                        params:{'yuvbuf': yuvbuf}
                    }, [yuvbuf.buffer]);
    
                    //logger.info(`video cache left ${this._videoCache.size()}`);
                }
    
                this.demux();

                this.checkPlayEnd();
    
            } , videoms);
        }

        if (this._audioEnable) {

            this._audioInterval = abst.setInterval_ABSTimer(() => {

                if (this._isPause) {
                    return;
                }

                this._audioCache.splitOnce((pcm_s16buf) => {
    
                    parentPort.postMessage({
                        cmdtype:'pcmdata', 
                        params:{'pcm_s16buf': pcm_s16buf}
                    });
    
                });
    
                this.demux();

                this.checkPlayEnd();
                
            } , this._audioSpliteInterval);
        }

        parentPort.postMessage({cmdtype:'playstart'});

        logger.info(`File Player(${this._handle}) Start`);

        if (!this._videoEnable && !this._audioEnable) {

            this.demuxError('video & audio all disable');
        }
        
    }

    demuxError(result) {

        logger.info(`File Player(${this._handle}) Demux Error:${result}`);

        this.stop();

        parentPort.postMessage({cmdtype:'playerror', params:{result}});
     
    }

    pause() {

        logger.info(`File Player(${this._handle}) Pause`);

        this._isPause = true;
    }

    resume() {

        logger.info(`File Player(${this._handle}) resume`);

        this._isPause = false;
    }


    checkPlayEnd() {

        if (this._state !== PlayerState.StateDumexEndWaitForPlayEnd) {

            return;
        }

        let vplayend = true;
        let aplayend = true;

        if (this._videoEnable) {

            vplayend =  (this._videoCache.size() === 0);

        }

        if (this._audioEnable) {

            aplayend = !this._audioCache.canSplite(); 
        }

        if (vplayend && aplayend) {

            logger.info(`File Player(${this._handle}) Play Stop Check Success`);


            if (this._loop < 0 || this._playEndCnt < this._loop) {

               //准备开始下一轮demux

               logger.info(`File Player(${this._handle}) will start next loop play, current:${this._playEndCnt} total:${this._loop}`);
               this._state = PlayerState.StateDumexing;
               this.demux();

            } else {

                logger.info(`File Player(${this._handle})(url=${this._url}) play reaches ${this._loop} loop, will stop`);

                parentPort.postMessage({cmdtype:'playstop'});
                this.stop();
            }


        }

    }

    isStopped() {

        return this._state === PlayerState.StatePlayEnd;

    }


    stop() {

        this._state = PlayerState.StatePlayEnd;

        if (this._videoInterval) {

            abst.clearInterval_ABSTimer(this._videoInterval);
        }
        
        if (this._audioInterval) {
            
            abst.clearInterval_ABSTimer(this._audioInterval);
        }

        logger.info(`File Player(${this._handle}) Stop`);

    }

    async destroy() {


    }

}

class FilePlayer extends EventEmitter  {

    _worker = undefined;
    _handle = undefined;

    constructor(inputParams, outParams) {

        super();

        this._handle = Utils.GenRandomString(5);

        this._worker = new Worker(__filename, {workerData:{inputParams, outParams, handle:this._handle}});
        this._worker.on('error', (error) => {

            logger.error(`File Player(${this._handle}) work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                logger.error(`File Player(${this._handle}) Worker thread stopped with exit code ${code}`);

            } else {

                logger.info(`File Player(${this._handle}) Worker thread stopped with exit code 0`);
            }
        });

        this._worker.on('message', ({cmdtype, params}) => {

            switch (cmdtype) {

                case 'avinfo': {

                    this.emit('avinfo', params.videoParam, params.audioParam);
                    break;
                }

                case 'yuvdata': {
    
                   this.emit('yuvdata', params.yuvbuf);
                    break;
                }
    
                case 'pcmdata': {
    
                    this.emit('pcmdata', params.pcm_s16buf);
                    break;
                }

                case 'playstart': {
    
                    this.emit('playstart');
                     break;
                 }

                 case 'playstop': {
    
                    this.emit('playstop');
                     break;
                 }

                 case 'playerror': {
    
                    this.emit('playerror', params.result);
                     break;
                 }
            }

        });

        logger.info(`File Player(${this._handle}) Create Worker Thread Success`);

    }
   
    start() {
        this._worker.postMessage({cmdtype:'start'});
    }

    stop() {

        this._worker.postMessage({cmdtype:'stop'});
    }

    pause() {

        this._worker.postMessage({cmdtype:'pause'});
    }

    resume() {

        this._worker.postMessage({cmdtype:'resume'});
    }

    async destroy() {

        await this._worker.terminate();
        logger.info(`File Player(${this._handle}) Destroy Worker Thread Success`);
    }

}

function WorkerThread() {

    parentPort.on('message', msg => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let fileplayer = workerData.fileplayer;

        switch (cmdtype) {

            case 'start': {

                if (fileplayer && !fileplayer.isStopped()) {

                    logger.warn(`fileplayer ${workerData.handle} has start`)
                    return
                }

                workerData.fileplayer = new FilePlayerInternal(workerData.inputParams, workerData.outParams, workerData.handle);
                workerData.fileplayer.start();
                break;
            }

            case 'stop': {

                if (!fileplayer) {
                    logger.warn(`fileplayer ${workerData.handle} has stopped, stop fail`)
                    return
                }

                fileplayer.stop();
                workerData.fileplayer = undefined;
                break;
            }

            case 'pause': {

                if (!fileplayer) {
                    logger.warn(`fileplayer ${workerData.handle} has stopped, pause fail`)
                    return
                }

                fileplayer.pause();
                break;
            }

            case 'resume': {

                if (!fileplayer) {
                    logger.warn(`fileplayer ${workerData.handle} has stopped, resume fail`)
                    return
                }

                fileplayer.resume();
                break;
            }
        }

    })

}


if (!isMainThread) {

    WorkerThread();

}


module.exports = FilePlayer;