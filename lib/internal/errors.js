/* eslint node-core/documented-errors: "error" */
/* eslint node-core/alphabetize-errors: "error" */
/* eslint node-core/prefer-util-format-errors: "error" */

'use strict';

// The whole point behind this internal module is to allow Node.js to no
// longer be forced to treat every error message change as a semver-major
// change. The NodeError classes here all expose a `code` property whose
// value statically and permanently identifies the error. While the error
// message may change, the code should not.

const kCode = Symbol('code');
const kInfo = Symbol('info');
const messages = new Map();
const codes = {};

var green = '';
var red = '';
var white = '';

const {
  errmap,
  UV_EAI_MEMORY,
  UV_EAI_NODATA,
  UV_EAI_NONAME
} = process.binding('uv');
const { kMaxLength } = process.binding('buffer');
const { defineProperty } = Object;

// Lazily loaded
var util_ = null;
var buffer;

function lazyUtil() {
  if (!util_) {
    util_ = require('util');
  }
  return util_;
}

var internalUtil = null;
function lazyInternalUtil() {
  if (!internalUtil) {
    internalUtil = require('internal/util');
  }
  return internalUtil;
}

function makeNodeError(Base) {
  return class NodeError extends Base {
    constructor(key, ...args) {
      super(message(key, args));
      defineProperty(this, kCode, {
        configurable: true,
        enumerable: false,
        value: key,
        writable: true
      });
    }

    get name() {
      return `${super.name} [${this[kCode]}]`;
    }

    set name(value) {
      defineProperty(this, 'name', {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }

    get code() {
      return this[kCode];
    }

    set code(value) {
      defineProperty(this, 'code', {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }
  };
}

function makeNodeErrorWithCode(Base, key) {
  return class NodeError extends Base {
    constructor(...args) {
      super(message(key, args));
    }

    get name() {
      return `${super.name} [${key}]`;
    }

    set name(value) {
      defineProperty(this, 'name', {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }

    get code() {
      return key;
    }

    set code(value) {
      defineProperty(this, 'code', {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    }
  };
}

// Utility function for registering the error codes. Only used here. Exported
// *only* to allow for testing.
function E(sym, val, def, ...otherClasses) {
  messages.set(sym, val);
  if (def === undefined) return;
  def = makeNodeErrorWithCode(def, sym);
  if (otherClasses.length !== 0) {
    otherClasses.forEach((clazz) => {
      def[clazz.name] = makeNodeErrorWithCode(clazz, sym);
    });
  }
  codes[sym] = def;
}

function lazyBuffer() {
  if (buffer === undefined)
    buffer = require('buffer').Buffer;
  return buffer;
}

// A specialized Error that includes an additional info property with
// additional information about the error condition. The code key will
// be extracted from the context object or the ERR_SYSTEM_ERROR default
// will be used.
class SystemError extends makeNodeError(Error) {
  constructor(context) {
    context = context || {};
    let code = 'ERR_SYSTEM_ERROR';
    if (messages.has(context.code))
      code = context.code;
    super(code,
          context.code,
          context.syscall,
          context.path,
          context.dest,
          context.message);
    Object.defineProperty(this, kInfo, {
      configurable: false,
      enumerable: false,
      value: context
    });
  }

  get info() {
    return this[kInfo];
  }

  get errno() {
    return this[kInfo].errno;
  }

  set errno(val) {
    this[kInfo].errno = val;
  }

  get syscall() {
    return this[kInfo].syscall;
  }

  set syscall(val) {
    this[kInfo].syscall = val;
  }

  get path() {
    return this[kInfo].path !== undefined ?
      this[kInfo].path.toString() : undefined;
  }

  set path(val) {
    this[kInfo].path = val ?
      lazyBuffer().from(val.toString()) : undefined;
  }

  get dest() {
    return this[kInfo].path !== undefined ?
      this[kInfo].dest.toString() : undefined;
  }

  set dest(val) {
    this[kInfo].dest = val ?
      lazyBuffer().from(val.toString()) : undefined;
  }
}

function createErrDiff(actual, expected, operator) {
  var other = '';
  var res = '';
  var lastPos = 0;
  var end = '';
  var skipped = false;
  const util = lazyUtil();
  const actualLines = util
    .inspect(actual, { compact: false, customInspect: false }).split('\n');
  const expectedLines = util
    .inspect(expected, { compact: false, customInspect: false }).split('\n');
  const msg = `Input A expected to ${operator} input B:\n` +
        `${green}+ expected${white} ${red}- actual${white}`;
  const skippedMsg = ' ... Lines skipped';

  // Remove all ending lines that match (this optimizes the output for
  // readability by reducing the number of total changed lines).
  var a = actualLines[actualLines.length - 1];
  var b = expectedLines[expectedLines.length - 1];
  var i = 0;
  while (a === b) {
    if (i++ < 2) {
      end = `\n  ${a}${end}`;
    } else {
      other = a;
    }
    actualLines.pop();
    expectedLines.pop();
    if (actualLines.length === 0 || expectedLines.length === 0)
      break;
    a = actualLines[actualLines.length - 1];
    b = expectedLines[expectedLines.length - 1];
  }
  if (i > 3) {
    end = `\n...${end}`;
    skipped = true;
  }
  if (other !== '') {
    end = `\n  ${other}${end}`;
    other = '';
  }

  const maxLines = Math.max(actualLines.length, expectedLines.length);
  var printedLines = 0;
  for (i = 0; i < maxLines; i++) {
    // Only extra expected lines exist
    const cur = i - lastPos;
    if (actualLines.length < i + 1) {
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += '\n...';
          skipped = true;
        } else if (cur > 3) {
          res += `\n  ${expectedLines[i - 2]}`;
          printedLines++;
        }
        res += `\n  ${expectedLines[i - 1]}`;
        printedLines++;
      }
      lastPos = i;
      other += `\n${green}+${white} ${expectedLines[i]}`;
      printedLines++;
    // Only extra actual lines exist
    } else if (expectedLines.length < i + 1) {
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += '\n...';
          skipped = true;
        } else if (cur > 3) {
          res += `\n  ${actualLines[i - 2]}`;
          printedLines++;
        }
        res += `\n  ${actualLines[i - 1]}`;
        printedLines++;
      }
      lastPos = i;
      res += `\n${red}-${white} ${actualLines[i]}`;
      printedLines++;
    // Lines diverge
    } else if (actualLines[i] !== expectedLines[i]) {
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += '\n...';
          skipped = true;
        } else if (cur > 3) {
          res += `\n  ${actualLines[i - 2]}`;
          printedLines++;
        }
        res += `\n  ${actualLines[i - 1]}`;
        printedLines++;
      }
      lastPos = i;
      res += `\n${red}-${white} ${actualLines[i]}`;
      other += `\n${green}+${white} ${expectedLines[i]}`;
      printedLines += 2;
    // Lines are identical
    } else {
      res += other;
      other = '';
      if (cur === 1 || i === 0) {
        res += `\n  ${actualLines[i]}`;
        printedLines++;
      }
    }
    // Inspected object to big (Show ~20 rows max)
    if (printedLines > 20 && i < maxLines - 2) {
      return `${msg}${skippedMsg}\n${res}\n...${other}\n...`;
    }
  }
  return `${msg}${skipped ? skippedMsg : ''}\n${res}${other}${end}`;
}

class AssertionError extends Error {
  constructor(options) {
    if (typeof options !== 'object' || options === null) {
      throw new exports.TypeError('ERR_INVALID_ARG_TYPE', 'options', 'Object');
    }
    var {
      actual,
      expected,
      message,
      operator,
      stackStartFn,
      errorDiff = 0
    } = options;

    if (message != null) {
      super(message);
    } else {
      if (util_ === null &&
          process.stdout.isTTY &&
          process.stdout.getColorDepth() !== 1) {
        green = '\u001b[32m';
        white = '\u001b[39m';
        red = '\u001b[31m';
      }
      const util = lazyUtil();

      if (actual && actual.stack && actual instanceof Error)
        actual = `${actual.name}: ${actual.message}`;
      if (expected && expected.stack && expected instanceof Error)
        expected = `${expected.name}: ${expected.message}`;

      if (errorDiff === 0) {
        let res = util.inspect(actual);
        let other = util.inspect(expected);
        if (res.length > 128)
          res = `${res.slice(0, 125)}...`;
        if (other.length > 128)
          other = `${other.slice(0, 125)}...`;
        super(`${res} ${operator} ${other}`);
      } else if (errorDiff === 1) {
        // In case the objects are equal but the operator requires unequal, show
        // the first object and say A equals B
        const res = util.inspect(
          actual,
          { compact: false, customInspect: false }
        ).split('\n');

        if (res.length > 20) {
          res[19] = '...';
          while (res.length > 20) {
            res.pop();
          }
        }
        // Only print a single object.
        super(`Identical input passed to ${operator}:\n${res.join('\n')}`);
      } else {
        super(createErrDiff(actual, expected, operator));
      }
    }

    this.generatedMessage = !message;
    this.name = 'AssertionError [ERR_ASSERTION]';
    this.code = 'ERR_ASSERTION';
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;
    Error.captureStackTrace(this, stackStartFn);
  }
}

// This is defined here instead of using the assert module to avoid a
// circular dependency. The effect is largely the same.
function internalAssert(condition, message) {
  if (!condition) {
    throw new AssertionError({
      message,
      actual: false,
      expected: true,
      operator: '=='
    });
  }
}

function message(key, args) {
  const msg = messages.get(key);
  internalAssert(msg, `An invalid error message key was used: ${key}.`);
  let fmt;
  if (typeof msg === 'function') {
    fmt = msg;
  } else {
    const util = lazyUtil();
    fmt = util.format;
    if (args === undefined || args.length === 0)
      return msg;
    args.unshift(msg);
  }
  return String(fmt.apply(null, args));
}

/**
 * This creates an error compatible with errors produced in the C++
 * function UVException using a context object with data assembled in C++.
 * The goal is to migrate them to ERR_* errors later when compatibility is
 * not a concern.
 *
 * @param {Object} ctx
 * @returns {Error}
 */
function uvException(ctx) {
  const [ code, uvmsg ] = errmap.get(ctx.errno);
  let message = `${code}: ${uvmsg}, ${ctx.syscall}`;

  let path;
  let dest;
  if (ctx.path) {
    path = ctx.path.toString();
    message += ` '${path}'`;
  }
  if (ctx.dest) {
    dest = ctx.dest.toString();
    message += ` -> '${dest}'`;
  }

  // Pass the message to the constructor instead of setting it on the object
  // to make sure it is the same as the one created in C++
  const err = new Error(message);

  for (const prop of Object.keys(ctx)) {
    if (prop === 'message' || prop === 'path' || prop === 'dest') {
      continue;
    }
    err[prop] = ctx[prop];
  }

  err.code = code;
  if (path) {
    err.path = path;
  }
  if (dest) {
    err.dest = dest;
  }

  Error.captureStackTrace(err, uvException);
  return err;
}

/**
 * This used to be util._errnoException().
 *
 * @param {number} err - A libuv error number
 * @param {string} syscall
 * @param {string} [original]
 * @returns {Error}
 */
function errnoException(err, syscall, original) {
  // TODO(joyeecheung): We have to use the type-checked
  // getSystemErrorName(err) to guard against invalid arguments from users.
  // This can be replaced with [ code ] = errmap.get(err) when this method
  // is no longer exposed to user land.
  const code = lazyUtil().getSystemErrorName(err);
  const message = original ?
    `${syscall} ${code} ${original}` : `${syscall} ${code}`;

  const ex = new Error(message);
  // TODO(joyeecheung): errno is supposed to err, like in uvException
  ex.code = ex.errno = code;
  ex.syscall = syscall;

  Error.captureStackTrace(ex, errnoException);
  return ex;
}

/**
 * This used to be util._exceptionWithHostPort().
 *
 * @param {number} err - A libuv error number
 * @param {string} syscall
 * @param {string} address
 * @param {number} [port]
 * @param {string} [additional]
 * @returns {Error}
 */
function exceptionWithHostPort(err, syscall, address, port, additional) {
  // TODO(joyeecheung): We have to use the type-checked
  // getSystemErrorName(err) to guard against invalid arguments from users.
  // This can be replaced with [ code ] = errmap.get(err) when this method
  // is no longer exposed to user land.
  const code = lazyUtil().getSystemErrorName(err);
  let details = '';
  if (port && port > 0) {
    details = ` ${address}:${port}`;
  } else if (address) {
    details = ` ${address}`;
  }
  if (additional) {
    details += ` - Local (${additional})`;
  }

  const ex = new Error(`${syscall} ${code}${details}`);
  // TODO(joyeecheung): errno is supposed to err, like in uvException
  ex.code = ex.errno = code;
  ex.syscall = syscall;
  ex.address = address;
  if (port) {
    ex.port = port;
  }

  Error.captureStackTrace(ex, exceptionWithHostPort);
  return ex;
}

/**
 * @param {number|string} err - A libuv error number or a c-ares error code
 * @param {string} syscall
 * @param {string} [hostname]
 * @returns {Error}
 */
function dnsException(err, syscall, hostname) {
  const ex = new Error();
  // FIXME(bnoordhuis) Remove this backwards compatibility nonsense and pass
  // the true error to the user. ENOTFOUND is not even a proper POSIX error!
  if (err === UV_EAI_MEMORY ||
      err === UV_EAI_NODATA ||
      err === UV_EAI_NONAME) {
    err = 'ENOTFOUND';  // Fabricated error name.
  }
  if (typeof err === 'string') {  // c-ares error code.
    const errHost = hostname ? ` ${hostname}` : '';
    ex.message = `${syscall} ${err}${errHost}`;
    // TODO(joyeecheung): errno is supposed to be a number, like in uvException
    ex.code = ex.errno = err;
    ex.syscall = syscall;
  } else {  // libuv error number
    const code = lazyInternalUtil().getSystemErrorName(err);
    ex.message = `${syscall} ${code}`;
    // TODO(joyeecheung): errno is supposed to be err, like in uvException
    ex.code = ex.errno = code;
    ex.syscall = syscall;
  }
  if (hostname) {
    ex.hostname = hostname;
  }
  Error.captureStackTrace(ex, dnsException);
  return ex;
}

module.exports = exports = {
  dnsException,
  errnoException,
  exceptionWithHostPort,
  uvException,
  message,
  Error: makeNodeError(Error),
  TypeError: makeNodeError(TypeError),
  RangeError: makeNodeError(RangeError),
  URIError: makeNodeError(URIError),
  AssertionError,
  SystemError,
  codes,
  E, // This is exported only to facilitate testing.
  errorCache: new Map() // This is in here only to facilitate testing.
};

// To declare an error message, use the E(sym, val) function above. The sym
// must be an upper case string. The val can be either a function or a string.
// The return value of the function must be a string.
// Examples:
// E('EXAMPLE_KEY1', 'This is the error value');
// E('EXAMPLE_KEY2', (a, b) => return `${a} ${b}`);
//
// Once an error code has been assigned, the code itself MUST NOT change and
// any given error code must never be reused to identify a different error.
//
// Any error code added here should also be added to the documentation
//
// Note: Please try to keep these in alphabetical order
//
// Note: Node.js specific errors must begin with the prefix ERR_

E('ERR_ARG_NOT_ITERABLE', '%s must be iterable', TypeError);
E('ERR_ASSERTION', '%s', AssertionError);
E('ERR_ASYNC_CALLBACK', '%s must be a function', TypeError);
E('ERR_ASYNC_TYPE', 'Invalid name for async "type": %s', TypeError);
E('ERR_BUFFER_OUT_OF_BOUNDS', bufferOutOfBounds, RangeError);
E('ERR_BUFFER_TOO_LARGE',
  `Cannot create a Buffer larger than 0x${kMaxLength.toString(16)} bytes`,
  RangeError);
E('ERR_CANNOT_WATCH_SIGINT', 'Cannot watch for SIGINT signals', Error);
E('ERR_CHILD_CLOSED_BEFORE_REPLY',
  'Child closed before reply received', Error);
E('ERR_CHILD_PROCESS_IPC_REQUIRED',
  "Forked processes must have an IPC channel, missing value 'ipc' in %s",
  Error);
E('ERR_CHILD_PROCESS_STDIO_MAXBUFFER', '%s maxBuffer length exceeded',
  RangeError);
E('ERR_CONSOLE_WRITABLE_STREAM',
  'Console expects a writable stream instance for %s', TypeError);
E('ERR_CPU_USAGE', 'Unable to obtain cpu usage %s', Error);
E('ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED',
  'Custom engines not supported by this OpenSSL', Error);
E('ERR_CRYPTO_ECDH_INVALID_FORMAT', 'Invalid ECDH format: %s', TypeError);
E('ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY',
  'Public key is not valid for specified curve', TypeError);
E('ERR_CRYPTO_ENGINE_UNKNOWN', 'Engine "%s" was not found', Error);
E('ERR_CRYPTO_FIPS_FORCED',
  'Cannot set FIPS mode, it was forced with --force-fips at startup.', Error);
E('ERR_CRYPTO_FIPS_UNAVAILABLE', 'Cannot set FIPS mode in a non-FIPS build.',
  Error);
E('ERR_CRYPTO_HASH_DIGEST_NO_UTF16', 'hash.digest() does not support UTF-16',
  Error);
E('ERR_CRYPTO_HASH_FINALIZED', 'Digest already called', Error);
E('ERR_CRYPTO_HASH_UPDATE_FAILED', 'Hash update failed', Error);
E('ERR_CRYPTO_INVALID_DIGEST', 'Invalid digest: %s', TypeError);
E('ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation %s', Error);

// Switch to TypeError. The current implementation does not seem right.
E('ERR_CRYPTO_SIGN_KEY_REQUIRED', 'No key provided to sign', Error);
E('ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH',
  'Input buffers must have the same length', RangeError);
E('ERR_DNS_SET_SERVERS_FAILED', 'c-ares failed to set servers: "%s" [%s]',
  Error);
E('ERR_DOMAIN_CALLBACK_NOT_AVAILABLE',
  'A callback was registered through ' +
     'process.setUncaughtExceptionCaptureCallback(), which is mutually ' +
     'exclusive with using the `domain` module',
  Error);
E('ERR_DOMAIN_CANNOT_SET_UNCAUGHT_EXCEPTION_CAPTURE',
  'The `domain` module is in use, which is mutually exclusive with calling ' +
     'process.setUncaughtExceptionCaptureCallback()',
  Error);
E('ERR_ENCODING_INVALID_ENCODED_DATA',
  'The encoded data was not valid for encoding %s', TypeError);
E('ERR_ENCODING_NOT_SUPPORTED', 'The "%s" encoding is not supported',
  RangeError); // One entry is currently falsy implemented as "Error"
E('ERR_FALSY_VALUE_REJECTION', 'Promise was rejected with falsy value', Error);
E('ERR_FS_INVALID_SYMLINK_TYPE',
  'Symlink type must be one of "dir", "file", or "junction". Received "%s"',
  Error); // Switch to TypeError. The current implementation does not seem right
E('ERR_HTTP2_ALTSVC_INVALID_ORIGIN',
  'HTTP/2 ALTSVC frames require a valid origin', TypeError);
E('ERR_HTTP2_ALTSVC_LENGTH',
  'HTTP/2 ALTSVC frames are limited to 16382 bytes', TypeError);
E('ERR_HTTP2_CONNECT_AUTHORITY',
  ':authority header is required for CONNECT requests', Error);
E('ERR_HTTP2_CONNECT_PATH',
  'The :path header is forbidden for CONNECT requests', Error);
E('ERR_HTTP2_CONNECT_SCHEME',
  'The :scheme header is forbidden for CONNECT requests', Error);
E('ERR_HTTP2_GOAWAY_SESSION',
  'New streams cannot be created after receiving a GOAWAY', Error);
E('ERR_HTTP2_HEADERS_AFTER_RESPOND',
  'Cannot specify additional headers after response initiated', Error);
E('ERR_HTTP2_HEADERS_SENT', 'Response has already been initiated.', Error);

// This should probably be a `TypeError`.
E('ERR_HTTP2_HEADER_SINGLE_VALUE',
  'Header field "%s" must have only a single value', Error);
E('ERR_HTTP2_INFO_STATUS_NOT_ALLOWED',
  'Informational status codes cannot be used', RangeError);

// This should probably be a `TypeError`.
E('ERR_HTTP2_INVALID_CONNECTION_HEADERS',
  'HTTP/1 Connection specific headers are forbidden: "%s"', Error);
E('ERR_HTTP2_INVALID_HEADER_VALUE',
  'Invalid value "%s" for header "%s"', TypeError);
E('ERR_HTTP2_INVALID_INFO_STATUS',
  'Invalid informational status code: %s', RangeError);
E('ERR_HTTP2_INVALID_PACKED_SETTINGS_LENGTH',
  'Packed settings length must be a multiple of six', RangeError);

// This should probably be a `TypeError`.
E('ERR_HTTP2_INVALID_PSEUDOHEADER',
  '"%s" is an invalid pseudoheader or is used incorrectly', Error);
E('ERR_HTTP2_INVALID_SESSION', 'The session has been destroyed', Error);
E('ERR_HTTP2_INVALID_SETTING_VALUE',
  'Invalid value for setting "%s": %s', TypeError, RangeError);
E('ERR_HTTP2_INVALID_STREAM', 'The stream has been destroyed', Error);
E('ERR_HTTP2_MAX_PENDING_SETTINGS_ACK',
  'Maximum number of pending settings acknowledgements (%s)', Error);
E('ERR_HTTP2_NO_SOCKET_MANIPULATION',
  'HTTP/2 sockets should not be directly manipulated (e.g. read and written)',
  Error);
E('ERR_HTTP2_OUT_OF_STREAMS',
  'No stream ID is available because maximum stream ID has been reached',
  Error);
E('ERR_HTTP2_PAYLOAD_FORBIDDEN',
  'Responses with %s status must not have a payload', Error);
E('ERR_HTTP2_PING_CANCEL', 'HTTP2 ping cancelled', Error);
E('ERR_HTTP2_PING_LENGTH', 'HTTP2 ping payload must be 8 bytes', RangeError);

// This should probably be a `TypeError`.
E('ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED',
  'Cannot set HTTP/2 pseudo-headers', Error);
E('ERR_HTTP2_PUSH_DISABLED', 'HTTP/2 client has disabled push streams', Error);
E('ERR_HTTP2_SEND_FILE', 'Only regular files can be sent', Error);
E('ERR_HTTP2_SESSION_ERROR', 'Session closed with error code %s', Error);
E('ERR_HTTP2_SOCKET_BOUND',
  'The socket is already bound to an Http2Session', Error);
E('ERR_HTTP2_STATUS_101',
  'HTTP status code 101 (Switching Protocols) is forbidden in HTTP/2', Error);
E('ERR_HTTP2_STATUS_INVALID', 'Invalid status code: %s', RangeError);
E('ERR_HTTP2_STREAM_CANCEL', 'The pending stream has been canceled', Error);
E('ERR_HTTP2_STREAM_ERROR', 'Stream closed with error code %s', Error);
E('ERR_HTTP2_STREAM_SELF_DEPENDENCY',
  'A stream cannot depend on itself', Error);
E('ERR_HTTP2_UNSUPPORTED_PROTOCOL', 'protocol "%s" is unsupported.', Error);
E('ERR_HTTP_HEADERS_SENT',
  'Cannot %s headers after they are sent to the client', Error);
E('ERR_HTTP_INVALID_HEADER_VALUE',
  'Invalid value "%s" for header "%s"', TypeError);
E('ERR_HTTP_INVALID_STATUS_CODE', 'Invalid status code: %s', RangeError);
E('ERR_HTTP_TRAILER_INVALID',
  'Trailers are invalid with this transfer encoding', Error);
E('ERR_INDEX_OUT_OF_RANGE', 'Index out of range', RangeError);
E('ERR_INSPECTOR_ALREADY_CONNECTED',
  'The inspector is already connected', Error);
E('ERR_INSPECTOR_CLOSED', 'Session was closed', Error);
E('ERR_INSPECTOR_NOT_AVAILABLE', 'Inspector is not available', Error);
E('ERR_INSPECTOR_NOT_CONNECTED', 'Session is not connected', Error);
E('ERR_INVALID_ARG_TYPE', invalidArgType, TypeError);
E('ERR_INVALID_ARG_VALUE', (name, value, reason = 'is invalid') => {
  const util = lazyUtil();
  let inspected = util.inspect(value);
  if (inspected.length > 128) {
    inspected = inspected.slice(0, 128) + '...';
  }
  return `The argument '${name}' ${reason}. Received ${inspected}`;
}, TypeError, RangeError); // Some are currently falsy implemented as "Error"
E('ERR_INVALID_ARRAY_LENGTH',
  (name, len, actual) => {
    internalAssert(typeof actual === 'number', 'actual must be a number');
    return `The array "${name}" (length ${actual}) must be of length ${len}.`;
  }, TypeError);
E('ERR_INVALID_ASYNC_ID', 'Invalid %s value: %s', RangeError);
E('ERR_INVALID_BUFFER_SIZE',
  'Buffer size must be a multiple of %s', RangeError);
E('ERR_INVALID_CALLBACK', 'Callback must be a function', TypeError);
E('ERR_INVALID_CHAR', invalidChar, TypeError); //Check falsy "Error" entries.

// This should probably be a `TypeError`.
E('ERR_INVALID_CURSOR_POS',
  'Cannot set cursor row without setting its column', Error);

// This should probably be a `TypeError`.
E('ERR_INVALID_DOMAIN_NAME', 'Unable to determine the domain name', Error);
E('ERR_INVALID_FD',
  '"fd" must be a positive integer: %s', RangeError);
E('ERR_INVALID_FD_TYPE', 'Unsupported fd type: %s', TypeError);
E('ERR_INVALID_FILE_URL_HOST',
  'File URL host must be "localhost" or empty on %s', TypeError);
E('ERR_INVALID_FILE_URL_PATH', 'File URL path %s', TypeError);
E('ERR_INVALID_HANDLE_TYPE', 'This handle type cannot be sent', TypeError);
E('ERR_INVALID_HTTP_TOKEN', '%s must be a valid HTTP token ["%s"]', TypeError);
// The `Error` should probably be a `TypeError`.
E('ERR_INVALID_IP_ADDRESS', 'Invalid IP address: %s', TypeError, Error);
E('ERR_INVALID_OPT_VALUE', (name, value) =>
  `The value "${String(value)}" is invalid for option "${name}"`,
  TypeError,
  RangeError);
E('ERR_INVALID_OPT_VALUE_ENCODING',
  'The value "%s" is invalid for option "encoding"', TypeError);
E('ERR_INVALID_PERFORMANCE_MARK',
  'The "%s" performance mark has not been set', Error);

// This should probably be a `TypeError`.
E('ERR_INVALID_PROTOCOL', 'Protocol "%s" not supported. Expected "%s"', Error);

// This should probably be a `TypeError`.
E('ERR_INVALID_REPL_EVAL_CONFIG',
  'Cannot specify both "breakEvalOnSigint" and "eval" for REPL', Error);
E('ERR_INVALID_SYNC_FORK_INPUT',
  'Asynchronous forks do not support Buffer, Uint8Array or string input: %s',
  TypeError);
E('ERR_INVALID_THIS', 'Value of "this" must be of type %s', TypeError);
E('ERR_INVALID_TUPLE', '%s must be an iterable %s tuple', TypeError);
E('ERR_INVALID_URI', 'URI malformed', URIError);
E('ERR_INVALID_URL', 'Invalid URL: %s', TypeError);
E('ERR_INVALID_URL_SCHEME',
  (expected) => `The URL must be ${oneOf(expected, 'scheme')}`, TypeError);
E('ERR_IPC_CHANNEL_CLOSED', 'Channel closed', Error);
E('ERR_IPC_DISCONNECTED', 'IPC channel is already disconnected', Error);
E('ERR_IPC_ONE_PIPE', 'Child process can have only one IPC pipe', Error);
E('ERR_IPC_SYNC_FORK', 'IPC cannot be used with synchronous forks', Error);
E('ERR_METHOD_NOT_IMPLEMENTED', 'The %s method is not implemented', Error);
E('ERR_MISSING_ARGS', missingArgs, TypeError);
E('ERR_MISSING_MODULE', 'Cannot find module %s', Error);
E('ERR_MODULE_RESOLUTION_LEGACY',
  '%s not found by import in %s.' +
    ' Legacy behavior in require() would have found it at %s',
  Error);
E('ERR_MULTIPLE_CALLBACK', 'Callback called multiple times', Error);
E('ERR_NAPI_CONS_FUNCTION', 'Constructor must be a function', TypeError);
E('ERR_NAPI_INVALID_DATAVIEW_ARGS',
  'byte_offset + byte_length should be less than or eqaul to the size in ' +
    'bytes of the array passed in',
  RangeError);
E('ERR_NAPI_INVALID_TYPEDARRAY_ALIGNMENT',
  'start offset of %s should be a multiple of %s', RangeError);
E('ERR_NAPI_INVALID_TYPEDARRAY_LENGTH',
  'Invalid typed array length', RangeError);
E('ERR_NO_CRYPTO',
  'Node.js is not compiled with OpenSSL crypto support', Error);
E('ERR_NO_ICU',
  '%s is not supported on Node.js compiled without ICU', TypeError);
E('ERR_NO_LONGER_SUPPORTED', '%s is no longer supported', Error);
E('ERR_OUT_OF_RANGE', outOfRange, RangeError);
E('ERR_REQUIRE_ESM', 'Must use import to load ES Module: %s', Error);
E('ERR_SCRIPT_EXECUTION_INTERRUPTED',
  'Script execution was interrupted by `SIGINT`.', Error);
E('ERR_SERVER_ALREADY_LISTEN',
  'Listen method has been called more than once without closing.', Error);
E('ERR_SERVER_NOT_RUNNING', 'Server is not running.', Error);
E('ERR_SOCKET_ALREADY_BOUND', 'Socket is already bound', Error);
E('ERR_SOCKET_BAD_BUFFER_SIZE',
  'Buffer size must be a positive integer', TypeError);
E('ERR_SOCKET_BAD_PORT',
  'Port should be > 0 and < 65536. Received %s.', RangeError);
E('ERR_SOCKET_BAD_TYPE',
  'Bad socket type specified. Valid types are: udp4, udp6', TypeError);
E('ERR_SOCKET_BUFFER_SIZE', 'Could not get or set buffer size: %s', Error);
E('ERR_SOCKET_CANNOT_SEND', 'Unable to send data', Error);
E('ERR_SOCKET_CLOSED', 'Socket is closed', Error);
E('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running', Error);
E('ERR_STDERR_CLOSE', 'process.stderr cannot be closed', Error);
E('ERR_STDOUT_CLOSE', 'process.stdout cannot be closed', Error);
E('ERR_STREAM_CANNOT_PIPE', 'Cannot pipe, not readable', Error);
E('ERR_STREAM_NULL_VALUES', 'May not write null values to stream', TypeError);
E('ERR_STREAM_PUSH_AFTER_EOF', 'stream.push() after EOF', Error);
E('ERR_STREAM_READ_NOT_IMPLEMENTED', '_read() is not implemented', Error);
E('ERR_STREAM_UNSHIFT_AFTER_END_EVENT',
  'stream.unshift() after end event', Error);
E('ERR_STREAM_WRAP', 'Stream has StringDecoder set or is in objectMode', Error);
E('ERR_STREAM_WRITE_AFTER_END', 'write after end', Error);
E('ERR_SYSTEM_ERROR', sysError);
E('ERR_TLS_CERT_ALTNAME_INVALID',
  'Hostname/IP does not match certificate\'s altnames: %s', Error);
E('ERR_TLS_DH_PARAM_SIZE', 'DH parameter size %s is less than 2048', Error);
E('ERR_TLS_HANDSHAKE_TIMEOUT', 'TLS handshake timeout', Error);
E('ERR_TLS_RENEGOTIATION_DISABLED',
  'TLS session renegotiation disabled for this socket', Error);

// This should probably be a `TypeError`.
E('ERR_TLS_REQUIRED_SERVER_NAME',
  '"servername" is required parameter for Server.addContext', Error);
E('ERR_TLS_SESSION_ATTACK', 'TLS session renegotiation attack detected', Error);
E('ERR_TLS_SNI_FROM_SERVER',
  'Cannot issue SNI from a TLS server-side socket', Error);
E('ERR_TRANSFORM_ALREADY_TRANSFORMING',
  'Calling transform done when still transforming', Error);

// This should probably be a `RangeError`.
E('ERR_TRANSFORM_WITH_LENGTH_0',
  'Calling transform done when writableState.length != 0', Error);
E('ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET',
  '`process.setupUncaughtExceptionCapture()` was called while a capture ' +
    'callback was already active',
  Error);
E('ERR_UNESCAPED_CHARACTERS', '%s contains unescaped characters', TypeError);
E('ERR_UNHANDLED_ERROR',
  (err) => {
    const msg = 'Unhandled error.';
    if (err === undefined) return msg;
    return `${msg} (${err})`;
  }, Error);
E('ERR_UNKNOWN_ENCODING', 'Unknown encoding: %s', TypeError);

// This should probably be a `TypeError`.
E('ERR_UNKNOWN_FILE_EXTENSION', 'Unknown file extension: %s', Error);
E('ERR_UNKNOWN_MODULE_FORMAT', 'Unknown module format: %s', RangeError);
E('ERR_UNKNOWN_SIGNAL', 'Unknown signal: %s', TypeError);
E('ERR_UNKNOWN_STDIN_TYPE', 'Unknown stdin file type', Error);

// This should probably be a `TypeError`.
E('ERR_UNKNOWN_STREAM_TYPE', 'Unknown stream file type', Error);
E('ERR_V8BREAKITERATOR',
  'Full ICU data not installed. See https://github.com/nodejs/node/wiki/Intl',
  Error);

// This should probably be a `TypeError`.
E('ERR_VALID_PERFORMANCE_ENTRY_TYPE',
  'At least one valid performance entry type is required', Error);
E('ERR_VM_MODULE_ALREADY_LINKED', 'Module has already been linked', Error);
E('ERR_VM_MODULE_DIFFERENT_CONTEXT',
  'Linked modules must use the same context', Error);
E('ERR_VM_MODULE_LINKING_ERRORED',
  'Linking has already failed for the provided module', Error);
E('ERR_VM_MODULE_NOT_LINKED',
  'Module must be linked before it can be instantiated', Error);
E('ERR_VM_MODULE_NOT_MODULE',
  'Provided module is not an instance of Module', Error);
E('ERR_VM_MODULE_STATUS', 'Module status %s', Error);
E('ERR_ZLIB_BINDING_CLOSED', 'zlib binding closed', Error);
E('ERR_ZLIB_INITIALIZATION_FAILED', 'Initialization failed', Error);

function sysError(code, syscall, path, dest,
                  message = 'A system error occurred') {
  if (code !== undefined)
    message += `: ${code}`;
  if (syscall !== undefined) {
    if (code === undefined)
      message += ':';
    message += ` [${syscall}]`;
  }
  if (path !== undefined) {
    message += `: ${path}`;
    if (dest !== undefined)
      message += ` => ${dest}`;
  }
  return message;
}

function invalidArgType(name, expected, actual) {
  internalAssert(name, 'name is required');

  // determiner: 'must be' or 'must not be'
  let determiner;
  if (typeof expected === 'string' && expected.startsWith('not ')) {
    determiner = 'must not be';
    expected = expected.replace(/^not /, '');
  } else {
    determiner = 'must be';
  }

  let msg;
  if (Array.isArray(name)) {
    var names = name.map((val) => `"${val}"`).join(', ');
    msg = `The ${names} arguments ${determiner} ${oneOf(expected, 'type')}`;
  } else if (name.endsWith(' argument')) {
    // for the case like 'first argument'
    msg = `The ${name} ${determiner} ${oneOf(expected, 'type')}`;
  } else {
    const type = name.includes('.') ? 'property' : 'argument';
    msg = `The "${name}" ${type} ${determiner} ${oneOf(expected, 'type')}`;
  }

  // if actual value received, output it
  if (arguments.length >= 3) {
    msg += `. Received type ${actual !== null ? typeof actual : 'null'}`;
  }
  return msg;
}

function missingArgs(...args) {
  internalAssert(args.length > 0, 'At least one arg needs to be specified');
  let msg = 'The ';
  const len = args.length;
  args = args.map((a) => `"${a}"`);
  switch (len) {
    case 1:
      msg += `${args[0]} argument`;
      break;
    case 2:
      msg += `${args[0]} and ${args[1]} arguments`;
      break;
    default:
      msg += args.slice(0, len - 1).join(', ');
      msg += `, and ${args[len - 1]} arguments`;
      break;
  }
  return `${msg} must be specified`;
}

function oneOf(expected, thing) {
  internalAssert(expected, 'expected is required');
  internalAssert(typeof thing === 'string', 'thing is required');
  if (Array.isArray(expected)) {
    const len = expected.length;
    internalAssert(len > 0,
                   'At least one expected value needs to be specified');
    expected = expected.map((i) => String(i));
    if (len > 2) {
      return `one of ${thing} ${expected.slice(0, len - 1).join(', ')}, or ` +
             expected[len - 1];
    } else if (len === 2) {
      return `one of ${thing} ${expected[0]} or ${expected[1]}`;
    } else {
      return `of ${thing} ${expected[0]}`;
    }
  } else {
    return `of ${thing} ${String(expected)}`;
  }
}

function bufferOutOfBounds(name, isWriting) {
  if (isWriting) {
    return 'Attempt to write outside buffer bounds';
  } else {
    return `"${name}" is outside of buffer bounds`;
  }
}

function invalidChar(name, field) {
  let msg = `Invalid character in ${name}`;
  if (field) {
    msg += ` ["${field}"]`;
  }
  return msg;
}

function outOfRange(name, range, value) {
  let msg = `The value of "${name}" is out of range.`;
  if (range) msg += ` It must be ${range}.`;
  if (value !== undefined) msg += ` Received ${value}`;
  return msg;
}