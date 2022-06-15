let bindings;
if (process.platform === 'win32') {
    bindings = require('./win/vcamwrite.node');
}
else {
    bindings = undefined;
}


module.exports = bindings;
