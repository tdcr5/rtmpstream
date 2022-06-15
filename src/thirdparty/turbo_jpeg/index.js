
const fsExtra = require('fs-extra');
let binding;
if (process.platform === 'win32') {
  binding = require('./win/jpegturbo.node');
}
else {
  binding = require('./linux/jpegturbo.node');
}
 


// Copy exports so that we can customize them on the JS side without
// overwriting the binding itself.
Object.keys(binding).forEach(function(key) {
  module.exports[key] = binding[key]
})

// Convenience wrapper for Buffer slicing.
module.exports.compressSync = function(buffer, optionalOutBuffer, options) {
  var out = binding.compressSync(buffer, optionalOutBuffer, options)
  return out.data.slice(0, out.size)
}

// Convenience wrapper for Buffer slicing.
module.exports.decompressSync = function(buffer, optionalOutBuffer, options) {
  var out = binding.decompressSync(buffer, optionalOutBuffer, options)
  out.data = out.data.slice(0, out.size)
  return out
}


let readJPEG = function (imgFile, format) {
  format = format ?? binding.FORMAT_RGBA
  var out = binding.decompressSync(fsExtra.readFileSync(imgFile), { format }, null,)
  out.data = out.data.slice(0, out.size)
  return out
}
module.exports.readJPEG = readJPEG

module.exports.readRGBA = function (file) {
  return readJPEG(file, binding.FORMAT_RGBA)
}

module.exports.readRGB = function (file) {
  return readJPEG(file, binding.FORMAT_RGB)
}


module.exports.readGray = function (file) {
  return readJPEG(file, binding.FORMAT_GRAY)
}


