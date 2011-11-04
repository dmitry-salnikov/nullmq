(function() {
  var Queue, Socket, Stomp, assert, nullmq;
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; }, __indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++) {
      if (this[i] === item) return i;
    }
    return -1;
  };
  nullmq = {
    PUB: 'pub',
    SUB: 'sub',
    REQ: 'req',
    REP: 'rep',
    XREQ: 'dealer',
    XREP: 'router',
    PULL: 'pull',
    PUSH: 'push',
    DEALER: 'dealer',
    ROUTER: 'router',
    HWM: 100,
    IDENTITY: 101,
    SUBSCRIBE: 102,
    UNSUBSCRIBE: 103
  };
  assert = function(description, condition) {
    if (condition == null) {
      condition = false;
    }
    if (!condition) {
      throw Error("Assertion: " + description);
    }
  };
  Queue = (function() {
    function Queue(maxsize) {
      this.maxsize = maxsize != null ? maxsize : null;
      this.queue = [];
      this.offset = 0;
      this.watches = [];
    }
    Queue.prototype.getLength = function() {
      return this.queue.length - this.offset;
    };
    Queue.prototype.isEmpty = function() {
      return this.queue.length === 0;
    };
    Queue.prototype.isFull = function() {
      if (this.maxsize === null) {
        return false;
      }
      return this.getLength() >= this.maxsize;
    };
    Queue.prototype.put = function(item) {
      var _base;
      if (!this.isFull()) {
        this.queue.push(item);
        if (typeof (_base = this.watches.shift()) === "function") {
          _base();
        }
        return item;
      } else {

      }
    };
    Queue.prototype.get = function() {
      var item;
      if (this.queue.length === 0) {
        return;
      }
      item = this.queue[this.offset];
      if (++this.offset * 2 >= this.queue.length) {
        this.queue = this.queue.slice(this.offset);
        this.offset = 0;
      }
      return item;
    };
    Queue.prototype.peek = function() {
      if (this.queue.length > 0) {
        return this.queue[this.offset];
      } else {
        return;
      }
    };
    Queue.prototype.watch = function(fn) {
      if (this.queue.length === 0) {
        return this.watches.push(fn);
      } else {
        return fn();
      }
    };
    return Queue;
  })();
  nullmq.Context = (function() {
    function Context(url, onconnect) {
      this.url = url;
      this.onconnect = onconnect;
      this.client = Stomp.client(this.url);
      this.client.connect("guest", "guest", this.onconnect);
      this.sockets = [];
    }
    Context.prototype.socket = function(type) {
      return new Socket(this, type);
    };
    Context.prototype.term = function() {
      var socket, _i, _len, _ref;
      assert("context is already connected", this.client.connected);
      _ref = this.sockets;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        socket = _ref[_i];
        socket.close();
      }
      return this.client.disconnect();
    };
    Context.prototype._send = function(socket, destination, message) {
      var headers, part, _i, _len;
      assert("context is already connected", this.client.connected);
      headers = {
        'socket': socket.type
      };
      if (socket.type === nullmq.REQ) {
        headers['reply-to'] = socket.connections[destination];
      }
      if (socket.type === nullmq.REP) {
        headers['reply-to'] = socket.last_recv.reply_to;
      }
      if (message instanceof Array) {
        headers['transaction'] = Math.random() + '';
        this.client.begin(transaction);
        for (_i = 0, _len = message.length; _i < _len; _i++) {
          part = message[_i];
          this.client.send(destination, headers, part);
        }
        return this.client.commit(transaction);
      } else {
        return this.client.send(destination, headers, message.toString());
      }
    };
    Context.prototype._subscribe = function(type, socket, destination) {
      var id;
      assert("context is already connected", this.client.connected);
      id = this.client.subscribe(destination, __bind(function(frame) {
        var envelope;
        envelope = {
          'message': frame.body,
          'destination': frame.destination
        };
        if (frame.headers['reply-to'] != null) {
          envelope['reply_to'] = frame.headers['reply-to'];
        }
        return socket.recv_queue.put(envelope);
      }, this), {
        'socket': socket.type,
        'type': type
      });
      return id;
    };
    Context.prototype._connect = function(socket, destination) {
      return this._subscribe('connect', socket, destination);
    };
    Context.prototype._bind = function(socket, destination) {
      return this._subscribe('bind', socket, destination);
    };
    return Context;
  })();
  Socket = (function() {
    function Socket(context, type) {
      var _ref;
      this.context = context;
      this.type = type;
      this._dispatch_outgoing = __bind(this._dispatch_outgoing, this);
      this.client = this.context.client;
      this.closed = false;
      this.recv_queue = new Queue();
      this.send_queue = new Queue();
      this.identity = null;
      this.linger = -1;
      this.filters = [];
      this.connections = {};
      this.rr_index = 0;
      this.last_recv = void 0;
      this.context.sockets.push(this);
      if ((_ref = this.type) === nullmq.REQ || _ref === nullmq.DEALER || _ref === nullmq.PUSH || _ref === nullmq.PUB || _ref === nullmq.ROUTER || _ref === nullmq.REP) {
        this.send_queue.watch(this._dispatch_outgoing);
      }
    }
    Socket.prototype.connect = function(destination) {
      var id;
      if (__indexOf.call(Object.keys(this.connections), destination) >= 0) {
        return;
      }
      id = this.context._connect(this, destination);
      return this.connections[destination] = id;
    };
    Socket.prototype.bind = function(destination) {
      var id;
      if (__indexOf.call(Object.keys(this.connections), destination) >= 0) {
        return;
      }
      id = this.context._bind(this, destination);
      return this.connections[destination] = id;
    };
    Socket.prototype.setsockopt = function(option, value) {
      var _ref;
      switch (option) {
        case nullmq.HWM:
          return this.hwm = value;
        case nullmq.IDENTITY:
          return this._identity(value);
        case nullmq.LINGER:
          return this.linger = value;
        case nullmq.SUBSCRIBE:
          if (this.type !== nullmq.SUB) {
            return;
          }
          if (_ref = !value, __indexOf.call(this.filters, _ref) >= 0) {
            this.filters.push(value);
          }
          return value;
        case nullmq.UNSUBSCRIBE:
          if (this.type !== nullmq.SUB) {
            return;
          }
          if (__indexOf.call(this.filters, value) >= 0) {
            this.filters.splice(this.filters.indexOf(value), 1);
          }
          return value;
        default:
          return;
      }
    };
    Socket.prototype.getsockopt = function(option) {
      switch (option) {
        case nullmq.HWM:
          return this.hwm;
        case nullmq.IDENTITY:
          return this.identity;
        case nullmq.LINGER:
          return this.linger;
        default:
          return;
      }
    };
    Socket.prototype.close = function() {
      var destination, id, _ref;
      _ref = this.connections;
      for (destination in _ref) {
        id = _ref[destination];
        this.client.unsubscribe(id);
      }
      this.connections = {};
      return this.closed = true;
    };
    Socket.prototype.send = function(message) {
      var _ref;
      if ((_ref = this.type) === nullmq.PULL || _ref === nullmq.SUB) {
        throw Error("Sending is not implemented for this socket type");
      }
      return this.send_queue.put(message);
    };
    Socket.prototype.recv = function(callback) {
      return this.recv_queue.watch(__bind(function() {
        return callback(this._recv());
      }, this));
    };
    Socket.prototype.recvall = function(callback) {
      var watcher;
      watcher = __bind(function() {
        callback(this._recv());
        return this.recv_queue.watch(watcher);
      }, this);
      return this.recv_queue.watch(watcher);
    };
    Socket.prototype._recv = function() {
      var envelope;
      envelope = this.recv_queue.get();
      this.last_recv = envelope;
      return envelope.message;
    };
    Socket.prototype._identity = function(value) {
      return this.identity = value;
    };
    Socket.prototype._deliver_round_robin = function(message) {
      var connection_count, destination;
      destination = Object.keys(this.connections)[this.rr_index];
      this.context._send(this, destination, message);
      connection_count = Object.keys(this.connections).length;
      return this.rr_index = ++this.rr_index % connection_count;
    };
    Socket.prototype._deliver_fanout = function(message) {
      var destination, id, _ref, _results;
      _ref = this.connections;
      _results = [];
      for (destination in _ref) {
        id = _ref[destination];
        _results.push(this.context._send(this, destination, message));
      }
      return _results;
    };
    Socket.prototype._deliver_routed = function(message) {
      var destination;
      destination = message.shift();
      return this.context._send(this, destination, message);
    };
    Socket.prototype._deliver_back = function(message) {
      return this.context._send(this, this.last_recv.destination, message);
    };
    Socket.prototype._dispatch_outgoing = function() {
      var message;
      message = this.send_queue.get();
      switch (this.type) {
        case nullmq.REQ:
        case nullmq.DEALER:
        case nullmq.PUSH:
          this._deliver_round_robin(message);
          break;
        case nullmq.PUB:
          this._deliver_fanout(message);
          break;
        case nullmq.ROUTER:
          this._deliver_routed(message);
          break;
        case nullmq.REP:
          this._deliver_back(message);
          break;
        default:
          assert("outgoing dispatching shouldn't happen for this socket type");
      }
      return this.send_queue.watch(this._dispatch_outgoing);
    };
    return Socket;
  })();
  if (typeof window !== "undefined" && window !== null) {
    window.nullmq = nullmq;
    if (!(window.Stomp != null)) {
      console.log("Required Stomp library not loaded.");
    } else {
      Stomp = window.Stomp;
    }
  } else {
    exports.nullmq = nullmq;
    exports.Queue = Queue;
    Stomp = require('./lib/stomp.js').Stomp;
  }
}).call(this);
