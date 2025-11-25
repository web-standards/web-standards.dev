# Web Standards

Daily web platform news. Published every weekday.

## Content

News body text is a single paragraph in Markdown format, with only inline code blocks allowed. Basically, plain text with backticks for code snippets. The total length, combining title, body, and the link (counted as 23 characters), must not exceed 500 characters.

## Covers

- Create a 1920 × 1080 cover and export it as `cover.png`.
- Convert it to AVIF via `avifenc -q 50 --speed 5 cover.png cover.avif`.
- Use the AVIF version as the source file.

## Adding news

To add a news item, run the following command:

```sh
npm run new YYYY.MM.DD news-url-slug
```

- `YYYY.MM.DD` the publication date.
- `news-url-slug` the URL slug for the news.

The news is added as a draft (with `permalink: false`) and then automatically gets published via [GitHub action](.github/workflows/publish.yml) on the specified date at 12:00 CET on weekdays.
