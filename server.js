const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'comments.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize comments file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ pages: {} }, null, 2));
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

app.listen(PORT, () => {
  console.log(`VIP Review Tool running on port ${PORT}`);
});
