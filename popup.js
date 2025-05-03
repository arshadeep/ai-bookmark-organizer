// Global variables to store page data
let currentPageData = {
  title: '',
  url: '',
  content: '',
  summary: '',
  metadata: {},
  alternativeContext: {}
};

// Variable to track if the suggestion came from pattern matching
let isPatternBasedSuggestion = false;

// Wait for DOM to be fully loaded before getting elements
document.addEventListener('DOMContentLoaded', () => {
  // Elements from the DOM - moved inside DOMContentLoaded
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
  initializePopup(elements);

  // Add event listeners
  elements.saveBtn.addEventListener('click', () => saveBookmark(elements));
  elements.cancelBtn.addEventListener('click', () => window.close());
  elements.refreshFolders.addEventListener('click', () => loadBookmarkFolders(elements));
  elements.aboutInput.addEventListener('input', debounce(() => refreshSuggestion(elements), 500));
  
  // Listen for changes in the suggested folder input
  elements.suggestedFolder.addEventListener('input', () => {
    // When user manually types in the suggestion field, update the folder select
    const userInput = elements.suggestedFolder.value.trim();
    if (userInput) {
      // Check if the folder exists
      let foundMatch = false;
      Array.from(elements.folderSelect.options).forEach(option => {
        if (option.textContent.includes(userInput) || 
            option.textContent.endsWith(userInput)) {
          elements.folderSelect.value = option.value;
          foundMatch = true;
        }
      });
      
      // If no match found, set to create new folder
      if (!foundMatch) {
        elements.folderSelect.value = 'new';
      }
    }
  });
  
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

// Main initialization function
async function initializePopup(elements) {
  try {
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
    await loadBookmarkFolders(elements);
    
    // Get page content from the content script
    try {
      chrome.tabs.sendMessage(currentTab.id, { action: "getPageContent" }, async (response) => {
        // Handle error if response is undefined (connection failure)
        if (chrome.runtime.lastError) {
          console.warn("Content script connection error:", chrome.runtime.lastError);
          handleContentScriptFailure(elements);
          return;
        }
        
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
              metadata: { ...currentPageData.metadata, url: currentPageData.url, title: currentPageData.title },
              fallbackSummary: initialSummary
            });
            
            if (summaryResponse.summary) {
              currentPageData.summary = summaryResponse.summary;
              elements.pageSummary.textContent = summaryResponse.summary;
            } else if (summaryResponse.fallbackSummary) {
              currentPageData.summary = summaryResponse.fallbackSummary;
              
              // Store alternative context if available for use in folder suggestions
              if (summaryResponse.alternativeContext) {
                currentPageData.alternativeContext = summaryResponse.alternativeContext;
              }
            }
          } catch (error) {
            console.error("Failed to generate summary:", error);
            // Keep using the initial summary if we can't generate a better one
          }
          
          // Get AI suggestion for folder
          await getAISuggestion(elements);
        } else {
          // Handle case where content extraction failed
          showError("Could not extract page content", elements);
          
          // Still try to get a folder suggestion based on URL and title
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

// Handle case where content script fails to respond
function handleContentScriptFailure(elements) {
  showError("Could not connect to page. Trying alternative approach...", elements);
  
  // Use URL-based context extraction as fallback
  currentPageData.alternativeContext = extractContextFromUrlAndMetadata({
    title: currentPageData.title,
    url: currentPageData.url
  });
  
  // Try to get folder suggestion with limited information
  getAISuggestion(elements).catch(error => {
    console.error("Could not get AI suggestion:", error);
    elements.suggestedFolder.value = "";
    elements.suggestedFolder.placeholder = "Please enter folder name";
    elements.suggestedFolder.disabled = false;
    updateStatus("Ready to save bookmark", true, elements);
    elements.saveBtn.disabled = false;
  });
}

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
async function refreshSuggestion(elements) {
  const userDescription = elements.aboutInput.value.trim();
  if (userDescription) {
    elements.suggestedFolder.value = "";
    elements.suggestedFolder.placeholder = "Updating...";
    // Hide pattern match indicator when user provides custom description
    elements.patternMatchContainer.style.display = 'none';
    isPatternBasedSuggestion = false;
    await getAISuggestion(elements);
  }
}

// Load all bookmark folders
async function loadBookmarkFolders(elements) {
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
    showError("Error loading bookmark folders: " + error.message, elements);
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
async function getAISuggestion(elements) {
  updateStatus("Getting AI suggestion...", false, elements);
  
  try {
    // Get API key from storage
    const result = await chrome.storage.local.get('geminiApiKey');
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      elements.suggestedFolder.placeholder = "No API key set";
      elements.suggestedFolder.disabled = false;
      updateStatus("Please set Gemini API key in extension options", true, elements);
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
        content: currentPageData.content || "",
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
    
    // Check if we have content or summary to work with
    let contextMissing = false;
    let alternativeContext = currentPageData.alternativeContext || {};
    
    if (!currentPageData.content || currentPageData.content.length < 100) {
      contextMissing = true;
      
      // If we don't already have alternative context, extract it
      if (!alternativeContext || Object.keys(alternativeContext).length === 0) {
        alternativeContext = extractContextFromUrlAndMetadata({
          title: currentPageData.title,
          url: currentPageData.url,
          ...currentPageData.metadata
        });
      }
    }
    
    // Modify prompt based on available context
    let prompt;
    
    if (contextMissing) {
      // Use a different prompt when content extraction failed
      prompt = `I need to suggest the most appropriate bookmark folder with limited information.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
${userDescription ? `Description provided by user: ${userDescription}` : ''}
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
USE_EXISTING: [folder name] 
or 
CREATE_NEW: [new folder name]

The folder name should be short (1-3 words) and descriptive of the topic.`;
    } else {
      // Use the original prompt when we have content
      prompt = `Based on the webpage information below, suggest the most appropriate bookmark folder. The user has a specific way of organizing bookmarks.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
${userDescription ? `Description provided by user: ${userDescription}` : ''}
${userNotes ? `Note provided by user: ${userNotes}` : ''}
${currentPageData.summary ? `Summary of page content: ${currentPageData.summary}` : ''}
${currentPageData.metadata.keywords ? `Keywords: ${currentPageData.metadata.keywords}` : ''}

Content excerpt:
${currentPageData.content ? currentPageData.content.substring(0, 500) + '...' : 'Not available'}

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
    }

    // Send request to background script
    const response = await chrome.runtime.sendMessage({
      action: "getGeminiSuggestion",
      prompt: prompt
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Process the suggestion - FIXED VERSION
    const suggestion = response.suggestion.trim();
    
    // Parse the response format - look for the pattern anywhere in the response
    let folderName = '';
    let useExisting = false;
    
    // Search for USE_EXISTING or CREATE_NEW pattern in the entire response
    const useExistingMatch = suggestion.match(/USE_EXISTING:\s*([^\n]+)/i);
    const createNewMatch = suggestion.match(/CREATE_NEW:\s*([^\n]+)/i);
    
    if (useExistingMatch) {
      useExisting = true;
      folderName = useExistingMatch[1].trim();
    } else if (createNewMatch) {
      useExisting = false;
      folderName = createNewMatch[1].trim();
    } else {
      // Fallback: try to extract a folder name from the response
      // Look for text in quotes or after a colon
      const quotedMatch = suggestion.match(/["']([^"']+)["']/);
      const colonMatch = suggestion.match(/:\s*([^\n]+)/);
      
      if (quotedMatch) {
        folderName = quotedMatch[1].trim();
      } else if (colonMatch) {
        folderName = colonMatch[1].trim();
      } else {
        // Last resort: use first few words of the response
        folderName = suggestion.split(/[.!?\n]/)[0].trim();
        if (folderName.length > 50) {
          folderName = folderName.substring(0, 50) + '...';
        }
      }
    }
    
    // Remove any quotes around the folder name
    folderName = folderName.replace(/^["']|["']$/g, '');
    
    // Ensure the folder name is not too long
    if (folderName.length > 30) {
      // Try to intelligently truncate by finding a good break point
      const words = folderName.split(/\s+/);
      if (words.length > 3) {
        folderName = words.slice(0, 3).join(' ');
      } else {
        folderName = folderName.substring(0, 30) + '...';
      }
    }
    
    // Update the UI with folder name in input field
    elements.suggestedFolder.value = folderName;
    elements.suggestedFolder.disabled = false;
    
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
    
    updateStatus("Ready to save bookmark", true, elements);
    elements.saveBtn.disabled = false;
    
  } catch (error) {
    // If we can't get an AI suggestion, show clear guidance to user
    if (patternRecommendation && patternRecommendation.recommendation) {
      // Use pattern recommendation as fallback
      const folderName = patternRecommendation.recommendation.path.split(' > ').pop();
      elements.suggestedFolder.value = folderName;
      elements.suggestedFolder.disabled = false;
      elements.patternMatchContainer.style.display = 'flex';
      elements.patternMatchText.textContent = "Using your bookmarking patterns (AI unavailable)";
    } else {
      // Ask user to select or create a folder
      elements.suggestedFolder.placeholder = "Please enter folder name";
      elements.suggestedFolder.disabled = false;
    }
    
    showError("Could not get AI suggestion: " + error.message, elements);
    elements.saveBtn.disabled = false;
  }
}

// Analyze existing folders to extract common categories
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
async function saveBookmark(elements) {
  updateStatus("Saving bookmark...", false, elements);
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
    
    // Get the current value from the suggested folder input
    // Get the current value from the suggested folder input
   const suggestedFolderValue = elements.suggestedFolder.value.trim();
   
   // Record this bookmark action for pattern learning
   try {
     // Store some metadata about this bookmark action for future learning
     chrome.storage.local.get('bookmarkingHistory', (result) => {
       const history = result.bookmarkingHistory || [];
       
       // Use the current value in the suggestion field for storing
       let folderNameToStore;
       if (selectedFolder === 'new') {
         // Use the value from the input field
         folderNameToStore = suggestedFolderValue;
       } else {
         // Still use the actual folder path for existing folders
         folderNameToStore = Array.from(elements.folderSelect.options)
           .find(opt => opt.value === selectedFolder)?.textContent || '';
       }
       
       // Add new entry
       history.push({
         url: currentPageData.url,
         title: currentPageData.title, 
         selectedFolder: folderNameToStore,
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
     // Use the value from the input field for the new folder name
     const newFolderName = suggestedFolderValue;
     
     if (!newFolderName) {
       showError("Please enter a folder name", elements);
       elements.saveBtn.disabled = false;
       return;
     }
     
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
   
   updateStatus("Bookmark saved successfully!", true, elements);
   setTimeout(() => window.close(), 1000);
   
 } catch (error) {
   showError("Error saving bookmark: " + error.message, elements);
   elements.saveBtn.disabled = false;
 }
}

// Update status message
function updateStatus(message, finished = false, elements) {
 elements.statusText.textContent = message;
 elements.loader.style.display = finished ? 'none' : 'inline-block';
}

// Show error message
function showError(message, elements) {
 elements.statusText.textContent = message;
 elements.statusText.style.color = 'red';
 elements.loader.style.display = 'none';
}

// Helper function to extract context from URLs when content extraction fails
function extractContextFromUrlAndMetadata(metadata) {
 let context = {};
 
 // 1. Extract topics from title
 if (metadata.title) {
   // Remove common web terms and extract potential topics
   const titleTerms = metadata.title
     .replace(/\s-\s.*$/, '') // Remove site names after dash
     .replace(/\|.*$/, '')    // Remove site names after pipe
     .split(/\s+/)
     .filter(word => 
       word.length > 3 && 
       !['http', 'https', 'www', 'com', 'org', 'the', 'and', 'for'].includes(word.toLowerCase())
     );
   
   context.titleTerms = titleTerms;
 }
 
 // 2. Extract domain and path from URL if available
 if (metadata.url) {
   try {
     const url = new URL(metadata.url);
     
     // Get domain without www
     const domain = url.hostname.replace('www.', '');
     
     // Extract meaningful parts from path (removing common web paths)
     const pathParts = url.pathname.split('/')
       .filter(part => 
         part.length > 0 && 
         !['index', 'home', 'page', 'article', 'post', 'view'].includes(part.toLowerCase())
       );
     
     context.domain = domain;
     context.pathParts = pathParts;
     
     // Special case for common sites
     if (domain.includes('github.com')) {
       context.likelySite = 'Programming/GitHub';
     } else if (domain.includes('stackoverflow.com')) {
       context.likelySite = 'Programming/StackOverflow';
     } else if (domain.includes('medium.com')) {
       context.likelySite = 'Articles';
     } else if (domain.includes('youtube.com')) {
       context.likelySite = 'Videos';
     }
     // Add more site-specific logic here
   } catch (error) {
     console.error("Error parsing URL:", error);
   }
 }
 
 return context;
}