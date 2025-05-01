// Global variables to store page data
let currentPageData = {
  title: '',
  url: '',
  content: '',
  summary: '',
  metadata: {}
};

// Variable to track if the suggestion came from pattern matching
let isPatternBasedSuggestion = false;

// Elements from the DOM
const elements = {
  pageTitle: document.getElementById('pageTitle'),
  pageUrl: document.getElementById('pageUrl'),
  aboutInput: document.getElementById('aboutInput'),
  folderSelect: document.getElementById('folderSelect'),
  suggestedFolder: document.getElementById('suggestedFolder'),
  patternMatchContainer: document.getElementById('patternMatchContainer'),
  patternMatchText: document.getElementById('patternMatchText'),
  patternInfoBtn: document.getElementById('patternInfoBtn'),
  patternInfoModal: document.getElementById('patternInfoModal'),
  closePatternInfo: document.getElementById('closePatternInfo'),
  notesInput: document.getElementById('notesInput'),
  pageSummary: document.getElementById('pageSummary'),
  saveBtn: document.getElementById('saveBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  refreshFolders: document.getElementById('refreshFolders'),
  statusMessage: document.getElementById('statusMessage'),
  statusText: document.getElementById('statusText'),
  loader: document.getElementById('loader')
};

// Initialize the popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab info
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  
  // Store basic page info
  currentPageData.title = currentTab.title;
  currentPageData.url = currentTab.url;
  
  // Display page info in the popup
  elements.pageTitle.textContent = currentPageData.title;
  elements.pageUrl.textContent = currentPageData.url;
  
  // Load bookmark folders
  await loadBookmarkFolders();
  
  // Get page content from the content script
  try {
    chrome.tabs.sendMessage(currentTab.id, { action: "getPageContent" }, async (response) => {
      if (response && response.content) {
        // Store content and metadata
        currentPageData.content = response.content;
        currentPageData.metadata = response.structuredData || {};
        
        // Use the initial summary from content script while we generate a better one
        const initialSummary = response.summary || "Analyzing page content...";
        elements.pageSummary.textContent = initialSummary;
        
        // Generate a better summary using Gemini
        try {
          const summaryResponse = await chrome.runtime.sendMessage({
            action: "generateSummary",
            content: currentPageData.content,
            metadata: currentPageData.metadata,
            fallbackSummary: initialSummary
          });
          
          if (summaryResponse.summary) {
            currentPageData.summary = summaryResponse.summary;
            elements.pageSummary.textContent = summaryResponse.summary;
          } else if (summaryResponse.fallbackSummary) {
            currentPageData.summary = summaryResponse.fallbackSummary;
          }
        } catch (error) {
          console.error("Failed to generate summary:", error);
          // Keep using the initial summary if we can't generate a better one
        }
        
        // Get AI suggestion for folder
        await getAISuggestion();
      } else {
        showError("Could not extract page content");
      }
    });
  } catch (error) {
    showError("Error communicating with the page: " + error.message);
  }
  
  // Add event listeners
  elements.saveBtn.addEventListener('click', saveBookmark);
  elements.cancelBtn.addEventListener('click', () => window.close());
  elements.refreshFolders.addEventListener('click', loadBookmarkFolders);
  elements.aboutInput.addEventListener('input', debounce(refreshSuggestion, 500));
  
  // Pattern info modal handlers
  elements.patternInfoBtn.addEventListener('click', () => {
    elements.patternInfoModal.style.display = 'block';
  });
  
  elements.closePatternInfo.addEventListener('click', () => {
    elements.patternInfoModal.style.display = 'none';
  });
  
  // Close modal if user clicks outside of it
  window.addEventListener('click', (event) => {
    if (event.target === elements.patternInfoModal) {
      elements.patternInfoModal.style.display = 'none';
    }
  });
});

// Debounce function to prevent excessive API calls
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Refresh the AI suggestion when user inputs what the article is about
async function refreshSuggestion() {
  const userDescription = elements.aboutInput.value.trim();
  if (userDescription) {
    elements.suggestedFolder.textContent = "Updating...";
    // Hide pattern match indicator when user provides custom description
    elements.patternMatchContainer.style.display = 'none';
    isPatternBasedSuggestion = false;
    await getAISuggestion();
  }
}

