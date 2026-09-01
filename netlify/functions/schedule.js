const repo = 'web-standards/web-standards.dev';

// Rebuild the site so news dated today goes live, and ask GitHub to refresh
// the social stats. Runs on production deploys only.
export default async () => {
	const results = await Promise.allSettled([
		triggerBuild(),
		dispatchWorkflow('social.yml'),
	]);

	const failed = results.filter((result) => result.status === 'rejected');

	for (const { reason } of failed) {
		console.error(reason.message);
	}

	if (failed.length > 0) {
		return new Response(`${failed.length} of ${results.length} tasks failed`, {
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

async function dispatchWorkflow(workflow) {
	const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': '2022-11-28',
		},
		// Opts into a 200 response carrying the run details. It replaces the
		// bare 204, which is deprecated with a sunset of 2028-03-10.
		body: JSON.stringify({ ref: 'main', return_run_details: true }),
	});

	if (!response.ok) {
		throw new Error(`Dispatching ${workflow} failed: HTTP ${response.status}`);
	}

	// Still 204 if the parameter was ignored, and a 204 has no body to read.
	if (response.status === 204) {
		console.log(`Dispatched ${workflow}`);
		return;
	}

	const { html_url: runUrl } = await response.json();
	console.log(`Dispatched ${workflow}: ${runUrl}`);
}

// Keep in sync with publishHourUTC in src/news/news.11tydata.js.
export const config = {
	schedule: '10 11 * * *',
};
