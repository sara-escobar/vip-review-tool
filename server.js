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

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize comments file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ pages: {} }, null, 2));
}

// Browser instance
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

// Generate screenshot filename from URL
function getScreenshotFilename(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  return `${hash}.png`;
}

// Capture screenshot of a page
app.post('/api/screenshot', async (req, res) => {
  const { url, refresh } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Only allow VIP Medical Group URLs
  if (!url.startsWith('https://www.vipmedicalgroup.com')) {
    return res.status(400).json({ error: 'Only VIP Medical Group URLs allowed' });
  }

  const filename = getScreenshotFilename(url);
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  // Return cached screenshot if exists and not forcing refresh
  if (!refresh && fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    const age = Date.now() - stats.mtimeMs;
    // Cache for 1 hour
    if (age < 3600000) {
      return res.json({ 
        screenshot: `/screenshots/${filename}`,
        cached: true,
        url 
      });
    }
  }

  try {
    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();
    
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait a bit for any animations
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
    
    // Get full page height
    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    await bodyHandle.dispose();

    // Capture full page screenshot
    await page.screenshot({
      path: filepath,
      fullPage: true
    });

    await page.close();

    res.json({ 
      screenshot: `/screenshots/${filename}`,
      cached: false,
      url,
      height: boundingBox.height
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: 'Failed to capture screenshot: ' + error.message });
  }
});

// Get comments for a page
app.get('/api/comments', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const pageComments = data.pages[url] || [];
  res.json(pageComments);
});

// Add a comment
app.post('/api/comments', (req, res) => {
  const { url, comment, author, x, y } = req.body;
  if (!url || !comment) return res.status(400).json({ error: 'URL and comment required' });
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) data.pages[url] = [];
  
  const newComment = {
    id: Date.now().toString(),
    comment,
    author: author || 'Anonymous',
    x: x || null,
    y: y || null,
    timestamp: new Date().toISOString(),
    resolved: false
  };
  
  data.pages[url].push(newComment);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json(newComment);
});

// Toggle comment resolved status
app.patch('/api/comments/:id', (req, res) => {
  const { id } = req.params;
  const { url, resolved } = req.body;
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) return res.status(404).json({ error: 'Page not found' });
  
  const comment = data.pages[url].find(c => c.id === id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  
  comment.resolved = resolved;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json(comment);
});

// Delete a comment
app.delete('/api/comments/:id', (req, res) => {
  const { id } = req.params;
  const { url } = req.query;
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.pages[url]) return res.status(404).json({ error: 'Page not found' });
  
  data.pages[url] = data.pages[url].filter(c => c.id !== id);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// Get all pages with comment counts
app.get('/api/pages', (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const pages = Object.entries(data.pages).map(([url, comments]) => ({
    url,
    commentCount: comments.length,
    unresolvedCount: comments.filter(c => !c.resolved).length
  }));
  res.json(pages);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});

app.listen(PORT, () => {
  console.log(`VIP Review Tool running on port ${PORT}`);
});
