// DOM elements
const totalBookmarksEl = document.getElementById('totalBookmarks');
const unsortedBookmarksEl = document.getElementById('unsortedBookmarks');
const existingFoldersEl = document.getElementById('existingFolders');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingSection = document.getElementById('loadingSection');
const statusMessage = document.getElementById('statusMessage');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const analysisResults = document.getElementById('analysisResults');
const proposedFolders = document.getElementById('proposedFolders');
const applyOrganizationBtn = document.getElementById('applyOrganization');
const cancelOrganizationBtn = document.getElementById('cancelOrganization');
const completionMessage = document.getElementById('completionMessage');

let bookmarkData = {
  unsorted: [],
  existing: {},
  proposed: {}
};

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
  await updateBookmarkStats();
  
  // Add event listeners
  analyzeBtn.addEventListener('click', startAnalysis);
  applyOrganizationBtn.addEventListener('click', applyOrganization);
  cancelOrganizationBtn.addEventListener('click', () => {
    analysisResults.style.display = 'none';
    analyzeBtn.disabled = false;
  });
});

// NEW: Enhanced bookmark utilities for new sync model

/**
 * Get the appropriate bookmarks bar folder for saving new bookmarks
 * Prioritizes non-syncing bookmarks bar if available
 */
async function getDefaultBookmarksBar() {
  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    const bookmarksBars = findBookmarksBars(bookmarkTree);
    
    // Prefer non-syncing bookmarks bar if available
    const nonSyncingBar = bookmarksBars.find(bar => !bar.unmodifiable);
    if (nonSyncingBar) {
      return nonSyncingBar.id;
    }
    
    // Fallback to any available bookmarks bar
    if (bookmarksBars.length > 0) {
      return bookmarksBars[0].id;
    }
    
    // Last resort: try to find any suitable parent folder
    const rootNodes = bookmarkTree[0].children || [];
    for (const node of rootNodes) {
      if (node.children) {
        return node.id;
      }
    }
    
    throw new Error('No suitable bookmark folder found');
  } catch (error) {
    console.error('Error finding bookmarks bar:', error);
    throw error;
  }
}

/**
 * Find all bookmarks bar folders in the bookmark tree
 */
function findBookmarksBars(bookmarkTree) {
  const bookmarksBars = [];
  
  function traverse(nodes) {
    for (const node of nodes) {
      // Check if this is a bookmarks bar by index and title
      if (node.index === 0 && node.children && 
          (node.title === 'Bookmarks bar' || 
           node.title === 'Bookmarks Bar' ||
           node.id === '1')) {
        bookmarksBars.push(node);
      }
      
      if (node.children) {
        traverse(node.children);
      }
    }
  }
  
  if (bookmarkTree && bookmarkTree[0] && bookmarkTree[0].children) {
    traverse(bookmarkTree[0].children);
  }
  
  return bookmarksBars;
}

/**
 * Find all "Other Bookmarks" folders in the bookmark tree
 */
function findOtherBookmarksFolders(bookmarkTree) {
  const otherFolders = [];
  
  function traverse(nodes) {
    for (const node of nodes) {
      // Check if this is an "Other Bookmarks" folder
      if (node.children && 
          (node.title === 'Other bookmarks' || 
           node.title === 'Other Bookmarks' ||
           node.id === '2')) {
        otherFolders.push(node);
      }
      
      if (node.children) {
        traverse(node.children);
      }
    }
  }
  
  if (bookmarkTree && bookmarkTree[0] && bookmarkTree[0].children) {
    traverse(bookmarkTree[0].children);
  }
  
  return otherFolders;
}

/**
 * Get all unsorted bookmarks from both syncing and non-syncing trees
 */
