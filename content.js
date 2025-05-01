// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getPageContent") {
    const pageData = extractPageData();
    sendResponse({ 
      content: pageData.content,
      summary: pageData.summary,
      structuredData: pageData.structuredData
    });
  }
  
  // Important: return true to indicate async response
  return true;
});

// Extract relevant content and metadata from the page
function extractPageData() {
  let result = {
    content: "",
    summary: "",
    structuredData: {}
  };
  
  // Get metadata
  result.structuredData = extractMetadata();
  
  // Get main content using Readability-inspired approach
  result.content = extractMainContent();
  
  // Create a summary (baseline version - will be improved by Gemini)
  result.summary = createSummary(result.content, result.structuredData);
  
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

// Extract main content using a Readability-like approach
function extractMainContent() {
  // Clone the document body to avoid modifying the actual page
  const bodyClone = document.body.cloneNode(true);
  
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
    const elements = bodyClone.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  // Helper function to get text and normalize whitespace
  const getCleanText = (element) => {
    if (!element) return '';
    return element.innerText
      .replace(/\\s+/g, ' ')
      .replace(/\\n+/g, ' ')
      .trim();
  };
  
  // Collect all possible content containers
  const possibleMainElements = [
    bodyClone.querySelector('main'),
    bodyClone.querySelector('article'),
    bodyClone.querySelector('[role="main"]'),
    bodyClone.querySelector('#content'),
    bodyClone.querySelector('.content'),
    bodyClone.querySelector('#main'),
    bodyClone.querySelector('.main'),
    bodyClone.querySelector('.post'),
    bodyClone.querySelector('.article'),
    bodyClone.querySelector('.entry'),
    bodyClone.querySelector('.blog-post'),
    bodyClone.querySelector('.story'),
    bodyClone // Fallback to the entire body if no main content is identified
  ];
  
  // Enhanced content extraction algorithm
  let content = '';
  
  // First try to identify and use the main content element
  const mainElement = possibleMainElements.find(element => element !== null);
  
  if (mainElement) {
    // Get headings first for structure
    const headings = mainElement.querySelectorAll('h1, h2, h3');
    const headingTexts = Array.from(headings).map(h => getCleanText(h));
    
    // Get all paragraphs and content blocks
    const contentElements = mainElement.querySelectorAll('p, article, section, .paragraph, .text, [class*="content"], [class*="text"], [class*="body"]');
    
    // Process paragraph content
    let paragraphs = [];
    contentElements.forEach(el => {
      const text = getCleanText(el);
      if (text.length > 25) { // Minimum length to be considered meaningful content
        paragraphs.push(text);
      }
    });
    
    // If we found good paragraphs, use them
    if (paragraphs.length > 0) {
      content = paragraphs.join('\n\n');
    } 
    // Otherwise, fallback to the main element's text
    else {
      content = getCleanText(mainElement);
    }
    
    // Prepend headings if we have them to give context
    if (headingTexts.length > 0) {
      content = headingTexts.join('\n') + '\n\n' + content;
    }
  }
  
  // If no content was extracted, try to scrape the entire page more aggressively
  if (!content || content.length < 100) {
    // Try to extract all paragraphs from the entire document
    const allParagraphs = bodyClone.querySelectorAll('p');
    const paragraphTexts = Array.from(allParagraphs)
      .map(p => getCleanText(p))
      .filter(text => text.length > 25);
    
    if (paragraphTexts.length > 0) {
      content = paragraphTexts.join('\n\n');
    } else {
      // Last resort: just get all the text from the body
      content = getCleanText(bodyClone);
    }
  }
  
  // Some basic cleaning of the content
  content = content
    .replace(/\s{2,}/g, ' ')  // Remove extra spaces
    .replace(/\n{3,}/g, '\n\n'); // Normalize excessive newlines
  
  return content;
}

// Create a simple summary from the content
function createSummary(content, metadata) {
  // Use metadata description if available as it's often a good summary
  if (metadata.description && metadata.description.length > 30) {
    return metadata.description;
  }
  
  // Simple summary generation: use first 50 words
  const words = content.split(/\\s+/);
  if (words.length > 15) {
    return words.slice(0, 50).join(' ') + '...';
  }
  
  return content;
}