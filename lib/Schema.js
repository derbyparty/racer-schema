var dotty = require('dotty');
var ZSchema = require('z-schema');

module.exports = Schema;

function Schema(options) {
  var options = this.options = options || {};
  options.validator = options.validator || {};
  // Force sync mode so we can use sync 'validate' hook
  options.validator.sync = true;

  this.ZSchema = ZSchema;

  if (options.formats) {
    for (var format in options.formats) {
      ZSchema.registerFormatSync(format, options.formats[format]);
    }
  }
  this.customValidators = options.validators || {};

  this.validator = new ZSchema(options.validator);

  if (!options.schemas) throw new Error('Schemas are required in options');
  // Compile and validate schemas
  this.validator.compileSchema(options.schemas);
  this.schemas = options.schemas;
}

Schema.prototype.setupStore = function(store) {
  this.store = store;
  var self = this;

  store.shareClient.use('submit', function(shareRequest, done) {
    var collection = shareRequest.collection;
    var docId = shareRequest.docName;
    var opData = shareRequest.op;
    var rootSchema = self.schemas[collection];

    function formatError (err) {
      if (!err) return;
      err.collection = collection;
      err.docId = docId;
      return err;
    }

    if (!rootSchema) {
      if(self.options.skipNonExisting) return done();

      return done(formatError(new Error('No schema for collection: ' + collection)));
    }
    //console.log(JSON.stringify(opData));

    if (opData.create) {
      // Create
      // Validate schema of doc in async 'submit' hook
      //   as we have the result data here
      var doc = opData.create.data;
      // Root paths as we want to validate whole doc
      var paths = [];
      // Custom validator contexts
      try {
        var contexts = self.getContexts(rootSchema, doc, paths);
      } catch (err) {
        return done(formatError(getError(err)));
      }
      var validateCreate = function(err) {
        // If there was no error from async custom validators,
        //   run sync schema validation and sync custom validators
        done(formatError(err || self.validate(doc, rootSchema, paths, contexts)));
      }
      var counter = getCounter();
      self.runAsyncs(contexts, counter, validateCreate);
      // There was no countexts or not async fn in any of them
      if (counter.count === 0 && !counter.sent) {
        validateCreate();
      }
    } else if (opData.del) {
      // Delete
      // Nothing to validate while deleting doc
      return done();
    } else {
      // Change
      // For all mutate ops we create 'validate' hook, which is sync
      //   and can be executed a lot of times (in high concurrent apps)
      //   Also it executes after the op is applied to doc, so we
      //   can validate the actual result of the opearation. It`s nessesary
      //   for validators like min, max and ops like increment and
      //   array ops (push, pop, etc) for ex.
      opData.validate = function(opData, data) {
        var doc = data.data;
        // Array has only one op here, that`s how ShareJS applies ops
        var op = opData.op[0];
        var paths = op.p;

        return self.validate(doc, rootSchema, paths, op.contexts);
      }

      var counter = getCounter();

      for (var i = 0; i < opData.op.length; i++) {
        var op = opData.op[i];
        var paths = op.p;
        var value = op.oi || op.li || op.na;
        try {
          var schema = getSchemaForPaths(rootSchema, paths);
          var contexts = self.getContexts(schema, value, paths);
        } catch (err) {
          return done(formatError(getError(err)));
        }
        op.contexts = contexts;
        self.runAsyncs(contexts, counter, done);
      }
      if (counter.count === 0 && !counter.sent) {
        counter.sent = true;
        done();
      }
    }
  });
}

Schema.prototype.runAsyncs = function(contexts, counter, done) {
  var self = this;
  var error = getError();
  for (var k = 0; k < contexts.length; k++) {
    var context = contexts[k];
    var customValidator = context.customValidator;
    if (customValidator.async) {
      counter.count++;
      setTimeout(function() {
        (function() {
          customValidator.async.call(self, context, function(err, data) {
            if (err) {
              err.paths = context.paths;
              error.errors.push(err);
            }
            context.data = data;
            counter.count--;
            if (counter.count === 0 && !counter.sent) {
              counter.sent = true;
              if (error.errors.length) {
                done(error);
              } else {
                done();
              }
            }
          });
        })(context);
      }, 0);
    }
  }
}

