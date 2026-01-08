const isDev = process.env.ELEVENTY_RUN_MODE === 'serve';

export default {
	eleventyComputed: {
		eleventyExcludeFromCollections: (data) => data.draft && !isDev,
		permalink: (data) => {
			if (data.draft && !isDev) {
				return false;
			}
			return data.permalink;
		},
	},
};
