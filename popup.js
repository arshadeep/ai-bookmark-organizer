// Global variables to store page data
let currentPageData = {
  title: '',
  url: '',
  content: ''
};

// Elements from the DOM
const elements = {
  pageTitle: document.getElementById('pageTitle'),
  pageUrl: document.getElementById('pageUrl'),
  folderSelect: document.getElementById('folderSelect'),
  suggestedFolder: document.getElementById('suggestedFolder'),
  notesInput: document.getElementById('notesInput'),
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
        currentPageData.content = response.content;
        
        // Get AI suggestion
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
});

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
    
    // Prepare content for Gemini
    const prompt = `Classify this webpage into one short folder name (e.g., Finance, Health, Recipes, AI Learning, Travel Blogs). Respond with ONLY the folder name, nothing else.

Title: ${currentPageData.title}
URL: ${currentPageData.url}
Content: ${currentPageData.content.substring(0, 500)}...`;

    // Send request to background script
    const response = await chrome.runtime.sendMessage({
      action: "getGeminiSuggestion",
      prompt: prompt
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Use the suggestion
    const suggestedFolder = response.suggestion.trim();
    elements.suggestedFolder.textContent = suggestedFolder;
    
    // Find if the suggested folder exists
    const folderExists = Array.from(elements.folderSelect.options).some(
      option => option.textContent.endsWith(suggestedFolder)
    );
    
    if (folderExists) {
      // Select the existing folder
      Array.from(elements.folderSelect.options).forEach(option => {
        if (option.textContent.endsWith(suggestedFolder)) {
          elements.folderSelect.value = option.value;
        }
      });
    } else {
      // Prepare to create a new folder
      elements.folderSelect.value = 'new';
    }
    
    updateStatus("Ready to save bookmark", true);
    elements.saveBtn.disabled = false;
    
  } catch (error) {
    showError("AI suggestion error: " + error.message);
    elements.saveBtn.disabled = false;
  }
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