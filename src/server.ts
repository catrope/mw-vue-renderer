import { createSSRApp, App, ComponentOptions, Plugin } from 'vue';
import * as Vue from 'vue';
import express from 'express';
import { parse, SFCParseResult } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import makeMwI18n, { MwI18n, MwMessage } from './mwMessage';

type ModuleDefinition = {
	files: Record<string, string | Record<string, unknown>>,
	entry: string,
	messages?: string | Record<string, string>,
	dependencies?: string[]
}

type RequestData = {
	modules: Record<string, ModuleDefinition>,
	lang: string,
	mainModule?: string,
	exportProperty?: string,
	props: Record<string, unknown>,
	attrs: Record<string, unknown>
}

type ModuleExport = ComponentOptions<never> | Record<string, unknown>;

type RequestExecutionContext = {
	modules: Record<string, ModuleDefinition>,
	moduleExportsCache: Record<string, ModuleExport>,
	messageMap: Map<string, string>,
	mockWindow: Record<string, unknown>
}

type ModuleExecutionContext = {
	files: Record<string, string|Record<string, unknown>>,
	fileExportsCache: Record<string, ModuleExport>,
	requestContext: RequestExecutionContext
}

const builtinModules = {
	vue: Vue
};

function makeI18nPlugin( mwI18n: MwI18n ) : Plugin {
	return {
		install( app ) {
			app.config.globalProperties.$i18n = function ( key, ...parameters ) {
				return mwI18n.message( key, ...parameters );
			};

			app.directive( 'i18n-html', {
				getSSRProps( binding ) {
					let message : MwMessage;
					if ( Array.isArray( binding.value ) ) {
						if ( binding.arg === undefined ) {
							// v-i18n-html="[ ...params ]" (error)
							throw new Error( 'v-i18n-html used with parameter array but without message key' );
						}
						// v-i18n-html:messageKey="[ ...params ]"
						message = mwI18n.message( binding.arg ).params( binding.value );
					} else if ( binding.value instanceof mwI18n.Message ) {
						// v-i18n-html="mw.message( '...' ).params( [ ... ] )"
						message = binding.value;
					} else {
						// v-i18n-html:foo or v-i18n-html="'foo'"
						message = mwI18n.message( binding.arg || binding.value );
					}
					return {
						innerHTML: message
					};
				}
			} );
		}
	};
}

const server = express();
const hasOwn = Object.prototype.hasOwnProperty;

// resolveRelativePath was copied from resources/src/startup/mediawiki.js

/**
 * Resolve a relative file path.
 *
 * For example, resolveRelativePath( '../foo.js', 'resources/src/bar/bar.js' )
 * returns 'resources/src/foo.js'.
 *
 * @param relativePath Relative file path, starting with ./ or ../
 * @param basePath Path of the file (not directory) relativePath is relative to
 * @return Resolved path, or null if relativePath does not start with ./ or ../
 */
function resolveRelativePath( relativePath : string, basePath : string ) : string|null {
	const relParts = relativePath.match( /^((?:\.\.?\/)+)(.*)$/ );

	if ( !relParts ) {
		return null;
	}

	const baseDirParts = basePath.split( '/' );
	// basePath looks like 'foo/bar/baz.js', so baseDirParts looks like [ 'foo', 'bar, 'baz.js' ]
	// Remove the file component at the end, so that we are left with only the directory path
	baseDirParts.pop();

	const prefixes = relParts[ 1 ].split( '/' );
	// relParts[ 1 ] looks like '../../', so prefixes looks like [ '..', '..', '' ]
	// Remove the empty element at the end
	prefixes.pop();

	// For every ../ in the path prefix, remove one directory level from baseDirParts
	let prefix : string;
	while ( ( prefix = prefixes.pop() ) !== undefined ) {
		if ( prefix === '..' ) {
			baseDirParts.pop();
		}
	}

	// If there's anything left of the base path, prepend it to the file path
	return ( baseDirParts.length ? baseDirParts.join( '/' ) + '/' : '' ) + relParts[ 2 ];
}

function executeFile( context : ModuleExecutionContext, path : string ) : ModuleExport {
	let code = context.files[ path ];
	let result : ModuleExport;
	if ( typeof code === 'string' ) {
		let parsedSFC : SFCParseResult = null;
		// Allow .vue files that have already been transformed to JS
		if ( path.endsWith( '.vue' ) && code.trim().startsWith( '<' ) ) {
			parsedSFC = parse( code );
			// TODO check parsedSFC.errors
			code = parsedSFC.descriptor.script.content;
		}

		const moduleObj = { exports: {} };
		const mockWindow = context.requestContext.mockWindow;
		// eslint-disable-next-line no-new-func
		new Function( 'module', 'exports', 'require', 'window', 'with(window){' + code + '}' ).bind( mockWindow )(
			moduleObj,
			moduleObj.exports,
			// eslint-disable-next-line no-use-before-define
			makeRequireFunction( context, path ),
			mockWindow
		);
		if ( parsedSFC !== null ) {
			( moduleObj.exports as ComponentOptions<never> ).template =
				parsedSFC.descriptor.template.content;
		}
		result = moduleObj.exports;
	} else {
		result = code;
	}
	context.fileExportsCache[ path ] = result;
	return result;
}

