var racer = require('racer');
var Memory = require('racer/node_modules/share/node_modules/livedb/lib/memory');
var options = require('./options');
racer.use(require('../lib'), options);
var store = racer.createStore({db: new Memory()});
var model = store.createModel();

module.exports = model;
