# Racer-Schema

- Schema validation module for Racer
- Uses [z-schema](https://github.com/zaggino/z-schema), which supports [JSON-Schema](http://json-schema.org/) v4
- Schema validation executes in sync 'validate' hook, so you validate the actual result of operation
- Supports custom validators with async and sync logic
- Custom validators can preload data in async hook to use it later in sync

## Known Issues
- Works only with JSON OT type
- Format functions should be sync
- For every op the whole doc validates each time, because it`s the only case when z-schema returns full path to wrong fields

## How it works
Current 0.7 version of ShareJS has 4 hooks which are executed while operation is applied.
- async 'submit' hook - executes once before op is applied to data snapshot in db. This is convinient place to preload data and execute async validation logic. Be aware that you can not have result of operation here. It`s ok for some ops (model.set, model.add) because they ovewrites previous data (or add new), but for array mutators (model.push, model.pop, etc), string mutators (model.stringInsert, model.stringRemove) and increment (model.increment) it`s impossible to predict what will be the result data and we can not use some kinds of validators here because of this, like max, min, etc. That`s why we should use sync hook.
- sync 'preValidate' hook - executes before op actually applied to snapshot. In high concurent cases it can be executed more than one time. We still does not have result data here, so it`s useless for us.
- sync 'validate' hook - executes after op is applied to snapshot, but before these changes are saved to db. Can be executed more than one time. It`s best place for schema validation logic as we have result data here which is not saved to db yet
- async 'after submit' hook - executes once after changes are saved to db. It`s useless for validation, but good to trigger
some stuff

All schema validation logic executes in 'validate' hook. Custom validators have two methods: '.sync' - sync and executes in 'validate' hook and '.async' - async and executes in 'submit' hook. There can be one of them or both, also you can preload data in '.async' method to use it later in '.sync'

### Installation
```
npm install racer-schema
```

### Setting
#### Step 1. Options
```
var options = {
  // Schemas use JSON-Schema format
  schemas: {
    users: {
      title: 'Example Schema',
      type: 'object',
      properties: {
        nickname: {
          type: 'string',
          format: 'xstring', // custom format
          minLength: 1,
          maxLength: 10
        },
        email: {
          type: 'string',
          format: 'email'
        },
        age: {
          description: 'Age in years',
          type: 'integer',
          minimum: 0
        },
        roleId: {
          type: 'string',
          collection: 'roles', // additional field for 'join' custom validator
          validators: ['join'] // custom validators
        },
        hobbies: {
          type: 'array',
          maxItems: 3,
          items: { 
            type: 'string'
          },
          uniqueItems: true
        }
      },
      required: ['email']
    },
    roles: {
      type: 'object',
      properties: {
        name: {
          type: 'string'
        }
      }
    }
  },
  // JSON-Schema formats can be added here. They should be sync
  formats: {
    xstring: function(str) {
      return str !== 'xxx';
    }
  },
  // Custom validators
  validators: {
    // join - is working example of custom validator. It ensures that value is id of doc of specific collection
    join: {
      async: function(context, done) {
        var id = context.value; // here is value for this op
        if (!id) return done();
        var collection = context.schema.collection; // context.schema - is schema of current property
        var model = this.store.createModel();
        var $entity = model.at(collection + '.' + id);
        model.fetch($entity, function(err) {
          if (err) return done(err);
          if (!$entity.get()) {
            return done(Error('No ' + collection + ' with id ' + id));
          }
          done();
        });
      }
    },
    // this is example of custom validator, that preloads data and uses it later
    preload: {
      async: function(context, done) {
        var model = this.store.createModel(); // that`s how to get model
        var $someData = model.at('some.path');
        model.fetch($someData, function(err) {
          if (err) return done(err);
          var data = $someData.get();
          done(null, data); // pass data as second parameter
        })
      },
      sync: function(value, context) {
        var data = context.data; // preloaded data is here

        retturn true || false;
      }
    }
  }
}
```

#### Step 2. Plugin
```
racer.use(require('racer-schema'), options);
// Or
derby.use(require('racer-schema'), options);
```

### Error format
```
model.add('collection', doc, function(err) {
  if (err) {
    var errors = err.errors;
    for (var i = 0; i < errors.length; i++) {
      var error = errors[i];
      var message = error.message; // Error message
      var paths = error.paths; // Array of strings. Full path to error field
    }
  }
});
```

### Example
- [derby-starter](https://github.com/vmakhaev/derby-starter/tree/auth) with auth
- [auth-example](https://github.com/vmakhaev/auth-example) simple app with auth

## The MIT License

Copyright (c) 2014 Vladimir Makhaev

Permission is hereby granted, free of charge, 
to any person obtaining a copy of this software and 
associated documentation files (the "Software"), to 
deal in the Software without restriction, including 
without limitation the rights to use, copy, modify, 
merge, publish, distribute, sublicense, and/or sell 
copies of the Software, and to permit persons to whom 
the Software is furnished to do so, 
subject to the following conditions:

The above copyright notice and this permission notice 
shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, 
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES 
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR 
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.