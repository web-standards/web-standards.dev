const isDev = process.env.ELEVENTY_RUN_MODE === 'serve';

export default {
	eleventyComputed: {
		permalink: (data) => {
			// In dev mode, always generate the page (ignore permalink: false)
			// In production, respect the original permalink value
			if (isDev && data.permalink === false) {
				// Let Eleventy generate the default permalink
				return undefined;
			}
			return data.permalink;
		},
	},
};
