var nativeHttps = require('https'),
  nativeHttp = require('http'),
  url = require('url'),
  _ = require('underscore');

var maxRedirects = module.exports.maxRedirects = 5;

var protocols = {
  https: nativeHttps,
  http: nativeHttp
};

// Only use GETs on redirects
for (var protocol in protocols) {
  // h is either our cloned http or https object
  var h =  function() {};
  h.prototype = protocols[protocol];
  h = new h();

  module.exports[protocol] = h;

  h.request = function (h) {
    return function (options, callback, redirectOptions) {

      redirectOptions = redirectOptions || {};

      var max = (typeof options === 'object' && 'maxRedirects' in options) ? options.maxRedirects : exports.maxRedirects;

      var redirect = _.extend({
        count: 0,
        max: max,
        clientRequest: null,
        userCallback: callback
      }, redirectOptions);

      /**
       * Emit error if too many redirects
       */
      if (redirect.count > redirect.max) {
        var err = new Error('Max redirects exceeded. To allow more redirects, pass options.maxRedirects property.');
        redirect.clientRequest.emit('error', err);
        return redirect.clientRequest;
      }

      redirect.count++;

      /**
       * Parse URL from options
       */
      var reqUrl;
      if (typeof options === 'string') {
        reqUrl = options;
      }
      else {
        reqUrl = url.format(_.extend({ protocol: protocol }, options));
      }

      /*
       * Build client request
       */
      var clientRequest = h.__proto__.request(options, redirectCallback(reqUrl, redirect));

      // Save user's clientRequest so we can emit errors later
      if (!redirect.clientRequest) redirect.clientRequest = clientRequest;

      /**
       * ClientRequest callback for redirects
       */
      function redirectCallback (reqUrl, redirect) {
        return function (res) {
          // status must be 300-399 for redirects
          if (res.statusCode < 300 || res.statusCode > 399) {
            return redirect.userCallback(res);
          }

          // no `Location:` header => nowhere to redirect
          if (!('location' in res.headers)) {
            return redirect.userCallback(res);
          }

          // we are going to follow the redirect, but in node 0.10 we must first attach a data listener
          // to consume the stream and send the 'end' event
          res.on('data', function() {});

          // save the original clientRequest to our redirectOptions so we can emit errors later

          // need to use url.resolve() in case location is a relative URL
          var redirectUrl = url.resolve(reqUrl, res.headers['location']);
          // we need to call the right api (http vs https) depending on protocol
          var proto = url.parse(redirectUrl).protocol;
          proto = proto.substr(0, proto.length - 1);

          // Make a new option object for next request from old options object
          // Break url in parts
          var searchname = url.parse(redirectUrl).search;
          var hostname = url.parse(redirectUrl).hostname;
          var pathname = url.parse(redirectUrl).pathname;

          var redirectOptions = options;
          redirectOptions.reqUrl = redirectUrl;
          redirectOptions.hostname = hostname;
          redirectOptions.path = pathname + searchname;

          var out = module.exports[proto].get(redirectOptions, redirectCallback(reqUrl, redirect), redirect);

          // bubble errors that occur on the redirect back up to the initiating client request
          // object, otherwise they wind up killing the process.
          out.on("error", function(err) { clientRequest.emit("error", err) });

          return out;
        };
      }

      return clientRequest;
    }
  }(h);

  // see https://github.com/joyent/node/blob/master/lib/http.js#L1623
  h.get = function (h) {
    return function (options, cb, redirectOptions) {
      var req = h.request(options, cb, redirectOptions);
      req.end();
      return req;
    };
  }(h);
}
