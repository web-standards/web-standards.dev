import MarkdownIt from 'markdown-it';

export default (config) => {
	// Markdown

	let markdownInline = new MarkdownIt({
		html: true,
		linkify: true,
	});

	config.amendLibrary('md', (mdLib) => {
		mdLib.set({ linkify: true });

		const defaultTextRender = mdLib.renderer.rules.text;
		mdLib.renderer.rules.text = (tokens, idx, options, env, self) => {
			if (idx > 0 && tokens[idx - 1].type === 'link_open' && tokens[idx - 1].markup === 'linkify') {
				return tokens[idx].content
					.replace(/^https?:\/\//, '')
					.replace(/^www\./, '')
					.replace(/\/$/, '');
			}
			return defaultTextRender
				? defaultTextRender(tokens, idx, options, env, self)
				: self.renderToken(tokens, idx, options);
		};

		markdownInline = mdLib;
	});

	config.addFilter('markdownInline', (content) => {
		return markdownInline.renderInline(String(content ?? ''));
	});

	// Dates

	config.addFilter('dateLong', (value) => {
		return value.toLocaleString('en', {
			dateStyle: 'long',
		});
	});

	config.addFilter('dateShort', (value) => {
		const articleYear = value.getFullYear();
		const currentYear = new Date().getFullYear();
		const dateFormat = articleYear < currentYear
			? {
				dateStyle: 'long',
			}
			: {
				month: 'long',
				day: 'numeric',
			};

		return value.toLocaleString('en', dateFormat);
	});

	config.addFilter('dateISO', (value) => {
		return value.toISOString().split('T')[0];
	});

	config.addFilter('dateToRfc3339Cet', (value) => {
		const date = new Date(value);
		date.setUTCHours(11);
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			timeZoneName: 'longOffset',
		}).formatToParts(date);
		const get = (type) => parts.find((p) => p.type === type).value;
		const offset = get('timeZoneName').replace('GMT', '');
		return `${get('year')}-${get('month')}-${get('day')}T12:00:00${offset}`;
	});

	// Strings

	config.addFilter('limit', (array, limit) => {
		return array.slice(0, limit);
	});

	config.addFilter('plainText', (text) => {
		if (!text) return '';
		return text
			.replace(/`/g, '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	});

	// Pagination

	config.addFilter('paginationItems', (pagination, maxVisible = 7) => {
		const current = pagination.pageNumber + 1;
		const total = pagination.pages.length;

		const page = (n) => ({
			type: 'page',
			number: n,
			href: pagination.hrefs[n - 1],
			isCurrent: n === current,
		});

		const ellipsis = { type: 'ellipsis' };

		const range = (start, end) => Array.from(
			{ length: end - start + 1 }, (_, i) => page(start + i)
		);

		if (total <= maxVisible) {
			return range(1, total);
		}
		if (current <= 4) {
			return [...range(1, 5), ellipsis, page(total)];
		}
		if (current >= total - 3) {
			return [page(1), ellipsis, ...range(total - 4, total)];
		}

		return [
			page(1),
			ellipsis,
			...range(current - 1, current + 1),
			ellipsis,
			page(total),
		];
	});
};
