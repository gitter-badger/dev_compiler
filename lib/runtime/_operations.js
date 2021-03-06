// Copyright (c) 2015, the Dart project authors.  Please see the AUTHORS file
// for details. All rights reserved. Use of this source code is governed by a
// BSD-style license that can be found in the LICENSE file.

/* This library defines runtime operations on objects used by the code
 * generator.
 */
dart_library.library('dart_runtime/_operations', null, /* Imports */[
], /* Lazy Imports */[
  'dart/async',
  'dart/collection',
  'dart/core',
  'dart/_js_helper',
  'dart_runtime/_classes',
  'dart_runtime/_errors',
  'dart_runtime/_rtti',
  'dart_runtime/_types'
], function(exports, async, collection, core, _js_helper, classes, errors, rtti,
            types) {
  'use strict';

  const getOwnNamesAndSymbols = dart_utils.getOwnNamesAndSymbols;
  const throwError = dart_utils.throwError;

  const getOwnPropertyNames = Object.getOwnPropertyNames;
  const hasOwnProperty = Object.prototype.hasOwnProperty;

  const slice = [].slice;

  function _canonicalFieldName(obj, name, args, displayName) {
    name = classes.canonicalMember(obj, name)
    if (name) return name;
    // TODO(jmesserly): in the future we might have types that "overlay" Dart
    // methods while also exposing the full native API, e.g. dart:html vs
    // dart:dom. To support that we'd need to fall back to the normal name
    // if an extension method wasn't found.
    errors.throwNoSuchMethod(obj, displayName, args);
  }

  function dload(obj, field) {
    field = _canonicalFieldName(obj, field, [], field);
    if (classes.hasMethod(obj, field)) {
      return classes.bind(obj, field);
    }
    // TODO(vsm): Implement NSM robustly.  An 'in' check breaks on certain
    // types.  hasOwnProperty doesn't chase the proto chain.
    // Also, do we want an NSM on regular JS objects?
    // See: https://github.com/dart-lang/dev_compiler/issues/169
    let result = obj[field];

    // TODO(vsm): Check this more robustly.
    if (typeof result == "function" && !hasOwnProperty.call(obj, field)) {
      // This appears to be a method tearoff.  Bind this.
      return result.bind(obj);
    }
        return result;
  }
  exports.dload = dload;

  function dput(obj, field, value) {
    field = _canonicalFieldName(obj, field, [value], field);
    // TODO(vsm): Implement NSM and type checks.
    // See: https://github.com/dart-lang/dev_compiler/issues/170
    obj[field] = value;
  }
  exports.dput = dput;


  /// Check that a function of a given type can be applied to
  /// actuals.
  function checkApply(type, actuals) {
    if (actuals.length < type.args.length) return false;
    let index = 0;
    for(let i = 0; i < type.args.length; ++i) {
      if (!instanceOfOrNull(actuals[i], type.args[i])) return false;
      ++index;
    }
    if (actuals.length == type.args.length) return true;
    let extras = actuals.length - type.args.length;
    if (type.optionals.length > 0) {
      if (extras > type.optionals.length) return false;
      for(let i = 0, j=index; i < extras; ++i, ++j) {
        if (!instanceOfOrNull(actuals[j], type.optionals[i])) return false;
      }
      return true;
    }
    // TODO(leafp): We can't tell when someone might be calling
    // something expecting an optional argument with named arguments

    if (extras != 1) return false;
    // An empty named list means no named arguments
    if (getOwnPropertyNames(type.named).length == 0) return false;
    let opts = actuals[index];
    let names = getOwnPropertyNames(opts);
    // Type is something other than a map
    if (names.length == 0) return false;
    for (name of names) {
      if (!(hasOwnProperty.call(type.named, name))) {
        return false;
      }
      if (!instanceOfOrNull(opts[name], type.named[name])) return false;
    }
    return true;
  }

  function throwNoSuchMethod(obj, name, args, opt_func) {
    if (obj === void 0) obj = opt_func;
    errors.throwNoSuchMethod(obj, name, args);
  }

  function checkAndCall(f, ftype, obj, args, name) {
    if (!(f instanceof Function)) {
      // We're not a function (and hence not a method either)
      // Grab the `call` method if it's not a function.
      if (f !== null) {
        ftype = classes.getMethodType(f, 'call');
        f = f.call;
      }
      if (!(f instanceof Function)) {
        throwNoSuchMethod(obj, name, args);
      }
    }
    // If f is a function, but not a method (no method type)
    // then it should have been a function valued field, so
    // get the type from the function.
    if (ftype === void 0) {
      ftype = rtti.read(f);
    }

    if (!ftype) {
      // TODO(leafp): Allow JS objects to go through?
      // This includes the DOM.
      return f.apply(obj, args);
    }

    if (checkApply(ftype, args)) {
      return f.apply(obj, args);
    }

    // TODO(leafp): throw a type error (rather than NSM)
    // if the arity matches but the types are wrong.
    throwNoSuchMethod(obj, name, args, f);
  }

  function dcall(f/*, ...args*/) {
    let args = slice.call(arguments, 1);
    let ftype = rtti.read(f);
    return checkAndCall(f, ftype, void 0, args, 'call');
  }
  exports.dcall = dcall;

  /** Shared code for dsend, dindex, and dsetindex. */
  function callMethod(obj, name, args, displayName) {
    let symbol = _canonicalFieldName(obj, name, args, displayName);
    let f = obj[symbol];
    let ftype = classes.getMethodType(obj, name);
    return checkAndCall(f, ftype, obj, args, displayName);
  }

  function dsend(obj, method/*, ...args*/) {
    return callMethod(obj, method, slice.call(arguments, 2));
  }
  exports.dsend = dsend;

  function dsendArray(obj, method, args) {
    return dsend(obj, method, ...args);
  }
  exports.dsendArray = dsendArray;

  function dindex(obj, index) {
    return callMethod(obj, 'get', [index], '[]');
  }
  exports.dindex = dindex;

  function dsetindex(obj, index, value) {
    return callMethod(obj, 'set', [index, value], '[]=');
  }
  exports.dsetindex = dsetindex;

  function _ignoreTypeFailure(actual, type) {
    // TODO(vsm): Remove this hack ...
    // This is primarily due to the lack of generic methods,
    // but we need to triage all the errors.
    let isSubtype = types.isSubtype;
    if (isSubtype(type, core.Iterable) && isSubtype(actual, core.Iterable) ||
        isSubtype(type, async.Future) && isSubtype(actual, async.Future) ||
        isSubtype(type, core.Map) && isSubtype(actual, core.Map) ||
        isSubtype(type, core.Function) && isSubtype(actual, core.Function)) {
      console.error('Ignoring cast fail from ' + types.typeName(actual) +
        ' to ' + types.typeName(type));
      return true;
    }
    return false;
  }

  function instanceOf(obj, type) {
    return types.isSubtype(rtti.realRuntimeType(obj), type);
  }
  exports.instanceOf = instanceOf;

  function instanceOfOrNull(obj, type) {
    if ((obj == null) || instanceOf(obj, type)) return true;
    let actual = rtti.realRuntimeType(obj);
    if (_ignoreTypeFailure(actual, type)) return true;
    return false;
  }
  exports.instanceOfOrNull = instanceOfOrNull;

  function cast(obj, type) {
    // TODO(vsm): handle non-nullable types
    if (obj == null) return obj;
    let actual = rtti.realRuntimeType(obj);
    if (types.isSubtype(actual, type)) return obj;
    if (_ignoreTypeFailure(actual, type)) return obj;
    errors.throwCastError(actual, type);
  }
  exports.cast = cast;

  function arity(f) {
    // TODO(jmesserly): need to parse optional params.
    // In ES6, length is the number of required arguments.
    return { min: f.length, max: f.length };
  }
  exports.arity = arity;

  function equals(x, y) {
    if (x == null || y == null) return x == y;
    let eq = x['=='];
    return eq ? eq.call(x, y) : x === y;
  }
  exports.equals = equals;

  /** Checks that `x` is not null or undefined. */
  function notNull(x) {
    // TODO(leafp): This is probably not the right error to throw.
    if (x == null) throwError('expected not-null value');
    return x;
  }
  exports.notNull = notNull;

  /**
   * Creates a dart:collection LinkedHashMap.
   *
   * For a map with string keys an object literal can be used, for example
   * `map({'hi': 1, 'there': 2})`.
   *
   * Otherwise an array should be used, for example `map([1, 2, 3, 4])` will
   * create a map with keys [1, 3] and values [2, 4]. Each key-value pair
   * should be adjacent entries in the array.
   *
   * For a map with no keys the function can be called with no arguments, for
   * example `map()`.
   */
  // TODO(jmesserly): this could be faster
  function map(values) {
    let map = collection.LinkedHashMap.new();
    if (Array.isArray(values)) {
      for (let i = 0, end = values.length - 1; i < end; i += 2) {
        let key = values[i];
        let value = values[i + 1];
        map.set(key, value);
      }
    } else if (typeof values === 'object') {
      for (let key of getOwnPropertyNames(values)) {
        map.set(key, values[key]);
      }
    }
    return map;
  }
  exports.map = map;

  function assert(condition) {
    if (!condition) errors.throwAssertionError();
  }
  exports.assert = assert;

  function throw_(obj) { throw obj; }
  exports.throw_ = throw_;


  function stackTrace(exception) {
    return _js_helper.getTraceFromException(exception);
  }
  exports.stackTrace = stackTrace;

  let _value = Symbol('_value');
  /**
   * Looks up a sequence of [keys] in [map], recursively, and
   * returns the result. If the value is not found, [valueFn] will be called to
   * add it. For example:
   *
   *     let map = new Map();
   *     putIfAbsent(map, [1, 2, 'hi ', 'there '], () => 'world');
   *
   * ... will create a Map with a structure like:
   *
   *     { 1: { 2: { 'hi ': { 'there ': 'world' } } } }
   */
  function multiKeyPutIfAbsent(map, keys, valueFn) {
    for (let k of keys) {
      let value = map.get(k);
      if (!value) {
        // TODO(jmesserly): most of these maps are very small (e.g. 1 item),
        // so it may be worth optimizing for that.
        map.set(k, value = new Map());
      }
      map = value;
    }
    if (map.has(_value)) return map.get(_value);
    let value = valueFn();
    map.set(_value, value);
    return value;
  }

  /** The global constant table. */
  const constants = new Map();

  /**
   * Canonicalize a constant object.
   *
   * Preconditions:
   * - `obj` is an objects or array, not a primitive.
   * - nested values of the object are themselves already canonicalized.
   */
  function constant(obj) {
    let objectKey = [rtti.realRuntimeType(obj)];
    // TODO(jmesserly): there's no guarantee in JS that names/symbols are
    // returned in the same order.
    //
    // We could probably get the same order if we're judicious about
    // initializing fields in a consistent order across all const constructors.
    // Alternatively we need a way to sort them to make consistent.
    //
    // Right now we use the (name,value) pairs in sequence, which prevents
    // an object with incorrect field values being returned, but won't
    // canonicalize correctly if key order is different.
    for (let name of getOwnNamesAndSymbols(obj)) {
      objectKey.push(name);
      objectKey.push(obj[name]);
    }
    return multiKeyPutIfAbsent(constants, objectKey, () => obj);
  }
  exports.const = constant;


  // The following are helpers for Object methods when the receiver
  // may be null or primitive.  These should only be generated by
  // the compiler.
  function hashCode(obj) {
    if (obj == null) {
      return 0;
    }
    // TODO(vsm): What should we do for primitives and non-Dart objects?
    switch (typeof obj) {
    case "number":
    case "boolean":
      return obj & 0x1FFFFFFF;
    case "string":
        // TODO(vsm): Call the JSString hashCode?
      return obj.length;
    }
    return obj.hashCode;
  }
  exports.hashCode = hashCode;

  function toString(obj) {
    if (obj == null) {
      return "null";
    }
    return obj.toString();
  }
  exports.toString = toString;

  function noSuchMethod(obj, invocation) {
    if (obj == null) {
      errors.throwNoSuchMethod(obj, invocation.memberName,
        invocation.positionalArguments, invocation.namedArguments);
    }
    switch (typeof obj) {
      case "number":
      case "boolean":
      case "string":
        errors.throwNoSuchMethod(obj, invocation.memberName,
          invocation.positionalArguments, invocation.namedArguments);
    }
    return obj.noSuchMethod(invocation);
  }
  exports.noSuchMethod = noSuchMethod;

  class JsIterator {
    constructor(dartIterator) {
      this.dartIterator = dartIterator;
    }
    next() {
      let i = this.dartIterator;
      let done = !i.moveNext();
      return { done: done, value: done ? void 0 : i.current };
    }
  }
  exports.JsIterator = JsIterator;


});
