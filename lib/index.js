var Schema = require('./Schema');

module.exports = plugin;

function plugin(racer, options) {
  var schema = new Schema(options);
  racer.on('store', function(store) {
    schema.setupStore(store);
  });
}