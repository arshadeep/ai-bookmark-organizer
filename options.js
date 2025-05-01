// DOM elements - API Settings
const apiKeyInput = document.getElementById('apiKey');
const saveApiButton = document.getElementById('saveApiBtn');
const apiStatusDiv = document.getElementById('apiStatus');

// DOM elements - Pattern Settings
const enablePatternsToggle = document.getElementById('enablePatterns');
const patternWeightSlider = document.getElementById('patternWeight');
const patternWeightValue = document.getElementById('patternWeightValue');
const considerHierarchyToggle = document.getElementById('considerHierarchy');
const autoUpdatePatternsToggle = document.getElementById('autoUpdatePatterns');
const resetPatternsButton = document.getElementById('resetPatterns');
const savePatternButton = document.getElementById('savePatternBtn');
const patternStatusDiv = document.getElementById('patternStatus');

// DOM elements - Patterns List
const patternsListDiv = document.getElementById('patternsList');
const refreshPatternsButton = document.getElementById('refreshPatterns');

// DOM elements - Tabs
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

// Default settings for pattern recognition
const defaultPatternSettings = {
  enablePatterns: true,
  patternWeight: 50,
  considerHierarchy: true,
  autoUpdatePatterns: true
};

// Load all settings when the page loads
document.addEventListener('DOMContentLoaded', () => {
  loadApiSettings();
  loadPatternSettings();
  setupTabNavigation();
  updatePatternsList();
  
  // Setup event listeners for pattern weight slider
  patternWeightSlider.addEventListener('input', () => {
    patternWeightValue.textContent = patternWeightSlider.value + '%';
  });
});

// Add event listeners to buttons
saveApiButton.addEventListener('click', saveApiSettings);
savePatternButton.addEventListener('click', savePatternSettings);
resetPatternsButton.addEventListener('click', resetPatternData);
refreshPatternsButton.addEventListener('click', updatePatternsList);

// Tab navigation setup
function setupTabNavigation() {
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      
      // Hide all tab contents
      tabContents.forEach(content => {
        content.classList.remove('active');
      });
      
      // Remove active class from all buttons
      tabButtons.forEach(btn => {
        btn.classList.remove('active');
      });
      
      // Show the selected tab content
      document.getElementById(tabId).classList.add('active');
      
      // Add active class to the clicked button
      button.classList.add('active');
    });
  });
}

// Load API settings from storage
async function loadApiSettings() {
  try {
    const result = await chrome.storage.local.get('geminiApiKey');
    
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  } catch (error) {
    showApiStatus('Error loading settings: ' + error.message, false);
  }
}

// Load pattern recognition settings from storage
async function loadPatternSettings() {
  try {
    const result = await chrome.storage.local.get('patternSettings');
    const settings = result.patternSettings || defaultPatternSettings;
    
    // Apply settings to form
    enablePatternsToggle.checked = settings.enablePatterns;
    patternWeightSlider.value = settings.patternWeight;
    patternWeightValue.textContent = settings.patternWeight + '%';
    considerHierarchyToggle.checked = settings.considerHierarchy;
    autoUpdatePatternsToggle.checked = settings.autoUpdatePatterns;
    
  } catch (error) {
    showPatternStatus('Error loading pattern settings: ' + error.message, false);
  }
}

// Save API settings to storage
async function saveApiSettings() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showApiStatus('Please enter a valid API key', false);
    return;
  }
  
  try {
    // Validate the API key by making a simple test request
    await testApiKey(apiKey);
    
    // Save the API key if test was successful
    await chrome.storage.local.set({ 'geminiApiKey': apiKey });
    
    showApiStatus('API key saved successfully!', true);
  } catch (error) {
    showApiStatus('Error: ' + error.message, false);
  }
}

// Save pattern recognition settings to storage
async function savePatternSettings() {
  try {
    const settings = {
      enablePatterns: enablePatternsToggle.checked,
      patternWeight: parseInt(patternWeightSlider.value),
      considerHierarchy: considerHierarchyToggle.checked,
      autoUpdatePatterns: autoUpdatePatternsToggle.checked
    };
    
    await chrome.storage.local.set({ 'patternSettings': settings });
    
    showPatternStatus('Pattern settings saved successfully!', true);
  } catch (error) {
    showPatternStatus('Error saving pattern settings: ' + error.message, false);
  }
}

// Reset pattern learning data
async function resetPatternData() {
  if (confirm('Are you sure you want to reset all pattern learning data? This cannot be undone.')) {
    try {
      // Clear the bookmarking history used for pattern learning
      await chrome.storage.local.remove('bookmarkingHistory');
      
      // Also clear any cached pattern data
      await chrome.storage.local.remove('folderKeywords');
      
      showPatternStatus('Pattern learning data has been reset.', true);
      
      // Refresh the patterns list
      updatePatternsList();
    } catch (error) {
      showPatternStatus('Error resetting pattern data: ' + error.message, false);
    }
  }
}

// Test the API key with a simple request
async function testApiKey(apiKey) {
  const testPrompt = "Respond with the word 'valid' if you can read this.";
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: testPrompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 10,
        topP: 0.95,
        topK: 40
      }
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message || "API request failed");
  }
  
  const data = await response.json();
  
  // Check if the API response contains content
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    throw new Error("Invalid API response");
  }
  
  return true;
}

