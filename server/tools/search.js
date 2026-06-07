import Exa from 'exa-js';

let _exa = null;
function getExa() {
  if (!_exa) {
    if (!process.env.EXA_API_KEY) throw new Error('EXA_API_KEY not configured');
    _exa = new Exa(process.env.EXA_API_KEY);
  }
  return _exa;
}

export async function webSearch(query, options = {}) {
  console.log('[tool] web_search called with:', query);
  try {
    const result = await getExa().searchAndContents(query, {
      numResults: options.numResults || 5,
      useAutoprompt: true,
      text: { maxCharacters: 2000 },
      ...options,
    });
    console.log('[tool] web_search success, results:', result.results.length);
    return {
      results: result.results.map(r => ({
        title: r.title,
        url: r.url,
        text: r.text,
        publishedDate: r.publishedDate,
      })),
    };
  } catch (err) {
    console.error('[tool] web_search error:', err.message);
    return { error: err.message };
  }
}

export async function webFetch(url) {
  console.log('[tool] web_fetch called with:', url);
  try {
    const result = await getExa().getContents([url], {
      text: { maxCharacters: 5000 },
    });
    console.log('[tool] web_fetch success');
    return {
      url,
      text: result.results[0]?.text || 'No content',
      title: result.results[0]?.title || '',
    };
  } catch (err) {
    console.error('[tool] web_fetch error:', err.message);
    return { error: err.message };
  }
}
