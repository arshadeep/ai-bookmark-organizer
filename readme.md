# AI Bookmark Organizer

A Chrome extension that automatically categorizes your bookmarks using Google's Gemini AI with enhanced content analysis.

## Features

- **AI-Powered Categorization**: Analyzes page content to suggest the most appropriate folder
- **User Context Integration**: Add your own description of what the article is about for better categorization
- **Smart Content Analysis**: Advanced page scraping to extract meaningful content
- **Automatic Summarization**: Creates concise 50-word summaries of bookmarked pages
- **Smart Folder Management**: Saves to existing folders or creates new ones automatically
- **Optional Notes**: Add custom notes to your bookmarks
- **Native Chrome Integration**: Works directly with Chrome's bookmark system
- **Minimal Setup**: Just install and add your Gemini API key

## Installation

### Developer Mode (Until Published to Chrome Web Store)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the folder containing the extension files
5. The extension icon will appear in your Chrome toolbar

### Setting Up Your API Key

1. After installation, the options page will open automatically
2. Get a Gemini API key from [Google AI Studio](https://ai.google.dev/)
3. Enter your API key in the settings page
4. Click "Save Settings"

## How to Use

1. Navigate to a webpage you want to bookmark
2. Click the AI Bookmark Organizer icon in your toolbar
3. The extension will analyze the page and suggest a category
4. (Optional) Describe what the article is about to improve categorization
5. View the AI-generated summary of the page
6. Add optional notes if desired
7. Click "Save Bookmark" to save the page to the suggested folder (or choose a different one)

## Folder Structure

```
ai-bookmark-organizer/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
├── background.js
├── options.html
├── options.js
├── README.md
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Technical Details

- **Permissions Used**:
  - `bookmarks`: To manage Chrome bookmarks
  - `tabs`: To access the current tab
  - `activeTab`: To extract content from the current page
  - `storage`: To store API key and settings
  - `scripting`: For enhanced content extraction

- **Content Analysis**:
  - Advanced readability-inspired content extraction
  - Structured metadata collection (JSON-LD, OpenGraph, etc.)
  - Semantic content understanding

- **AI Integration**:
  - Uses Google Gemini API for content analysis and summarization
  - Two-step AI processing: content categorization and page summarization
  - Requires a valid API key from Google AI Studio

## Future Enhancements

- Smart dashboard to view categorized bookmarks
- Ability to reorganize existing bookmarks
- Multi-browser support (Firefox, Edge)
- Offline AI fallback for when API is unavailable
- Tag-based organization alongside folder-based organization

## Privacy

This extension:
- Only analyzes the content of pages you choose to bookmark
- Stores your API key locally on your device
- Does not collect any user data
- Does not share your browsing history or bookmarks

## License

MIT License