function getUnsortedBookmarks(bookmarkTree) {
  const unsorted = [];
  const bookmarksBars = findBookmarksBars(bookmarkTree);
  const otherBookmarksFolders = findOtherBookmarksFolders(bookmarkTree);
  
  // Check all bookmarks bars for direct bookmarks
  bookmarksBars.forEach(bar => {
    if (bar.children) {
      bar.children.forEach(child => {
        if (child.url) { // It's a bookmark, not a folder
          unsorted.push({
            id: child.id,
            title: child.title,
            url: child.url,
            parentId: child.parentId
          });
        }
      });
    }
  });
  
  // Check all "Other Bookmarks" folders for direct bookmarks
  otherBookmarksFolders.forEach(folder => {
    if (folder.children) {
      folder.children.forEach(child => {
        if (child.url) { // It's a bookmark, not a folder
          unsorted.push({
            id: child.id,
            title: child.title,
            url: child.url,
            parentId: child.parentId
          });
        }
      });
    }
  });
  
  return unsorted;
}

/**
 * Enhanced bookmark statistics analysis for new sync model
 */
function analyzeBookmarkTreeEnhanced(bookmarkNodes) {
  const stats = {
    totalBookmarks: 0,
    unsortedBookmarks: 0,
    folderCount: 0,
    unsortedList: [],
    existingFolders: {},
    syncingBookmarks: 0,
    localBookmarks: 0
  };
  
  // Get unsorted bookmarks using the enhanced method
  stats.unsortedList = getUnsortedBookmarks(bookmarkNodes);
  stats.unsortedBookmarks = stats.unsortedList.length;
  
  // Count total bookmarks and folders
  function traverse(nodes, inSyncedTree = false) {
    for (const node of nodes) {
      if (node.children) {
        // It's a folder
        if (node.title) {
          stats.folderCount++;
          stats.existingFolders[node.id] = {
            title: node.title,
            parentId: node.parentId,
            path: getFullFolderPathEnhanced(node, bookmarkNodes),
            unmodifiable: node.unmodifiable || false
          };
        }
        
        // Recurse into the folder
        traverse(node.children, inSyncedTree || node.unmodifiable);
      } else if (node.url) {
        // It's a bookmark
        stats.totalBookmarks++;
        
        if (inSyncedTree || node.unmodifiable) {
          stats.syncingBookmarks++;
        } else {
          stats.localBookmarks++;
        }
      }
    }
  }
  
  traverse(bookmarkNodes);
  
  return stats;
}

/**
 * Enhanced path building that respects the new bookmark structure
 */
function getFullFolderPathEnhanced(targetNode, bookmarkTree) {
  const pathParts = [targetNode.title];
  let currentId = targetNode.parentId;
  
  // Build a lookup map for faster searching
  const nodeMap = {};
  function buildNodeMap(nodes) {
    for (const node of nodes) {
      nodeMap[node.id] = node;
      if (node.children) {
        buildNodeMap(node.children);
      }
    }
  }
  buildNodeMap(bookmarkTree);
  
  // Walk up the tree
  while (currentId && currentId !== '0') {
    const parentNode = nodeMap[currentId];
    if (parentNode && parentNode.title) {
      let title = parentNode.title;
      // Add sync indicator for root-level folders
      if (parentNode.parentId === '0' && parentNode.unmodifiable) {
        title += ' (Synced)';
      } else if (parentNode.parentId === '0' && !parentNode.unmodifiable) {
        title += ' (Local)';
      }
      pathParts.unshift(title);
      currentId = parentNode.parentId;
    } else {
      break;
    }
  }
  
  return pathParts.join(' > ');
}

// UPDATED: Enhanced bookmark stats function
async function updateBookmarkStats() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    const stats = analyzeBookmarkTreeEnhanced(bookmarks);
    
    totalBookmarksEl.textContent = stats.totalBookmarks;
    unsortedBookmarksEl.textContent = stats.unsortedBookmarks;
    existingFoldersEl.textContent = stats.folderCount;
    
    // Store unsorted bookmarks for analysis
    bookmarkData.unsorted = stats.unsortedList;
    bookmarkData.existing = stats.existingFolders;
    
  } catch (error) {
    console.error('Error getting bookmark stats:', error);
  }
}

