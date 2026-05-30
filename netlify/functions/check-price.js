exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL' }) };

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    const html = await res.text();
    let price = null;
    let title = null;
    let status = 'active';

    // Page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = titleMatch[1].trim().substring(0, 120);

    // Check if sold
    if (/sold|no longer available|listing expired|vehicle sold/i.test(html.substring(0, 5000))) {
      status = 'sold';
    }

    // JSON-LD structured data (most reliable)
    const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const block of jsonLdBlocks) {
      try {
        const data = JSON.parse(block[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const p = item?.offers?.price ?? item?.offers?.[0]?.price ?? item?.price;
          if (p) { price = parseFloat(String(p).replace(/[,$\s]/g, '')); break; }
        }
        if (price) break;
      } catch {}
    }

    // Cars.com specific
    if (!price) {
      const m = html.match(/"price"\s*:\s*(\d{4,6})/);
      if (m) price = parseInt(m[1]);
    }

    // CarGurus specific
    if (!price) {
      const m = html.match(/data-price="(\d{4,6})"/);
      if (m) price = parseInt(m[1]);
    }

    // AutoTrader specific
    if (!price) {
      const m = html.match(/"listingPrice"\s*:\s*\{"value"\s*:\s*(\d{4,6})/);
      if (m) price = parseInt(m[1]);
    }

    // OG price meta
    if (!price) {
      const m = html.match(/<meta[^>]*(?:property|name)=["']og:price:amount["'][^>]*content=["']([^"']+)["']/i);
      if (m) price = parseFloat(m[1].replace(/[,$]/g, ''));
    }

    // Generic dollar amount fallback (look for prominent prices $10k-$60k)
    if (!price) {
      const matches = [...html.matchAll(/\$\s*((?:[1-5]\d|[6-9])\d{3}(?:,\d{3})?)\b/g)];
      const prices = matches
        .map(m => parseInt(m[1].replace(',', '')))
        .filter(p => p >= 10000 && p <= 60000);
      if (prices.length > 0) {
        // Most common price
        const freq = {};
        prices.forEach(p => freq[p] = (freq[p] || 0) + 1);
        price = parseInt(Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0]);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        price: price ? Math.round(price) : null,
        title,
        status,
        url,
        checkedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ price: null, error: err.message, checkedAt: new Date().toISOString() })
    };
  }
};
