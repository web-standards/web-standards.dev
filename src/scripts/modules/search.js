let pagefindModulePromise;

const loadPagefind = async () => {
	if (globalThis.pagefind) {
		return globalThis.pagefind;
	}

	if (!pagefindModulePromise) {
		pagefindModulePromise = import('/pagefind/pagefind.js').then((module) => {
			const pagefind = module?.default ?? module;
			globalThis.pagefind = pagefind;
			return pagefind;
		});
	}

	return pagefindModulePromise;
};

const resolvePagefindSearch = (pagefindModule = globalThis.pagefind || globalThis.Pagefind || globalThis.__pagefind) => {
	const search = pagefindModule?.search || pagefindModule?.default?.search;
	if (!search) {
		throw new Error('Pagefind search function is unavailable after loading the script');
	}
	return search;
};

class SearchField extends HTMLElement {
	constructor() {
		super();
		this.resultEntries = [];
		this.activeIndex = -1;
		this.resultIdCounter = 0;
		this.debounceTimer = null;
		this.pagefindSearchPromise = null;
	}

	connectedCallback() {
		if (this.initialized) return;
		this.initialized = true;

		this.panel = this.querySelector('.search__panel') || this;
		this.input = this.querySelector('input');
		if (!this.input) return;

		this.resultsArea = this.querySelector('.search__results');
		this.clearButton = this.querySelector('.search__clear');
		this.ensureDynamicElements();
		if (!this.resultsArea) return;

		this.input.addEventListener('focus', this.onFocus);
		this.input.addEventListener('input', this.onInput);
		this.input.addEventListener('keydown', this.onInputKeydown);
		document.addEventListener('pointerdown', this.onPointerDown);
		this.resultsArea.addEventListener('keydown', this.onResultsKeydown);
		this.clearButton?.addEventListener('click', this.onClearClick);
		this.updateClearButtonVisibility();
	}

	disconnectedCallback() {
		this.input?.removeEventListener('focus', this.onFocus);
		this.input?.removeEventListener('input', this.onInput);
		this.input?.removeEventListener('keydown', this.onInputKeydown);
		document.removeEventListener('pointerdown', this.onPointerDown);
		this.resultsArea?.removeEventListener('keydown', this.onResultsKeydown);
		this.clearButton?.removeEventListener('click', this.onClearClick);
	}

	onFocus = () => {
		this.prefetchPagefind();

		if (this.input.value) {
			this.openResults();
		}
	};

	onInput = (event) => {
		const value = event.target.value.trim();

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.updateClearButtonVisibility();

		this.debounceTimer = setTimeout(() => {
			this.performSearch(value);
		}, 300);
	};

	onInputKeydown = (event) => {
		if (event.key === 'Escape') {
			this.closeResults();
			return;
		}

		if (!this.resultEntries.length) {
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.openResults();
			this.setActive(this.activeIndex + 1 || 0);
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.openResults();
			this.setActive(this.activeIndex > 0 ? this.activeIndex - 1 : this.resultEntries.length - 1);
		}
	};

	onResultsKeydown = (event) => {
		if (!this.resultEntries.length) {
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.setActive(this.activeIndex + 1);
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.setActive(this.activeIndex - 1);
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			this.closeResults();
			this.input.focus();
		}
	};

	onPointerDown = (event) => {
		if (!this.contains(event.target)) {
			this.closeResults();
		}
	};

	onClearClick = () => {
		this.input.value = '';
		this.clearResultsContent();
		this.closeResults();
		this.updateClearButtonVisibility();
		this.input.focus();
	};

	openResults() {
		this.resultsArea.hidden = false;
		this.input.setAttribute('aria-expanded', 'true');
		this.updateClearButtonVisibility();
	}

	closeResults() {
		this.resultsArea.hidden = true;
		this.input.setAttribute('aria-expanded', 'false');
		this.input.removeAttribute('aria-activedescendant');
		this.resultEntries = [];
		this.activeIndex = -1;
		this.updateClearButtonVisibility();
	}