// Show API status message
function showApiStatus(message, isSuccess) {
  apiStatusDiv.textContent = message;
  apiStatusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
  apiStatusDiv.style.display = 'block';
  
  // Hide the message after 3 seconds
  setTimeout(() => {
    apiStatusDiv.style.display = 'none';
  }, 3000);
}

// Show pattern status message
function showPatternStatus(message, isSuccess) {
  patternStatusDiv.textContent = message;
  patternStatusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
  patternStatusDiv.style.display = 'block';
  
  // Hide the message after 3 seconds
  setTimeout(() => {
    patternStatusDiv.style.display = 'none';
  }, 3000);
}

// Update the patterns list
async function updatePatternsList() {
  // Show loading message
  patternsListDiv.innerHTML = '<p class="info-text">Loading your bookmark patterns...</p>';
  
  try {
    // Get cached folder keywords from storage
    const result = await chrome.storage.local.get('folderKeywords');
    let folderKeywords = result.folderKeywords;
    
    // If no cached keywords or they're outdated, analyze patterns
    if (!folderKeywords) {
      folderKeywords = await analyzePatterns();
    }
    
    // Display the patterns
    displayPatterns(folderKeywords);
  } catch (error) {
    patternsListDiv.innerHTML = `<p class="info-text">Error loading patterns: ${error.message}</p>`;
  }
}

// Analyze bookmark patterns
async function analyzePatterns() {
  // First, get all bookmarks
  const bookmarks = await chrome.bookmarks.getTree();
  
  // Extract all folders and their bookmarks
  const folderContents = {};
  
  // Recursive function to process bookmark tree
  function processBookmarkItems(items, path = '') {
    for (const item of items) {
      if (item.children) {
        // It's a folder
        const folderPath = path ? `${path} > ${item.title}` : item.title;
        
        // Skip empty or root folders
        if (item.title) {
          folderContents[item.id] = {
            path: folderPath,
            title: item.title,
            bookmarks: []
          };
        }
        
        // Process children
        processBookmarkItems(item.children, folderPath);
      } else if (item.url) {
        // It's a bookmark, add to parent folder
        const parentId = item.parentId;
        if (folderContents[parentId]) {
          folderContents[parentId].bookmarks.push({
            title: item.title,
            url: item.url
          });
        }
      }
    }
  }
  
  // Process the bookmark tree
  processBookmarkItems(bookmarks);
  
  // Now extract keywords from folders with enough bookmarks
  const folderKeywords = {};
  
  for (const folderId in folderContents) {
    const folder = folderContents[folderId];
    
    // Skip folders with too few bookmarks
    if (folder.bookmarks.length < 2) continue;
    
    // Collect all titles from the folder
    const allTitles = folder.bookmarks.map(b => b.title).join(' ');
    
    // Simple keyword extraction
    const words = allTitles.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3) // Only words longer than 3 chars
      .filter(word => !['http', 'https', 'www', 'com', 'the', 'and', 'for', 'that', 'with'].includes(word));
    
    // Count word frequencies
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    // Sort by frequency
    const sortedWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 keywords
      .map(entry => entry[0]);
    
    // Calculate confidence based on number of bookmarks and keyword strength
    let confidence = "Low";
    if (folder.bookmarks.length >= 10) {
      confidence = "High";
    } else if (folder.bookmarks.length >= 5) {
      confidence = "Medium";
    }
    
    folderKeywords[folderId] = {
      path: folder.path,
      title: folder.title,
      keywords: sortedWords,
      bookmarkCount: folder.bookmarks.length,
      confidence: confidence
    };
  }
  
  // Cache the folder keywords
  await chrome.storage.local.set({ 'folderKeywords': folderKeywords });
  
  return folderKeywords;
}

// Display the patterns in the UI
function displayPatterns(folderKeywords) {
  // Clear the patterns list
  patternsListDiv.innerHTML = '';
  
  // Convert to array and sort by bookmark count (most bookmarks first)
  const sortedPatterns = Object.values(folderKeywords)
    .sort((a, b) => b.bookmarkCount - a.bookmarkCount);
  
  if (sortedPatterns.length === 0) {
    patternsListDiv.innerHTML = '<p class="info-text">No bookmark patterns found yet. As you add more bookmarks, patterns will appear here.</p>';
    return;
  }
  
  // Add each pattern to the UI
  sortedPatterns.forEach(pattern => {
    const patternCard = document.createElement('div');
    patternCard.className = 'pattern-card';
    
    // Create folder name element
    const folderElem = document.createElement('div');
    folderElem.className = 'pattern-folder';
    folderElem.textContent = pattern.path;
    patternCard.appendChild(folderElem);
    
    // Create keywords element
    const keywordsElem = document.createElement('div');
    keywordsElem.className = 'pattern-keywords';
    
    // Add keyword chips
    pattern.keywords.forEach(keyword => {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.textContent = keyword;
      keywordsElem.appendChild(chip);
    });
    
    patternCard.appendChild(keywordsElem);
    
    // Create stats element
    const statsElem = document.createElement('div');
    statsElem.className = 'pattern-stats';
    statsElem.textContent = `${pattern.bookmarkCount} bookmarks · ${pattern.confidence} confidence`;
    patternCard.appendChild(statsElem);
    
    // Add the card to the patterns list
    patternsListDiv.appendChild(patternCard);
  });
}