// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getGeminiSuggestion") {
    getGeminiSuggestion(request.prompt)
      .then(suggestion => {
        sendResponse({ suggestion });
      })
      .catch(error => {
        console.error("Gemini API error:", error);
        sendResponse({ error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
  
  if (request.action === "generateSummary") {
    generatePageSummary(request.content, request.metadata)
      .then(summary => {
        sendResponse({ summary });
      })
      .catch(error => {
        console.error("Summary generation error:", error);
        sendResponse({ error: error.message, fallbackSummary: request.fallbackSummary });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
  
  // New handler for user pattern recommendations
  if (request.action === "getUserPatternRecommendation") {
    getUserPatternFolderRecommendation(request.content, request.title)
      .then(recommendation => {
        sendResponse({ recommendation });
      })
      .catch(error => {
        console.error("Pattern recommendation error:", error);
        sendResponse({ error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

// Function to call the Gemini API
async function getGeminiSuggestion(prompt) {
  try {
    // Get the API key from storage
    const result = await chrome.storage.local.get('geminiApiKey');
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      throw new Error("No API key set. Please set your Gemini API key in the extension options.");
    }
    
    // Call Gemini API
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
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 50, // Increased to handle the new format
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
    
    // Extract the response text
    if (data.candidates && data.candidates[0] && 
        data.candidates[0].content && 
        data.candidates[0].content.parts && 
        data.candidates[0].content.parts[0]) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Unexpected API response format");
    }
  } catch (error) {
    console.error("Error in getGeminiSuggestion:", error);
    throw error;
  }
}

// Function to generate a concise summary using Gemini
async function generatePageSummary(content, metadata) {
  try {
    // Get the API key from storage
    const result = await chrome.storage.local.get('geminiApiKey');
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      throw new Error("No API key set");
    }
    
    // Extract important information from the title
    const title = metadata.title || '';
    let titleClues = '';
    
    if (title) {
      // Extract possible topic indicators from the title
      const titleWords = title.split(/\s+/).filter(word => word.length > 3);
      titleClues = `Key terms from title: ${titleWords.join(', ')}`;
    }
    
    // Get first 100 words and last 100 words for better context
    const allWords = content.split(/\s+/);
    const startWords = allWords.slice(0, 100).join(' ');
    const endWords = allWords.length > 200 
      ? allWords.slice(Math.max(0, allWords.length - 100)).join(' ') 
      : '';
    
    // Prepare the prompt for summary generation
    const summaryPrompt = `Generate a concise and informative summary (approximately 50 words) that explains what this webpage is about. Focus on the main topic, purpose, and key information. Make it useful for someone who wants to know what this bookmark contains.

Title: ${metadata.title || 'Unknown title'}
${metadata.description ? `Description: ${metadata.description}` : ''}
${metadata.keywords ? `Keywords: ${metadata.keywords}` : ''}
${metadata.author ? `Author: ${metadata.author}` : ''}
${metadata.type ? `Content type: ${metadata.type}` : ''}
${titleClues}

Beginning of content:
${startWords}

${endWords ? `End of content:\n${endWords}` : ''}

Additional content excerpts:
${content.substring(content.length / 3, content.length / 3 + 200)}

Respond with ONLY the summary, nothing else. The summary should clearly identify the specific topic and purpose of the page.`;

    // Call Gemini API with larger token limit for summary
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
                text: summaryPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 100, // Allow enough tokens for a good summary
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
    
    // Extract the response text
    if (data.candidates && data.candidates[0] && 
        data.candidates[0].content && 
        data.candidates[0].content.parts && 
        data.candidates[0].content.parts[0]) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Unexpected API response format");
    }
  } catch (error) {
    console.error("Error in generatePageSummary:", error);
    throw error;
  }
}

// Handle install/update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page for first-time setup
    chrome.runtime.openOptionsPage();
  }
});

// Function to analyze user's existing bookmarks and their organization patterns
async function analyzeUserBookmarkPatterns() {
  // Get all bookmarks
  const bookmarks = await chrome.bookmarks.getTree();
  
  // Extract all folders and their bookmarks
  const folderContents = {};
  
  // Recursive function to process bookmark tree
  function processBookmarkItems(items, path = '') {
    for (const item of items) {
      if (item.children) {
        // It's a folder
        const folderPath = path ? `${path} > ${item.title}` : item.title;
        folderContents[item.id] = {
          path: folderPath,
          title: item.title,
          bookmarks: []
        };
        
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
  
  processBookmarkItems(bookmarks);
  return folderContents;
}

// Function to extract keywords from a folder's bookmarks
async function extractFolderKeywords(folderContents) {
  const folderKeywords = {};
  
  for (const folderId in folderContents) {
    const folder = folderContents[folderId];
    
    // Skip folders with too few bookmarks
    if (folder.bookmarks.length < 2) continue;
    
    // Collect all titles from the folder
    const allTitles = folder.bookmarks.map(b => b.title).join(' ');
    
    // Simple keyword extraction (can be enhanced)
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
    
    folderKeywords[folderId] = {
      path: folder.path,
      title: folder.title,
      keywords: sortedWords,
      bookmarkCount: folder.bookmarks.length
    };
  }
  
  return folderKeywords;
}

// Function to find the most appropriate folder based on content and user patterns
async function findBestFolder(pageContent, title, userFolderKeywords) {
  // Get pattern settings
  const result = await chrome.storage.local.get('patternSettings');
  const settings = result.patternSettings || { 
    enablePatterns: true, 
    patternWeight: 50,
    considerHierarchy: true
  };
  
  // If patterns are disabled, return null
  if (!settings.enablePatterns) {
    return null;
  }
  
  // Prepare scoring object
  const folderScores = {};
  
  // Lowercase content for comparison
  const lowerContent = (pageContent + ' ' + title).toLowerCase();
  
  // Calculate scores based on keyword matches
  for (const folderId in userFolderKeywords) {
    const folder = userFolderKeywords[folderId];
    let score = 0;
    
    // Score each keyword match
    folder.keywords.forEach(keyword => {
      const regex = new RegExp('\\b' + keyword + '\\b', 'gi');
      const matches = lowerContent.match(regex) || [];
      score += matches.length;
    });
    
    // Normalize by number of keywords
    if (folder.keywords.length > 0) {
      score = score / folder.keywords.length;
    }
    
    // Add a bonus for folders with more bookmarks (more established categories)
    score *= (1 + Math.min(folder.bookmarkCount, 20) / 20);
    
    // Apply pattern weight from settings (0-100%)
    score *= (settings.patternWeight / 100);
    
    folderScores[folderId] = {
      path: folder.path,
      score: score,
      confidence: score > 1 ? "high" : (score > 0.5 ? "medium" : "low")
    };
  }
  
  // Sort folders by score
  const sortedFolders = Object.entries(folderScores)
    .sort((a, b) => b[1].score - a[1].score);
  
  // Return the best matching folder or null if no good match
  return sortedFolders.length > 0 && sortedFolders[0][1].score > 0.5 
    ? { 
        id: sortedFolders[0][0], 
        path: sortedFolders[0][1].path,
        confidence: sortedFolders[0][1].confidence,
        score: sortedFolders[0][1].score
      } 
    : null;
}

// Cache for folder keywords to avoid repeated analysis
let cachedFolderKeywords = null;
let lastAnalysisTime = 0;
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

// Function to get folder recommendations based on user patterns
async function getUserPatternFolderRecommendation(pageContent, title) {
  try {
    // Get pattern settings
    const result = await chrome.storage.local.get('patternSettings');
    const settings = result.patternSettings || { enablePatterns: true };
    
    // If patterns are disabled, return early
    if (!settings.enablePatterns) {
      return { recommendation: null };
    }
    
    const now = Date.now();
    
    // Refresh cache if needed
    if (!cachedFolderKeywords || now - lastAnalysisTime > CACHE_TTL) {
      const folderContents = await analyzeUserBookmarkPatterns();
      cachedFolderKeywords = await extractFolderKeywords(folderContents);
      lastAnalysisTime = now;
      
      // Store in local storage for other uses (like the options page)
      await chrome.storage.local.set({ 'folderKeywords': cachedFolderKeywords });
    }
    
    const recommendation = await findBestFolder(pageContent, title, cachedFolderKeywords);
    return { recommendation };
  } catch (error) {
    console.error("Error in getUserPatternFolderRecommendation:", error);
    return { error: error.message };
  }
}