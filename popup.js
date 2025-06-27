// Global variables to store page data
let currentPageData = {
  title: '',
  url: '',
  content: '',
  summary: '',
  metadata: {},
  alternativeContext: {}
};

// Wait for DOM to be fully loaded before getting elements
document.addEventListener('DOMContentLoaded', () => {
  // Force fixed dimensions immediately to prevent movement
  document.body.style.width = '380px';
  document.body.style.minWidth = '380px';
  document.body.style.maxWidth = '380px';
  document.documentElement.style.width = '380px';
  document.documentElement.style.minWidth = '380px';
  document.documentElement.style.maxWidth = '380px';
  
  // Elements from the DOM
  const elements = {
    pageTitle: document.getElementById('pageTitle'),
    pageUrl: document.getElementById('pageUrl'),
    folderSelect: document.getElementById('folderSelect'),
    suggestedFolder: document.getElementById('suggestedFolder'),
    notesInput: document.getElementById('notesInput'),
    pageSummary: document.getElementById('pageSummary'),
    saveBtn: document.getElementById('saveBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    refreshFolders: document.getElementById('refreshFolders'),
    statusMessage: document.getElementById('statusMessage'),
    statusText: document.getElementById('statusText'),
    loader: document.getElementById('loader')
  };

  // Pre-set fixed dimensions on all elements to prevent layout shifts
  if (elements.statusMessage) {
    elements.statusMessage.style.height = '44px';
    elements.statusMessage.style.minHeight = '44px';
    elements.statusMessage.style.maxHeight = '44px';
  }
  
  if (elements.folderSelect) {
    elements.folderSelect.style.height = '40px';
    elements.folderSelect.style.minHeight = '40px';
    elements.folderSelect.style.maxHeight = '40px';
  }
  
  if (elements.suggestedFolder) {
    elements.suggestedFolder.style.height = '40px';
    elements.suggestedFolder.style.minHeight = '40px';
    elements.suggestedFolder.style.maxHeight = '40px';
  }

  // Initialize the popup
  initializePopup(elements);

  // Add event listeners
  elements.saveBtn.addEventListener('click', () => saveBookmark(elements));
  elements.cancelBtn.addEventListener('click', () => window.close());
  elements.refreshFolders.addEventListener('click', () => loadBookmarkFolders(elements));
  
  // Listen for changes in the suggested folder input
  elements.suggestedFolder.addEventListener('input', () => {
    const userInput = elements.suggestedFolder.value.trim();
    if (userInput) {
      let foundMatch = false;
      Array.from(elements.folderSelect.options).forEach(option => {
        if (option.textContent.includes(userInput) || 
            option.textContent.endsWith(userInput)) {
          elements.folderSelect.value = option.value;
          foundMatch = true;
        }
      });
      
      if (!foundMatch) {
        elements.folderSelect.value = 'new';
      }
    }
  });
});

// Auto-save flag from settings
const defaultPatternSettings = { autoSaveBookmarks: false };
let autoSaveEnabled = false;

// Load the user's auto-save preference
chrome.storage.local.get(
  { patternSettings: defaultPatternSettings },
  ({ patternSettings }) => {
    autoSaveEnabled = patternSettings.autoSaveBookmarks;
  }
);

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
 * Enhanced folder extraction that handles multiple bookmark trees
 */
function extractFoldersEnhanced(bookmarkItems, path = '', result = [], level = 0) {
  for (const item of bookmarkItems) {
    if (item.children) {
      let currentPath = path;
      let displayTitle = item.title;
      
      // Add sync status indicator for root-level folders
      if (level === 1 && item.unmodifiable) {
        displayTitle += ' (Synced)';
      } else if (level === 1 && !item.unmodifiable && item.title) {
        displayTitle += ' (Local)';
      }
      
      if (item.title) {
        currentPath = path ? `${path} > ${displayTitle}` : displayTitle;
        
        // Only add non-root folders to the result
        if (level > 0) {
          result.push({ 
            id: item.id, 
            path: currentPath,
            unmodifiable: item.unmodifiable || false,
            level: level
          });
        }
      }
      
      // Recurse into the folder
      extractFoldersEnhanced(item.children, currentPath, result, level + 1);
    }
  }
  return result;
}

// Main initialization function
async function initializePopup(elements) {
  try {
    // Get current tab info
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    // Store basic page info
    currentPageData.title = currentTab.title;
    currentPageData.url = currentTab.url;
    
    // Display page info immediately to prevent layout shifts
    safeUpdateText(elements.pageTitle, currentPageData.title);
    safeUpdateText(elements.pageUrl, currentPageData.url);
    
    // Load bookmark folders
    await loadBookmarkFolders(elements);
    
    // Get page content from the content script
    try {
      chrome.tabs.sendMessage(currentTab.id, { action: "getPageContent" }, async (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Content script connection error:", chrome.runtime.lastError);
          handleContentScriptFailure(elements);
          return;
        }
        
        if (response && response.content) {
          currentPageData.content = response.content;
          currentPageData.metadata = response.structuredData || {};
          
          const initialSummary = response.summary || "Analyzing page content...";
          safeUpdateText(elements.pageSummary, initialSummary);
          
          try {
            const summaryResponse = await chrome.runtime.sendMessage({
              action: "generateSummary",
              content: currentPageData.content,
              metadata: { ...currentPageData.metadata, url: currentPageData.url, title: currentPageData.title },
              fallbackSummary: initialSummary
            });
            
            if (summaryResponse.summary) {
              currentPageData.summary = summaryResponse.summary;
              safeUpdateText(elements.pageSummary, summaryResponse.summary);
            } else if (summaryResponse.fallbackSummary) {
              currentPageData.summary = summaryResponse.fallbackSummary;
              
              if (summaryResponse.alternativeContext) {
                currentPageData.alternativeContext = summaryResponse.alternativeContext;
              }
            }
          } catch (error) {
            console.error("Failed to generate summary:", error);
          }
          
          await getAISuggestion(elements);
        } else {
          console.warn("Could not extract page content");
          
          currentPageData.alternativeContext = extractContextFromUrlAndMetadata({
            title: currentPageData.title,
            url: currentPageData.url
          });
          
          await getAISuggestion(elements);
        }
      });
    } catch (error) {
      handleContentScriptFailure(elements);
    }
  } catch (error) {
    showError("Error initializing popup: " + error.message, elements);
  }
}

