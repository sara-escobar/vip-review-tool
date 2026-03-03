// DOM Elements
const pageUrlInput = document.getElementById('pageUrl');
const loadPageBtn = document.getElementById('loadPage');
const toggleModeBtn = document.getElementById('toggleMode');
const pageFrame = document.getElementById('pageFrame');
const previewWrapper = document.getElementById('previewWrapper');
const placeholder = document.getElementById('placeholder');
const pinOverlay = document.getElementById('pinOverlay');
const pinsContainer = document.getElementById('pinsContainer');
const commentsList = document.getElementById('commentsList');
const commentCount = document.getElementById('commentCount');
const addCommentForm = document.getElementById('addCommentForm');
const commentText = document.getElementById('commentText');
const submitCommentBtn = document.getElementById('submitComment');
const cancelCommentBtn = document.getElementById('cancelComment');
const authorInput = document.getElementById('authorName');
const filterBtns = document.querySelectorAll('.filter-btn');

// State
let currentUrl = '';
let comments = [];
let pinMode = false;
let pendingPin = null;
let currentFilter = 'all';
let activeCommentId = null;

// API Base URL
const API_BASE = window.location.origin;

// Load page
loadPageBtn.addEventListener('click', loadPage);
pageUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loadPage();
});

async function loadPage() {
  let url = pageUrlInput.value.trim();
  if (!url) return;
  
  // Add https if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    pageUrlInput.value = url;
  }
  
  currentUrl = url;
  pageFrame.src = url;
  previewWrapper.classList.add('active');
  placeholder.style.display = 'none';
  
  // Load comments for this URL
  await loadComments();
}

// Toggle pin mode
toggleModeBtn.addEventListener('click', () => {
  pinMode = !pinMode;
  toggleModeBtn.classList.toggle('active', pinMode);
  pinOverlay.classList.toggle('active', pinMode);
  toggleModeBtn.querySelector('.mode-text').textContent = pinMode ? 'Cancel' : 'Add Pin';
});

// Handle pin placement
pinOverlay.addEventListener('click', (e) => {
  if (!pinMode) return;
  
  const rect = pinOverlay.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  
  pendingPin = { x, y };
  showCommentForm();
  
  // Exit pin mode
  pinMode = false;
  toggleModeBtn.classList.remove('active');
  pinOverlay.classList.remove('active');
  toggleModeBtn.querySelector('.mode-text').textContent = 'Add Pin';
});

function showCommentForm() {
  addCommentForm.style.display = 'block';
  commentText.focus();
}

function hideCommentForm() {
  addCommentForm.style.display = 'none';
  commentText.value = '';
  pendingPin = null;
}

cancelCommentBtn.addEventListener('click', hideCommentForm);

// Submit comment
submitCommentBtn.addEventListener('click', submitComment);
commentText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) submitComment();
});

async function submitComment() {
  const text = commentText.value.trim();
  if (!text || !currentUrl) return;
  
  const author = authorInput.value.trim() || 'Anonymous';
  
  try {
    const response = await fetch(`${API_BASE}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        comment: text,
        author,
        x: pendingPin?.x || null,
        y: pendingPin?.y || null
      })
    });
    
    if (response.ok) {
      hideCommentForm();
      await loadComments();
    }
  } catch (error) {
    console.error('Error submitting comment:', error);
  }
}

// Load comments
async function loadComments() {
  if (!currentUrl) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/comments?url=${encodeURIComponent(currentUrl)}`);
    comments = await response.json();
    renderComments();
    renderPins();
  } catch (error) {
    console.error('Error loading comments:', error);
  }
}

// Render comments list
function renderComments() {
  const filtered = comments.filter(c => {
    if (currentFilter === 'open') return !c.resolved;
    if (currentFilter === 'resolved') return c.resolved;
    return true;
  });
  
  commentCount.textContent = comments.length;
  
  if (filtered.length === 0) {
    commentsList.innerHTML = `
      <div class="no-comments">
        <span>💬</span>
        <p>No comments yet</p>
        <p class="hint">Click "Add Pin" then click on the page to add a comment</p>
      </div>
    `;
    return;
  }
  
  commentsList.innerHTML = filtered.map((c, index) => {
    const pinNumber = comments.indexOf(c) + 1;
    const date = new Date(c.timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return `
      <div class="comment-card ${c.resolved ? 'resolved' : ''} ${c.id === activeCommentId ? 'active' : ''}" 
           data-id="${c.id}" onclick="highlightComment('${c.id}')">
        <div class="comment-card-header">
          <span class="comment-author">${escapeHtml(c.author)}</span>
          ${c.x !== null ? `<span class="comment-pin-badge">Pin #${pinNumber}</span>` : ''}
        </div>
        <p class="comment-text">${escapeHtml(c.comment)}</p>
        <div class="comment-footer">
          <span>${date}</span>
          <div class="comment-actions">
            <button class="resolve-btn" onclick="event.stopPropagation(); toggleResolve('${c.id}', ${!c.resolved})">
              ${c.resolved ? '↩ Reopen' : '✓ Resolve'}
            </button>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteComment('${c.id}')">
              🗑 Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Render pins on preview
function renderPins() {
  pinsContainer.innerHTML = comments
    .filter(c => c.x !== null && c.y !== null)
    .map((c, index) => {
      const pinNumber = comments.indexOf(c) + 1;
      return `
        <div class="pin ${c.resolved ? 'resolved' : ''} ${c.id === activeCommentId ? 'active' : ''}" 
             style="left: ${c.x}%; top: ${c.y}%"
             data-id="${c.id}"
             onclick="highlightComment('${c.id}')">
          <span class="pin-number">${pinNumber}</span>
        </div>
      `;
    }).join('');
}

// Highlight comment and pin
window.highlightComment = function(id) {
  activeCommentId = activeCommentId === id ? null : id;
  renderComments();
  renderPins();
  
  // Scroll to comment card
  if (activeCommentId) {
    const card = document.querySelector(`.comment-card[data-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

// Toggle resolve status
window.toggleResolve = async function(id, resolved) {
  try {
    await fetch(`${API_BASE}/api/comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, resolved })
    });
    await loadComments();
  } catch (error) {
    console.error('Error updating comment:', error);
  }
};

// Delete comment
window.deleteComment = async function(id) {
  if (!confirm('Delete this comment?')) return;
  
  try {
    await fetch(`${API_BASE}/api/comments/${id}?url=${encodeURIComponent(currentUrl)}`, {
      method: 'DELETE'
    });
    await loadComments();
  } catch (error) {
    console.error('Error deleting comment:', error);
  }
};

// Filter comments
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderComments();
  });
});

// Utility: escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Save author name to localStorage
authorInput.addEventListener('change', () => {
  localStorage.setItem('reviewAuthor', authorInput.value);
});

// Load saved author name
const savedAuthor = localStorage.getItem('reviewAuthor');
if (savedAuthor) authorInput.value = savedAuthor;
