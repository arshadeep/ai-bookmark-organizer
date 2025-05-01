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