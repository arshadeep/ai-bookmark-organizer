// DOM elements
const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');

// Load saved settings when the page loads
document.addEventListener('DOMContentLoaded', loadSettings);

// Add event listener to save button
saveButton.addEventListener('click', saveSettings);

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('geminiApiKey');
    
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  } catch (error) {
    showStatus('Error loading settings: ' + error.message, false);
  }
}

// Save settings to storage
async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showStatus('Please enter a valid API key', false);
    return;
  }
  
  try {
    // Validate the API key by making a simple test request
    await testApiKey(apiKey);
    
    // Save the API key if test was successful
    await chrome.storage.local.set({ 'geminiApiKey': apiKey });
    
    showStatus('Settings saved successfully!', true);
  } catch (error) {
    showStatus('Error: ' + error.message, false);
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

// Show status message
function showStatus(message, isSuccess) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
  statusDiv.style.display = 'block';
  
  // Hide the message after 3 seconds
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}