// Load all bookmark folders
async function loadBookmarkFolders() {
  elements.folderSelect.innerHTML = '<option value="">Loading folders...</option>';
  elements.folderSelect.disabled = true;
  
  try {
    // Get all bookmarks
    const bookmarks = await chrome.bookmarks.getTree();
    const folders = extractFolders(bookmarks);
    
    // Clear and populate dropdown
    elements.folderSelect.innerHTML = '';
    
    // Add default option for root
    const rootOption = document.createElement('option');
    rootOption.value = '1'; // Chrome's default Bookmarks Bar ID
    rootOption.textContent = 'Bookmarks Bar';
    elements.folderSelect.appendChild(rootOption);
    
    // Add all other folders
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.path;
      elements.folderSelect.appendChild(option);
    });
    
    // Add option to create new folder
    const newFolderOption = document.createElement('option');
    newFolderOption.value = 'new';
    newFolderOption.textContent = '+ Create New Folder';
    elements.folderSelect.appendChild(newFolderOption);
    
    elements.folderSelect.disabled = false;
  } catch (error) {
    showError("Error loading bookmark folders: " + error.message);
  }
}

// Extract folders from bookmarks tree
function extractFolders(bookmarkItems, path = '', result = []) {
  for (const item of bookmarkItems) {
    if (item.children) {
      // Skip the root nodes (they don't have titles)
      let currentPath = path;
      if (item.title) {
        currentPath = path ? `${path} > ${item.title}` : item.title;
        result.push({ id: item.id, path: currentPath });
      }
      extractFolders(item.children, currentPath, result);
    }
  }
  return result;
}

