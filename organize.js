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

async function updateBookmarkStats() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    const stats = analyzeBookmarkTree(bookmarks);
    
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

function analyzeBookmarkTree(bookmarkNodes, stats = null, parentId = '0') {
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
  const batchSize = 5;
  
  for (let i = 0; i < unsortedBookmarks.length; i += batchSize) {
    const batch = unsortedBookmarks.slice(i, i + batchSize);
    
    // Process each bookmark in the batch
    await Promise.all(batch.map(async (bookmark) => {
      try {
        const suggestedFolder = await getSuggestedFolder(bookmark);
        
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
        
        // Add to 'Uncategorized' if analysis fails
        if (!proposedOrganization['Uncategorized']) {
          proposedOrganization['Uncategorized'] = {
            bookmarks: [],
            isNew: !isFolderExisting('Uncategorized')
          };
        }
        proposedOrganization['Uncategorized'].bookmarks.push(bookmark);
      }
      
      processed++;
      updateProgress(processed, unsortedBookmarks.length);
    }));
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < unsortedBookmarks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return proposedOrganization;
}

async function getSuggestedFolder(bookmark) {
  // First, try to extract context from URL and title
  const context = extractContextFromUrlAndTitle(bookmark.url, bookmark.title);
  
  // Get existing folder names for context
  const existingFolderNames = Object.values(bookmarkData.existing)
    .map(folder => folder.title)
    .join(', ');
  
  // Prepare the prompt
  const prompt = `Analyze this bookmark and suggest the most appropriate folder name:

Title: ${bookmark.title}
URL: ${bookmark.url}
Domain: ${context.domain || 'Unknown'}
URL path terms: ${context.pathParts ? context.pathParts.join(', ') : 'None'}
Key terms from title: ${context.titleTerms ? context.titleTerms.join(', ') : 'None'}

Existing folders: ${existingFolderNames}

Suggest a single folder name that would best categorize this bookmark. If an existing folder is appropriate, use that exact name. Otherwise, suggest a new folder name. The folder name should be:
- 1-3 words maximum
- Clear and descriptive
- Consistent with existing folder naming patterns if similar folders exist

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
    return folderName || 'Uncategorized';
    
  } catch (error) {
    console.error('Error getting folder suggestion:', error);
    
    // Fallback: use domain-based categorization
    if (context.domain) {
      // Try to match with common domain patterns
      if (context.domain.includes('github.com') || context.domain.includes('gitlab.com')) {
        return 'Development';
      } else if (context.domain.includes('stackoverflow.com')) {
        return 'Programming';
      } else if (context.domain.includes('youtube.com') || context.domain.includes('vimeo.com')) {
        return 'Videos';
      } else if (context.domain.includes('medium.com') || context.domain.includes('dev.to')) {
        return 'Articles';
      } else if (context.domain.includes('news') || context.domain.includes('nytimes.com')) {
        return 'News';
      }
    }
    
    return 'Uncategorized';
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
        word.length > 3 && 
        !['http', 'https', 'www', 'com', 'org', 'the', 'and', 'for'].includes(word.toLowerCase())
      );
  }
  
  return context;
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
        // Create new folder in bookmarks bar
        const newFolder = await chrome.bookmarks.create({
          parentId: '1', // Bookmarks bar
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