	setActive(nextIndex) {
		if (!this.resultEntries.length) {
			return;
		}

		const boundedIndex = ((nextIndex % this.resultEntries.length) + this.resultEntries.length) % this.resultEntries.length;

		if (this.activeIndex >= 0 && this.resultEntries[this.activeIndex]) {
			this.resultEntries[this.activeIndex].item.setAttribute('aria-selected', 'false');
		}

		this.activeIndex = boundedIndex;

		const { item, link } = this.resultEntries[this.activeIndex];
		item.setAttribute('aria-selected', 'true');
		this.input.setAttribute('aria-activedescendant', link.id);
		link.focus({ preventScroll: true });
		item.scrollIntoView({ block: 'nearest' });
	}

	async performSearch(query) {
		if (!query) {
			this.closeResults();
			return;
		}

		try {
			if (!this.pagefindSearch) {
				this.pagefindSearch = await this.ensurePagefindSearch();
			}
		} catch {
			return;
		}

		const result = await this.pagefindSearch(query);
		if (!result?.results?.length) {
			this.renderResults([]);
			return;
		}

		const items = await Promise.all(
			result.results.map(async (entry) => {
				const data = await entry.data();
				return data;
			})
		);

		this.renderResults(items);
	}

	renderResults(items) {
		this.clearResultsContent();

		if (!items.length) {
			this.resultsArea.innerHTML = `<li role="option" aria-selected="false">No matches found</li>`;
			this.resultsArea.scrollTop = 0;
			this.openResults();
			return;
		}

		const html = items
			.map((item) => {
				const id = `search-result-${++this.resultIdCounter}`;
				const title = item.meta?.title ?? item.url;
				const url = item.url;
				const excerpt = item.excerpt ?? '';
				const paragraph = excerpt ? `<p>${excerpt}</p>` : '';

				return `
					<li role="option" aria-selected="false">
						<a
							href="${url}"
							id="${id}"
							tabindex="-1"
						>
							${this.escapeHtml(title)}
						</a>
						${paragraph}
					</li>
				`;
			})
			.join('');

		this.resultsArea.innerHTML = html;
		this.resultsArea.scrollTop = 0;

		const listItems = Array.from(this.resultsArea.querySelectorAll('li'));
		listItems.forEach((item) => {
			const link = item.querySelector('a');
			if (!link) return;
			this.resultEntries.push({ item, link });
		});

		this.openResults();
	}

	clearResultsContent() {
		this.resultsArea.innerHTML = '';
		if (this.resultsArea) {
			this.resultsArea.scrollTop = 0;
		}
		this.resultEntries = [];
		this.activeIndex = -1;
	}

	ensureDynamicElements() {
		if (!this.panel) {
			return;
		}

		const resultsId = this.input.getAttribute('aria-controls');
		let markup = '';

		if (!this.clearButton) {
			markup += `
				<button
					class="search__clear"
					type="button"
					aria-label="Clear search"
					hidden
				></button>
			`;
		}

		if (!this.resultsArea) {
			markup += `
				<ul
					class="search__results"
					id="${resultsId}"
					aria-live="polite"
					role="listbox"
					hidden
				></ul>
			`;
		}

		if (markup) {
			this.panel.insertAdjacentHTML('beforeend', markup);
		}

		this.clearButton = this.clearButton || this.panel.querySelector('.search__clear');
		this.resultsArea = this.resultsArea || this.panel.querySelector('.search__results');

		this.resultsArea.id = resultsId;
	}

	escapeHtml(value) {
		if (!value) {
			return '';
		}
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	updateClearButtonVisibility() {
		if (!this.clearButton) {
			return;
		}

		const hasValue = Boolean(this.input?.value.trim());
		const resultsVisible = this.resultsArea && !this.resultsArea.hidden;
		this.clearButton.hidden = !(hasValue || resultsVisible);
	}

	ensurePagefindSearch = async () => {
		if (this.pagefindSearch) {
			return this.pagefindSearch;
		}

		if (!this.pagefindSearchPromise) {
			this.pagefindSearchPromise = loadPagefind().then((pagefindModule) => resolvePagefindSearch(pagefindModule));
		}

		try {
			this.pagefindSearch = await this.pagefindSearchPromise;
		} catch (error) {
			console.warn('Pagefind failed to load', error);
			this.input.placeholder = 'Search is offline right now';
			this.pagefindSearchPromise = null;
			throw error;
		}

		return this.pagefindSearch;
	};

	prefetchPagefind() {
		if (this.pagefindSearch || this.pagefindSearchPromise) {
			return;
		}

		this.ensurePagefindSearch().catch(() => {});
	}
}

customElements.define('search-field', SearchField);