// LEGACY: Keep original function for backward compatibility but mark as deprecated
function analyzeBookmarkTree(bookmarkNodes, stats = null, parentId = '0') {
  console.warn('analyzeBookmarkTree is deprecated, use analyzeBookmarkTreeEnhanced instead');
  if (!stats) {
    stats = {
      totalBookmarks: 0,
      unsortedBookmarks: 0,
      folderCount: 0,
      unsortedList: [],
      existingFolders: {}
    };
  }
  
  for (const node of bookmarkNodes) {
    if (node.children) {
      // It's a folder
      if (node.title) { // Ignore the root nodes
        stats.folderCount++;
        stats.existingFolders[node.id] = {
          title: node.title,
          parentId: node.parentId,
          path: getFullFolderPath(node)
        };
      }
      
      // Recurse into the folder
      analyzeBookmarkTree(node.children, stats, node.id);
    } else if (node.url) {
      // It's a bookmark
      stats.totalBookmarks++;
      
      // Consider it unsorted if it's directly in the bookmarks bar (ID: '1') or other bookmarks (ID: '2')
      if (node.parentId === '1' || node.parentId === '2') {
        stats.unsortedBookmarks++;
        stats.unsortedList.push({
          id: node.id,
          title: node.title,
          url: node.url,
          parentId: node.parentId
        });
      }
    }
  }
  
  return stats;
}

// LEGACY: Keep original function for backward compatibility
function getFullFolderPath(node) {
  if (!node.parentId || node.parentId === '0') {
    return node.title;
  }
  
  // Build the full path recursively
  const pathParts = [node.title];
  let currentId = node.parentId;
  
  while (currentId && currentId !== '0') {
    const parentNode = bookmarkData.existing[currentId];
    if (parentNode) {
      pathParts.unshift(parentNode.title);
      currentId = parentNode.parentId;
    } else {
      break;
    }
  }
  
  return pathParts.join(' > ');
}

// Function to fetch and analyze page content
async function fetchPageContent(url) {
  try {
    // Create a tab in the background - REMOVED pinned: true
    const tab = await chrome.tabs.create({ 
      url: url, 
      active: false
      // Removed: pinned: true  // This was causing the auto-pinning bug
    });
    
    // Wait for the tab to finish loading
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });
    
    // Execute content extraction script
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });
    
    // Close the tab immediately after content extraction
    await chrome.tabs.remove(tab.id);
    
    return result.result || {};
  } catch (error) {
    console.error('Error fetching page content:', error);
    return {};
  }
}

