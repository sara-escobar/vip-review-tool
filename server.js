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

// Ensure directories exist
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Initialize comments file
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ pages: {} }, null, 2));
}

// All VIP pages
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

// Get list of pages with screenshot status
app.get('/api/pages', (req, res) => {
  const pages = VIP_PAGES.map(p => {
    const filename = getScreenshotFilename(p.url);
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    const hasScreenshot = fs.existsSync(filepath);
    
    // Get comment count
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

// Capture screenshot of a single page
app.post('/api/screenshot', async (req, res) => {
  const { url, refresh } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const page = VIP_PAGES.find(p => p.url === url);
  if (!page) return res.status(400).json({ error: 'URL not in allowed list' });

  const filename = getScreenshotFilename(url);
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  // Return cached if exists and not refreshing
  if (!refresh && fs.existsSync(filepath)) {
    return res.json({ 
      screenshot: `/screenshots/${filename}`,
      cached: true
    });
  }

  try {
    const browserInstance = await getBrowser();
    const browserPage = await browserInstance.newPage();
    
    await browserPage.setViewport({ width: 1400, height: 900 });
    await browserPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await browserPage.evaluate(() => new Promise(r => setTimeout(r, 2000)));
    
    await browserPage.screenshot({
      path: filepath,
      fullPage: true
    });

    await browserPage.close();

    res.json({ 
      screenshot: `/screenshots/${filename}`,
      cached: false
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: 'Failed to capture: ' + error.message });
  }
});

// Capture all screenshots
app.post('/api/screenshot/all', async (req, res) => {
  const { refresh } = req.body;
  const results = [];

  try {
    const browserInstance = await getBrowser();

    for (const page of VIP_PAGES) {
      const filename = getScreenshotFilename(page.url);
      const filepath = path.join(SCREENSHOTS_DIR, filename);

      if (!refresh && fs.existsSync(filepath)) {
        results.push({ url: page.url, name: page.name, status: 'cached' });
        continue;
      }

      try {
        const browserPage = await browserInstance.newPage();
        await browserPage.setViewport({ width: 1400, height: 900 });
        await browserPage.goto(page.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await browserPage.evaluate(() => new Promise(r => setTimeout(r, 2000)));
        
        await browserPage.screenshot({
          path: filepath,
          fullPage: true
        });

        await browserPage.close();
        results.push({ url: page.url, name: page.name, status: 'captured' });
        console.log(`Captured: ${page.name}`);
      } catch (err) {
        results.push({ url: page.url, name: page.name, status: 'error', error: err.message });
        console.error(`Error capturing ${page.name}:`, err.message);
      }
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});

app.listen(PORT, () => {
  console.log(`VIP Review Tool running on port ${PORT}`);
});
