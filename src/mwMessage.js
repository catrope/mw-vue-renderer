// i18n-related code copied from mediawiki.base.js, slightly adapted
/* eslint-disable no-var, @typescript-eslint/explicit-function-return-type */

module.exports = function makeMwI18n( langCode, messageMap ) {
	function escapeCallback( s ) {
		switch ( s ) {
			case '\'':
				return '&#039;';
			case '"':
				return '&quot;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
		}
	}

	/**
	 * @param {string} s
	 * @return {string}
	 */
	function htmlEscape( s ) {
		return s.replace( /['"<>&]/g, escapeCallback );
	}

	/**
	 * Replace `$*` with a list of parameters for `uselang=qqx` support.
	 *
	 * @param {string} formatString Format string
	 * @param {Array} parameters Values for $N replacements
	 * @return {string} Transformed format string
	 */
	function internalDoTransformFormatForQqx( formatString, parameters ) {
		var replacement;
		if ( formatString.indexOf( '$*' ) !== -1 ) {
			replacement = '';
			if ( parameters.length ) {
				replacement = ': ' + parameters.map( function ( _, i ) {
					return '$' + ( i + 1 );
				} ).join( ', ' );
			}
			return formatString.replace( '$*', replacement );
		}
		return formatString;
	}

	/**
	 * Format a string. Replace $1, $2 ... $N with positional arguments.
	 *
	 * Used by Message#parser().
	 *
	 * @since 1.25
	 * @param {string} formatString Format string
	 * @param {...Mixed} parameters Values for $N replacements
	 * @return {string} Formatted string
	 */
	function format( formatString, ...parameters ) {
		formatString = internalDoTransformFormatForQqx( formatString, parameters );
		return formatString.replace( /\$(\d+)/g, function ( str, match ) {
			var index = parseInt( match, 10 ) - 1;
			return parameters[ index ] !== undefined ? parameters[ index ] : '$' + match;
		} );
	}

	/**
	 * @class Message
	 *
	 * @constructor
	 * @param {Map} map Message store
	 * @param {string} key
	 * @param {Array} [parameters]
	 */
	function Message( map, key, parameters ) {
		this.format = 'text';
		this.map = map;
		this.key = key;
		this.parameters = parameters || [];
		return this;
	}

	Message.prototype = {
		/**
		 * Get parsed contents of the message.
		 *
		 * The default parser does simple $N replacements and nothing else.
		 * This may be overridden to provide a more complex message parser.
		 * The primary override is in the mediawiki.jqueryMsg module.
		 *
		 * This function will not be called for nonexistent messages.
		 *
		 * @return {string} Parsed message
		 */
		parser: function () {
			var text = this.map.get( this.key );
			if (
				langCode === 'qqx' &&
				text === '(' + this.key + ')'
			) {
				text = '(' + this.key + '$*)';
			}
			text = format( text, ...this.parameters );
			if ( this.format === 'parse' ) {
				// We don't know how to parse anything, so escape it all
				text = htmlEscape( text );
			}
			return text;
		},

		/**
		 * Add (does not replace) parameters for `$N` placeholder values.
		 *
		 * @param {Array} parameters
		 * @return {Message}
		 * @chainable
		 */
		params: function ( parameters ) {
			var i;
			for ( i = 0; i < parameters.length; i++ ) {
				this.parameters.push( parameters[ i ] );
			}
			return this;
		},

		/**
		 * Convert message object to its string form based on current format.
		 *
		 * @return {string} Message as a string in the current form, or `<key>` if key
		 *  does not exist.
		 */
		toString: function () {
			if ( !this.exists() ) {
				// Use ⧼key⧽ as text if key does not exist
				// Err on the side of safety, ensure that the output
				// is always html safe in the event the message key is
				// missing, since in that case its highly likely the
				// message key is user-controlled.
				// '⧼' is used instead of '<' to side-step any
				// double-escaping issues.
				// (Keep synchronised with Message::toString() in PHP.)
				return '⧼' + htmlEscape( this.key ) + '⧽';
			}

			if ( this.format === 'plain' || this.format === 'text' || this.format === 'parse' ) {
				return this.parser();
			}

			// Format: 'escaped'
			return htmlEscape( this.parser() );
		},

		/**
		 * Change format to 'parse' and convert message to string
		 *
		 * If jqueryMsg is loaded, this parses the message text from wikitext
		 * (where supported) to HTML
		 *
		 * Otherwise, it is equivalent to plain.
		 *
		 * @return {string} String form of parsed message
		 */
		parse: function () {
			this.format = 'parse';
			return this.toString();
		},

		/**
		 * Change format to 'plain' and convert message to string
		 *
		 * This substitutes parameters, but otherwise does not change the
		 * message text.
		 *
		 * @return {string} String form of plain message
		 */
		plain: function () {
			this.format = 'plain';
			return this.toString();
		},

		/**
		 * Change format to 'text' and convert message to string
		 *
		 * If jqueryMsg is loaded, {{-transformation is done where supported
		 * (such as {{plural:}}, {{gender:}}, {{int:}}).
		 *
		 * Otherwise, it is equivalent to plain
		 *
		 * @return {string} String form of text message
		 */
		text: function () {
			this.format = 'text';
			return this.toString();
		},

		/**
		 * Change the format to 'escaped' and convert message to string
		 *
		 * This is equivalent to using the 'text' format (see #text), then
		 * HTML-escaping the output.
		 *
		 * @return {string} String form of html escaped message
		 */
		escaped: function () {
			this.format = 'escaped';
			return this.toString();
		},

		/**
		 * Check if a message exists
		 *
		 * @see mw.Map#exists
		 * @return {boolean}
		 */
		exists: function () {
			return this.map.has( this.key );
		}
	};

	/**
	 * Get a message object.
	 *
	 * Shortcut for `new mw.Message( mw.messages, key, parameters )`.
	 *
	 * @param {string} key Key of message to get
	 * @param {...Mixed} parameters Values for $N replacements
	 * @return {Message}
	 */
	function message( key, ...parameters ) {
		return new Message( messageMap, key, parameters );
	}

	/**
	 * Get a message string using the (default) 'text' format.
	 *
	 * Shortcut for `mw.message( key, parameters... ).text()`.
	 *
	 * @see mw.Message
	 * @param {string} key Key of message to get
	 * @param {...Mixed} parameters Values for $N replacements
	 * @return {string}
	 */
	function msg( key, ...parameters ) {
		return message( key, ...parameters ).toString();
	}

	return {
		Message,
		message,
		msg
	};
};
