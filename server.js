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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(injectedHtml);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Failed to load page: ' + err.message);
  }
});

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    };
    
    client.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const urlObj = new URL(url);
          redirectUrl = urlObj.origin + redirectUrl;
        }
        return fetchPage(redirectUrl).then(resolve).catch(reject);
      }
      
      let chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('utf8'));
      });
    }).on('error', reject);
  });
}

function injectCommentSystem(html, pageUrl) {
  // Fix relative URLs to absolute
  const baseUrl = 'https://www.vipmedicalgroup.com';
  
  // Add base tag if not present
  let modifiedHtml = html;
  if (!modifiedHtml.includes('<base')) {
    modifiedHtml = modifiedHtml.replace('<head>', `<head><base href="${baseUrl}/">`);
  }

  const commentScript = `
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  .vip-review-marker {
    position: absolute;
    width: 32px;
    height: 32px;
    background: #e74c3c;
    border: 3px solid white;
    border-radius: 50%;
    color: white;
    font-size: 14px;
    font-weight: 700;
    font-family: 'DM Sans', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    transition: transform 0.2s;
    pointer-events: auto !important;
  }
  .vip-review-marker:hover { transform: scale(1.15); }
  .vip-review-marker.resolved { background: #00b894; }
  .vip-review-marker.selected { background: #6c5ce7; transform: scale(1.2); }
  
  .vip-review-tooltip {
    position: fixed;
    background: white;
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 4px 25px rgba(0,0,0,0.25);
    z-index: 2147483647;
    max-width: 300px;
    font-family: 'DM Sans', sans-serif;
    display: none;
    pointer-events: none;
  }
  .vip-review-tooltip.visible { display: block; }
  .vip-review-tooltip-author {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
    color: #333;
  }
  .vip-review-tooltip-text {
    font-size: 13px;
    color: #555;
    line-height: 1.5;
  }
  .vip-review-tooltip-time {
    font-size: 11px;
    color: #999;
    margin-top: 8px;
  }
  
  body.vip-pin-mode,
  body.vip-pin-mode * { 
    cursor: crosshair !important; 
  }
  
  .vip-pin-indicator {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #6c5ce7;
    color: white;
    padding: 14px 28px;
    border-radius: 30px;
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    z-index: 2147483647;
    box-shadow: 0 4px 20px rgba(108,92,231,0.5);
    display: none;
    pointer-events: none;
  }
  body.vip-pin-mode .vip-pin-indicator { display: block; }
</style>

<div class="vip-review-tooltip" id="vipTooltip"></div>
<div class="vip-pin-indicator">👆 Click anywhere to add a comment</div>

<script>
(function() {
  var PAGE_URL = ${JSON.stringify(pageUrl)};
  var API_BASE = '/review';
  var comments = [];
  var selectedId = null;
  var tooltip = document.getElementById('vipTooltip');
  
  console.log('[VIP Review] Script loaded for:', PAGE_URL);
  
  // Load comments from API
  function loadComments() {
    console.log('[VIP Review] Loading comments...');
    fetch(API_BASE + '/api/comments?url=' + encodeURIComponent(PAGE_URL))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        console.log('[VIP Review] Loaded', data.length, 'comments');
        comments = data;
        renderMarkers();
      })
      .catch(function(err) {
        console.error('[VIP Review] Error loading comments:', err);
      });
  }
  
  // Render comment markers
  function renderMarkers() {
    // Remove old markers
    var oldMarkers = document.querySelectorAll('.vip-review-marker');
    for (var i = 0; i < oldMarkers.length; i++) {
      oldMarkers[i].remove();
    }
    
    comments.forEach(function(c, idx) {
      if (c.x == null || c.y == null) return;
      
      var marker = document.createElement('div');
      marker.className = 'vip-review-marker';
      if (c.resolved) marker.className += ' resolved';
      if (c.id === selectedId) marker.className += ' selected';
      marker.textContent = idx + 1;
      marker.style.left = c.x + 'px';
      marker.style.top = c.y + 'px';
      
      marker.onclick = function(e) {
        e.stopPropagation();
        e.preventDefault();
        showTooltip(c, marker);
        try {
          window.parent.postMessage({ type: 'SELECT_COMMENT', id: c.id }, '*');
        } catch(err) {}
        return false;
      };
      
      marker.onmouseenter = function() { showTooltip(c, marker); };
      marker.onmouseleave = function() { hideTooltip(); };
      
      document.body.appendChild(marker);
    });
  }
  
  function showTooltip(comment, marker) {
    var rect = marker.getBoundingClientRect();
    tooltip.innerHTML = '<div class="vip-review-tooltip-author">' + escapeHtml(comment.author) + '</div>' +
      '<div class="vip-review-tooltip-text">' + escapeHtml(comment.comment) + '</div>' +
      '<div class="vip-review-tooltip-time">' + new Date(comment.timestamp).toLocaleString() + '</div>';
    
    var left = rect.right + 15;
    if (left + 300 > window.innerWidth) {
      left = rect.left - 315;
    }
    tooltip.style.left = left + 'px';
    tooltip.style.top = rect.top + 'px';
    tooltip.classList.add('visible');
  }
  
  function hideTooltip() {
    tooltip.classList.remove('visible');
  }
  
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Listen for messages from parent
  window.addEventListener('message', function(e) {
    console.log('[VIP Review] Message received:', e.data);
    if (e.data && e.data.type === 'ENTER_PIN_MODE') {
      document.body.classList.add('vip-pin-mode');
    } else if (e.data && e.data.type === 'EXIT_PIN_MODE') {
      document.body.classList.remove('vip-pin-mode');
    } else if (e.data && e.data.type === 'RELOAD_COMMENTS') {
      loadComments();
    } else if (e.data && e.data.type === 'SELECT_COMMENT') {
      selectedId = e.data.id;
      renderMarkers();
      var marker = document.querySelector('.vip-review-marker.selected');
      if (marker) marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  
  // Handle clicks in pin mode
  document.addEventListener('click', function(e) {
    if (!document.body.classList.contains('vip-pin-mode')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    var x = e.pageX;
    var y = e.pageY;
    
    console.log('[VIP Review] Pin placed at:', x, y);
    document.body.classList.remove('vip-pin-mode');
    
    try {
      window.parent.postMessage({ type: 'PIN_PLACED', x: x, y: y }, '*');
    } catch(err) {
      console.error('[VIP Review] PostMessage error:', err);
    }
    
    return false;
  }, true);
  
  // Initialize when ready
  function init() {
    console.log('[VIP Review] Initializing...');
    loadComments();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
`;

  // Inject before </body> or at end
  if (modifiedHtml.includes('</body>')) {
    return modifiedHtml.replace('</body>', commentScript + '</body>');
  } else {
    return modifiedHtml + commentScript;
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
