const isDev = process.env.ELEVENTY_RUN_MODE === 'serve';

export default {
	eleventyComputed: {
		permalink: (data) => {
			if (data.draft && !isDev) {
				return false;
			}
			return data.permalink;
		},
	},
};
