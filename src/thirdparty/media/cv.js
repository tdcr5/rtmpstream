const cv = require('opencv4nodejs');






function colorRGBAScale(data, width, height, dstwidth, dstheight) {

    let mat = new cv.Mat(data, height, width, cv.CV_8UC4);

    let dstmat = mat.resize(dstheight, dstwidth);

    return Buffer.from(dstmat.getData());
}



function colorI420Scale(data, width, height, dstwidth, dstheight) {

    let mat = new cv.Mat(data, height*3/2, width, cv.CV_8UC1);

    let dstmat = mat.resize(dstheight*3/2, dstwidth);

    return Buffer.from(dstmat.getData());
}


module.exports = {colorI420Scale, colorRGBAScale};