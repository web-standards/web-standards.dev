const CACHE_PATHS = [
	'.cache/@11ty/_images',
];

export default {
	async onPreBuild({ utils }) {
		console.log('Checking for cached directories...');

		for (const path of CACHE_PATHS) {
			if (await utils.cache.has(path)) {
				console.log(`Restoring cache: ${path}`);
				await utils.cache.restore(path);
			} else {
				console.log(`No cache found: ${path}`);
			}
		}
	},

	async onPostBuild({ utils }) {
		console.log('Saving cache for future builds...');

		for (const path of CACHE_PATHS) {
			const success = await utils.cache.save(path);
			if (success) {
				console.log(`Cached: ${path}`);
			} else {
				console.log(`Failed to cache: ${path}`);
			}
		}
	},
};