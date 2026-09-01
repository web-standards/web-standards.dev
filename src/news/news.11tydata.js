const isDev = process.env.ELEVENTY_RUN_MODE === 'serve';

// News goes live on the first production build at or after this hour on its
// date. Keep in sync with the cron in netlify/functions/schedule.js.
const publishHourUTC = 11;

// Evaluated once per build: a build is a snapshot of what was published when
// it ran, so publishing depends on the scheduled rebuild, not on the clock.
const buildTime = Date.now();

// Locally everything is visible, whatever its date.
const isScheduled = (data) => {
	if (isDev) {
		return false;
	}

	const publishAt = new Date(data.page.date);
	publishAt.setUTCHours(publishHourUTC, 0, 0, 0);

	return buildTime < publishAt;
};

export default {
	eleventyComputed: {
		eleventyExcludeFromCollections: isScheduled,
		permalink: (data) => {
			if (isScheduled(data)) {
				return false;
			}
			return data.permalink;
		},
	},
};
