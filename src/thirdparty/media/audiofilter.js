const Utils = require('./utils');
const av = require('./av');
const gop = require('./gop');
const EventEmitter = require('events');
const beamcoder = require('../beamcoder_contextaware');
// const logger = require("../../logger").log4js.getLogger('default');
const logger = require("console")
const AudioBufferEx = require('../splitebufferex');


const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');



class AudioFilterInternal extends EventEmitter {

    //input audio params
    _in_format = '';
    _in_sample = 0;
    _in_channels = 0;
    _in_channelsLayout = '';
    _in_depth = 0;
    

    //output audio params
    _out_format = '';
    _out_sample = 0;
    _out_channels = 0;
    _out_channelsLayout = '';
    _out_depth = 0;
    _out_sampleNumPerFrame = 0;

    _pcmFilter = undefined;
    _audioCache = undefined;
    _pcmBuf = undefined;
    _handle = undefined;

    _pcmFilteStart = false;

    
    constructor(inputParams, outParams, handle) {

        super();

        this._handle = handle;

        this._in_format = inputParams.format;
        this._in_sample = inputParams.sample;
        this._in_channels = inputParams.channels;
        this._in_channelsLayout = this._in_channels === 1 ? 'mono' : 'stereo';
        this._in_depth = inputParams.depth;

        this._out_format = outParams.format;
        this._out_sample = outParams.sample;
        this._out_channels = outParams.channels;
        this._out_channelsLayout = this._out_channels === 1 ? 'mono' : 'stereo';
        this._out_depth = outParams.depth;
        this._out_sampleNumPerFrame = outParams.sampleNumPerFrame;

        this._audioCache = new gop.GopCache();
        this._pcmBuf = new AudioBufferEx(this._out_sampleNumPerFrame*this._out_channels*this._out_depth/8,
                                        1000.0/(this._out_sample*this._out_channels*this._out_depth/8));

        logger.info(` Audio Filter(${this._handle}) Created`);

    }


    pushPCMData(pcmbuf, timestamp) {
        
        let apkt = new av.AVPacket();
        apkt.payload = pcmbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Audio;

        this._audioCache.addPacket(apkt);
        this.audioFilter();
    }

    async audioFilter() {

        if (this._audioCache.isEmpty()) {
            return;
        }

        if (this._pcmFilteStart) {

            return;
        }

        this._pcmFilteStart = true;

        let avpacket = this._audioCache.getPacket();

        await this.handleAudio(avpacket);
        
        this._pcmFilteStart = false;


        this.audioFilter(); 
    }

    async handleAudio(packet) {

        if (!this._pcmFilter) {

            this._pcmFilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: this._in_sample,
                                                            sampleFormat: this._in_format,
                                                            channelLayout: this._in_channelsLayout,
                                                            timeBase: [1, 1000]
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._out_sample,
                                                            sampleFormat: this._out_format,
                                                            channelLayout: this._out_channelsLayout
                                                        }
                                                        ],
                                                        filterSpec: `aresample=${this._out_sample}, aformat=sample_fmts=${this._out_format}:channel_layouts=${this._out_channelsLayout}`
                                                    });

        }


        let samplenum = packet.payload.length/this._in_channels*8/this._in_depth;

        let frame = beamcoder.frame({
             format: this._in_format,
             sample_rate: this._in_sample,
             time_base: [1, 1000],
             channels: this._in_channels,
             channel_layout:this._in_channelsLayout,
             nb_samples:samplenum
          }).alloc();

          packet.payload.copy(frame.data[0], 0, 0);


        let filter_result = await this._pcmFilter.filter([frame]);

        if (filter_result?.length <= 0 || filter_result[0]?.frames?.length <= 0) {
             return;
        }

        for(let filterframe of filter_result[0].frames) {

            let filterframebuf = filterframe.data[0];
            let buflen = filterframe.nb_samples*this._out_channels*this._out_depth/8;

            let pcmbuf = Buffer.alloc(buflen);
            filterframebuf.copy(pcmbuf, 0, 0, buflen); 

            this._pcmBuf.addBuffer(packet.timestamp, pcmbuf);
        }


        this._pcmBuf.split((pts, pcmbuf) => {

            parentPort.postMessage({cmdtype:'pcmdata', 
            params:{'pcmbuf': pcmbuf, 'pts': pts}});

        });

    }


    async destroy() {


    }

}

class AudioFilter extends EventEmitter  {

    _worker = undefined;
    _handle = undefined;

    constructor(inputParams, outParams) {

        super();

        this._handle = Utils.GenRandomString(5);

        this._worker = new Worker(__filename, {workerData:{inputParams, outParams, handle:this._handle}});
        this._worker.on('error', (error) => {

            logger.error(`Audio Filter(${this._handle}) work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                logger.error(`Audio Filter(${this._handle}) Worker thread stopped with exit code ${code}`);

            } else {

                logger.info(`Audio Filter(${this._handle}) Worker thread stopped with exit code 0`);
            }
        });

        this._worker.on('message', ({cmdtype, params}) => {

            switch (cmdtype) {

                case 'pcmdata': {
    
                    this.emit('pcmdata', params.pcmbuf, params.pts);
                    break;
                }

            }

        });

        logger.info(`Audio Filter(${this._handle}) Create Worker Thread Success`);

    }
   
    pushPCMData(pcmbuf, timestamp) {

        this._worker.postMessage({cmdtype:'pushpcmdata', 
                                  params:{pcmbuf, timestamp}});
    }

    async destroy() {

        await this._worker.terminate();
        logger.info(`Audio Filter(${this._handle}) Destroy Worker Thread Success`);
    }

}

function WorkerThread() {


    workerData.audiofilter = new AudioFilterInternal(workerData.inputParams, workerData.outParams, workerData.handle);

    parentPort.on('message', msg => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let audiofilter = workerData.audiofilter;

        switch (cmdtype) {

            case 'pushpcmdata': {

                audiofilter.pushPCMData(Buffer.from(params.pcmbuf), params.timestamp);
                break;
            }

        }

    })

}


if (!isMainThread) {

    WorkerThread();

}


module.exports = AudioFilter;