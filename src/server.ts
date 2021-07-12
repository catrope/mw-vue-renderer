import Vue from 'vue';
import express from 'express';
import { parseComponent, SFCDescriptor } from 'vue-template-compiler';
import { createRenderer } from 'vue-server-renderer';
import { ComponentOptions } from 'vue';

const server = express();
const renderer = createRenderer();
const hasOwn = Object.prototype.hasOwnProperty;

type ModuleDefinition = {
	files: Record<string, string|Record<string, unknown>>,
	entry: string
}

type RequestData = {
	modules: Record<string, ModuleDefinition>,
	mainModule?: string,
	props: Record<string, unknown>,
	attrs: Record<string, unknown>
}

type ModuleExport = ComponentOptions<never> | Record<string, unknown>

type ModuleExecutionContext = {
	files: Record<string, string|Record<string, unknown>>,
	exportsCache: Record<string, ModuleExport>,
	modules: Record<string, ModuleDefinition>
}

const builtinModules = {
	vue: Vue
};

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
		let parsedSFC : SFCDescriptor|null = null;
		// Allow .vue files that have already been transformed to JS
		if ( path.endsWith( '.vue' ) && code.trim().startsWith( '<' ) ) {
			parsedSFC = parseComponent( code );
			code = parsedSFC.script.content;
		}

		const moduleObj = { exports: {} };
		// eslint-disable-next-line no-new-func
		new Function( 'module', 'exports', 'require', code )( moduleObj, moduleObj.exports,
			// eslint-disable-next-line no-use-before-define
			makeRequireFunction( context, path )
		);
		if ( parsedSFC !== null ) {
			( moduleObj.exports as ComponentOptions<never> ).template = parsedSFC.template.content;
		}
		result = moduleObj.exports;
	} else {
		result = code;
	}
	context.exportsCache[ path ] = result;
	return result;
}

function makeRequireFunction( context : ModuleExecutionContext, path : string ) {
	return function ( fileName : string ) : unknown {
		const resolvedFileName = resolveRelativePath( fileName, path );
		if ( resolvedFileName === null ) {
			if ( fileName in builtinModules ) {
				return builtinModules[ fileName ];
			}
			if ( hasOwn.call( context.modules, fileName ) ) {
				// eslint-disable-next-line no-use-before-define
				return executeModule( context.modules, fileName );
			}
			throw new Error( `Cannot require() undefined module ${fileName}` );
		}
		if ( !hasOwn.call( context.files, resolvedFileName ) ) {
			throw new Error( `Cannot require() undefined file ${fileName}` );
		}
		if ( hasOwn.call( context.exportsCache, resolvedFileName ) ) {
			return context.exportsCache[ resolvedFileName ];
		}

		return executeFile( context, resolvedFileName );
	};
}

function executeModule( modules : Record<string, ModuleDefinition>, moduleName : string )
: ModuleExport {
	const { files, entry } = modules[ moduleName ];
	const context : ModuleExecutionContext = {
		files,
		exportsCache: {},
		modules
	};
	return executeFile( context, entry );
}

function wrapComponent(
	wrappedComponent : ComponentOptions<never>,
	props: Record<string, unknown>,
	attrs: Record<string, unknown>
) : Vue {
	return new Vue( {
		render: ( h ) => h( wrappedComponent, { props, attrs } )
	} );
}

server.use( express.json( { limit: '10MB' } ) );

server.post( '/render', async ( req, res ) => {
	const { modules, mainModule = 'main', props = {}, attrs = {} } = ( req.body as RequestData );
	const componentObject = executeModule( modules, mainModule );
	const app = wrapComponent( componentObject, props, attrs );
	const context = {};

	try {
		const html = await renderer.renderToString( app, context );
		res.json( {
			html
		} );
	} catch ( error ) {
		res.json( { error: error } );
		throw error;
	}
} );

server.listen( 8082 );
