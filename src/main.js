
const rs = require('./rtmpstream')
const r = require('./record')


function testRtmp() {

    let pullUrl = 'rtmp://172.16.103.19:1935/live/a123456';
    let pushUrl = 'rtmp://172.16.103.19:1935/push/p123456';

    let pullstream = new rs.RtmpPullStream(pullUrl);
    let pushstream = new rs.RtmpPushStream(pushUrl);;

    pullstream.on('vinfo', (width, height) => {

        pushstream.setVideoInfo(width, height);
        
    });

    pullstream.on('ainfo', (sample, channels, depth) => {

        pushstream.setAudioInfo(sample, channels, depth);

    });
    
    pullstream.on('rgbadata', (rgbabuf, timestamp) => {

        pushstream.pushRGBAData(rgbabuf, timestamp);
    });

    pullstream.on('pcmdata', (pcmbuf, timestamp) => {

        let splitsamlenum = 240;
 
       // let tsoffset = Math.floor(splitsamlenum*1000/48000);

        let total = 1024;
        let left = total;

        while(left > 0) {

            if (left > splitsamlenum) {

                pushstream.pushPCMData(pcmbuf.slice((total - left)*4,  (total - left + splitsamlenum)*4), 
                                                    timestamp + Math.floor((total - left)*1000/4800));
                left -= splitsamlenum;

            } else {

                pushstream.pushPCMData(pcmbuf.slice((total - left)*4), timestamp + Math.floor((total - left)*1000/4800));

                left = 0;
            }

        }


        //pushstream.pushPCMData(pcmbuf, timestamp);

      });

    pullstream.start();
    pushstream.start();
}


function testRecord() {

    let pullUrl = 'rtmp://172.16.103.19:1935/live/a123456';
    let mp4file = './test_1.mp4'
    let pullstream = new rs.RtmpPullStream(pullUrl);
    let mp4stream = new r.RecordStream(mp4file);

    let isVSet = false;
    let isASet = false;
    let basets = undefined;

    pullstream.on('vinfo', (width, height) => {

     mp4stream.setVideoInfo(width, height, 'V0');
     isVSet = true;
     
     if (isVSet && isASet) {

        mp4stream.start();
     }
        
    });

    pullstream.on('ainfo', (sample, channels, depth) => {

       mp4stream.setAudioInfo(sample, channels, depth, 'A0');
       mp4stream.setAudioInfo(sample, channels, depth, 'A1');
       isASet = true;

       if (isVSet && isASet) {
            mp4stream.start();
       }
    });
    
    pullstream.on('rgbadata', (rgbabuf, timestamp) => {

        if (!basets) {
            basets = timestamp;
        }

        mp4stream.pushRGBAData(rgbabuf, timestamp -basets, 'V0');
    });

    pullstream.on('pcmdata', (pcmbuf, timestamp) => {

        
        if (!basets) {
            basets = timestamp;
        }

        let splitsamlenum = 240;
 
        // let tsoffset = Math.floor(splitsamlenum*1000/48000);
 
         let total = 1024;
         let left = total;
 
         while(left > 0) {
 
             if (left > splitsamlenum) {
 
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4,  (total - left + splitsamlenum)*4), 
                                                    timestamp + Math.floor((total - left)*1000/4800) - basets, 'A0');
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4,  (total - left + splitsamlenum)*4), 
                                                    timestamp + Math.floor((total - left)*1000/4800) - basets, 'A1');
                left -= splitsamlenum;
 
             } else {
 
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4), timestamp + Math.floor((total - left)*1000/4800) - basets, 'A0');
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4), timestamp + Math.floor((total - left)*1000/4800) - basets, 'A1');
                 left = 0;
             }
 
         }

    });

    pullstream.start();
    console.log('mp4 start record');

    setTimeout(() => {
        
        mp4stream.stop();
        console.log('mp4 stop record');

    }, 10*1000);
}


function main() {

    testRecord();
    
}


main();