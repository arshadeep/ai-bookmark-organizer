// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getPageContent") {
    const pageContent = extractPageContent();
    sendResponse({ content: pageContent });
  }
  
  // Important: return true to indicate async response
  return true;
});

// Extract relevant content from the page
function extractPageContent() {
  let content = "";
  
  // Get meta description if available
  const metaDescription = document.querySelector('meta[name="description"]')?.content || 
                         document.querySelector('meta[property="og:description"]')?.content || '';
  
  // Get main content
  // First try to identify the main content area
  const possibleMainElements = [
    document.querySelector('main'),
    document.querySelector('article'),
    document.querySelector('#content'),
    document.querySelector('.content'),
    document.querySelector('#main'),
    document.querySelector('.main'),
    document.body // Fallback to body if no main content is identified
  ];
  
  // Use the first valid element from the list
  const mainElement = possibleMainElements.find(element => element !== null);
  
  // Extract text from the main element, removing scripts, styles, etc.
  if (mainElement) {
    // Create a clone to avoid modifying the actual page
    const clone = mainElement.cloneNode(true);
    
    // Remove script, style, and hidden elements
    const elementsToRemove = clone.querySelectorAll('script, style, [hidden], .hidden, .nav, .menu, .footer, .header, nav, header, footer');
    elementsToRemove.forEach(el => el.remove());
    
    // Get the text content
    content = clone.innerText || clone.textContent || '';
    
    // Clean up the content
    content = content.replace(/\\s+/g, ' ').trim();
    
    // Limit to first 500 words for efficiency
    const words = content.split(' ');
    if (words.length > 500) {
      content = words.slice(0, 500).join(' ') + '...';
    }
  }
  
  // Combine meta description and content
  return `${metaDescription}\n\n${content}`;
}