function makeRequireFunction( context : ModuleExecutionContext, path : string ) {
	return function ( fileName : string ) : unknown {
		const resolvedFileName = resolveRelativePath( fileName, path );
		if ( resolvedFileName === null ) {
			if ( fileName in builtinModules ) {
				return builtinModules[ fileName ];
			}
			if ( hasOwn.call( context.requestContext.modules, fileName ) ) {
				// eslint-disable-next-line no-use-before-define
				return executeModule( context.requestContext, fileName );
			}
			throw new Error( `Cannot require() undefined module ${fileName}` );
		}
		if ( !hasOwn.call( context.files, resolvedFileName ) ) {
			throw new Error( `Cannot require() undefined file ${fileName}` );
		}
		if ( hasOwn.call( context.fileExportsCache, resolvedFileName ) ) {
			return context.fileExportsCache[ resolvedFileName ];
		}

		return executeFile( context, resolvedFileName );
	};
}

function addMessages( messageMap: Map<string, string>, messages: string | Record<string, string> )
: void {
	const decodedMessages : Record<string, string> = typeof messages === 'string' ? JSON.parse( messages ) : messages;
	for ( const [ k, v ] of Object.entries( decodedMessages ) ) {
		messageMap.set( k, v );
	}
}

function executeModule( requestContext : RequestExecutionContext, moduleName : string )
: ModuleExport {
	if ( !hasOwn.call( requestContext.moduleExportsCache, moduleName ) ) {
		const { files, entry, messages = {}, dependencies = [] } =
			requestContext.modules[ moduleName ];
		for ( const dependency of dependencies ) {
			executeModule( requestContext, dependency );
		}
		const context : ModuleExecutionContext = {
			files,
			fileExportsCache: {},
			requestContext
		};
		addMessages( requestContext.messageMap, messages );
		requestContext.moduleExportsCache[ moduleName ] = executeFile( context, entry );
	}
	return requestContext.moduleExportsCache[ moduleName ];
}

function makeApp(
	component: ComponentOptions<never>,
	props: Record<string, unknown>,
	mwI18n: MwI18n
) : App {
	const app = createSSRApp( component, props );
	app.use( makeI18nPlugin( mwI18n ) );
	return app;
}

server.use( express.json( { limit: '10MB' } ) );

server.post( '/render', async ( req, res ) => {
	const {
		modules,
		lang,
		mainModule = 'main',
		exportProperty = null,
		props = {}
	} = ( req.body as RequestData );

	const messageMap = new Map<string, string>();
	const mwI18n = makeMwI18n( lang, messageMap );

	// HACK mock some things to make common code work
	const mockLog = () : boolean => false;
	mockLog.deprecate = () => false;
	class MwMap {
		values: Map<string, unknown>;
		constructor() {
			this.values = new Map();
		}
		get( key : string, fallback : unknown ) : unknown {
			// TODO full implementation, maybe just use mediawiki.js itself
			return this.values.has( key ) ?
				this.values.get( key ) :
				fallback;
		}
		set( key : string, value : unknown ) : void {
			if ( typeof key === 'object' ) {
				for ( const [ k, v ] of Object.entries( key ) ) {
					this.values.set( k, v );
				}
			} else {
				this.values.set( key, value );
			}
		}
		exists( key : string ) : boolean {
			return this.values.has( key );
		}
	}
	const mock$ = () : boolean => false;
	mock$.extend = Object.assign;
	mock$.fn = {};
	// TODO decide how much of mw we want to mock vs how much we use real MW files vs how much
	// we just don't make available
	const mockWindow = {
		mw: {
			...mwI18n,
			config: new MwMap(), // TODO fill with values
			user: {
				options: new MwMap(),
				tokens: new MwMap()
			},
			log: mockLog,
			Map: MwMap,
			libs: {} // HACK
		},
		$: mock$
	};
	const requestContext : RequestExecutionContext = {
		modules, messageMap, mockWindow,
		moduleExportsCache: { ...builtinModules }
	};

	const mainExport = executeModule( requestContext, mainModule );
	const componentObject = exportProperty === null ? mainExport : mainExport[ exportProperty ];
	const app = makeApp( componentObject, props, mwI18n );

	const context = {};
	try {
		const html = await renderToString( app, context );
		res.json( {
			html
		} );
	} catch ( error ) {
		res.json( { error: error } );
		throw error;
	}
} );

server.listen( 8082 );
