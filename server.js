const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'comments.json');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Initialize comments file
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ pages: {} }, null, 2));
}

// Fetch and proxy a page with injected comment system
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');
  
  if (!url.startsWith('https://www.vipmedicalgroup.com')) {
    return res.status(400).send('Only VIP Medical Group URLs allowed');
  }

  try {
    const html = await fetchPage(url);
    const injectedHtml = injectCommentSystem(html, url);
    res.setHeader('Content-Type', 'text/html');
    res.send(injectedHtml);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Failed to load page: ' + err.message);
  }
});

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchPage(response.headers.location).then(resolve).catch(reject);
      }
      
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function injectCommentSystem(html, pageUrl) {
  const commentScript = `
<style>
  .vip-comment-marker {
    position: absolute;
    width: 28px;
    height: 28px;
    background: #e74c3c;
    border: 2px solid white;
    border-radius: 50%;
    color: white;
    font-size: 12px;
    font-weight: 700;
    font-family: 'DM Sans', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 999999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: transform 0.2s;
    pointer-events: auto;
  }
  .vip-comment-marker:hover { transform: scale(1.15); }
  .vip-comment-marker.resolved { background: #00b894; }
  .vip-comment-marker.selected { background: #6c5ce7; transform: scale(1.2); }
  
  .vip-comment-tooltip {
    position: absolute;
    background: white;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    z-index: 9999999;
    max-width: 280px;
    font-family: 'DM Sans', sans-serif;
    display: none;
  }
  .vip-comment-tooltip.visible { display: block; }
  .vip-comment-tooltip-author {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
    color: #333;
  }
  .vip-comment-tooltip-text {
    font-size: 13px;
    color: #555;
    line-height: 1.4;
  }
  .vip-comment-tooltip-time {
    font-size: 11px;
    color: #999;
    margin-top: 6px;
  }
  
  .vip-pin-mode * { cursor: crosshair !important; }
  .vip-pin-mode::after {
    content: 'Click anywhere to place a comment pin';
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #6c5ce7;
    color: white;
    padding: 12px 24px;
    border-radius: 25px;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 9999999;
    box-shadow: 0 4px 15px rgba(108,92,231,0.4);
  }
</style>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>
(function() {
  const PAGE_URL = ${JSON.stringify(pageUrl)};
  const API_BASE = window.location.origin + '/review';
  let comments = [];
  let selectedId = null;
  let tooltip = null;
  
  // Create tooltip element
  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'vip-comment-tooltip';
    document.body.appendChild(tooltip);
  }
  
  // Load comments from API
  async function loadComments() {
    try {
      const res = await fetch(API_BASE + '/api/comments?url=' + encodeURIComponent(PAGE_URL));
      comments = await res.json();
      renderMarkers();
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  }
  
  // Render comment markers
  function renderMarkers() {
    // Remove old markers
    document.querySelectorAll('.vip-comment-marker').forEach(m => m.remove());
    
    comments.forEach((c, i) => {
      if (c.x == null || c.y == null) return;
      
      const marker = document.createElement('div');
      marker.className = 'vip-comment-marker' + (c.resolved ? ' resolved' : '') + (c.id === selectedId ? ' selected' : '');
      marker.textContent = i + 1;
      marker.style.left = c.x + 'px';
      marker.style.top = c.y + 'px';
      
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showTooltip(c, marker);
        window.parent.postMessage({ type: 'SELECT_COMMENT', id: c.id }, '*');
      });
      
      marker.addEventListener('mouseenter', () => showTooltip(c, marker));
      marker.addEventListener('mouseleave', hideTooltip);
      
      document.body.appendChild(marker);
    });
  }
  
  function showTooltip(comment, marker) {
    const rect = marker.getBoundingClientRect();
    tooltip.innerHTML = \`
      <div class="vip-comment-tooltip-author">\${escapeHtml(comment.author)}</div>
      <div class="vip-comment-tooltip-text">\${escapeHtml(comment.comment)}</div>
      <div class="vip-comment-tooltip-time">\${new Date(comment.timestamp).toLocaleString()}</div>
    \`;
    tooltip.style.left = (rect.right + 10) + 'px';
    tooltip.style.top = (rect.top + window.scrollY) + 'px';
    tooltip.classList.add('visible');
  }
  
  function hideTooltip() {
    tooltip.classList.remove('visible');
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Listen for messages from parent
  window.addEventListener('message', (e) => {
    if (e.data.type === 'ENTER_PIN_MODE') {
      document.body.classList.add('vip-pin-mode');
    } else if (e.data.type === 'EXIT_PIN_MODE') {
      document.body.classList.remove('vip-pin-mode');
    } else if (e.data.type === 'RELOAD_COMMENTS') {
      loadComments();
    } else if (e.data.type === 'SELECT_COMMENT') {
      selectedId = e.data.id;
      renderMarkers();
      // Scroll to marker
      const marker = document.querySelector('.vip-comment-marker.selected');
      if (marker) marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  
  // Handle clicks in pin mode
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('vip-pin-mode')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const x = e.pageX;
    const y = e.pageY;
    
    document.body.classList.remove('vip-pin-mode');
    window.parent.postMessage({ type: 'PIN_PLACED', x, y }, '*');
  }, true);
  
  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    createTooltip();
    loadComments();
  });
  
  // Also try immediately in case DOMContentLoaded already fired
  if (document.readyState !== 'loading') {
    createTooltip();
    loadComments();
  }
})();
</script>
`;

  // Inject before </body> or at end
  if (html.includes('</body>')) {
    return html.replace('</body>', commentScript + '</body>');
  } else {
    return html + commentScript;
  }
}

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

app.listen(PORT, () => {
  console.log(`VIP Review Tool running on port ${PORT}`);
});
