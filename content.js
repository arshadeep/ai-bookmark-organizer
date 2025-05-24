// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getPageContent") {
    console.log("Content script: getPageContent request received");
    
    try {
      const pageData = extractPageData();
      console.log("Content script: extracted content length:", pageData.content?.length || 0);
      
      sendResponse({ 
        content: pageData.content,
        summary: pageData.summary,
        structuredData: pageData.structuredData
      });
    } catch (error) {
      console.error("Content script error:", error);
      sendResponse({ 
        content: "",
        summary: "",
        structuredData: {}
      });
    }
  }
  
  // Important: return true to indicate async response
  return true;
});

// Extract relevant content and metadata from the page
function extractPageData() {
  console.log("Content script: Starting content extraction for:", window.location.href);
  
  let result = {
    content: "",
    summary: "",
    structuredData: {}
  };
  
  // Get metadata
  result.structuredData = extractMetadata();
  
  // Get main content using multiple strategies
  result.content = extractMainContent();
  
  // Create a summary (baseline version - will be improved by Gemini)
  result.summary = createSummary(result.content, result.structuredData);
  
  console.log("Content script: Final content length:", result.content?.length || 0);
  return result;
}

// Extract metadata using various methods
function extractMetadata() {
  const metadata = {};
  
  // Standard meta tags
  const metaTags = {
    description: document.querySelector('meta[name="description"]')?.content || 
                document.querySelector('meta[property="og:description"]')?.content,
    keywords: document.querySelector('meta[name="keywords"]')?.content,
    author: document.querySelector('meta[name="author"]')?.content,
    title: document.querySelector('meta[property="og:title"]')?.content || document.title,
    type: document.querySelector('meta[property="og:type"]')?.content,
    publishedTime: document.querySelector('meta[property="article:published_time"]')?.content
  };
  
  // JSON-LD structured data
  try {
    const jsonLdElements = document.querySelectorAll('script[type="application/ld+json"]');
    if (jsonLdElements.length > 0) {
      for (const element of jsonLdElements) {
        try {
          const data = JSON.parse(element.textContent);
          if (data) {
            metadata.jsonLd = data;
            break; // Just use the first valid one for now
          }
        } catch (e) {
          // JSON parsing error, skip this element
        }
      }
    }
  } catch (e) {
    // Ignore errors with JSON-LD parsing
  }
  
  // Clean up any undefined values and add meta tags
  Object.keys(metaTags).forEach(key => {
    if (metaTags[key]) {
      metadata[key] = metaTags[key];
    }
  });
  
  return metadata;
}

// Extract main content using a Readability-like approach with multiple strategies
function extractMainContent() {
  console.log("Content script: Starting main content extraction");
  
  // Strategy 1: Try specific content selectors first
  const contentSelectors = [
    'main',
    'article', 
    '[role="main"]',
    '.main-content',
    '#main-content',
    '.content',
    '#content',
    '.post-content',
    '.entry-content',
    '.article-content',
    // NASA specific selectors
    '.content-area',
    '.page-content',
    '.mission-content',
    '.science-content'
  ];
  
  let content = '';
  let contentFound = false;
  
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const extractedText = extractTextFromElement(element);
      if (extractedText && extractedText.length > 200) {
        console.log(`Content script: Found content using selector "${selector}", length: ${extractedText.length}`);
        content = extractedText;
        contentFound = true;
        break;
      }
    }
  }
  
  // Strategy 2: If no main content found, try paragraph extraction
  if (!contentFound) {
    console.log("Content script: No main content area found, trying paragraph extraction");
    const paragraphs = document.querySelectorAll('p');
    const paragraphTexts = Array.from(paragraphs)
      .map(p => getCleanText(p))
      .filter(text => text.length > 25); // Filter out short paragraphs
    
    if (paragraphTexts.length > 0) {
      content = paragraphTexts.slice(0, 20).join('\n\n'); // Take first 20 meaningful paragraphs
      console.log(`Content script: Extracted ${paragraphTexts.length} paragraphs, total length: ${content.length}`);
      contentFound = true;
    }
  }
  
  // Strategy 3: If still no content, try body text extraction with filtering
  if (!contentFound) {
    console.log("Content script: Trying full body extraction with filtering");
    content = extractTextFromElement(document.body, true);
    if (content && content.length > 100) {
      console.log(`Content script: Extracted body content, length: ${content.length}`);
      contentFound = true;
    }
  }
  
  // Strategy 4: Last resort - just get all text
  if (!contentFound) {
    console.log("Content script: Last resort - getting all visible text");
    content = document.body.innerText || document.body.textContent || '';
    console.log(`Content script: Last resort content length: ${content.length}`);
  }
  
  return content;
}

// Helper function to extract text from an element with optional filtering
function extractTextFromElement(element, withFiltering = false) {
  if (!element) return '';
  
  // Clone the element to avoid modifying the actual page
  const elementClone = element.cloneNode(true);
  
  if (withFiltering) {
    // Remove elements that are unlikely to contain main content
    const elementsToRemove = [
      'script', 'style', 'iframe', 'noscript', 'header', 'footer', 'nav', 
      'aside', 'form', '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
      '[role="form"]', '[role="contentinfo"]', '.sidebar', '.menu', '.nav', '.navigation', 
      '.header', '.footer', '.comments', '.comment', '.advertisement', '.ad', '.ads', 
      '#sidebar', '#header', '#footer', '#nav', '#menu', '#comments', 
      '[hidden]', '.hidden', '[aria-hidden="true"]'
    ];
    
    elementsToRemove.forEach(selector => {
      const elements = elementClone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
  }
  
  return getCleanText(elementClone);
}

// Helper function to get text and normalize whitespace
function getCleanText(element) {
  if (!element) return '';
  
  const text = element.innerText || element.textContent || '';
  
  return text
    .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim();
}

// Create a simple summary from the content
function createSummary(content, metadata) {
  // Use metadata description if available as it's often a good summary
  if (metadata.description && metadata.description.length > 30) {
    return metadata.description;
  }
  
  // Simple summary generation: use first 50 words
  if (content) {
    const words = content.split(/\s+/);
    if (words.length > 15) {
      return words.slice(0, 50).join(' ') + '...';
    }
    return content;
  }
  
  return '';
}

// Log that content script has loaded
console.log("Content script loaded for:", window.location.href);