// Safe text update that preserves layout
function safeUpdateText(element, text) {
  if (!element || !text) return;
  
  // Use a more stable approach to prevent layout shifts
  const maxLength = element === document.getElementById('pageTitle') ? 80 : 
                   element === document.getElementById('pageUrl') ? 60 : 200;
  
  const truncatedText = text.length > maxLength ? 
    text.substring(0, maxLength) + '...' : text;
  
  if (element.textContent !== truncatedText) {
    element.textContent = truncatedText;
  }
}

// Handle content script failure
function handleContentScriptFailure(elements) {
  updateStatus("Analyzing page...", false, elements);
  
  currentPageData.alternativeContext = extractContextFromUrlAndMetadata({
    title: currentPageData.title,
    url: currentPageData.url
  });
  
  getAISuggestion(elements).catch(error => {
    console.error("Could not get AI suggestion:", error);
    elements.suggestedFolder.value = "";
    elements.suggestedFolder.placeholder = "Please enter folder name";
    elements.suggestedFolder.disabled = false;
    updateStatus("", true, elements);
    elements.saveBtn.disabled = false;
  });
}

// Load bookmark folders with stable updates (UPDATED for new sync model)
async function loadBookmarkFolders(elements) {
  // Don't change the select content until we have the data
  const originalContent = elements.folderSelect.innerHTML;
  elements.folderSelect.disabled = true;
  
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    const folders = extractFoldersEnhanced(bookmarks);
    
    // Build the complete HTML first, then update in one operation
    let optionsHtml = '';
    
    // Add default option for root - use dynamic detection
    try {
      const defaultBookmarksBar = await getDefaultBookmarksBar();
      const defaultBarName = await getBookmarksBarName(bookmarks);
      optionsHtml += `<option value="${defaultBookmarksBar}">${defaultBarName}</option>`;
    } catch (error) {
      console.warn("Could not find default bookmarks bar, using fallback");
      optionsHtml += '<option value="1">Bookmarks Bar</option>';
    }
    
    // Add all other folders
    folders.forEach(folder => {
      const escapedPath = folder.path.replace(/"/g, '&quot;');
      optionsHtml += `<option value="${folder.id}">${escapedPath}</option>`;
    });
    
    // Add option to create new folder
    optionsHtml += '<option value="new">+ Create New Folder</option>';
    
    // Update in one operation to prevent layout shifts
    elements.folderSelect.innerHTML = optionsHtml;
    elements.folderSelect.disabled = false;
    
  } catch (error) {
    // Restore original content if there's an error
    elements.folderSelect.innerHTML = originalContent;
    showError("Error loading bookmark folders: " + error.message, elements);
  }
}