// Function to extract content from the page
function extractPageContent() {
  const content = {
    title: document.title || '',
    description: '',
    keywords: [],
    headings: [],
    text: '',
    metadata: {}
  };
  
  // Extract meta description
  const metaDescription = document.querySelector('meta[name="description"]');
  content.description = metaDescription ? metaDescription.content : '';
  
  // Extract keywords
  const metaKeywords = document.querySelector('meta[name="keywords"]');
  if (metaKeywords) {
    content.keywords = metaKeywords.content.split(',').map(k => k.trim());
  }
  
  // Extract OpenGraph metadata
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  const ogType = document.querySelector('meta[property="og:type"]');
  
  if (ogTitle) content.metadata.ogTitle = ogTitle.content;
  if (ogDescription) content.metadata.ogDescription = ogDescription.content;
  if (ogType) content.metadata.ogType = ogType.content;
  
  // Extract headings
  const headings = document.querySelectorAll('h1, h2, h3');
  content.headings = Array.from(headings).slice(0, 10).map(h => h.textContent.trim());
  
  // Extract main content
  const mainContent = document.querySelector('main, article, .content, .main-content, #content') || document.body;
  
  // Clone to avoid modifying the actual page
  const contentClone = mainContent.cloneNode(true);
  
  // Remove unwanted elements
  const unwantedSelectors = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', '.sidebar', '.menu', '.ad', '.advertisement'];
  unwantedSelectors.forEach(selector => {
    contentClone.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  // Extract text content
  content.text = contentClone.textContent
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000); // Limit to first 2000 characters
  
  return content;
}

async function startAnalysis() {
  if (bookmarkData.unsorted.length === 0) {
    showMessage('No unsorted bookmarks to organize!', 'success');
    return;
  }
  
  // Check for API key
  const result = await chrome.storage.local.get('geminiApiKey');
  if (!result.geminiApiKey) {
    showMessage('Please set your Gemini API key in the extension options first.', 'error');
    return;
  }
  
  analyzeBtn.disabled = true;
  loadingSection.style.display = 'block';
  analysisResults.style.display = 'none';
  
  try {
    // Analyze bookmarks and get folder suggestions
    const proposedOrganization = await analyzeBookmarks(bookmarkData.unsorted);
    
    // Store the proposed organization
    bookmarkData.proposed = proposedOrganization;
    
    // Display the proposed organization
    displayProposedOrganization(proposedOrganization);
    
    loadingSection.style.display = 'none';
    analysisResults.style.display = 'block';
    
  } catch (error) {
    showMessage(`Analysis failed: ${error.message}`, 'error');
    analyzeBtn.disabled = false;
    loadingSection.style.display = 'none';
  }
}

async function analyzeBookmarks(unsortedBookmarks) {
  const proposedOrganization = {};
  let processed = 0;
  
  updateProgress(processed, unsortedBookmarks.length);
  
  // Batch process bookmarks to avoid API rate limits
  const batchSize = 3; // Reduced batch size for content scraping
  
  for (let i = 0; i < unsortedBookmarks.length; i += batchSize) {
    const batch = unsortedBookmarks.slice(i, i + batchSize);
    
    // Process each bookmark in the batch
    await Promise.all(batch.map(async (bookmark) => {
      try {
        statusMessage.textContent = `Analyzing: ${bookmark.title}...`;
        
        // Fetch page content for better categorization
        const pageContent = await fetchPageContent(bookmark.url);
        
        // Get suggested folder with page content
        const suggestedFolder = await getSuggestedFolder(bookmark, pageContent);
        
        // Add to proposed organization
        if (!proposedOrganization[suggestedFolder]) {
          proposedOrganization[suggestedFolder] = {
            bookmarks: [],
            isNew: !isFolderExisting(suggestedFolder)
          };
        }
        
        proposedOrganization[suggestedFolder].bookmarks.push(bookmark);
        
      } catch (error) {
        console.error(`Error analyzing bookmark "${bookmark.title}":`, error);
        
        // Use generic fallback categorization
        const fallbackFolder = getGenericFallbackCategory(bookmark);
        
        if (!proposedOrganization[fallbackFolder]) {
          proposedOrganization[fallbackFolder] = {
            bookmarks: [],
            isNew: !isFolderExisting(fallbackFolder)
          };
        }
        proposedOrganization[fallbackFolder].bookmarks.push(bookmark);
      }
      
      processed++;
      updateProgress(processed, unsortedBookmarks.length);
    }));
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < unsortedBookmarks.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  return proposedOrganization;
}

async function getSuggestedFolder(bookmark, pageContent) {
  // Extract context from URL and title
  const context = extractContextFromUrlAndTitle(bookmark.url, bookmark.title);
  
  // Get existing folder names for context
  const existingFolderNames = Object.values(bookmarkData.existing)
    .map(folder => folder.title)
    .join(', ');
  
  // Enhanced prompt with page content
  const prompt = `Analyze this bookmark and suggest the most appropriate folder name.

Title: ${bookmark.title}
URL: ${bookmark.url}
Domain: ${context.domain || 'Unknown'}
URL path terms: ${context.pathParts ? context.pathParts.join(', ') : 'None'}
Key terms from title: ${context.titleTerms ? context.titleTerms.join(', ') : 'None'}

Page Content Analysis:
- Description: ${pageContent.description || 'Not available'}
- Keywords: ${pageContent.keywords?.join(', ') || 'None'}
- Headings: ${pageContent.headings?.slice(0, 5).join(', ') || 'None'}
- Content preview: ${pageContent.text?.slice(0, 300) || 'Not available'}
- Page type: ${pageContent.metadata?.ogType || 'Unknown'}

Existing folders: ${existingFolderNames}

CATEGORIZATION PRINCIPLES:
1. Identify if this is about a specific brand, product, or instance that belongs to a broader category
2. Look for relationships between specific items and general categories
3. If content is about a specific item (brand, model, technology), categorize it under the general product category
4. Use existing folder names if they represent appropriate broader categories
5. Create new folders only for truly distinct categories not represented in existing folders

Think about hierarchical relationships:
- Are we looking at a specific brand that belongs to a product category?
- Is this a specific technology that belongs to a broader field?
- Is this a specific type of content that belongs to a general category?

Based on the page content and context, determine the most logical broader category.

Respond with ONLY the folder name, nothing else.`;

  try {
    // Get suggestion from Gemini
    const response = await chrome.runtime.sendMessage({
      action: "getGeminiSuggestion",
      prompt: prompt
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    const folderName = response.suggestion.trim();
    
    return folderName || 'General';
    
  } catch (error) {
    console.error('Error getting folder suggestion:', error);
    
    // Use enhanced fallback with page content
    return getEnhancedFallbackCategory(bookmark, pageContent);
  }
}

function extractContextFromUrlAndTitle(url, title) {
  const context = {};
  
  // Extract domain
  try {
    const urlObj = new URL(url);
    context.domain = urlObj.hostname.replace('www.', '');
    
    // Extract path parts
    context.pathParts = urlObj.pathname.split('/')
      .filter(part => part.length > 0 && !['index', 'home', 'page'].includes(part.toLowerCase()));
  } catch (error) {
    console.error('Error parsing URL:', error);
  }
  
  // Extract title terms
  if (title) {
    context.titleTerms = title
      .replace(/\s-\s.*$/, '') // Remove site names after dash
      .replace(/\|.*$/, '')    // Remove site names after pipe
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !['http', 'https', 'www', 'com', 'org', 'the', 'and', 'for'].includes(word.toLowerCase())
      );
  }
  
  return context;
}

// Enhanced fallback categorization with page content
function getEnhancedFallbackCategory(bookmark, pageContent) {
  const url = bookmark.url.toLowerCase();
  const title = bookmark.title.toLowerCase();
  const description = (pageContent.description || '').toLowerCase();
  const contentText = (pageContent.text || '').toLowerCase();
  const keywords = (pageContent.keywords || []).join(' ').toLowerCase();
  
  // Look for patterns in all available content
  const allContent = `${title} ${description} ${keywords} ${contentText}`;
  
  // Recipe/cooking content
  if (allContent.includes('recipe') || allContent.includes('cooking') || 
      allContent.includes('ingredients') || allContent.includes('preparation')) {
    return 'Recipes';
  }
  
  // Development/programming
  if (allContent.includes('code') || allContent.includes('programming') || 
      allContent.includes('developer') || allContent.includes('software') ||
      url.includes('github.') || url.includes('stackoverflow.')) {
    return 'Development';
  }
  
  // News/articles
  if (allContent.includes('news') || allContent.includes('article') ||
      pageContent.metadata?.ogType === 'article' ||
      url.includes('/article') || url.includes('/story/')) {
    return 'News';
  }
  
  // Video content
  if (url.includes('youtube.') || url.includes('vimeo.') ||
      allContent.includes('video') || allContent.includes('watch')) {
    return 'Videos';
  }
  
  // Shopping/commerce
  if (allContent.includes('shop') || allContent.includes('buy') ||
      allContent.includes('price') || allContent.includes('cart') ||
      allContent.includes('product')) {
    return 'Shopping';
  }
  
  // Educational content
  if (allContent.includes('learn') || allContent.includes('tutorial') ||
      allContent.includes('course') || allContent.includes('education')) {
    return 'Education';
  }
  
  // Documentation
  if (url.includes('/docs') || url.includes('/documentation') ||
      allContent.includes('documentation') || allContent.includes('guide') ||
      allContent.includes('reference')) {
    return 'Documentation';
  }
  
  // Blog content
  if (url.includes('/blog') || url.includes('blog.') ||
      allContent.includes('blog') || pageContent.metadata?.ogType === 'blog') {
    return 'Blogs';
  }
  
  // Research/academic
  if (allContent.includes('research') || allContent.includes('study') ||
      allContent.includes('paper') || allContent.includes('academic')) {
    return 'Research';
  }
  
  // Tools/utilities
  if (allContent.includes('tool') || allContent.includes('utility') ||
      allContent.includes('calculator') || allContent.includes('converter')) {
    return 'Tools';
  }
  
  // Default fallback
  return getGenericFallbackCategory(bookmark);
}

// Generic fallback categorization based on patterns
function getGenericFallbackCategory(bookmark) {
  const url = bookmark.url.toLowerCase();
  const title = bookmark.title.toLowerCase();
  
  // Look for common web content patterns
  if (url.includes('recipe') || title.includes('recipe') || 
      url.includes('cooking') || title.includes('cooking')) {
    return 'Recipes';
  }
  
  if (url.includes('github.') || url.includes('gitlab.') || 
      url.includes('stackoverflow.') || title.includes('code') ||
      title.includes('programming')) {
    return 'Development';
  }
  
  if (url.includes('news') || title.includes('news') ||
      url.includes('.com/article') || url.includes('/story/')) {
    return 'News';
  }
  
  if (url.includes('youtube.') || url.includes('vimeo.') ||
      url.includes('video') || title.includes('video')) {
    return 'Videos';
  }
  
  if (url.includes('shop') || url.includes('store') ||
      url.includes('buy') || title.includes('price') ||
      title.includes('buy')) {
    return 'Shopping';
  }
  
  if (url.includes('/blog') || url.includes('blog.') ||
      title.includes('blog')) {
    return 'Blogs';
  }
  
  if (url.includes('/docs') || url.includes('/documentation') ||
      title.includes('documentation') || title.includes('guide')) {
    return 'Documentation';
  }
  
  // Look for domain-based patterns
  const domain = getDomainFromUrl(url);
  if (domain) {
    const domainParts = domain.split('.');
    if (domainParts.length > 1) {
      const domainName = domainParts[0];
      if (domainName.length > 3) {
        return capitalize(domainName);
      }
    }
  }
  
  // Default category
  return 'General';
}

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch (e) {
    return null;
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isFolderExisting(folderName) {
  return Object.values(bookmarkData.existing).some(folder => 
    folder.title.toLowerCase() === folderName.toLowerCase()
  );
}

function updateProgress(current, total) {
  const percentage = (current / total) * 100;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${current} of ${total} bookmarks analyzed`;
}

function displayProposedOrganization(proposedOrganization) {
  proposedFolders.innerHTML = '';
  
  for (const [folderName, folderData] of Object.entries(proposedOrganization)) {
    const folderGroup = document.createElement('div');
    folderGroup.className = 'folder-group';
    
    // Create folder header
    const header = document.createElement('div');
    header.className = 'folder-header';
    
    const folderInfo = document.createElement('div');
    folderInfo.innerHTML = `
      <div class="checkbox-container">
        <input type="checkbox" id="folder-${folderName}" checked>
        <span class="folder-name">${folderName}</span>
        <span class="folder-action ${folderData.isNew ? 'new-folder' : 'existing-folder'}">
          ${folderData.isNew ? '(New folder)' : '(Existing folder)'}
        </span>
      </div>
    `;
    
    const count = document.createElement('div');
    count.className = 'bookmark-count';
    count.textContent = `${folderData.bookmarks.length} bookmarks`;
    
    header.appendChild(folderInfo);
    header.appendChild(count);
    
    // Add click to expand/collapse
    header.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        const bookmarkList = folderGroup.querySelector('.bookmark-list');
        bookmarkList.style.display = bookmarkList.style.display === 'none' ? 'block' : 'none';
      }
    });
    
    // Create bookmark list
    const bookmarkList = document.createElement('div');
    bookmarkList.className = 'bookmark-list';
    bookmarkList.style.display = 'none';
    
    folderData.bookmarks.forEach((bookmark, index) => {
      const bookmarkItem = document.createElement('div');
      bookmarkItem.className = 'bookmark-item';
      
      bookmarkItem.innerHTML = `
        <input type="checkbox" id="bookmark-${folderName}-${index}" checked>
        <img class="bookmark-favicon" src="chrome://favicon/${bookmark.url}" alt="">
        <div>
          <div class="bookmark-title" title="${bookmark.title}">${bookmark.title}</div>
          <div class="bookmark-url" title="${bookmark.url}">${bookmark.url}</div>
        </div>
      `;
      
      bookmarkList.appendChild(bookmarkItem);
    });
    
    folderGroup.appendChild(header);
    folderGroup.appendChild(bookmarkList);
    proposedFolders.appendChild(folderGroup);
  }
}

// UPDATED: Apply organization with new sync model support
async function applyOrganization() {
  applyOrganizationBtn.disabled = true;
  
  const selectedOrganization = getSelectedOrganization();
  
  if (Object.keys(selectedOrganization).length === 0) {
    showMessage('No bookmarks selected for organization.', 'error');
    applyOrganizationBtn.disabled = false;
    return;
  }
  
  try {
    let movedCount = 0;
    let createdFolders = 0;
    
    for (const [folderName, bookmarks] of Object.entries(selectedOrganization)) {
      // Find or create the folder
      let folderId;
      
      const existingFolder = Object.entries(bookmarkData.existing).find(([id, folder]) => 
        folder.title.toLowerCase() === folderName.toLowerCase()
      );
      
      if (existingFolder) {
        folderId = existingFolder[0];
      } else {
        // Create new folder - use dynamic parent detection instead of hardcoded '1'
        const defaultParent = await getDefaultBookmarksBar();
        
        const newFolder = await chrome.bookmarks.create({
          parentId: defaultParent,
          title: folderName
        });
        folderId = newFolder.id;
        createdFolders++;
      }
      
      // Move bookmarks to the folder
      for (const bookmark of bookmarks) {
        await chrome.bookmarks.move(bookmark.id, { parentId: folderId });
        movedCount++;
      }
    }
    
    showMessage(
      `Successfully organized ${movedCount} bookmarks into ${Object.keys(selectedOrganization).length} folders (${createdFolders} new folders created).`,
      'success'
    );
    
    // Refresh the page after a short delay
    setTimeout(() => {
      window.location.reload();
    }, 2000);
    
  } catch (error) {
    showMessage(`Error organizing bookmarks: ${error.message}`, 'error');
    applyOrganizationBtn.disabled = false;
  }
}

function getSelectedOrganization() {
  const selected = {};
  
  for (const [folderName, folderData] of Object.entries(bookmarkData.proposed)) {
    const folderCheckbox = document.getElementById(`folder-${folderName}`);
    
    if (folderCheckbox && folderCheckbox.checked) {
      selected[folderName] = [];
      
      folderData.bookmarks.forEach((bookmark, index) => {
        const bookmarkCheckbox = document.getElementById(`bookmark-${folderName}-${index}`);
        if (bookmarkCheckbox && bookmarkCheckbox.checked) {
          selected[folderName].push(bookmark);
        }
      });
      
      // Remove folders with no selected bookmarks
      if (selected[folderName].length === 0) {
        delete selected[folderName];
      }
    }
  }
  
  return selected;
}

function showMessage(message, type) {
  completionMessage.textContent = message;
  completionMessage.className = type;
  completionMessage.style.display = 'block';
  
  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      completionMessage.style.display = 'none';
    }, 5000);
  }
}