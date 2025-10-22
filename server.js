const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 5000;

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

app.set('trust proxy', true);
app.set('json spaces', 2);
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false
  }
});
app.use(limiter);

const BASE_URL = 'https://sinhalasub.lk';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

async function fetchHTML(url, retries = 3) {
  const cacheKey = `html_${url}`;
  const cachedHTML = cache.get(cacheKey);
  if (cachedHTML) {
    console.log(`[CACHE HIT] ${url}`);
    return cheerio.load(cachedHTML);
  }

  console.log(`[FETCHING] ${url}`);
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { 
        headers: HEADERS,
        timeout: 15000,
        maxRedirects: 5
      });
      console.log(`[SUCCESS] Status: ${response.status}, Length: ${response.data.length} bytes`);
      cache.set(cacheKey, response.data);
      const $ = cheerio.load(response.data);
      return $;
    } catch (error) {
      console.error(`[RETRY ${i + 1}/${retries}] Error: ${error.message}`);
      if (i === retries - 1) {
        console.error(`[FAILED] Could not fetch ${url} after ${retries} attempts`);
        return null;
      }
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extractQuality(text) {
  if (!text) return 'Standard';
  const qualities = ['4K', '2160p', '1080p', '720p', '480p', '360p', 'HD', 'CAM', 'TS', 'BluRay', 'WEB-DL', 'HDTV', 'HDRip', 'WEBRip'];
  const upperText = text.toUpperCase();
  for (const quality of qualities) {
    if (upperText.includes(quality)) return quality;
  }
  return 'Standard';
}

function extractFormat(url, text = '') {
  const formats = {
    'mkv': 'MKV',
    'mp4': 'MP4',
    'avi': 'AVI',
    'mov': 'MOV',
    'wmv': 'WMV',
    'flv': 'FLV',
    'webm': 'WEBM',
    'srt': 'SRT',
    'sub': 'SUB',
    'ass': 'ASS',
    'ssa': 'SSA'
  };
  
  const combined = `${url} ${text}`.toLowerCase();
  for (const [key, value] of Object.entries(formats)) {
    if (combined.includes(`.${key}`)) return value;
  }
  return 'MP4';
}

function extractSize(text, parentText = '') {
  const combined = `${text} ${parentText}`;
  const sizeMatch = combined.match(/(\d+(?:\.\d+)?)\s*(MB|GB|KB|TB)/i);
  if (sizeMatch) {
    return `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
  }
  
  const bytesMatch = combined.match(/(\d+(?:\.\d+)?)\s*bytes/i);
  if (bytesMatch) {
    const bytes = parseFloat(bytesMatch[1]);
    if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes > 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} Bytes`;
  }
  
  return 'Size Unknown';
}

function absoluteURL(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return new URL(url, BASE_URL).href;
}

function detectLinkType(url, text = '') {
  const combined = `${url} ${text}`.toLowerCase();
  
  if (combined.includes('subtitle') || combined.includes('srt') || combined.includes('උපසිරසි')) {
    return 'subtitle';
  }
  if (combined.includes('stream') || combined.includes('watch') || combined.includes('player')) {
    return 'stream';
  }
  if (combined.includes('torrent') || combined.includes('magnet')) {
    return 'torrent';
  }
  
  return 'download';
}

function analyzeDownloadLink(url, text = '') {
  const combined = `${url} ${text}`.toLowerCase();
  
  const hostedServices = [
    'pixeldrain', 'mediafire', 'mega.nz', 'drive.google', 'dropbox',
    'uploadrar', 'uptobox', 'rapidgator', 'zippyshare', 'sendspace',
    'file-upload', 'clicknupload', 'gofile', 'anonfiles', 'bayfiles',
    'mixdrop', 'doodstream', 'streamtape', 'racaty', 'gdtot'
  ];
  
  const directIndicators = [
    '.mkv', '.mp4', '.avi', '.mov', '.srt', '.zip', '.rar'
  ];
  
  let linkType = 'indirect';
  let service = 'unknown';
  let needsSteps = true;
  let estimatedSteps = [];
  
  for (const hosted of hostedServices) {
    if (combined.includes(hosted)) {
      service = hosted.replace('.', '');
      linkType = 'hosted';
      estimatedSteps = [
        'Visit link',
        'Wait for countdown (usually 5-15 seconds)',
        'Click download button',
        'Download starts'
      ];
      break;
    }
  }
  
  for (const indicator of directIndicators) {
    if (url.toLowerCase().includes(indicator)) {
      linkType = 'direct';
      service = 'direct';
      needsSteps = false;
      estimatedSteps = ['Click to download directly'];
      break;
    }
  }
  
  if (combined.includes('sinhalasub.lk/links/') || combined.includes('/links/')) {
    linkType = 'redirect';
    estimatedSteps = [
      'Opens intermediate page',
      'Countdown timer (usually 15 seconds)',
      'Download button appears',
      'Click to download'
    ];
  }
  
  return {
    link_type: linkType,
    service: service,
    requires_interaction: needsSteps,
    download_steps: estimatedSteps
  };
}

app.get('/', (req, res) => {
  res.json({
    name: 'SinhalaSub.lk Advanced API',
    version: '2.0.0',
    developer: 'Mr Senal',
    description: 'High-performance API for SinhalaSub.lk with advanced features',
    status: 'active',
    endpoints: {
      '/': 'API documentation',
      '/search': 'Search movies and TV series',
      '/movie/:id': 'Get movie details with all download links',
      '/series/:id': 'Get TV series details',
      '/episodes/:seriesId': 'Get all episodes of a TV series',
      '/episode/:id': 'Get single episode details with download links',
      '/latest': 'Get latest movies and series',
      '/trending': 'Get trending content',
      '/direct-links/:id': 'Get direct download links only'
    },
    features: [
      'Movie search with pagination',
      'TV series search',
      'Episode-wise download links',
      'Smart download link analysis',
      'Download step instructions (direct vs countdown)',
      'File hosting service detection',
      'Subtitle download links',
      'Multiple quality options',
      'File format & size detection',
      'Pretty JSON formatting',
      'Caching for better performance',
      'Rate limiting for stability',
      'Error handling and retry logic'
    ],
    download_info: {
      description: 'Each download link includes detailed information about the download process',
      fields: {
        method: 'Type of link (direct, redirect, hosted, indirect)',
        service: 'Hosting service name (pixeldrain, mediafire, etc.)',
        requires_interaction: 'Whether user action is needed (true/false)',
        steps: 'Step-by-step instructions for downloading'
      },
      example: {
        method: 'redirect',
        service: 'unknown',
        requires_interaction: true,
        steps: [
          'Opens intermediate page',
          'Countdown timer (usually 15 seconds)',
          'Download button appears',
          'Click to download'
        ]
      }
    },
    usage: {
      search: '/search?q=avatar&type=movie&page=1',
      searchSeries: '/search?q=game of thrones&type=series',
      movie: '/movie/avatar-2022',
      series: '/series/game-of-thrones',
      episodes: '/episodes/game-of-thrones',
      episode: '/episode/game-of-thrones-s01e01',
      directLinks: '/direct-links/avatar-2022'
    }
  });
});

app.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const page = req.query.page || '1';
    const type = req.query.type || 'all';

    if (!query) {
      return res.status(400).json({ 
        error: 'Query parameter "q" is required',
        example: '/search?q=avatar&type=movie&page=1'
      });
    }

    const cacheKey = `search_${query}_${page}_${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const searchURL = `${BASE_URL}/?s=${encodeURIComponent(query)}&paged=${page}`;
    const $ = await fetchHTML(searchURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch search results' });
    }

    const results = [];
    
    const foundElements = $('.item-box').length;
    console.log(`[SEARCH] Found ${foundElements} item-box elements`);

    $('.item-box').each((i, elem) => {
      try {
        const $elem = $(elem);
        
        const linkElem = $elem.find('a[data-url]').first();
        const link = linkElem.attr('href') || `https://sinhalasub.lk/${linkElem.attr('data-url')}/`;
        const dataUrl = linkElem.attr('data-url');
        
        const titleElem = $elem.find('.item-desc-title h3, h3').first();
        const title = titleElem.text().trim() || linkElem.attr('title');
        
        const imgElem = $elem.find('img.mli-thumb, img').first();
        const image = imgElem.attr('data-original') || imgElem.attr('src') || imgElem.attr('data-src');
        
        const yearElem = $elem.find('.item-desc-giha, .year, .date').first();
        const yearText = yearElem.text().trim();
        const yearMatch = yearText.match(/\d{4}/);
        const year = yearMatch ? yearMatch[0] : null;
        
        const qualityElem = $elem.find('.item-desc-hl, .quality').first();
        const quality = qualityElem.text().trim();

        const isSeries = title.toLowerCase().includes('season') || 
                        title.toLowerCase().includes('episode') ||
                        title.match(/s\d+e\d+/i) ||
                        $elem.find('.series-badge, .tv-series').length > 0;

        const contentType = isSeries ? 'series' : 'movie';

        if (type !== 'all' && type !== contentType) {
          return;
        }

        if (title && (link || dataUrl)) {
          results.push({
            title: title,
            url: link || `https://sinhalasub.lk/${dataUrl}/`,
            image: absoluteURL(image),
            year: year,
            quality: quality || extractQuality(title),
            type: contentType,
            id: dataUrl || link.split('/').filter(Boolean).pop()
          });
          console.log(`[FOUND] ${title} (${contentType})`);
        }
      } catch (err) {
        console.error('Error parsing search item:', err.message);
      }
    });

    const response = {
      success: true,
      search: {
        query: query,
        page: parseInt(page),
        type: type
      },
      results: {
        items: results,
        count: results.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/movie/:id', async (req, res) => {
  try {
    const movieId = req.params.id;
    const movieURL = `${BASE_URL}/${movieId}`;
    
    const cacheKey = `movie_${movieId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const $ = await fetchHTML(movieURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch movie details' });
    }

    const title = $('.item-title h1, h1, .entry-title, .title').first().text().trim() || 'Unknown';
    
    const descriptionElem = $('.item-desc, .description, .summary, .entry-content').first();
    const description = descriptionElem.text().trim() || null;

    const imgElem = $('img.mli-thumb, .item-poster img, img.poster, .featured-image img').first();
    const image = imgElem.attr('data-original') || imgElem.attr('src') || imgElem.attr('data-src');

    const meta = {};
    $('.meta-item, .movie-info, .info-item, .movie-data').each((i, elem) => {
      const $item = $(elem);
      const text = $item.text().trim();
      const label = $item.find('.label, strong, .meta-label').text().trim();
      const value = $item.find('.value, .meta-value').text().trim() || text.replace(label, '').replace(':', '').trim();
      
      if (label && value) {
        meta[label] = value;
      } else if (text.includes(':')) {
        const [key, ...valueParts] = text.split(':');
        meta[key.trim()] = valueParts.join(':').trim();
      }
    });

    const imdbRating = $('.imdb-rating, .rating, [class*="rating"]').first().text().trim();
    if (imdbRating) meta['Rating'] = imdbRating;

    const downloadLinks = [];
    const subtitleLinks = [];
    const seenUrls = new Set();

    $('a[href]').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');
      const text = $link.text().trim();
      const parent = $link.parent();
      const parentText = parent.text().trim();

      const isDownloadLink = 
        text.match(/download|ඩවුලෝඩ්|dlserver|link|direct|get|මෙතනින්|dl-|grab/i) ||
        href?.match(/\/links\//i) ||
        $link.attr('class')?.match(/download|link|button|btn|dl-/i) ||
        parent.attr('class')?.match(/download|links|button/i) ||
        $link.closest('.download, .links, .download-links, .download-section, .downloads, .item-links').length > 0;

      const isSubtitle = 
        text.match(/subtitle|උපසිරසි|sub|srt|caption/i) ||
        href?.match(/\.srt|\.sub|\.ass|subtitle/i);

      const isValid = href && 
        !href.includes('#') && 
        !href.includes('javascript:') &&
        !href.match(/facebook|twitter|whatsapp|telegram|instagram|share/i) &&
        !seenUrls.has(href);

      if (isValid && (isDownloadLink || isSubtitle)) {
        seenUrls.add(href);
        
        const downloadAnalysis = analyzeDownloadLink(href, text);
        
        const linkInfo = {
          name: text || 'Download Link',
          url: absoluteURL(href),
          quality: extractQuality(text) || extractQuality(parentText),
          format: extractFormat(href, text),
          size: extractSize(text, parentText),
          type: detectLinkType(href, text),
          download_info: {
            method: downloadAnalysis.link_type,
            service: downloadAnalysis.service,
            requires_interaction: downloadAnalysis.requires_interaction,
            steps: downloadAnalysis.download_steps
          }
        };

        if (isSubtitle) {
          subtitleLinks.push(linkInfo);
        } else {
          downloadLinks.push(linkInfo);
        }
      }
    });

    $('.download-links, .links-section, .download-section, .downloads, .links').each((i, section) => {
      $(section).find('a[href], button[data-url]').each((j, elem) => {
        const $link = $(elem);
        const href = $link.attr('href') || $link.attr('data-url');
        const text = $link.text().trim();

        if (href && !seenUrls.has(href)) {
          const isValid = 
            !href.includes('#') && 
            !href.includes('javascript:') &&
            !href.match(/facebook|twitter|whatsapp/i);

          if (isValid) {
            seenUrls.add(href);
            
            const downloadAnalysis = analyzeDownloadLink(href, text);
            
            const linkInfo = {
              name: text || 'Download Link',
              url: absoluteURL(href),
              quality: extractQuality(text),
              format: extractFormat(href, text),
              size: extractSize(text, $(section).text()),
              type: detectLinkType(href, text),
              download_info: {
                method: downloadAnalysis.link_type,
                service: downloadAnalysis.service,
                requires_interaction: downloadAnalysis.requires_interaction,
                steps: downloadAnalysis.download_steps
              }
            };

            if (text.match(/subtitle|උපසිරසි/i) || href.match(/\.srt|subtitle/i)) {
              subtitleLinks.push(linkInfo);
            } else {
              downloadLinks.push(linkInfo);
            }
          }
        }
      });
    });

    $('form[action], [data-download-url]').each((i, elem) => {
      const $elem = $(elem);
      const url = $elem.attr('action') || $elem.attr('data-download-url');
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        const buttonText = $elem.find('button, input[type="submit"]').val() || $elem.text().trim();
        const downloadAnalysis = analyzeDownloadLink(url, buttonText);
        
        downloadLinks.push({
          name: buttonText || 'Download Link',
          url: absoluteURL(url),
          quality: extractQuality(buttonText),
          format: extractFormat(url, buttonText),
          size: extractSize(buttonText, $elem.text()),
          type: 'download',
          download_info: {
            method: downloadAnalysis.link_type,
            service: downloadAnalysis.service,
            requires_interaction: downloadAnalysis.requires_interaction,
            steps: downloadAnalysis.download_steps
          }
        });
      }
    });

    const response = {
      success: true,
      movie: {
        id: movieId,
        title: title,
        url: movieURL,
        image: absoluteURL(image),
        description: description,
        meta: meta
      },
      downloads: {
        links: downloadLinks,
        count: downloadLinks.length
      },
      subtitles: {
        links: subtitleLinks,
        count: subtitleLinks.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Movie details error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/series/:id', async (req, res) => {
  try {
    const seriesId = req.params.id;
    const seriesURL = `${BASE_URL}/${seriesId}`;
    
    const cacheKey = `series_${seriesId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const $ = await fetchHTML(seriesURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch series details' });
    }

    const title = $('h1, .series-title, .entry-title').first().text().trim();
    const description = $('.description, .summary, .entry-content').first().text().trim();
    const image = $('.poster img, .series-poster img').first().attr('src');

    const seasons = [];
    const episodes = [];

    $('.season-item, .season, [class*="season"]').each((i, elem) => {
      const $season = $(elem);
      const seasonNum = $season.find('.season-number, .number').text().trim() || `Season ${i + 1}`;
      seasons.push({
        season: seasonNum,
        title: $season.find('.season-title, .title').text().trim()
      });
    });

    $('.episode-item, .episode, [class*="episode"]').each((i, elem) => {
      const $ep = $(elem);
      const epTitle = $ep.find('h2, h3, .title, .episode-title').first().text().trim();
      const epLink = $ep.find('a[href]').first().attr('href');
      const epNum = epTitle.match(/e\d+/i)?.[0] || `E${i + 1}`;

      if (epLink) {
        episodes.push({
          title: epTitle,
          episode: epNum,
          url: absoluteURL(epLink),
          id: epLink.split('/').filter(Boolean).pop()
        });
      }
    });

    const response = {
      success: true,
      series: {
        id: seriesId,
        title: title,
        url: seriesURL,
        image: absoluteURL(image),
        description: description,
        type: 'series'
      },
      seasons: {
        list: seasons,
        count: seasons.length
      },
      episodes: {
        list: episodes,
        count: episodes.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Series error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/episodes/:seriesId', async (req, res) => {
  try {
    const seriesId = req.params.seriesId;
    const season = req.query.season;
    
    const cacheKey = `episodes_${seriesId}_${season || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const seriesURL = `${BASE_URL}/${seriesId}`;
    const $ = await fetchHTML(seriesURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch episodes' });
    }

    const episodes = [];

    $('.episode-item, .episode, [class*="episode"], article').each((i, elem) => {
      const $ep = $(elem);
      const epTitle = $ep.find('h2, h3, .title, .episode-title, a').first().text().trim();
      const epLink = $ep.find('a[href]').first().attr('href');
      const epImage = $ep.find('img').first().attr('src');
      
      const seasonMatch = epTitle.match(/s(\d+)/i);
      const episodeMatch = epTitle.match(/e(\d+)/i);
      
      const epSeason = seasonMatch ? `S${seasonMatch[1]}` : null;
      const epNumber = episodeMatch ? `E${episodeMatch[1]}` : null;

      if (season && epSeason && epSeason.toLowerCase() !== season.toLowerCase()) {
        return;
      }

      if (epLink && (epTitle.match(/s\d+e\d+/i) || epTitle.includes('Episode'))) {
        episodes.push({
          title: epTitle,
          season: epSeason,
          episode: epNumber,
          url: absoluteURL(epLink),
          image: absoluteURL(epImage),
          id: epLink.split('/').filter(Boolean).pop()
        });
      }
    });

    const response = {
      success: true,
      series_id: seriesId,
      season: season || 'all',
      episodes: {
        list: episodes,
        count: episodes.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Episodes error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/episode/:id', async (req, res) => {
  try {
    const episodeId = req.params.id;
    const episodeURL = `${BASE_URL}/${episodeId}`;
    
    const cacheKey = `episode_${episodeId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const $ = await fetchHTML(episodeURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch episode details' });
    }

    const title = $('h1, .episode-title, .entry-title').first().text().trim();
    const description = $('.description, .summary, .entry-content').first().text().trim();
    const image = $('.poster img, .episode-poster img').first().attr('src');

    const downloadLinks = [];
    const subtitleLinks = [];
    const seenUrls = new Set();

    $('a[href]').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');
      const text = $link.text().trim();

      const isDownloadLink = 
        text.match(/download|link|direct|උපසිරසි/i) ||
        $link.closest('.download, .links').length > 0;

      const isSubtitle = text.match(/subtitle|උපසිරසි|srt/i) || href?.includes('.srt');

      if (href && isDownloadLink && !seenUrls.has(href)) {
        seenUrls.add(href);
        
        const downloadAnalysis = analyzeDownloadLink(href, text);
        
        const linkInfo = {
          name: text || 'Download Link',
          url: absoluteURL(href),
          quality: extractQuality(text),
          format: extractFormat(href, text),
          size: extractSize(text, $link.parent().text()),
          type: detectLinkType(href, text),
          download_info: {
            method: downloadAnalysis.link_type,
            service: downloadAnalysis.service,
            requires_interaction: downloadAnalysis.requires_interaction,
            steps: downloadAnalysis.download_steps
          }
        };

        if (isSubtitle) {
          subtitleLinks.push(linkInfo);
        } else {
          downloadLinks.push(linkInfo);
        }
      }
    });

    const response = {
      success: true,
      episode: {
        id: episodeId,
        title: title,
        url: episodeURL,
        image: absoluteURL(image),
        description: description,
        type: 'episode'
      },
      downloads: {
        links: downloadLinks,
        count: downloadLinks.length
      },
      subtitles: {
        links: subtitleLinks,
        count: subtitleLinks.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Episode error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/direct-links/:id', async (req, res) => {
  try {
    const contentId = req.params.id;
    const contentURL = `${BASE_URL}/${contentId}`;
    
    const $ = await fetchHTML(contentURL);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch content' });
    }

    const directLinks = [];
    const seenUrls = new Set();

    $('a[href]').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');
      const text = $link.text().trim();

      const isDirect = 
        href?.match(/\.(mkv|mp4|avi|mov|srt)$/i) ||
        text.match(/direct|dl|ඩවුලෝඩ්/i) ||
        $link.attr('download') !== undefined;

      if (href && isDirect && !seenUrls.has(href) && !href.includes('stream')) {
        seenUrls.add(href);
        const downloadAnalysis = analyzeDownloadLink(href, text);
        
        directLinks.push({
          name: text || 'Direct Download',
          url: absoluteURL(href),
          quality: extractQuality(text),
          format: extractFormat(href, text),
          size: extractSize(text, $link.parent().text()),
          is_direct: downloadAnalysis.link_type === 'direct',
          download_info: {
            method: downloadAnalysis.link_type,
            service: downloadAnalysis.service,
            requires_interaction: downloadAnalysis.requires_interaction,
            steps: downloadAnalysis.download_steps
          }
        });
      }
    });

    res.json({
      success: true,
      content_id: contentId,
      downloads: {
        links: directLinks,
        count: directLinks.length
      }
    });

  } catch (error) {
    console.error('Direct links error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/latest', async (req, res) => {
  try {
    const page = req.query.page || '1';
    const type = req.query.type || 'all';
    
    const cacheKey = `latest_${page}_${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = page === '1' ? BASE_URL : `${BASE_URL}/page/${page}/`;
    const $ = await fetchHTML(url);

    if (!$) {
      return res.status(500).json({ error: 'Failed to fetch latest content' });
    }

    const results = [];
    
    const foundElements = $('.item-box').length;
    console.log(`[LATEST] Found ${foundElements} item-box elements on homepage`);

    $('.item-box').slice(0, 24).each((i, elem) => {
      try {
        const $elem = $(elem);
        
        const linkElem = $elem.find('a[data-url]').first();
        const link = linkElem.attr('href') || `https://sinhalasub.lk/${linkElem.attr('data-url')}/`;
        const dataUrl = linkElem.attr('data-url');
        
        const titleElem = $elem.find('.item-desc-title h3, h3').first();
        const title = titleElem.text().trim() || linkElem.attr('title');
        
        const imgElem = $elem.find('img.mli-thumb, img').first();
        const image = imgElem.attr('data-original') || imgElem.attr('src') || imgElem.attr('data-src');
        
        const yearElem = $elem.find('.item-desc-giha, .year, .date').first();
        const yearText = yearElem.text().trim();
        const yearMatch = yearText.match(/\d{4}/);
        const year = yearMatch ? yearMatch[0] : null;

        const qualityElem = $elem.find('.item-desc-hl, .quality').first();
        const quality = qualityElem.text().trim();

        const isSeries = title.toLowerCase().includes('season') || 
                        title.toLowerCase().includes('episode') ||
                        title.match(/s\d+e\d+/i);
        const contentType = isSeries ? 'series' : 'movie';

        if (type !== 'all' && type !== contentType) {
          return;
        }

        if (title && (link || dataUrl)) {
          results.push({
            title: title,
            url: link || `https://sinhalasub.lk/${dataUrl}/`,
            image: absoluteURL(image),
            year: year,
            quality: quality || extractQuality(title),
            type: contentType,
            id: dataUrl || link.split('/').filter(Boolean).pop()
          });
        }
      } catch (err) {
        console.error('Error parsing latest item:', err.message);
      }
    });

    const response = {
      success: true,
      latest: {
        page: parseInt(page),
        type: type
      },
      results: {
        items: results,
        count: results.length
      }
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Latest error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy', 
    server: {
      uptime: `${Math.floor(process.uptime())} seconds`,
      memory_usage: {
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
        heap_used: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heap_total: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`
      }
    },
    cache: {
      total_keys: cache.keys().length,
      active: true
    }
  });
});

app.post('/cache/clear', (req, res) => {
  const keysCleared = cache.keys().length;
  cache.flushAll();
  res.json({ 
    success: true,
    message: 'Cache cleared successfully',
    keys_cleared: keysCleared
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Endpoint not found',
    message: 'Please check API documentation at /',
    requested_url: req.originalUrl,
    tip: 'Visit / for a complete list of available endpoints'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    developer: 'Mr Senal'
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    cache.close();
    process.exit(0);
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║         SinhalaSub.lk Advanced API v2.0.0                ║
║         Developer: Mr Senal                               ║
║                                                           ║
║         🚀 Server running on http://0.0.0.0:${PORT}       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

API Endpoints Available:
  - GET  /                     API Documentation
  - GET  /search?q=query       Search Movies/Series
  - GET  /movie/:id            Movie Details
  - GET  /series/:id           Series Details
  - GET  /episodes/:id         Episodes List
  - GET  /episode/:id          Episode Details
  - GET  /latest               Latest Content
  - GET  /direct-links/:id     Direct Download Links
  - GET  /health               Health Check
  - POST /cache/clear          Clear Cache
`);
});
