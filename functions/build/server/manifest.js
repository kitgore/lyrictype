const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["Arrow.svg","ChicagoFLF.ttf","GenevaRegular.ttf","carti.jpg","computer.svg","favicon.png","global.css","lyrictypeIcon.svg","sysfont.otf","windows-95.png"]),
	mimeTypes: {".svg":"image/svg+xml",".ttf":"font/ttf",".jpg":"image/jpeg",".png":"image/png",".css":"text/css",".otf":"font/otf"},
	_: {
		client: {"start":"_app/immutable/entry/start.Dpogm0Yv.js","app":"_app/immutable/entry/app.DyKUiaYU.js","imports":["_app/immutable/entry/start.Dpogm0Yv.js","_app/immutable/chunks/entry.Ck2vSvE-.js","_app/immutable/chunks/scheduler.Dn0xgxB4.js","_app/immutable/chunks/index.iAYQFAim.js","_app/immutable/entry/app.DyKUiaYU.js","_app/immutable/chunks/preload-helper.D6kgxu3v.js","_app/immutable/chunks/scheduler.Dn0xgxB4.js","_app/immutable/chunks/index.C4ZxKzAa.js"],"stylesheets":[],"fonts":[],"uses_env_dynamic_public":false},
		nodes: [
			__memo(() => import('./chunks/0-D8NcbHOu.js')),
			__memo(() => import('./chunks/1-CYhML5l9.js')),
			__memo(() => import('./chunks/2-ONaCNuQ4.js'))
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
