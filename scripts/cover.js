import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const QUALITY = '50';
const SPEED = '0';

const files = process.argv.slice(2);

if (files.length === 0) {
	console.error('Usage: npm run cover -- <path/to/cover.png> [...]');
	process.exit(1);
}

if (spawnSync('avifenc', ['--version'], { stdio: 'ignore' }).status !== 0) {
	console.error('Error: avifenc is not installed. Please install libavif to convert cover.png to AVIF.');
	process.exit(1);
}

let failed = false;

for (const file of files) {
	if (path.basename(file) !== 'cover.png') {
		console.error(`Skipping ${file}: not a cover.png`);
		failed = true;
		continue;
	}

	const avifFile = path.join(path.dirname(file), 'cover.avif');

	if (existsSync(avifFile)) {
		console.error(`Error: ${avifFile} already exists, refusing to overwrite.`);
		failed = true;
		continue;
	}

	console.log(`Converting ${file} → ${avifFile}`);

	const result = spawnSync(
		'avifenc',
		['-q', QUALITY, '--speed', SPEED, file, avifFile],
		{ stdio: 'inherit' },
	);

	if (result.status !== 0) {
		console.error(`Error: avifenc failed for ${file}`);
		failed = true;
	}
}

process.exit(failed ? 1 : 0);
