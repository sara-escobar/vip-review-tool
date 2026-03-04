const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'comments.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'public', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ pages: {} }, null, 2));
}

const VIP_PAGES = [
  { name: 'Home', url: 'https://www.vipmedicalgroup.com/' },
  { name: 'About Us', url: 'https://www.vipmedicalgroup.com/about-us/' },
  { name: 'Meet Our Doctors', url: 'https://www.vipmedicalgroup.com/meet-our-doctors/' },
  { name: 'Meet Our Team', url: 'https://www.vipmedicalgroup.com/meet-our-team/' },
  { name: 'What to Expect', url: 'https://www.vipmedicalgroup.com/what-to-expect/' },
  { name: 'Your Visit', url: 'https://www.vipmedicalgroup.com/your-visit/' },
  { name: 'Locations', url: 'https://www.vipmedicalgroup.com/locations/' },
  { name: 'Book Appointment', url: 'https://www.vipmedicalgroup.com/book-appointment/' },
  { name: 'Careers', url: 'https://www.vipmedicalgroup.com/careers/' },
  { name: 'Vein Treatments', url: 'https://www.vipmedicalgroup.com/vein-treatments/' },
  { name: 'Spider Veins', url: 'https://www.vipmedicalgroup.com/vein-treatment/spider-veins/' },
  { name: 'Varicose Veins', url: 'https://www.vipmedicalgroup.com/vein-treatment/varicose-veins/' },
  { name: 'Chronic Venous Insufficiency', url: 'https://www.vipmedicalgroup.com/vein-treatment/chronic-venous-insufficiency/' },
  { name: 'Vein Treatment Results', url: 'https://www.vipmedicalgroup.com/vein-treatment-results/' },
  { name: 'Pain Treatments', url: 'https://www.vipmedicalgroup.com/pain-treatments/' },
  { name: 'Pain Treatment Results', url: 'https://www.vipmedicalgroup.com/pain-treatment-results/' },
  { name: 'Referrals', url: 'https://www.vipmedicalgroup.com/referrals/' },
  { name: 'How Referral Process Works', url: 'https://www.vipmedicalgroup.com/how-referral-process-works/' },
];

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browser;
}

function getScreenshotFilename(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  return `${hash}.png`;
}

// Get pages list
app.get('/api/pages', (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const pages = VIP_PAGES.map(p => {
    const filename = getScreenshotFilename(p.url);
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    const hasScreenshot = fs.existsSync(filepath);
    const comments = data.pages[p.url] || [];
    
    return {
      ...p,
      filename,
      hasScreenshot,
      screenshotUrl: hasScreenshot ? `/screenshots/${filename}` : null,
      commentCount: comments.length,
      openComments: comments.filter(c => !c.resolved).length
    };
  });
  res.json(pages);
});

// Capture screenshot with cookie acceptance
app.post('/api/screenshot', async (req, res) => {
  const { url, refresh } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const page = VIP_PAGES.find(p => p.url === url);
  if (!page) return res.status(400).json({ error: 'URL not in allowed list' });

  const filename = getScreenshotFilename(url);
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  if (!refresh && fs.existsSync(filepath)) {
    return res.json({ screenshot: `/screenshots/${filename}`, cached: true });
  }

  try {
    const browserInstance = await getBrowser();
    const browserPage = await browserInstance.newPage();
    
    await browserPage.setViewport({ width: 1400, height: 900 });
    await browserPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Accept cookies - try common cookie consent buttons
    try {
      await browserPage.evaluate(() => {
        const selectors = [
          '[class*="cookie"] button[class*="accept"]',
          '[class*="cookie"] button[class*="agree"]',
          '[id*="cookie"] button',
          'button[class*="accept-cookies"]',
          '.cookie-consent button',
          '#onetrust-accept-btn-handler',
          '.cc-accept',
          '[data-action="accept"]'
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn) { btn.click(); break; }
        }
      });
      await browserPage.evaluate(() => new Promise(r => setTimeout(r, 1000)));
    } catch (e) { /* ignore cookie errors */ }
    
    await browserPage.evaluate(() => new Promise(r => setTimeout(r, 2000)));
    
    await browserPage.screenshot({ path: filepath, fullPage: true });
    await browserPage.close();

    res.json({ screenshot: `/screenshots/${filename}`, cached: false });
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: 'Failed to capture: ' + error.message });
  }
});

// Get comments
app.get('/api/comments', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  res.json(data.pages[url] || []);
});

// Add comment
app.post('/api/comments', (req, res) => {
  const { url, comment, author, x, y, urgency, parentId } = req.body;
  if (!url || !comment) return res.status(400).json({ error: 'URL and comment required' });
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) data.pages[url] = [];
  
  const newComment = {
    id: Date.now().toString(),
    comment,
    author: author || 'Anonymous',
    x: x || null,
    y: y || null,
    urgency: urgency || 'medium', // low, medium, high, critical
    parentId: parentId || null, // for replies
    timestamp: new Date().toISOString(),
    resolved: false,
    replies: []
  };
  
  // If it's a reply, add to parent's replies array
  if (parentId) {
    const parent = data.pages[url].find(c => c.id === parentId);
    if (parent) {
      if (!parent.replies) parent.replies = [];
      parent.replies.push(newComment);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      return res.json(newComment);
    }
  }
  
  data.pages[url].push(newComment);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json(newComment);
});

// Update comment
app.patch('/api/comments/:id', (req, res) => {
  const { id } = req.params;
  const { url, resolved, urgency } = req.body;
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) return res.status(404).json({ error: 'Page not found' });
  
  const comment = data.pages[url].find(c => c.id === id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  
  if (resolved !== undefined) comment.resolved = resolved;
  if (urgency !== undefined) comment.urgency = urgency;
  
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json(comment);
});

// Delete comment
app.delete('/api/comments/:id', (req, res) => {
  const { id } = req.params;
  const { url } = req.query;
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) return res.status(404).json({ error: 'Page not found' });
  
  data.pages[url] = data.pages[url].filter(c => c.id !== id);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});

app.listen(PORT, () => {
  console.log(`VIP Review Tool running on port ${PORT}`);
});
