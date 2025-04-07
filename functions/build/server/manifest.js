const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["Arrow.svg","carti.jpg","ChicagoFLF.ttf","computer.svg","favicon.png","GenevaRegular.ttf","global.css","lyrictypeIcon.svg","sysfont.otf","windows-95.png"]),
	mimeTypes: {".svg":"image/svg+xml",".jpg":"image/jpeg",".ttf":"font/ttf",".png":"image/png",".css":"text/css",".otf":"font/otf"},
	_: {
		client: {"start":"_app/immutable/entry/start.BLuapdey.js","app":"_app/immutable/entry/app.ClXnDEen.js","imports":["_app/immutable/entry/start.BLuapdey.js","_app/immutable/chunks/entry.lyRy1VuY.js","_app/immutable/chunks/scheduler.4wPzjlaw.js","_app/immutable/chunks/index.CexjyeIv.js","_app/immutable/entry/app.ClXnDEen.js","_app/immutable/chunks/preload-helper.D6kgxu3v.js","_app/immutable/chunks/scheduler.4wPzjlaw.js","_app/immutable/chunks/index.BtrknYgQ.js"],"stylesheets":[],"fonts":[],"uses_env_dynamic_public":false},
		nodes: [
			__memo(() => import('./chunks/0-B5N59JPA.js')),
			__memo(() => import('./chunks/1-CxCyr1CR.js')),
			__memo(() => import('./chunks/2-C67-Uov9.js'))
		],
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/proxy-image",
				pattern: /^\/api\/proxy-image\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./chunks/_server-BtXL4YiP.js'))
			}
		],
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

const prerendered = new Set([]);

const base = "";

export { base, manifest, prerendered };
//# sourceMappingURL=manifest.js.map