Schema.prototype.validate = function(doc, rootSchema, paths, contexts) {
  var error = getError();
  // Schema validation is here
  //   everytime we validate the whole doc, because it`s only case
  //   when z-schema returns full paths with errors
  var valid = this.validator.validate(doc, rootSchema);
  if (!valid) {
    error.errors = this.validator.getLastError().errors;
    // Parse path to array for each error
    for (var i = 0; i < error.errors.length; i++) {
      var parsedError = error.errors[i];
      var path = parsedError.path;
      var paths = [];
      // Avoiding '#/'
      if (path.length > 2) {
        paths = path.split('/').slice(1);
      }
      // Add last part from params.property
      if (parsedError.params && parsedError.params.property) {
        paths.push(parsedError.params.property);
      }
      for (var k = 0; k < paths.length; k++) {
        var part = paths[k];
        if (part[0] === '[') {
          paths[k] = +part.slice(1, part.length - 1);
        }
      }
      error.errors[i].paths = paths;
    }
  }

  // Custom validators
  if (contexts) {
    for (var i = 0; i < contexts.length; i++) {
      var context = contexts[i];
      if (!context.customValidator.sync) continue;
      var value;
      if (context.paths.length) {
        value = dotty.get(doc, context.paths);
      } else {
        value = doc;
      }
      if (!value) continue;
      var err = context.customValidator.sync(value, context);
      if (err) {
        err.paths = context.paths;
        error.errors.push(err);
      }
    }
  }

  if (error.errors.length) {
    //console.log(JSON.stringify(error));
    return error;
  }
}

Schema.prototype.getContexts = function(schema, value, defaultPaths, paths) {
  var results = [];
  paths = paths || [];
  if (schema.validators) {
    for (var i = 0; i < schema.validators.length; i++) {
      var validatorName = schema.validators[i];
      var customValidator = this.customValidators[validatorName];
      if (!customValidator) throw Error('Unknown validator: ' + validatorName);
      results.push({
        name: validatorName,
        customValidator: customValidator,
        paths: defaultPaths.concat(paths),
        schema: schema,
        value: value
      })
    }
  }

  if (schema.type === 'object') {
    if (value) {
      for (var key in value) {
        try {
          results = results.concat(this.getContexts(getSchemaForObjectProperty(schema, key), value[key], defaultPaths, paths.concat([key])));
        } catch (err) {
          // Prevent overwriting if we catched rethrown error
          if (!err.paths) {
            err.paths = defaultPaths.concat(paths);
          }
          throw err;
        }
      }
    }
  } else if (schema.type === 'array') {
    if (value) {
      for (var i = 0; i < value.length; i++) {
        var passValue = value[i];
        results = results.concat(this.getContexts(schema.items, passValue, defaultPaths, paths.concat([i])));
      }
    }
  }

  return results;
}

function getSchemaForPaths(schema, paths) {
  if (!paths.length) return schema;

  var property = paths[0];
  paths = paths.slice(1);
  if (schema.type === 'object') {
    try {
      return getSchemaForPaths(getSchemaForObjectProperty(schema, property), paths);
    } catch (err) {
      if (!err.paths) {
        err.paths = paths.concat([property]);
      }
      throw err;
    }
  } else if (schema.type === 'array') {
    return getSchemaForPaths(schema.items, paths);
  } else if (schema.type === 'string') {
    // String operations
    return schema;
  }
}

function getSchemaForObjectProperty(schema, property) {
  if (schema.properties && schema.properties[property]) {
    return schema.properties[property];
  }
  if (schema.patternProperties) {
    for (var patternProperty in schema.patternProperties) {
      var pattern = new RegExp(patternProperty);
      if (pattern.test(property)) {
        return schema.patternProperties[patternProperty];
      }
    }
  }
  if (schema.additionalProperties === true || (!schema.additionalProperties && schema.additionalProperties !== false)) {
    return {};
  } else if (schema.additionalProperties) {
    return schema.additionalProperties;
  }

  throw Error('Property "' + property + '" is invalid');
}

function getCounter() {
  return  {
    count: 0,
    sent: false
  };
}

function getError(err) {
  var error = Error('Not valid');
  error.errors = [];
  if (err) {
    error.errors.push(err);
  }
  return error;
}
