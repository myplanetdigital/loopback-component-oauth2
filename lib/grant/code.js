/**
 * Module dependencies.
 */
var url = require('url')
  , AuthorizationError = require('../errors/authorizationerror');


/**
 * Handles authorization requests using an authorization code as a grant.
 *
 * Applications must supply an `issue` callback that issues authorization codes.
 * The callback accepts five arguments: `client`, `redirectURI`, `user`, `scope`
 * and a `done` callback, which accepts `err` and `code` arguments in idomatic
 * fashion (see below for examples).
 *
 * The `client` argument is supplied by the application through the
 * `validateRequest` function, and optionally serialized to and from of the
 * session via `serializeClient` and `deserializeClient`.
 *
 * The code issued in this step will be used by the client in exchange for an
 * access token.  This code is bound to the client identifier and redirection
 * URI, which is included in the token request for verification.  The code is a
 * single-use token, and should expire shortly after it is issued (the maximum
 * recommended lifetime is 10 minutes).
 *
 * Options:
 *
 *     scopeSeparator  separator used to demarcate scope values (default: ' ')
 *
 * Examples:
 *
 *     server.approve(oauth2orize.approve.code(function(client, redirectURI, user, scope, done) {
 *       AuthorizationCode.create(client.id, redirectURI, user.id, scope, function(err, code) {
 *         if (err) { return done(err); }
 *         done(null, code);
 *       });
 *     }));
 *
 * References:
 *  - [Authorization Code](http://tools.ietf.org/html/draft-ietf-oauth-v2-26#section-1.3.1)
 *  - [Authorization Code Grant](http://tools.ietf.org/html/draft-ietf-oauth-v2-26#section-4.1)
 *
 * @param {Object} options
 * @param {Function} issue
 * @api public
 */
module.exports = function code(options, issue) {
  if (typeof options == 'function') {
    issue = options;
    options = null;
  }
  options = options || {};
  
  if (!issue) throw new Error('OAuth 2.0 code grant middleware requires an issue function.');
  
  // For maximum flexibility, multiple scope spearators can optionally be
  // allowed.  This allows the server to accept clients that separate scope
  // with either space or comma (' ', ',').  This violates the specification,
  // but achieves compatibility with existing client libraries that are already
  // deployed.
  var separators = options.scopeSeparator || ' ';
  if (!Array.isArray(separators)) {
    separators = [ separators ];
  }
  
  
  /* Parse requests that request `code` as `response_type`.
   *
   * @param {http.ServerRequest} req
   * @api public
   */
  function request(req) {
    var clientID = req.query['client_id']
      , redirectURI = req.query['redirect_uri']
      , scope = req.query['scope']
      , state = req.query['state'];
      
    if (!clientID) { throw new AuthorizationError('missing client_id parameter', 'invalid_request'); }
    
    if (scope) {
      for (var i = 0, len = separators.length; i < len; i++) {
        var separated = scope.split(separators[i]);
        // only separate on the first matching separator.  this allows for a sort
        // of separator "priority" (ie, favor spaces then fallback to commas)
        if (separated.length > 1) {
          scope = separated;
          break;
        }
      }
      
      if (!Array.isArray(scope)) { scope = [ scope ]; }
    }
    
    return {
      clientID: clientID,
      redirectURI: redirectURI,
      scope: scope,
      state: state
    }
  }
  
  /* Sends responses to transactions that request `code` as `response_type`.
   *
   * @param {Object} txn
   * @param {http.ServerResponse} res
   * @param {Function} next
   * @api public
   */
  function response(txn, res, next) {
    if (!txn.redirectURI) { return next(new Error('No redirect URI available to send OAuth 2.0 response.')); }
    if (!txn.res.allow) {
      var parsed = url.parse(txn.redirectURI, true);
      delete parsed.search;
      parsed.query['error'] = 'access_denied';
      if (txn.req && txn.req.state) { parsed.query['state'] = txn.req.state; }
      
      var location = url.format(parsed);
      return res.redirect(location);
    }
    
    function issued(err, code) {
      if (err) { return next(err); }
      
      var parsed = url.parse(txn.redirectURI, true);
      delete parsed.search;
      parsed.query['code'] = code;
      if (txn.req && txn.req.state) { parsed.query['state'] = txn.req.state; }
      
      var location = url.format(parsed);
      return res.redirect(location);
    }
    
    // NOTE: The `redirect_uri`, if present in the client's authorization
    //       request, must also be present in the subsequent request to exchange
    //       the authorization code for an access token.  Acting as a verifier,
    //       the two values must be equal and serve to protect against certain
    //       types of attacks.  More information can be found here:
    //
    //       http://hueniverse.com/2011/06/oauth-2-0-redirection-uri-validation/
    
    var arity = issue.length;
    if (arity == 5) {
      issue(txn.client, txn.req.redirectURI, txn.user, txn.res, issued);
    } else { // arity == 4
      issue(txn.client, txn.req.redirectURI, txn.user, issued);
    }
  }
  
  
  /**
   * Return `code` approval module.
   */
  var mod = {};
  mod.name = 'code';
  mod.request = request;
  mod.response = response;
  return mod;
}