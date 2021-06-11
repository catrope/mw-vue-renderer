# mw-vue-renderer

Proof of concept Vue SSR rendering service for MediaWiki.

## Setup

```
npm install
npm start
```
This starts an HTTP server on port 8082.

## Usage

Send POST requests to http://localhost:8082/render with JSON in the body formatted as follows:
```
{
	"modules": {
		"moduleName": {
			"files": {
				"filename.js": "...file contents...",
				"filename.vue": "...file contents, can be an SFC or JavaScript..."
			},
			"entry": "App.vue" // entry point file for this module
		}
	},
	"mainModule": "foo", // defaults to "main" if omitted
	"props": {
		// Props to pass to the main component
		"propname": "propvalue"
	},
	"attrs": {
		// HTML attributes to pass to the main component
		"attrname": "attrvalue"
	}
}
```

Files can export data by assigning to `module.exports` or adding properties to the `exports` object.
Files can `require()` other files in the same module by calling `require( './filename.js' )`, which
returns the `module.exports` value from that file. Files can also require other modules by calling
`require( 'moduleName' )`, which returns the `module.exports` value from that module's main file.

The main module must export a Vue component options object. The service renders that component,
passing in the props and attrs, and returns the rendered HTML wrapped in an object that looks like
`{ "html": "<div ...>...</div>" }`.

## Examples

There are examples in the `examples/` directory. You can use them as follows:
```
curl -d "$(cat examples/test-multimodule.json)" -H "Content-Type: application/json" http://localhost:8082/render
```
