
const rs = require('./rtmpstream')


function main() {

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


main();