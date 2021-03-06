dart_library.library('misc', null, /* Imports */[
  "dart_runtime/dart",
  'dart/core'
], /* Lazy imports */[
], function(exports, dart, core) {
  'use strict';
  let dartx = dart.dartx;
  class _Uninitialized extends core.Object {
    _Uninitialized() {
    }
  }
  dart.setSignature(_Uninitialized, {
    constructors: () => ({_Uninitialized: [_Uninitialized, []]})
  });
  let UNINITIALIZED = dart.const(new _Uninitialized());
  let Generic$ = dart.generic(function(T) {
    class Generic extends core.Object {
      get type() {
        return Generic$();
      }
    }
    return Generic;
  });
  let Generic = Generic$();
  function main() {
    core.print(dart.toString(1));
    core.print(dart.toString(1.0));
    core.print(dart.toString(1.1));
    let x = 42;
    core.print(dart.equals(x, core.Object));
    core.print(dart.equals(x, Generic));
    core.print(new (Generic$(core.int))().type);
  }
  dart.fn(main);
  // Exports:
  exports.UNINITIALIZED = UNINITIALIZED;
  exports.Generic$ = Generic$;
  exports.Generic = Generic;
  exports.main = main;
});
