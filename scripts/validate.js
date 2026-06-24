import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const QUOTED_FIELDS = ['title', 'alt', 'description'];

async function loadLabels() {
	const file = path.join(projectRoot, 'src', 'data', 'labels.yml');
	return Object.keys(yamlLoad(await fs.readFile(file, 'utf8')));
}

function buildSchema(labels) {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['title', 'alt', 'description', 'date', 'links', 'tags'],
		properties: {
			title: { type: 'string', minLength: 1 },
			alt: { type: 'string', minLength: 1 },
			description: { type: 'string', minLength: 1 },
			date: { type: 'string', format: 'date' },
			links: {
				type: 'array',
				minItems: 1,
				items: { type: 'string', pattern: 'https?://\\S+' },
			},
			tags: {
				type: 'array',
				minItems: 1,
				uniqueItems: true,
				items: { type: 'string', enum: labels },
			},
			draft: { type: 'boolean' },
		},
	};
}

async function listAllNewsYml() {
	const newsRoot = path.join(projectRoot, 'src', 'news');
	const result = [];
	async function walk(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'template') continue;
				await walk(full);
			} else if (entry.name === 'index.yml') {
				result.push(full);
			}
		}
	}
	await walk(newsRoot);
	return result;
}

// Text-level rules: things that disappear once YAML is parsed.
function scanRawText(text) {
	const issues = [];
	const seen = new Set();
	const lines = text.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const lineNo = i + 1;
		const match = lines[i].match(/^([a-z]+):\s*(.*)$/);
		if (!match) continue;
		const [, key, rest] = match;
		if (seen.has(key)) continue;

		if (key === 'date') {
			seen.add(key);
			if (/^['"]/.test(rest)) {
				issues.push(`L${lineNo}: \`date\` must be unquoted (YYYY-MM-DD)`);
			}
			continue;
		}

		if (!QUOTED_FIELDS.includes(key)) continue;
		seen.add(key);

		const quoted = rest.match(/^'(.*)'\s*$/);
		if (!quoted) {
			issues.push(`L${lineNo}: \`${key}\` must be wrapped in single quotes`);
			continue;
		}
		// Ignore content inside `…` code spans (HTML/JS requires straight quotes there)
		const prose = quoted[1].replace(/`[^`]*`/g, '');
		if (prose.includes("''")) {
			issues.push(`L${lineNo}: \`${key}\` contains a straight apostrophe (use a curly ’)`);
		}
		if (prose.includes('"')) {
			issues.push(`L${lineNo}: \`${key}\` contains straight double quotes (use curly “ ”)`);
		}
	}
	return issues;
}

function formatAjvError(error) {
	const where = error.instancePath || '(root)';
	switch (error.keyword) {
		case 'required':
			return `Missing required field \`${error.params.missingProperty}\``;
		case 'additionalProperties':
			return `Unknown field \`${error.params.additionalProperty}\``;
		case 'enum':
			return `${where}: value is not in the allowed list`;
		case 'uniqueItems':
			return `${where}: duplicate items not allowed`;
		case 'pattern':
			return `${where}: does not match expected pattern`;
		case 'format':
			return `${where}: must be a valid ${error.params.format}`;
		default:
			return `${where}: ${error.message}`;
	}
}

async function validateFile(file, validate) {
	const errors = [];
	let text;
	try {
		text = await fs.readFile(file, 'utf8');
	} catch (error) {
		return [`Cannot read file: ${error.message}`];
	}

	errors.push(...scanRawText(text));

	let data;
	try {
		data = yamlLoad(text);
	} catch (error) {
		errors.push(`YAML parse error: ${error.message}`);
		return errors;
	}

	// js-yaml turns unquoted YYYY-MM-DD into a Date; Ajv's `format: date` wants a string.
	if (data && data.date instanceof Date && !Number.isNaN(data.date.getTime())) {
		data = { ...data, date: data.date.toISOString().slice(0, 10) };
	}

	if (!validate(data)) {
		for (const err of validate.errors) errors.push(formatAjvError(err));
	}
	return errors;
}

async function main() {
	const args = process.argv.slice(2);
	const labels = await loadLabels();
	const ajv = new Ajv({ allErrors: true });
	addFormats(ajv);
	const validate = ajv.compile(buildSchema(labels));

	let files;
	if (args.length > 0) {
		files = args
			.map((file) => path.resolve(process.cwd(), file))
			.filter((file) => file.endsWith('index.yml') && file.includes(`${path.sep}news${path.sep}`))
			.filter((file) => !file.endsWith(`${path.sep}news${path.sep}template${path.sep}index.yml`));
	} else {
		files = await listAllNewsYml();
	}

	if (files.length === 0) return;

	let totalErrors = 0;
	for (const file of files) {
		const rel = path.relative(projectRoot, file);
		const errors = await validateFile(file, validate);
		if (errors.length > 0) {
			totalErrors += errors.length;
			console.error(`\n✗ ${rel}`);
			for (const error of errors) console.error(`  ${error}`);
		}
	}

	if (totalErrors > 0) {
		console.error(`\n${totalErrors} validation error(s) in ${files.length} file(s) checked.`);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error('Error:', error.message);
	process.exit(1);
});