// Get folder suggestion from Gemini API
async function getAISuggestion() {
  updateStatus("Getting AI suggestion...");
  
  try {
    // Get API key from storage
    const result = await chrome.storage.local.get('geminiApiKey');
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      elements.suggestedFolder.textContent = "No API key set";
      updateStatus("Please set Gemini API key in extension options", true);
      elements.saveBtn.disabled = true;
      return;
    }
    
    // Get user's description about the article (if provided)
    const userDescription = elements.aboutInput.value.trim();
    const userNotes = elements.notesInput.value.trim();
    
    // First, check if there's a pattern match from user's existing bookmarks
    let patternRecommendation = null;
    try {
      patternRecommendation = await chrome.runtime.sendMessage({
        action: "getUserPatternRecommendation",
        content: currentPageData.content,
        title: currentPageData.title
      });
      
      // If there's a good pattern match, show the pattern match indicator
      if (patternRecommendation && patternRecommendation.recommendation) {
        isPatternBasedSuggestion = true;
        
        // Only show pattern match indicator if user hasn't provided their own description
        if (!userDescription) {
          elements.patternMatchContainer.style.display = 'flex';
          
          // Customize the message based on confidence score
          const confidence = patternRecommendation.recommendation.confidence || 'low';
          if (confidence === 'high') {
            elements.patternMatchText.textContent = "Strong match with your bookmarking patterns";
          } else {
            elements.patternMatchText.textContent = "Based on your bookmarking patterns";
          }
        }
      }
    } catch (error) {
      console.warn("Could not get user pattern recommendation:", error);
      // Continue with AI recommendation only
      isPatternBasedSuggestion = false;
      elements.patternMatchContainer.style.display = 'none';
    }
    
    // Get existing folders for context
    const existingFolders = Array.from(elements.folderSelect.options)
      .filter(option => option.value !== 'new' && option.value !== '')
      .map(option => option.textContent)
      .join(', ');
    
    // Extract top categories from existing folder structure
    const topCategories = analyzeExistingFolders(elements.folderSelect.options);
    
    // Prepare content for Gemini
    const prompt = `Based on the webpage information below, suggest the most appropriate bookmark folder. The user has a specific way of organizing bookmarks.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
${userDescription ? `Description provided by user: ${userDescription}` : ''}
${userNotes ? `Note provided by user: ${userNotes}` : ''}
${currentPageData.summary ? `Summary of page content: ${currentPageData.summary}` : ''}
${currentPageData.metadata.keywords ? `Keywords: ${currentPageData.metadata.keywords}` : ''}

Content excerpt:
${currentPageData.content.substring(0, 500)}...

Existing bookmark folders: ${existingFolders || "None"}

Common categories in user's bookmark structure: ${topCategories}

${patternRecommendation && patternRecommendation.recommendation ? `IMPORTANT: Based on the user's bookmarking patterns, this content may belong in the folder: "${patternRecommendation.recommendation.path}"` : ''}

First decide if one of the existing folders is appropriate or if a new folder should be created.
${patternRecommendation && patternRecommendation.recommendation ? 'Strongly consider the pattern-based recommendation provided above unless you have a compelling reason not to.' : ''}
Then respond in this exact format:
USE_EXISTING: [folder name] 
or 
CREATE_NEW: [new folder name]

The folder name should be short (1-3 words) and descriptive of the topic.`;

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
    
    // Parse the response format
    let folderName;
    let useExisting = false;
    
    if (suggestion.startsWith("USE_EXISTING:")) {
      useExisting = true;
      folderName = suggestion.substring("USE_EXISTING:".length).trim();
    } else if (suggestion.startsWith("CREATE_NEW:")) {
      useExisting = false;
      folderName = suggestion.substring("CREATE_NEW:".length).trim();
    } else {
      // Fallback if the format is not followed
      folderName = suggestion;
    }
    
    elements.suggestedFolder.textContent = folderName;
    
    if (useExisting) {
      // Try to find and select the existing folder
      let found = false;
      Array.from(elements.folderSelect.options).forEach(option => {
        // Check if option text contains or ends with the folder name
        if (option.textContent.includes(folderName) || 
            option.textContent.endsWith(folderName)) {
          elements.folderSelect.value = option.value;
          found = true;
        }
      });
      
      // If not found, fall back to creating a new folder
      if (!found) {
        elements.folderSelect.value = 'new';
      }
    } else {
      // Set to create a new folder
      elements.folderSelect.value = 'new';
    }
    
    updateStatus("Ready to save bookmark", true);
    elements.saveBtn.disabled = false;
    
  } catch (error) {
    showError("AI suggestion error: " + error.message);
    elements.saveBtn.disabled = false;
  }
}

// Function to analyze existing folders and extract common categories
function analyzeExistingFolders(options) {
  // Extract folder names from options
  const folderNames = Array.from(options)
    .filter(option => option.value !== 'new' && option.value !== '')
    .map(option => {
      // Get the last part of the path (the actual folder name)
      const parts = option.textContent.split(' > ');
      return parts[parts.length - 1];
    });
  
  // Count occurrences of each category
  const categoryCounts = {};
  folderNames.forEach(name => {
    categoryCounts[name] = (categoryCounts[name] || 0) + 1;
  });
  
  // Sort by frequency and take top 10
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0])
    .join(', ');
  
  return topCategories;
}

// Save the bookmark
async function saveBookmark() {
  updateStatus("Saving bookmark...");
  elements.saveBtn.disabled = true;
  
  try {
    const selectedFolder = elements.folderSelect.value;
    const notes = elements.notesInput.value;
    
    // Prepare title with notes if provided
    let bookmarkTitle = currentPageData.title;
    if (notes) {
      bookmarkTitle += ` - ${notes}`;
    }
    
    // Add the page summary as a note if available and user didn't add notes
    if (!notes && currentPageData.summary) {
      bookmarkTitle += ` - ${currentPageData.summary.substring(0, 100)}`;
      if (currentPageData.summary.length > 100) {
        bookmarkTitle += '...';
      }
    }
    
    // Record this bookmark action for pattern learning
    try {
      // Store some metadata about this bookmark action for future learning
      chrome.storage.local.get('bookmarkingHistory', (result) => {
        const history = result.bookmarkingHistory || [];
        
        // Add new entry
        history.push({
          url: currentPageData.url,
          title: currentPageData.title, 
          selectedFolder: selectedFolder === 'new' ? elements.suggestedFolder.textContent : 
                         Array.from(elements.folderSelect.options)
                           .find(opt => opt.value === selectedFolder)?.textContent || '',
          wasPatternBased: isPatternBasedSuggestion,
          timestamp: Date.now()
        });
        
        // Keep only the last 100 entries to prevent storage issues
        if (history.length > 100) {
          history.shift();
        }
        
        chrome.storage.local.set({ 'bookmarkingHistory': history });
      });
    } catch (e) {
      // Non-critical error, continue with bookmark creation
      console.warn("Could not save bookmark action to history:", e);
    }
    
    // Handle creating new folder if needed
    if (selectedFolder === 'new') {
      // Get suggested folder name
      const newFolderName = elements.suggestedFolder.textContent;
      
      // Create new folder in the Bookmarks Bar
      const newFolder = await chrome.bookmarks.create({
        parentId: '1', // Chrome's default Bookmarks Bar ID
        title: newFolderName
      });
      
      // Create bookmark in the new folder
      await chrome.bookmarks.create({
        parentId: newFolder.id,
        title: bookmarkTitle,
        url: currentPageData.url
      });
      
    } else {
      // Create bookmark in the existing folder
      await chrome.bookmarks.create({
        parentId: selectedFolder,
        title: bookmarkTitle,
        url: currentPageData.url
      });
    }
    
    updateStatus("Bookmark saved successfully!", true);
    setTimeout(() => window.close(), 1000);
    
  } catch (error) {
    showError("Error saving bookmark: " + error.message);
    elements.saveBtn.disabled = false;
  }
}

// Update status message
function updateStatus(message, finished = false) {
  elements.statusText.textContent = message;
  elements.loader.style.display = finished ? 'none' : 'inline-block';
}

// Show error message
function showError(message) {
  elements.statusText.textContent = message;
  elements.statusText.style.color = 'red';
  elements.loader.style.display = 'none';
}