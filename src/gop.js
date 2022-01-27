

class GopCache {

    _cache = [];

    addPacket(avpacket) {

        this._cache.push(avpacket);
    }

    isEmpty() {

        return this._cache.length === 0;
    }

    getPacket() {

        return this._cache.shift();
    }

    clear() {

        this._cache.length = 0;
    }

}


module.exports = {GopCache};