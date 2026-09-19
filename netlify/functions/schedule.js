// Rebuild the site so news dated today goes live. Runs on production deploys
// only.
export default async () => {
	try {
		await triggerBuild();
	} catch (error) {
		console.error(error.message);

		return new Response(error.message, {
			status: 500,
		});
	}

	return new Response('OK');
};

async function triggerBuild() {
	const response = await fetch(process.env.BUILD_HOOK_URL, {
		method: 'POST',
	});

	if (!response.ok) {
		throw new Error(`Build hook failed: HTTP ${response.status}`);
	}
}

// Keep in sync with publishHourUTC in src/news/news.11tydata.js.
export const config = {
	schedule: '10 11 * * *',
};