// NEW: Get the name of the default bookmarks bar
async function getBookmarksBarName(bookmarkTree) {
  const bookmarksBars = findBookmarksBars(bookmarkTree);
  
  if (bookmarksBars.length === 1) {
    return bookmarksBars[0].title || 'Bookmarks Bar';
  } else if (bookmarksBars.length > 1) {
    // Multiple bars - show which one we're using
    const nonSyncingBar = bookmarksBars.find(bar => !bar.unmodifiable);
    if (nonSyncingBar) {
      return `${nonSyncingBar.title} (Local)`;
    } else {
      return `${bookmarksBars[0].title} (Synced)`;
    }
  }
  
  return 'Bookmarks Bar';
}

// Get AI suggestion with stable UI updates
async function getAISuggestion(elements) {
  updateStatus("Getting AI suggestion...", false, elements);
  
  try {
    const result = await chrome.storage.local.get('geminiApiKey');
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      elements.suggestedFolder.placeholder = "No API key set";
      elements.suggestedFolder.disabled = false;
      updateStatus("Please set Gemini API key in extension options", true, elements);
      setStatusClass(elements.statusMessage, 'error');
      elements.saveBtn.disabled = true;
      return;
    }
    
    const userNotes = elements.notesInput.value.trim();
    
    // Get pattern recommendation
    let patternRecommendation = null;
    try {
      patternRecommendation = await chrome.runtime.sendMessage({
        action: "getUserPatternRecommendation",
        content: currentPageData.content || "",
        title: currentPageData.title
      });
    } catch (error) {
      console.warn("Could not get user pattern recommendation:", error);
    }
    
    // Get existing folders for context
    const existingFolders = Array.from(elements.folderSelect.options)
      .filter(option => option.value !== 'new' && option.value !== '')
      .map(option => option.textContent)
      .join(', ');
    
    const topCategories = analyzeExistingFolders(elements.folderSelect.options);
    
    // Check context availability
    let contextMissing = false;
    let alternativeContext = currentPageData.alternativeContext || {};
    
    if (!currentPageData.content || currentPageData.content.length < 100) {
      contextMissing = true;
      
      if (!alternativeContext || Object.keys(alternativeContext).length === 0) {
        alternativeContext = extractContextFromUrlAndMetadata({
          title: currentPageData.title,
          url: currentPageData.url,
          ...currentPageData.metadata
        });
      }
    }
    
    // Create prompt
    let prompt;
    
    if (contextMissing) {
      prompt = `I need to suggest the most appropriate bookmark folder with limited information.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
${userNotes ? `Note provided by user: ${userNotes}` : ''}

Domain: ${alternativeContext.domain || 'Unknown'}
${alternativeContext.pathParts ? `URL path terms: ${alternativeContext.pathParts.join(', ')}` : ''}
${alternativeContext.titleTerms ? `Key terms from title: ${alternativeContext.titleTerms.join(', ')}` : ''}
${alternativeContext.likelySite ? `This appears to be from: ${alternativeContext.likelySite}` : ''}

Existing bookmark folders: ${existingFolders || "None"}
Common categories in user's bookmark structure: ${topCategories}

${patternRecommendation && patternRecommendation.recommendation ? `IMPORTANT: Based on the user's bookmarking patterns, this content may belong in the folder: "${patternRecommendation.recommendation.path}"` : ''}

PRIORITY ORDER FOR SUGGESTIONS:
1. Use pattern recommendation if provided and confidence is medium/high
2. Use existing folder that closely matches domain or title terms
3. Suggest new folder based on domain or title terms

Then respond in this exact format:
USE_EXISTING: [exact folder name]

OR

CREATE_NEW: [new folder name]

The folder name must be 1-3 words maximum. Do not include any explanations, reasoning, colons, dashes, or additional text. Just the format above.`;
    } else {
      prompt = `Based on the webpage information below, suggest the most appropriate bookmark folder.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
${userNotes ? `Note provided by user: ${userNotes}` : ''}
${currentPageData.summary ? `Summary of page content: ${currentPageData.summary}` : ''}
${currentPageData.metadata.keywords ? `Keywords: ${currentPageData.metadata.keywords}` : ''}

Content excerpt:
${currentPageData.content ? currentPageData.content.substring(0, 500) + '...' : 'Not available'}

Existing bookmark folders: ${existingFolders || "None"}
Common categories in user's bookmark structure: ${topCategories}

${patternRecommendation && patternRecommendation.recommendation ? `IMPORTANT: Based on the user's bookmarking patterns, this content may belong in the folder: "${patternRecommendation.recommendation.path}"` : ''}

Then respond in this exact format:
USE_EXISTING: [folder name] 
or 
CREATE_NEW: [new folder name]

The folder name should be short (1-3 words) and descriptive of the topic.`;
    }

    // Send request to background script
    const response = await chrome.runtime.sendMessage({
      action: "getGeminiSuggestion",
      prompt: prompt
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Process the suggestion
    const suggestion = response.suggestion.trim();
    
    let folderName = '';
    let useExisting = false;
    
    const useExistingMatch = suggestion.match(/USE_EXISTING:\s*([^\n]+)/i);
    const createNewMatch = suggestion.match(/CREATE_NEW:\s*([^\n]+)/i);
    
    if (useExistingMatch) {
      useExisting = true;
      folderName = useExistingMatch[1].trim();
    } else if (createNewMatch) {
      useExisting = false;
      folderName = createNewMatch[1].trim();
    } else {
      const quotedMatch = suggestion.match(/["']([^"']+)["']/);
      const colonMatch = suggestion.match(/:\s*([^\n]+)/);
      
      if (quotedMatch) {
        folderName = quotedMatch[1].trim();
      } else if (colonMatch) {
        folderName = colonMatch[1].trim();
      } else {
        folderName = suggestion.split(/[.!?\n]/)[0].trim();
        if (folderName.length > 50) {
          folderName = folderName.substring(0, 50) + '...';
        }
      }
    }
    
    folderName = folderName.replace(/^["']|["']$/g, '');
    
    const displayName = folderName.includes(' > ') ? 
      folderName.split(' > ').pop() : folderName;
    
    // Update suggestion field with stable text
    safeUpdateText(elements.suggestedFolder, displayName);
    elements.suggestedFolder.value = displayName;
    elements.suggestedFolder.disabled = false;
    
    if (useExisting) {
      let found = false;
      Array.from(elements.folderSelect.options).forEach(option => {
        if (option.textContent === folderName) {
          elements.folderSelect.value = option.value;
          found = true;
          return;
        }
      });
      
      if (!found) {
        const targetFolderName = folderName.includes(' > ') ? 
          folderName.split(' > ').pop() : folderName;
          
        Array.from(elements.folderSelect.options).forEach(option => {
          if (option.textContent.endsWith(' > ' + targetFolderName)) {
            elements.folderSelect.value = option.value;
            found = true;
            return;
          }
        });
      }
      
      if (!found) {
        elements.folderSelect.value = 'new';
      }
    } else {
      elements.folderSelect.value = 'new';
    }
    
    if (autoSaveEnabled) {
      await saveBookmark(elements);
    } else {
      updateStatus("Ready to save!", true, elements);
      setStatusClass(elements.statusMessage, 'success');
      elements.saveBtn.disabled = false;
    }
    
  } catch (error) {
    elements.suggestedFolder.placeholder = "Please enter folder name";
    elements.suggestedFolder.disabled = false;
    
    showError("Could not get AI suggestion: " + error.message, elements);
    elements.saveBtn.disabled = false;
  }
}

// Stable class manipulation
function setStatusClass(element, className) {
  if (!element) return;
  
  // Remove existing status classes
  element.classList.remove('success', 'error');
  
  // Add new class if specified
  if (className) {
    element.classList.add(className);
  }
}

// Analyze existing folders
function analyzeExistingFolders(options) {
  const folderNames = Array.from(options)
    .filter(option => option.value !== 'new' && option.value !== '')
    .map(option => {
      const parts = option.textContent.split(' > ');
      return parts[parts.length - 1];
    });
  
  const categoryCounts = {};
  folderNames.forEach(name => {
    categoryCounts[name] = (categoryCounts[name] || 0) + 1;
  });
  
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0])
    .join(', ');
  
  return topCategories;
}

// Save bookmark with stable UI (UPDATED for new sync model)
async function saveBookmark(elements) {
  updateStatus("Saving bookmark...", false, elements);
  elements.saveBtn.disabled = true;
  
  try {
    const selectedFolder = elements.folderSelect.value;
    const notes = elements.notesInput.value;
    
    let bookmarkTitle = currentPageData.title;
    if (notes) {
      bookmarkTitle += ` - ${notes}`;
    }
    
    if (!notes && currentPageData.summary) {
      bookmarkTitle += ` - ${currentPageData.summary.substring(0, 100)}`;
      if (currentPageData.summary.length > 100) {
        bookmarkTitle += '...';
      }
    }
    
    const suggestedFolderValue = elements.suggestedFolder.value.trim();
    
    // Record bookmark action for pattern learning
    try {
      chrome.storage.local.get('bookmarkingHistory', (result) => {
        const history = result.bookmarkingHistory || [];
        
        let folderNameToStore;
        if (selectedFolder === 'new') {
          folderNameToStore = suggestedFolderValue;
        } else {
          folderNameToStore = Array.from(elements.folderSelect.options)
            .find(opt => opt.value === selectedFolder)?.textContent || '';
        }
        
        history.push({
          url: currentPageData.url,
          title: currentPageData.title, 
          selectedFolder: folderNameToStore,
          timestamp: Date.now()
        });
        
        if (history.length > 100) {
          history.shift();
        }
        
        chrome.storage.local.set({ 'bookmarkingHistory': history });
      });
    } catch (e) {
      console.warn("Could not save bookmark action to history:", e);
    }
    
    // Handle creating new folder or using existing (UPDATED for new sync model)
    if (selectedFolder === 'new') {
      const newFolderName = suggestedFolderValue;
      
      if (!newFolderName) {
        showError("Please enter a folder name", elements);
        elements.saveBtn.disabled = false;
        return;
      }
      
      // Use dynamic parent detection instead of hardcoded '1'
      const defaultParent = await getDefaultBookmarksBar();
      
      const newFolder = await chrome.bookmarks.create({
        parentId: defaultParent,
        title: newFolderName
      });
      
      await chrome.bookmarks.create({
        parentId: newFolder.id,
        title: bookmarkTitle,
        url: currentPageData.url
      });
      
    } else {
      await chrome.bookmarks.create({
        parentId: selectedFolder,
        title: bookmarkTitle,
        url: currentPageData.url
      });
    }
    
    updateStatus("Bookmark saved successfully!", true, elements);
    setStatusClass(elements.statusMessage, 'success');
    setTimeout(() => window.close(), 1500);
    
  } catch (error) {
    showError("Error saving bookmark: " + error.message, elements);
    elements.saveBtn.disabled = false;
  }
}

// Stable status update
function updateStatus(message, finished = false, elements) {
  if (!elements.statusText) return;
  
  // Update text content safely
  safeUpdateText(elements.statusText, message);
  
  // Update loader visibility
  if (elements.loader) {
    elements.loader.style.display = finished ? 'none' : 'inline-block';
  }
  
  // Reset status classes
  setStatusClass(elements.statusMessage, '');
  
  // Control status message visibility
  if (elements.statusMessage) {
    if (!message && finished) {
      elements.statusMessage.style.display = 'none';
    } else {
      elements.statusMessage.style.display = 'flex';
    }
  }
}

// Show error with stable UI
function showError(message, elements) {
  if (!elements.statusText) return;
  
  safeUpdateText(elements.statusText, message);
  setStatusClass(elements.statusMessage, 'error');
  
  if (elements.loader) {
    elements.loader.style.display = 'none';
  }
  
  if (elements.statusMessage) {
    elements.statusMessage.style.display = 'flex';
  }
}

// Extract context from URL and metadata
function extractContextFromUrlAndMetadata(metadata) {
  let context = {};
  
  if (metadata.title) {
    const titleTerms = metadata.title
      .replace(/\s-\s.*$/, '')
      .replace(/\|.*$/, '')
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !['http', 'https', 'www', 'com', 'org', 'the', 'and', 'for'].includes(word.toLowerCase())
      );
    
    context.titleTerms = titleTerms;
  }
  
  if (metadata.url) {
    try {
      const url = new URL(metadata.url);
      
      const domain = url.hostname.replace('www.', '');
      
      const pathParts = url.pathname.split('/')
        .filter(part => 
          part.length > 0 && 
          !['index', 'home', 'page', 'article', 'post', 'view'].includes(part.toLowerCase())
        );
      
      context.domain = domain;
      context.pathParts = pathParts;
      
      if (domain.includes('github.com')) {
        context.likelySite = 'Programming/GitHub';
      } else if (domain.includes('stackoverflow.com')) {
        context.likelySite = 'Programming/StackOverflow';
      } else if (domain.includes('medium.com')) {
        context.likelySite = 'Articles';
      } else if (domain.includes('youtube.com')) {
        context.likelySite = 'Videos';
      }
    } catch (error) {
      console.error("Error parsing URL:", error);
    }
  }
  
  return context;
}