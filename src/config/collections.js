export default (config, { newsGlob, pageSize }) => {
	config.addCollection('news', (collectionApi) => {
		return collectionApi.getFilteredByGlob(newsGlob)
			.map((item) => {
				item.data.layout = 'news-article.njk';
				return item;
			});
	});

	config.addCollection('newsPagination', (collectionApi) => {
		const items = collectionApi.getFilteredByGlob(newsGlob)
			.filter((item) => !item.data.eleventyExcludeFromCollections)
			.sort((a, b) => b.date - a.date);

		const totalPages = Math.ceil(items.length / pageSize);
		const hrefs = Array.from({ length: totalPages }, (_, i) =>
			i === 0 ? '/news/' : `/news/page/${i + 1}/`
		);

		return Array.from({ length: totalPages }, (_, pageIndex) => ({
			permalink: pageIndex === 0
				? '/news/index.html'
				: `/news/page/${pageIndex + 1}/index.html`,
			title: pageIndex === 0
				? 'All news'
				: `All news — Page ${pageIndex + 1}`,
			pagination: {
				items: items.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
				pageNumber: pageIndex,
				hrefs,
				pages: Array(totalPages).fill(null),
			},
		}));
	});

	config.addCollection('tagPagination', (collectionApi) => {
		const tagMap = new Map();

		for (const item of collectionApi.getFilteredByGlob(newsGlob)) {
			if (item.data.eleventyExcludeFromCollections) continue;
			for (const tag of item.data.tags ?? []) {
				if (!tagMap.has(tag)) tagMap.set(tag, []);
				tagMap.get(tag).push(item);
			}
		}

		return [...tagMap].flatMap(([tag, items]) => {
			items.sort((a, b) => b.date - a.date);
			const totalPages = Math.ceil(items.length / pageSize);
			const hrefs = Array.from({ length: totalPages }, (_, i) =>
				i === 0 ? `/tags/${tag}/` : `/tags/${tag}/page/${i + 1}/`
			);

			return Array.from({ length: totalPages }, (_, pageIndex) => ({
				tag,
				permalink: pageIndex === 0
					? `/tags/${tag}/index.html`
					: `/tags/${tag}/page/${pageIndex + 1}/index.html`,
				titleSuffix: pageIndex === 0
					? ''
					: ` — Page ${pageIndex + 1}`,
				pagination: {
					items: items.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
					pageNumber: pageIndex,
					hrefs,
					pages: Array(totalPages).fill(null),
				},
			}));
		});
	});

	config.addCollection('sitemap', (collectionApi) => {
		const newsItems = collectionApi.getFilteredByGlob(newsGlob);

		const mostRecentNewsDate = newsItems.length > 0
			? newsItems.reduce((latest, item) => item.date > latest ? item.date : latest, newsItems[0].date)
			: new Date();

		const homePage = [{
			url: '/',
			date: mostRecentNewsDate,
			priority: 1.0,
			changefreq: 'daily',
		}];

		const newsArchive = [{
			url: '/news/',
			date: mostRecentNewsDate,
			priority: 0.9,
			changefreq: 'daily',
		}];

		const newsPages = newsItems
			.map((item) => ({
				url: item.url,
				date: item.date,
				priority: 0.8,
				changefreq: 'weekly',
			}))
			.sort((a, b) => b.date - a.date);

		const tagPages = [];
		const tagPagination = collectionApi.getFilteredByGlob(newsGlob)
			.reduce((map, item) => {
				if (item.data.tags) {
					item.data.tags.forEach((tag) => {
						if (!map.has(tag)) map.set(tag, { count: 0, date: item.date });
						const entry = map.get(tag);
						entry.count++;
						if (item.date > entry.date) entry.date = item.date;
					});
				}
				return map;
			}, new Map());

		for (const [tag, { count, date }] of tagPagination) {
			const totalPages = Math.ceil(count / pageSize);
			for (let i = 0; i < totalPages; i++) {
				tagPages.push({
					url: i === 0 ? `/tags/${tag}/` : `/tags/${tag}/page/${i + 1}/`,
					date,
					priority: i === 0 ? 0.5 : 0.3,
					changefreq: 'weekly',
				});
			}
		}

		return [
			...homePage,
			...newsArchive,
			...newsPages,
			...tagPages,
		];
	});

	config.addFilter('relatedByTags', (collection, currentUrl, currentTags) => {
		return collection.filter((item) => {
			if (item.url === currentUrl) {
				return false;
			}
			return currentTags.some((tag) => item.data.tags?.includes(tag));
		});
	});
};
